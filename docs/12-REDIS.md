# Redis integration

The FieldEdge sync API uses [Redis](https://redis.io/) for two narrow,
high-leverage pieces of state that the rest of the app does not need
to own:

1. **JWT `jti` revocation list** — every successful `/auth/refresh`
   and `/auth/logout` writes the old token's `jti` to Redis with TTL =
   remaining lifetime. `decode_token` rejects any token whose `jti`
   is on the list.
2. **Sync upload idempotency cache** — `POST /sync/upload` hashes the
   request body's canonical JSON with SHA-256 and uses it as a Redis
   cache key. A repeat POST of the same body within 24h returns the
   cached response with `already_received=true` instead of
   re-running the per-point conflict loop.

This doc covers the architecture, the TTL policy, the failure modes,
and the operational limits (the cluster runs on the Redis Labs free
tier — 30 MB / 100 ops/sec / 30 connections).

## Provisioning

```
redis://default:<password>@redis-19164.c270.us-east-1-3.ec2.cloud.redislabs.com:19164
```

Stored in `apps/sync-api/.env` as `REDIS_URL`. Toggle the entire
integration off with `REDIS_ENABLED=false` — the app boots cleanly
without Redis, both call-sites degrade gracefully (see
[Fallback behaviour](#fallback-behaviour) below).

## Architecture

```
                       ┌────────────────────────────────────────────┐
                       │           Redis (free tier)                │
                       │                                            │
   /auth/refresh ──────▶  revoked:refresh:<old_jti> = <ts>  EX <ttl> │
       │                │                                            │
       │                │  revoked:access:<jti>     = <ts>  EX <ttl> │
       │                │                                            │
       ▼                │  upload:<batch_sha256>    = "1"   EX 86400 │
   decode_token         │  upload:<batch_sha256>:response = <json>  │
   ┌──────────┐  EXISTS │                                            │
   │ check    │────────▶│                                            │
   │ revoked  │◀─────── │                                            │
   └──────────┘         └────────────────────────────────────────────┘

   /sync/upload ───────▶  EXISTS upload:<sha256> ?
       │                  ├─ yes → GET upload:<sha256>:response → return cached
       │                  └─ no  → process, then SET upload:<sha256> = "1"
       │                              + SET upload:<sha256>:response = <json>
       ▼
   per-point conflict loop (Qdrant)
```

## TTL policy

| Key pattern | TTL | Why |
|---|---|---|
| `revoked:refresh:<jti>` | remaining token lifetime | Entry expires at the same moment the token would have anyway — no background sweep needed |
| `revoked:access:<jti>`  | remaining token lifetime | Same — auto-cleanup with the token's natural expiry |
| `upload:<sha256>`       | 24 h (`_IDEMPOTENCY_TTL_SECONDS`) | Long enough to absorb network retries / WAL replay; short enough that re-syncing the same photos tomorrow isn't blocked |
| `upload:<sha256>:response` | 24 h | Mirrors the marker key |

The revocation TTL = remaining lifetime means a refresh token that's
already half-expired only adds 3.5 days of revocation storage. Tokens
that have already expired don't waste entries at all (their
`remaining` is 0 / negative, so the call to `revoke_jti` no-ops).

## Fallback behaviour

Redis is a **best-effort** dependency. The sync API must boot, serve
`/sync/*`, `/auth/*`, and `/healthz` even when Redis is unreachable.

- **`/auth/refresh`** — when Redis is down, the old refresh token's
  `jti` revocation write fails silently. The next attempt to use the
  old refresh token succeeds (graceful degradation back to the v0
  "rotate-on-refresh, no revocation" behaviour). The cost is bounded
  by the token's natural expiry; a Redis outage does not leak tokens
  beyond that.
- **`/sync/upload`** — when Redis is down, the cache lookup and
  cache write are both skipped with a structured `logger.warning`.
  Duplicates are re-processed. The per-point conflict loop is
  idempotent (same `id` + same `vector_checksum` → `accepted`), so
  the only cost is a few extra Qdrant round-trips per retry.
- **`/readyz`** — `redis` field flips to `false`, but the probe still
  returns 200. Qdrant is the hard readiness gate; Redis is not.

## Free-tier limits

| Limit | Value | What happens at the limit |
|---|---|---|
| Memory | 30 MB | Revocation entries auto-expire, but a burst of failed refreshes could pile up briefly. Each entry is ~80 bytes (`revoked:<kind>:<32-hex-jti>` + the ts value) — 30 MB ≈ 350k entries. |
| Throughput | 100 ops/sec | Each protected request adds ONE `EXISTS revoked:<kind>:<jti>` (1 op). Each `/auth/refresh` adds 1 `SET` (revocation). Each `/sync/upload` adds 2 ops (`EXISTS` + `SET` × 2). At 50 RPS this is ~150 ops/sec — we WILL hit the cap. Mitigation: client-side throttling. |
| Connections | 30 | The client pool caps `max_connections=10` (1/3 of the budget) so a single sync-API process never starves other consumers. |

If we start hitting the throughput limit, the practical impact is:
revocation checks get slower (latency), and idempotency lookups slow
down. Neither is a correctness issue — both fall back to the "v0"
behaviour on timeout (the `is_jti_revoked` try/except returns `False`
on timeout).

## Monitoring

```bash
# Memory usage
redis-cli -u "$REDIS_URL" INFO memory | grep used_memory_human

# Connection count
redis-cli -u "$REDIS_URL" INFO clients | grep connected_clients

# Throughput (commands processed per second)
redis-cli -u "$REDIS_URL" INFO stats | grep instantaneous_ops_per_sec
```

Set an alert on `used_memory > 25MB` (83% of budget) and on
`instantaneous_ops_per_sec > 80` sustained for >5 min.

The `revoked:*` keyspace should stay under a few MB even at the
hackathon's peak demo rate. The `upload:*` keyspace grows with
unique batches; with the 24h TTL it's bounded by daily upload
volume × ~150 bytes per entry.

## Key naming convention

```
revoked:<token_kind>:<jti>     — kind ∈ {access, refresh}
upload:<sha256>                — marker (value = "1")
upload:<sha256>:response       — cached response JSON
```

Never include user data (device_id, photo_id) in keys. The SHA-256
already absorbs those into the cache key, so the keyspace stays
content-free.

## Files

- `apps/sync-api/app/redis_client.py` — connection pool + ping/close
- `apps/sync-api/app/auth.py` — `is_jti_revoked`, `revoke_jti`, revocation check in `decode_token`
- `apps/sync-api/app/routers/auth.py` — `/auth/refresh` revokes old refresh; `/auth/logout` revokes access + optional refresh
- `apps/sync-api/app/routers/sync.py` — `/sync/upload` SHA-256 cache
- `apps/sync-api/app/routers/health.py` — `/readyz` exposes `redis` field
- `apps/sync-api/app/main.py` — startup ping with structured warning on failure
- `apps/sync-api/app/config.py` — `redis_url`, `redis_enabled`

## Future work

- **Eviction policy** — the free tier ships with the default
  `noeviction` policy. For our workload we want `volatile-ttl` (only
  evict keys with an `EX` set — every entry we write has one). Switch
  via `CONFIG SET maxmemory-policy volatile-ttl` once we move off
  the free tier and have admin access.
- **Per-device throttling** — when traffic exceeds 100 ops/sec, the
  first thing to hurt is the revocation lookup. A Redis-cached
  device-rate-limit (replacing the in-memory one in `require_auth`)
  would absorb the burst.
- **Cache-warming on hot keys** — currently we `EXISTS` then `GET`.
  A future pass could combine into a single `MGET` for the common
  case (an access token's revocation status + the upload cache).
