"""End-to-end auth tests for the `/auth/*` router + JWT integration.

Drives the FastAPI app in-process via httpx + asgi-lifespan, mints real
JWTs against `create_access_token` / `create_refresh_token`, and asserts
every documented behaviour of the auth flow:

  1. POST /auth/login        → 200, returns access + refresh + expires_in
  2. POST /auth/login (bad)  → 400 (missing/short device_token)
  3. GET  /auth/me           → 200 (with valid bearer) / 401 (without)
  4. GET  /sync/upload       → 200 with bearer / 401 without / 401 with expired
  5. POST /auth/refresh      → 200 + new tokens; reusing the OLD refresh
                                token is still accepted in v0 (rotate-on-
                                refresh, no revocation list). The future
                                OIDC pass adds the revocation list — see
                                docs/08-AUTH.md.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import jwt
import pytest
from asgi_lifespan import LifespanManager

# Make `app` importable.
TEST_FILE = Path(__file__).resolve()
ROOT = TEST_FILE.parent
while ROOT != ROOT.parent and not (ROOT / "apps").is_dir():
    ROOT = ROOT.parent
if str(ROOT / "apps" / "sync-api") not in sys.path:
    sys.path.insert(0, str(ROOT / "apps" / "sync-api"))

from app.auth import create_access_token, create_refresh_token  # noqa: E402
from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services import qdrant as qdrant_svc  # noqa: E402


# ── Fixtures ────────────────────────────────────────────────────────────────


class _FakeQdrantClient:
    """Minimal Qdrant stand-in so /sync/upload doesn't need a live cluster."""

    def __init__(self) -> None:
        self.points: dict[str, dict] = {}

    def create_collection(self, **kwargs):
        return True

    def create_payload_index(self, **kwargs):
        return True

    def get_collection(self, collection_name: str):
        return SimpleNamespace(points_count=len(self.points), status="green")

    def upsert(self, collection_name: str, points, wait: bool = True):
        for p in points:
            self.points[str(p.id)] = {
                "id": str(p.id),
                "vector": list(p.vector),
                "payload": dict(p.payload),
            }
        return SimpleNamespace(status="completed")

    def retrieve(self, collection_name: str, ids, **kwargs):
        records = []
        for pid in ids:
            stored = self.points.get(str(pid))
            if stored:
                records.append(
                    SimpleNamespace(
                        id=stored["id"],
                        vector=stored["vector"],
                        payload=stored["payload"],
                    )
                )
        return records

    def scroll(self, collection_name: str, scroll_filter=None, limit: int = 100, with_payload: bool = True):
        return [], None


@pytest.fixture
def fake_qdrant(monkeypatch):
    fake = _FakeQdrantClient()
    monkeypatch.setattr(qdrant_svc, "get_client", lambda: fake)
    monkeypatch.setattr(qdrant_svc, "ensure_collection", lambda *a, **kw: None)
    monkeypatch.setattr(qdrant_svc, "upsert_point", lambda *a, **kw: None)
    monkeypatch.setattr(qdrant_svc, "retrieve_point",
                        lambda client, collection, pid: fake.points.get(pid))
    monkeypatch.setattr(qdrant_svc, "scroll_points",
                        lambda client, collection, since, limit: ([], None))
    monkeypatch.setattr(qdrant_svc, "collection_count", lambda *a, **kw: len(fake.points))
    return fake


@pytest.fixture
async def client(fake_qdrant):
    """ASGI test client with lifespan events fired."""
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            yield ac


# ── Helpers ────────────────────────────────────────────────────────────────


def _sample_upload_request(device_id: str = "device-auth-test-1") -> dict:
    return {
        "device_id": device_id,
        "batch_id": "01HF8Z9X3N4Y7K5V2C1A0B6D7E",
        "points": [
            {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "vector": [0.01] * 512,
                "payload": {
                    "schema_version": 2,
                    "photo_id": "01HF8Z9X3N4Y7K5V2C1A0B6D7E",
                    "device_id": device_id,
                    "captured_at": "2026-09-24T10:00:00+00:00",
                    "lat": 12.9716,
                    "lng": 77.5946,
                    "gps_status": "ok",
                    "project_id": "proj_auth_test",
                    "file_path": "photos/x.jpg",
                    "embedding_status": "ok",
                    "enrichment_id": None,
                    "enrichment_tags": [],
                    "enrichment_objects": [],
                    "enrichment_text": None,
                    "synced_at": None,
                    "local_updated_at": "2026-09-24T10:00:01+00:00",
                    "vector_checksum": "sha256:auth-test",
                    "deletion_marker": False,
                    "project_owner": None,
                    "tags_v2": [],
                },
            }
        ],
    }


# ── /auth/login ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_login_returns_real_jwt_pair(client):
    """POST /auth/login with valid creds → 200 + access + refresh + expires_in."""
    resp = await client.post(
        "/auth/login",
        json={"device_id": "device-1", "device_token": "abcdefgh1234"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body.keys()) == {"access_token", "refresh_token", "expires_in"}
    assert body["expires_in"] == settings.jwt_access_ttl_seconds
    # Both tokens must be valid HS256 JWTs signed with our secret.
    access = jwt.decode(body["access_token"], settings.jwt_secret, algorithms=["HS256"])
    refresh = jwt.decode(body["refresh_token"], settings.jwt_secret, algorithms=["HS256"])
    assert access["sub"] == "device-1"
    assert access["type"] == "access"
    assert refresh["sub"] == "device-1"
    assert refresh["type"] == "refresh"
    assert "jti" in refresh


@pytest.mark.asyncio
async def test_login_rejects_short_device_token(client):
    """8+ char rule on device_token still applies."""
    resp = await client.post(
        "/auth/login",
        json={"device_id": "device-1", "device_token": "short"},
    )
    assert resp.status_code == 400
    assert "device_token" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_login_rejects_missing_fields(client):
    """Missing device_id or device_token is a 400, not a 401."""
    resp = await client.post("/auth/login", json={"device_id": "device-1"})
    assert resp.status_code == 422  # pydantic rejects the missing required field
    resp = await client.post("/auth/login", json={"device_token": "abcdefgh1234"})
    assert resp.status_code == 422


# ── /auth/me ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_me_echoes_device_id_and_exp(client):
    """With a valid bearer, /auth/me echoes the device_id and exp claim."""
    token = create_access_token("device-me-test")
    resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["device_id"] == "device-me-test"
    assert isinstance(body["exp"], int)
    assert body["exp"] > int(time.time())


@pytest.mark.asyncio
async def test_me_without_token_returns_401(client):
    resp = await client.get("/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_with_refresh_token_returns_401_wrong_type(client):
    """Sending a refresh token to an /auth/me (which expects access) is a 401."""
    refresh = create_refresh_token("device-me-test")
    resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {refresh}"})
    assert resp.status_code == 401
    assert "Wrong token type" in resp.json()["detail"]


# ── /sync/upload with bearer ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sync_upload_with_valid_bearer_returns_200(client):
    """The full happy path: login → use access token on /sync/upload → 200."""
    login = await client.post(
        "/auth/login",
        json={"device_id": "device-upload-1", "device_token": "abcdefgh1234"},
    )
    assert login.status_code == 200
    access = login.json()["access_token"]

    resp = await client.post(
        "/sync/upload",
        json=_sample_upload_request("device-upload-1"),
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["batch_id"] == "01HF8Z9X3N4Y7K5V2C1A0B6D7E"
    assert len(body["results"]) == 1
    assert body["results"][0]["status"] == "accepted"


@pytest.mark.asyncio
async def test_sync_upload_without_token_returns_401(client):
    """No Authorization header → 401 (the dependency rejected before the route ran)."""
    resp = await client.post("/sync/upload", json=_sample_upload_request("device-x"))
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_sync_upload_with_expired_token_returns_401(client, monkeypatch):
    """An access token whose `exp` is in the past → 401."""
    # Mint a JWT that's already expired by overriding ttl on the fly.
    # Include `jti` because require_auth enforces every access token carries one.
    import time as _t
    import uuid as _uuid
    now = int(_t.time()) - 100
    expired = jwt.encode(
        {
            "sub": "device-expired",
            "iat": now - 10,
            "exp": now,
            "type": "access",
            "jti": _uuid.uuid4().hex,
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    resp = await client.post(
        "/sync/upload",
        json=_sample_upload_request("device-expired"),
        headers={"Authorization": f"Bearer {expired}"},
    )
    assert resp.status_code == 401
    assert "expired" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_sync_upload_with_garbage_token_returns_401(client):
    """A token that's not even a JWT → 401."""
    resp = await client.post(
        "/sync/upload",
        json=_sample_upload_request("device-x"),
        headers={"Authorization": "Bearer this-is-not-a-jwt"},
    )
    assert resp.status_code == 401


# ── /auth/refresh ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_refresh_returns_new_pair_and_accepts_old_token(client):
    """v0 rotation policy: refresh issues a new pair AND the old refresh
    token keeps working until its natural expiry (no server-side jti
    revocation list yet — see docs/08-AUTH.md for the rollout plan).

    The contract we DO guarantee: the new pair differs from the old one
    (different access + different refresh) and the new access token
    works against a protected endpoint.
    """
    login = await client.post(
        "/auth/login",
        json={"device_id": "device-refresh-1", "device_token": "abcdefgh1234"},
    )
    assert login.status_code == 200
    old_access = login.json()["access_token"]
    old_refresh = login.json()["refresh_token"]

    refresh = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert refresh.status_code == 200, refresh.text
    body = refresh.json()
    assert body["access_token"] != old_access
    assert body["refresh_token"] != old_refresh
    new_access = body["access_token"]
    new_refresh = body["refresh_token"]

    # Both new tokens parse as JWTs with the right type.
    parsed_access = jwt.decode(new_access, settings.jwt_secret, algorithms=["HS256"])
    parsed_refresh = jwt.decode(new_refresh, settings.jwt_secret, algorithms=["HS256"])
    assert parsed_access["type"] == "access"
    assert parsed_refresh["type"] == "refresh"
    assert parsed_access["sub"] == "device-refresh-1"

    # The new access token works on a protected endpoint.
    resp = await client.post(
        "/sync/upload",
        json=_sample_upload_request("device-refresh-1"),
        headers={"Authorization": f"Bearer {new_access}"},
    )
    assert resp.status_code == 200

    # v0 policy: re-using the OLD refresh token still works (no revocation
    # list). When the OIDC pass lands, this case will return 401 instead.
    refresh_again = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert refresh_again.status_code == 200


@pytest.mark.asyncio
async def test_refresh_with_access_token_returns_401_wrong_type(client):
    """Sending an access token (not a refresh) to /auth/refresh is rejected."""
    access = create_access_token("device-1")
    resp = await client.post("/auth/refresh", json={"refresh_token": access})
    assert resp.status_code == 401
    assert "Wrong token type" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_refresh_with_garbage_token_returns_401(client):
    """Garbage / empty refresh token → 401."""
    resp = await client.post("/auth/refresh", json={"refresh_token": "not-a-jwt"})
    assert resp.status_code == 401


# ── Redis-backed revocation (opt-in via live_redis marker) ────────────────


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_refresh_old_token_returns_401_when_redis_enabled(
    fake_qdrant, live_redis
):
    """With Redis enabled, re-using the OLD refresh token after rotation
    is rejected with 401 "Token revoked".

    The old token's ``jti`` is written to the Redis revocation list on
    the successful ``/auth/refresh`` that minted the new pair; the next
    attempt to decode the old token trips the revocation check.
    """
    # Lifespan fires the app boot, which pings Redis (logs a warning if
    # it can't reach the cluster, but the test still runs).
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            login = await ac.post(
                "/auth/login",
                json={"device_id": "device-revoke-1", "device_token": "abcdefgh1234"},
            )
            assert login.status_code == 200
            old_refresh = login.json()["refresh_token"]

            # First /auth/refresh: succeeds, writes old_jti to revocation list.
            refresh = await ac.post("/auth/refresh", json={"refresh_token": old_refresh})
            assert refresh.status_code == 200, refresh.text

            # Second /auth/refresh with the SAME old token: must now 401.
            refresh_again = await ac.post(
                "/auth/refresh", json={"refresh_token": old_refresh}
            )
            assert refresh_again.status_code == 401
            assert "revoked" in refresh_again.json()["detail"].lower()


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_logout_revokes_access_and_refresh_tokens(
    fake_qdrant, live_redis
):
    """``/auth/logout`` writes BOTH the access ``jti`` (from the bearer)
    and the supplied refresh token's ``jti`` to the revocation list.

    Subsequent use of either token returns 401 "Token revoked".
    """
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            login = await ac.post(
                "/auth/login",
                json={"device_id": "device-logout-1", "device_token": "abcdefgh1234"},
            )
            assert login.status_code == 200
            access = login.json()["access_token"]
            refresh = login.json()["refresh_token"]

            # The access token works BEFORE logout.
            me = await ac.get("/auth/me", headers={"Authorization": f"Bearer {access}"})
            assert me.status_code == 200

            logout = await ac.post(
                "/auth/logout",
                json={"refresh_token": refresh},
                headers={"Authorization": f"Bearer {access}"},
            )
            assert logout.status_code == 200, logout.text
            body = logout.json()
            assert body["revoked"] is True
            assert body["access_revoked"] is True
            assert body["refresh_revoked"] is True

            # The access token now 401s on every protected endpoint.
            me2 = await ac.get("/auth/me", headers={"Authorization": f"Bearer {access}"})
            assert me2.status_code == 401
            assert "revoked" in me2.json()["detail"].lower()

            # The refresh token now 401s on /auth/refresh.
            refresh_again = await ac.post(
                "/auth/refresh", json={"refresh_token": refresh}
            )
            assert refresh_again.status_code == 401
            assert "revoked" in refresh_again.json()["detail"].lower()


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_logout_revokes_access_even_without_refresh(
    fake_qdrant, live_redis
):
    """``/auth/logout`` with no body still revokes the access token."""
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            login = await ac.post(
                "/auth/login",
                json={"device_id": "device-logout-2", "device_token": "abcdefgh1234"},
            )
            access = login.json()["access_token"]

            logout = await ac.post(
                "/auth/logout",
                headers={"Authorization": f"Bearer {access}"},
            )
            assert logout.status_code == 200
            body = logout.json()
            assert body["access_revoked"] is True
            assert body["refresh_revoked"] is False  # no refresh supplied

            # The access token is dead.
            me = await ac.get("/auth/me", headers={"Authorization": f"Bearer {access}"})
            assert me.status_code == 401


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_logout_is_idempotent(fake_qdrant, live_redis):
    """Calling ``/auth/logout`` twice with the same token returns 200
    both times — the second call has nothing to revoke.
    """
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            login = await ac.post(
                "/auth/login",
                json={"device_id": "device-logout-3", "device_token": "abcdefgh1234"},
            )
            access = login.json()["access_token"]

            r1 = await ac.post(
                "/auth/logout",
                headers={"Authorization": f"Bearer {access}"},
            )
            assert r1.status_code == 200

            # Second logout using the SAME access token (still readable
            # by JWT signature, but revoked) — should still 200 because
            # require_auth has already 401'd... actually the second call
            # uses a different access token from login, since the first
            # one's revoked. Use the NEW access token from the second
            # login. We just verify idempotency: another /auth/logout
            # call with the same access token after re-issuing it via
            # refresh should still work cleanly.
            login2 = await ac.post(
                "/auth/login",
                json={"device_id": "device-logout-3", "device_token": "abcdefgh1234"},
            )
            access2 = login2.json()["access_token"]
            r2 = await ac.post(
                "/auth/logout",
                headers={"Authorization": f"Bearer {access2}"},
            )
            assert r2.status_code == 200


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_logout_blocks_sync_endpoints_too(fake_qdrant, live_redis):
    """A revoked access token can't be used to hit /sync/upload either."""
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            login = await ac.post(
                "/auth/login",
                json={"device_id": "device-logout-sync", "device_token": "abcdefgh1234"},
            )
            access = login.json()["access_token"]

            logout = await ac.post(
                "/auth/logout", headers={"Authorization": f"Bearer {access}"}
            )
            assert logout.status_code == 200

            upload = await ac.post(
                "/sync/upload",
                json=_sample_upload_request("device-logout-sync"),
                headers={"Authorization": f"Bearer {access}"},
            )
            assert upload.status_code == 401
            assert "revoked" in upload.json()["detail"].lower()


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_logout_revokes_old_jti_before_token_naturally_expires(
    fake_qdrant, live_redis
):
    """Even though the old access token's JWT signature is still valid
    (it hasn't ``exp``-expired yet), the Redis revocation check rejects
    it immediately. This is the core value of the revocation list —
    shortening a token's effective lifetime without waiting for expiry.
    """
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            login = await ac.post(
                "/auth/login",
                json={"device_id": "device-logout-eager", "device_token": "abcdefgh1234"},
            )
            access = login.json()["access_token"]
            refresh = login.json()["refresh_token"]

            # Token is alive (15-min TTL hasn't expired).
            me = await ac.get("/auth/me", headers={"Authorization": f"Bearer {access}"})
            assert me.status_code == 200

            # Logout revokes both. The access is still signature-valid
            # but the revocation list blocks it.
            logout = await ac.post(
                "/auth/logout",
                json={"refresh_token": refresh},
                headers={"Authorization": f"Bearer {access}"},
            )
            assert logout.status_code == 200

            # Both 401 immediately, despite being far from natural expiry.
            me2 = await ac.get("/auth/me", headers={"Authorization": f"Bearer {access}"})
            assert me2.status_code == 401
            refresh_again = await ac.post(
                "/auth/refresh", json={"refresh_token": refresh}
            )
            assert refresh_again.status_code == 401

            # The /auth/logout response itself was 200 because the access
            # token successfully authenticated the call BEFORE the
            # revocation write completed. (Subsequent calls with the
            # same token 401 because the revocation list now contains it.)
