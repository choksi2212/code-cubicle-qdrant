"""/auth/* — login, refresh, and the protected /auth/me echo."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import (
    AuthContext,
    create_access_token,
    create_refresh_token,
    decode_token,
    new_session,
    require_auth,
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

    v0: rotated refresh tokens stay valid until their natural expiry
    (no server-side revocation list yet — TODO in OIDC pass). For now
    the rotation is a defence-in-depth improvement, not a hard revoke.
    """
    try:
        payload = decode_token(req.refresh_token, expected_type="refresh")
    except HTTPException as exc:
        # Pass through the upstream detail (e.g. "Wrong token type",
        # "Token expired") so clients can debug without a second probe.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=exc.detail,
        ) from exc
    device_id = str(payload["sub"])
    new_pair = {
        "access_token": create_access_token(device_id),
        # Brand new jti — old refresh token will keep working too until
        # we land a jti-revocation list. See decode_token's TODO.
        "refresh_token": create_refresh_token(device_id),
        "expires_in": settings.jwt_access_ttl_seconds,
    }
    return TokenPair(**new_pair)


@router.get("/me", response_model=MeResponse)
async def me(ctx: AuthContext = Depends(require_auth)) -> MeResponse:
    """Echo back the authenticated device + this access token's expiry.

    Useful as a "is my bearer still alive?" probe — clients can hit this
    on app foreground to decide whether to silently refresh.
    """
    return MeResponse(device_id=ctx.device_id, exp=ctx.exp)
