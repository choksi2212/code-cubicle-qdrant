"""Auth utilities (device token verification)."""

from fastapi import Header, HTTPException, status


async def verify_device_token(authorization: str | None = Header(default=None)) -> str:
    """Verify Bearer token and return the device_id.

    For the hackathon: any non-empty token works. Production would
    verify against a database of issued tokens.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization scheme",
        )

    token = authorization[len("Bearer "):]
    if not token or len(token) < 8:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    # v1: trust the token; v2: look up device_id in DB
    # Extract device_id from prefix like "dev_550e8400..."
    if token.startswith("dev_"):
        return token[4:]

    # Fallback: use the token as device_id (insecure but works for demo)
    return token
