"""/auth/* — login, refresh, logout, and the protected /auth/me echo."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import (
    AuthContext,
    create_access_token,
    create_refresh_token,
    decode_token,
    new_session,
    require_auth,
    revoke_jti,
    validate_login_credentials,
)
from app.config import settings

router = APIRouter()


# ── Request / response models ──────────────────────────────────────────────


class LoginRequest(BaseModel):
    """Body of `POST /auth/login`.

    `device_id` and `device_token` are both required. Today the token is
    just an 8+ char shared secret — OIDC pass swaps `device_token` for
    an auth-code flow.
    """

    device_id: str = Field(..., min_length=1, description="Per-install device id (ULID)")
    device_token: str = Field(..., min_length=1, description="Device-issued bearer token")


class TokenPair(BaseModel):
    """Access + refresh pair returned by `/auth/login` and `/auth/refresh`."""

    access_token: str
    refresh_token: str
    expires_in: int  # access-token TTL in seconds


class RefreshRequest(BaseModel):
    """Body of `POST /auth/refresh`."""

    refresh_token: str = Field(..., min_length=1)


class LogoutRequest(BaseModel):
    """Body of `POST /auth/logout`.

    ``refresh_token`` is optional — pass it to also revoke the refresh
    side of the current session. The access token is always revoked
    (it's the one that authenticated this call).
    """

    refresh_token: str | None = Field(default=None, min_length=1)


class LogoutResponse(BaseModel):
    """What `POST /auth/logout` returns."""

    revoked: bool
    access_revoked: bool
    refresh_revoked: bool


class MeResponse(BaseModel):
    """What `GET /auth/me` returns — a quick way for clients to verify
    the bearer is still alive and discover its remaining lifetime."""

    device_id: str
    exp: int  # unix-seconds expiry of the *access* token used for this call


# ── Endpoints ──────────────────────────────────────────────────────────────


@router.post("/login", response_model=TokenPair, status_code=status.HTTP_200_OK)
async def login(req: LoginRequest) -> TokenPair:
    """Exchange a (device_id, device_token) pair for a JWT pair.

    v0: any non-empty device_id + 8+ char device_token is accepted. This
    is the same trust shape the old `verify_device_token` shim had, but
    the client now holds a real, signed token instead of an opaque string.
    """
    validate_login_credentials(req.device_id, req.device_token)
    pair = new_session(req.device_id)
    return TokenPair(**pair)


@router.post("/refresh", response_model=TokenPair)
async def refresh(req: RefreshRequest) -> TokenPair:
    """Trade a refresh token for a fresh access+refresh pair.

    The OLD refresh token's ``jti`` is immediately written to the
    Redis-backed revocation list with TTL = its remaining lifetime, so
    any subsequent decode rejects it with 401 "Token revoked". When
    Redis is unreachable the revocation silently degrades — the old
    refresh keeps working until natural expiry (see docs/12-REDIS.md).
    """
    try:
        payload = await decode_token(req.refresh_token, expected_type="refresh")
    except HTTPException as exc:
        # Pass through the upstream detail (e.g. "Wrong token type",
        # "Token expired") so clients can debug without a second probe.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=exc.detail,
        ) from exc
    device_id = str(payload["sub"])

    # Revoke the old refresh token. TTL = remaining lifetime so the
    # entry expires at the same moment the token would have anyway —
    # no background sweep needed.
    old_jti = str(payload.get("jti") or "")
    if old_jti:
        remaining = max(0, int(payload.get("exp", 0)) - int(time.time()))
        await revoke_jti(old_jti, "refresh", remaining)

    new_pair = {
        "access_token": create_access_token(device_id),
        "refresh_token": create_refresh_token(device_id),
        "expires_in": settings.jwt_access_ttl_seconds,
    }
    return TokenPair(**new_pair)


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    req: LogoutRequest | None = None,
    ctx: AuthContext = Depends(require_auth),
) -> LogoutResponse:
    """Revoke the current access token (and the supplied refresh token).

    One-call "log me out everywhere this token is used". Idempotent —
    revoking an already-revoked ``jti`` is a no-op. Falls back to a
    no-op when Redis is down so a Redis outage doesn't lock users out.
    """
    # Always revoke the access token we just authenticated with.
    access_revoked = False
    if ctx.jti:
        remaining = max(0, int(ctx.exp) - int(time.time()))
        await revoke_jti(ctx.jti, "access", remaining)
        access_revoked = True

    refresh_revoked = False
    if req and req.refresh_token:
        try:
            refresh_payload = await decode_token(req.refresh_token, expected_type="refresh")
        except HTTPException:
            # Caller supplied an invalid refresh — ignore, but don't 4xx.
            # They might be logging out from a different device that
            # already lost its refresh token.
            refresh_revoked = False
        else:
            refresh_jti = str(refresh_payload.get("jti") or "")
            refresh_exp = int(refresh_payload.get("exp", 0))
            if refresh_jti:
                remaining = max(0, refresh_exp - int(time.time()))
                await revoke_jti(refresh_jti, "refresh", remaining)
                refresh_revoked = True

    return LogoutResponse(
        revoked=True,
        access_revoked=access_revoked,
        refresh_revoked=refresh_revoked,
    )


@router.get("/me", response_model=MeResponse)
async def me(ctx: AuthContext = Depends(require_auth)) -> MeResponse:
    """Echo back the authenticated device + this access token's expiry.

    Useful as a "is my bearer still alive?" probe — clients can hit this
    on app foreground to decide whether to silently refresh.
    """
    return MeResponse(device_id=ctx.device_id, exp=ctx.exp)
