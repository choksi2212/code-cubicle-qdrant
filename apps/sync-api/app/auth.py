"""Real JWT-based authentication.

Tokens:
- Access token (HS256, 15 min TTL):  ``Authorization: Bearer <jwt>`` on
  every sync endpoint. Payload: ``{sub: device_id, iat, exp, type: "access"}``.
- Refresh token (HS256, 7 day TTL): long-lived secret the device stores
  in EncryptedSharedPreferences. Payload:
  ``{sub: device_id, iat, exp, type: "refresh", jti: <uuid>}``.

For now the ``/auth/login`` endpoint accepts any non-empty ``device_id``
plus an 8+ char ``device_token`` and mints a real JWT. We swap that
``device_token`` validation for an OIDC code-exchange once enterprise SSO
is wired up — the JWT plumbing stays the same.

Replacement policy for refresh tokens:
    v0 (this commit): rotate-on-refresh — every successful
    ``/auth/refresh`` issues a brand new refresh token and the old one
    remains valid until its natural expiry. We accept reuse of the old
    token for now because we don't have a server-side revocation store.
    v1 (TODO, see comment in decode_token): introduce a Redis-backed
    ``jti`` revocation list and reject any previously-rotated refresh
    token. OIDC swap will land in the same pass — refresh tokens get
    replaced by OIDC's own refresh-token semantics.
"""

from __future__ import annotations

import secrets
import time
import uuid
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException, status

from app.config import settings


# ── Token model ────────────────────────────────────────────────────────────


@dataclass
class AuthContext:
    """What `Depends(require_auth)` returns."""

    device_id: str
    exp: int       # unix seconds — exposed so /auth/me can echo it back
    jti: str | None  # only set for refresh tokens


# ── Encoding ───────────────────────────────────────────────────────────────


def create_access_token(device_id: str) -> str:
    """Mint a short-lived access token for the given device.

    Each access token carries a `jti` (random uuid hex) so two tokens
    minted in the same second for the same device are byte-distinct —
    otherwise repeated logins / refreshes produce literally identical
    JWTs, which makes "did the access token rotate?" impossible to tell
    from the wire.
    """
    now = int(time.time())
    payload = {
        "sub": device_id,
        "iat": now,
        "exp": now + settings.jwt_access_ttl_seconds,
        "type": "access",
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_refresh_token(device_id: str) -> str:
    """Mint a long-lived refresh token. Each token gets a unique `jti`.

    v0: we don't persist `jti` server-side, so reuse of an old refresh
    token will keep working until its natural expiry. TODO (OIDC pass):
    persist `jti` to Redis with TTL = refresh_ttl and reject any token
    whose `jti` was previously rotated out.
    """
    now = int(time.time())
    payload = {
        "sub": device_id,
        "iat": now,
        "exp": now + settings.jwt_refresh_ttl_seconds,
        "type": "refresh",
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str, expected_type: str) -> dict:
    """Verify signature + expiry + type, return the payload dict.

    Raises ``HTTPException(401)`` on any failure (bad signature, expired,
    wrong type, malformed). Callers should treat the returned dict as
    authoritative — it has already been cryptographically verified.
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            options={"require": ["exp", "iat", "sub", "type", "jti"]},
        )
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token expired: {e}",
        ) from e
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        ) from e

    if payload.get("type") != expected_type:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Wrong token type: expected '{expected_type}', got '{payload.get('type')}'",
        )

    return payload


# ── Login / refresh payloads ───────────────────────────────────────────────


def validate_login_credentials(device_id: str, device_token: str) -> None:
    """For now: any non-empty device_id + 8+ char device_token.

    v1 (TODO OIDC): swap this body for an OIDC code-exchange that calls
    the enterprise IdP's ``/token`` endpoint and verifies the ID token's
    signature + ``sub`` claim. The ``device_id`` we mint can come from
    the ID token's ``sub`` or an internal mapping.
    """
    if not device_id or not isinstance(device_id, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="device_id is required",
        )
    if not device_token or not isinstance(device_token, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="device_token is required",
        )
    if len(device_token) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="device_token must be at least 8 characters",
        )


def new_session(device_id: str) -> dict:
    """Mint a fresh access + refresh pair for a freshly-authenticated device."""
    return {
        "access_token": create_access_token(device_id),
        "refresh_token": create_refresh_token(device_id),
        "expires_in": settings.jwt_access_ttl_seconds,
    }


# ── FastAPI dependency ─────────────────────────────────────────────────────


def _extract_bearer(authorization: str | None) -> str:
    """Pull the token out of an `Authorization: Bearer <x>` header."""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization scheme",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization[len("Bearer "):].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


async def require_auth(
    authorization: str | None = Header(default=None),
) -> AuthContext:
    """FastAPI dependency: validate the access token and return device_id.

    Wire every sync endpoint with ``Depends(require_auth)`` instead of the
    old ``verify_device_token`` shim.
    """
    token = _extract_bearer(authorization)
    payload = decode_token(token, expected_type="access")
    return AuthContext(
        device_id=str(payload["sub"]),
        exp=int(payload["exp"]),
        jti=None,
    )


# Back-compat alias — same signature as the old shim, returns just the
# device_id string so the few callers that expected a plain `str` keep
# working without churn. New code should use `require_auth` directly.
async def verify_device_token(
    authorization: str | None = Header(default=None),
) -> str:
    """Deprecated: prefer `Depends(require_auth)` which returns an AuthContext."""
    ctx = await require_auth(authorization)
    return ctx.device_id


def generate_test_secret() -> str:
    """For tests that want their own deterministic secret."""
    return secrets.token_hex(32)
