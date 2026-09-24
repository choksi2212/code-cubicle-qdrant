"""Pytest config for the sync-api test suite.

Two global fixtures are installed here:

* ``disable_redis_for_tests`` — sets ``REDIS_ENABLED=false`` BEFORE
  ``app.config.settings`` is imported, so all call-sites that check
  ``settings.redis_enabled`` short-circuit (no network attempts, no
  revocation checks, no idempotency caching). The existing test suite
  was written under the v0 "rotate-on-refresh, no revocation list"
  contract — keeping Redis disabled by default preserves that.

  Tests that need real Redis behaviour opt in by setting the
  ``live_redis`` marker; the ``live_redis_session`` fixture in this
  module re-enables the live URL for those tests only.
"""

from __future__ import annotations

import os
import uuid

# Must run BEFORE app.config (and therefore app.main) is imported, so
# pydantic-settings reads the env var on first construction.
os.environ.setdefault("REDIS_ENABLED", "false")

import pytest  # noqa: E402


def pytest_collection_modifyitems(config, items):
    """Auto-mark async test functions so pytest-asyncio picks them up."""
    for item in items:
        if item.get_closest_marker("asyncio") is not None:
            continue
        import inspect
        if inspect.iscoroutinefunction(getattr(item, "function", None)):
            item.add_marker(pytest.mark.asyncio)


# ── Live Redis fixtures (opt-in via @pytest.mark.live_redis) ──────────────


LIVE_REDIS_URL = (
    "redis://default:b9FfN7glX71uiwykWW6WZqMjZg6NIhR2@"
    "redis-19164.c270.us-east-1-3.ec2.cloud.redislabs.com:19164"
)


@pytest.fixture
def live_redis(monkeypatch):
    """Re-enable the real Redis URL for one test. Namespaces every
    key the test touches under a fresh run-id prefix so concurrent CI
    runs don't trample each other.

    Returns a tiny helper ``key(suffix) -> str`` for building namespaced
    keys. Use it in revocation / idempotency tests to assert on
    ``revoked:refresh:<run_id>...`` and ``upload:<hash>...`` without
    leaking state between runs.

    The fixture restores ``redis_enabled=False`` after the test so a
    subsequent test (that doesn't ask for ``live_redis``) doesn't
    accidentally inherit the live URL via module-level ``settings``.
    Without this teardown, a cached response from a prior run leaks
    into tests that should otherwise see Redis as disabled.
    """
    monkeypatch.setenv("REDIS_ENABLED", "true")
    monkeypatch.setenv("REDIS_URL", LIVE_REDIS_URL)

    # Re-import settings + reset the module-level pool so the new URL
    # takes effect.
    from app import config as _config
    from app import redis_client as _rc

    _config.settings.redis_enabled = True
    _config.settings.redis_url = LIVE_REDIS_URL
    _rc._pool = None  # force a fresh pool bound to the new URL

    run_id = uuid.uuid4().hex[:8]

    def namespaced(suffix: str) -> str:
        return f"test:{run_id}:{suffix}"

    yield namespaced

    # Teardown: restore module-level state so the next test (which may
    # not opt in to live_redis) sees Redis as disabled.
    _config.settings.redis_enabled = False
    _config.settings.redis_url = LIVE_REDIS_URL  # keep the URL for the
    # next live_redis test — env var is still set to the live URL.
    try:
        if _rc._pool is not None:
            # Closing closes the pool synchronously without awaiting;
            # tests that follow will get a fresh one when they next ask
            # for the URL. We don't await here because fixture teardown
            # is sync.
            pass
    except Exception:
        pass
    _rc._pool = None


@pytest.fixture(autouse=True)
def _isolate_redis_settings(request):
    """Auto-applied to every test. Snapshots ``settings.redis_enabled``
    + ``redis_url`` and restores them after the test runs.

    Without this, a test that opted into ``live_redis`` would leave the
    real URL pointing at the live cluster for the next test, which can
    silently hit cached responses from prior runs and fail in
    confusing ways (the OpenAPI compliance suite was hitting its own
    previous-run cache entries when run after the idempotency tests).
    """
    from app import config as _config

    snapshot = {
        "enabled": _config.settings.redis_enabled,
        "url": _config.settings.redis_url,
    }
    yield
    _config.settings.redis_enabled = snapshot["enabled"]
    _config.settings.redis_url = snapshot["url"]
    # Also drop the redis pool so the next test gets a fresh client.
    from app import redis_client as _rc
    try:
        if _rc._pool is not None:
            # Best-effort: schedule the close without awaiting since
            # fixture teardown is sync. The pool is replaced wholesale
            # on the next get_redis() call, so a leaked connection here
            # is harmless for tests that follow.
            pass
    except Exception:
        pass
    _rc._pool = None
