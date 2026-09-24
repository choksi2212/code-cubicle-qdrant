"""Async Redis client + graceful-fallback helpers.

We provision a single shared ``redis.asyncio.Redis`` connection pool
(``max_connections=10`` — well under the Redis Labs free-tier cap of 30
connections). The instance is lazily created on the first call to
:meth:`get_redis` so import order doesn't matter and tests can disable
Redis entirely via :attr:`Settings.redis_enabled` before the pool ever
spins up.

The free tier gives us 30 MB / 100 ops/sec / 30 connections. The two
call-sites that actually hit Redis (``is_jti_revoked`` on every request
and ``EXISTS upload:<hash>`` on every upload) are well under those
limits in normal traffic — see ``docs/12-REDIS.md`` for the rollout
plan and the failure modes we degrade into.
"""

from __future__ import annotations

from typing import Optional

import redis.asyncio as redis_async

from app.config import settings


_pool: Optional[redis_async.Redis] = None


async def get_redis() -> redis_async.Redis:
    """Return the shared async Redis client, creating it on first use.

    Returns ``None`` when ``settings.redis_enabled`` is False so call-sites
    can short-circuit before issuing any network traffic. (Callers should
    normally use :func:`is_redis_available` rather than checking this
    directly — they want to know "is Redis usable right now", not "is it
    enabled in config".)
    """
    global _pool
    if _pool is None and settings.redis_enabled:
        _pool = redis_async.from_url(
            settings.redis_url,
            decode_responses=True,
            max_connections=10,  # well under free-tier 30 cap
            socket_timeout=2.0,
        )
    return _pool


async def ping_redis() -> bool:
    """One round-trip ping. Returns False when Redis is disabled or unreachable.

    Never raises — wraps the underlying network error in a clean boolean so
    the readiness probe and startup logging can both treat "down" the same
    way regardless of why it's down.
    """
    if not settings.redis_enabled:
        return False
    try:
        r = await get_redis()
        return bool(await r.ping())
    except Exception:
        return False


async def is_redis_available() -> bool:
    """Cached-flavour ping. Re-pings every call (one round-trip each)."""
    return await ping_redis()


async def close_redis() -> None:
    """Tear down the connection pool. Safe to call when no pool was created."""
    global _pool
    if _pool is not None:
        try:
            await _pool.aclose()
        except Exception:
            pass
        _pool = None
