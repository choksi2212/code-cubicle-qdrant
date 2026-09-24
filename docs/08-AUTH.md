# 08 — Auth

This document describes FieldEdge's authentication model: the JWT format
the server issues, the rotation/refresh policy, the mobile-side token
storage, and how we'll swap the v0 device-token login for a real OIDC
code-exchange once enterprise SSO lands.

## Why this exists

The original sync API (`apps/sync-api/app/auth.py` before this commit)
trusted any `Authorization: Bearer <token>` whose token was at least 8
characters and started with `dev_`. That meant anyone with the URL
could read or write any device's photos. Enterprises won't touch the
product without real auth, so we replaced the dev-mode shim with a
real JWT-issuing server while keeping the wire shape small enough that
the mobile app needs only three new methods (login, refresh, secure-store).

## Token format

Both tokens are HS256-signed JWTs. The signing key lives in
`JWT_SECRET` (env var) and is auto-generated on first boot if not set
(`apps/sync-api/app/config.py::_load_or_generate_jwt_secret`). On
Render/prod the env var is set explicitly so the secret survives restarts.

### Access token

| Claim | Value                                       |
|-------|---------------------------------------------|
| `sub` | device_id (ULID)                            |
| `iat` | unix-seconds minted-at                      |
| `exp` | `iat` + `JWT_ACCESS_TTL_SECONDS` (15 min)   |
| `type`| `"access"`                                  |
| `jti` | random uuid hex — every token is unique     |

Sent on every `/sync/*` request as `Authorization: Bearer <access>`.

### Refresh token

| Claim | Value                                       |
|-------|---------------------------------------------|
| `sub` | device_id                                   |
| `iat` | unix-seconds minted-at                      |
| `exp` | `iat` + `JWT_REFRESH_TTL_SECONDS` (7 days)  |
| `type`| `"refresh"`                                 |
| `jti` | random uuid hex                             |

Held in `EncryptedSharedPreferences` on Android. Sent to
`/auth/refresh` to mint a new pair.

## Endpoints

### `POST /auth/login`

Body:
```json
{ "device_id": "01HF...", "device_token": "any 8+ char string" }
```

Response (200):
```json
{
  "access_token":  "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in":    900
}
```

The 15-minute access-token TTL is short enough that an intercepted
token expires before it's useful; the 7-day refresh token is the long-
lived secret the device holds.

### `POST /auth/refresh`

Body:
```json
{ "refresh_token": "eyJ..." }
```

Response (200): same shape as `/auth/login`.

The server rotates the refresh token (new `jti`) and issues a fresh
access token. **v0 policy:** the OLD refresh token keeps working until
its natural expiry. There is no server-side revocation list yet — see
"Future work" below.

### `GET /auth/me`

Headers: `Authorization: Bearer <access>`

Response (200):
```json
{ "device_id": "01HF...", "exp": 1790255948 }
```

A cheap "is my bearer still alive?" probe. Mobile clients hit this on
app foreground to decide whether to silently refresh.

## Rotation policy (v0)

- On every `/auth/login`, both tokens are minted fresh. Two successive
  logins produce different access tokens (different `jti`s).
- On every `/auth/refresh`, both tokens are rotated. Old refresh
  tokens stay valid until expiry — this is a defence-in-depth
  improvement, not a hard revoke.
- The `Authorization` header is the only place an access token travels
  on the wire. The refresh token never leaves EncryptedSharedPreferences.

## Mobile-side storage

The mobile app stores both tokens via the new `SecureStore` native
module (`apps/mobile/android/.../SecureStoreModule.kt`), which wraps
Android's `EncryptedSharedPreferences` (MasterKey AES256_GCM, the
jetpack `security-crypto` library). The TS layer talks to it via
`apps/mobile/src/services/tokenStore.ts`:

```ts
getTokens():   Promise<{access, refresh} | null>
setTokens(t):  Promise<void>
clearTokens(): Promise<void>
```

Tokens survive app reinstall on the same device because the encrypted
prefs are stored in the app's data partition, but they're lost on
uninstall (Android wipes the sandbox). Login on a fresh install will
hit `/auth/login` again.

## API client 401-refresh-retry

`apps/mobile/src/services/api.ts` adds `setRefreshHandler(fn)` that the
App wires up at startup. The flow on every request:

1. Send the request with the current access token.
2. On 200/2xx: return the response.
3. On any non-401 error: surface immediately.
4. On 401: call the refresh handler. The handler calls
   `POST /auth/refresh`, persists the new pair via `tokenStore.setTokens`,
   and returns the new access token. The original request is retried
   once with the new bearer.
5. If the refresh itself 401s (refresh token expired / revoked): the
   client throws `AuthExpiredError` and the UI navigates to
   `LoginScreen`.

This matches the OAuth2 "client credentials refresh" dance that mobile
SDKs like MSAL do automatically.

## Future work — OIDC swap

The v0 login endpoint accepts any non-empty `device_id` + 8+ char
`device_token`. When enterprise SSO ships, replace
`apps/sync-api/app/routers/auth.py::login` with an OIDC authorization-
code exchange:

```python
@router.post("/login")
async def login(req: LoginRequest) -> TokenPair:
    # TODO (OIDC pass):
    #   1. Exchange req.auth_code for tokens at the IdP's /token endpoint
    #      (Keycloak / Okta / Auth0).
    #   2. Verify the ID token's signature + audience + nonce.
    #   3. Extract sub / email / tenant from the ID token claims.
    #   4. Mint our own access + refresh JWT with sub = id_token['sub'].
```

Also land the jti-revocation list so rotated refresh tokens actually
revoke. Two natural places:

- A Redis-backed `SET revoked_jti <token_id>` with TTL = refresh TTL.
  Every `/auth/refresh` checks `revoked_jti` after signature verify
  and before issuing a new pair.
- A Postgres `revoked_refresh_tokens` table for setups that prefer
  not to depend on Redis.

The auth.py `decode_token` already has a `# TODO (OIDC pass)` marker
where this check belongs.

## Operational notes

- Set `JWT_SECRET` explicitly in Render's environment — Render injects
  process env vars on every boot. Without it, the server falls back to
  a file-backed random secret (`apps/sync-api/app/.jwt_secret`), which
  works locally but loses its secret if the deploy container's
  filesystem is ephemeral.
- `JWT_ACCESS_TTL_SECONDS` (default 900) and
  `JWT_REFRESH_TTL_SECONDS` (default 604800) are tunable. Don't drop
  the access TTL below a few minutes or the refresh storm gets bad.
- The existing `verify_device_token` shim is kept as a back-compat
  alias returning just the `device_id` string. New code should use
  `Depends(require_auth)` directly to get an `AuthContext`.
