# 07 — CI/CD and Staging

> Owns the bridge between "merged code" and "running service". Today
> every release is "did the tests pass on Manas's laptop?". This doc
> replaces that with a real pipeline.

## TL;DR

| What | Where | Trigger |
|---|---|---|
| JS/TS lint + typecheck + Jest | GitHub Actions `ci` → `js` job | every PR + push to `development`/`main` |
| Rust `cargo test` + clippy | GitHub Actions `ci` → `rust` job | every PR + push to `development`/`main` |
| Mobile release APK build | GitHub Actions `ci` → `mobile-apk` job | push to `development` or `main` only (not PRs) |
| Tag-based APK + GitHub Release | GitHub Actions `release` → `build-apk` | push of `v*` tag |
| Firebase App Distribution | GitHub Actions `release` → `firebase-distribute` | tag, **only if** `FIREBASE_APP_ID` + `FIREBASE_TOKEN` secrets are set |
| Staging deploy (sync API) | Render Blueprint `render-staging.yaml` | autoDeploy on push to `development` |
| Production deploy (sync API) | Render Blueprint `render-prod.yaml` | manual via Render dashboard, OR auto on tag → CI run |

## Workflow diagram

```
                    ┌──────────────┐
                    │ feature/* PR │
                    └──────┬───────┘
                           │ opens / updates PR
                           ▼
        ┌──────────────────────────────────────┐
        │  GitHub Actions  .github/workflows/  │
        │             ci.yml                  │
        │                                      │
        │   ┌─────────────┐  ┌──────────────┐  │
        │   │  js job     │  │  rust job    │  │
        │   │ lint/tsc/   │  │ cargo test   │  │
        │   │ jest        │  │ clippy       │  │
        │   └─────────────┘  └──────────────┘  │
        │                                      │
        │   (mobile-apk job skipped on PRs —  │
        │    too slow for a reviewer waiting)  │
        └──────────────┬───────────────────────┘
                       │ merge to development
                       ▼
        ┌──────────────────────────────────────┐
        │  mobile-apk job builds APK on        │
        │  push to development / main          │
        │  → uploaded as run artifact          │
        └──────────────┬───────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────────┐
        │  Render (autoDeploy)                 │
        │   staging service picks up the new   │
        │   commit on `development`            │
        │   health: /healthz                   │
        │   smoke: apps/sync-api/scripts/      │
        │          smoke.sh <staging-url>      │
        └──────────────┬───────────────────────┘
                       │ ready for prod
                       ▼
                git tag v0.2.0
                git push origin v0.2.0
                       │
                       ▼
        ┌──────────────────────────────────────┐
        │  .github/workflows/release.yml       │
        │   build-apk  → upload APK, attach    │
        │                to GitHub Release     │
        │   firebase-distribute (optional,     │
        │     gated on FIREBASE_APP_ID +       │
        │     FIREBASE_TOKEN secrets)          │
        └──────────────┬───────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────────┐
        │  Render prod service (autoDeploy on  │
        │  tag, OR manual "Manual Deploy" in   │
        │  Render dashboard)                   │
        └──────────────────────────────────────┘
```

## Branch policy

| Branch | Pushes there trigger | What deploys |
|---|---|---|
| `feature/*` | CI runs `js` + `rust` (PR gate) | nothing deploys — PRs don't auto-deploy anything |
| `development` | CI runs all 3 jobs incl. `mobile-apk`; Render picks up the commit for **staging** | sync API **staging** service |
| `main` | CI runs all 3 jobs incl. `mobile-apk`; nothing deploys automatically | sync API prod is **not** wired to `main` (intentional — see below) |
| `v*` tag | release.yml: APK build + GitHub Release (+ Firebase if configured) | optional Render manual deploy from the tag |

### Why prod doesn't auto-deploy from `main`

Two reasons:

1. **Promote staging → prod is a conscious step.** The dashboard URL is
   the demo surface — a broken main commit shouldn't page the demo URL.
2. **Rollbacks are easier when prod deploys are explicit.** Each
   Render deploy gets its own id; we redeploy an older deploy id to
   roll back (see below).

The release flow is: merge to `development` → exercise on staging →
when green, `git tag vX.Y.Z && git push origin vX.Y.Z` → either let
Render's `autoDeploy` pick up the tag for prod, or click **Manual
Deploy → Deploy a specific commit/tag** in the Render dashboard and
pick the release tag.

## How to roll back

### Sync API on Render

Render keeps every deploy. Two equivalent ways:

1. **CLI** (fast):
   ```bash
   render rollback --service field-edge-sync-api
   ```
2. **Dashboard**: Service → **Deploys** → click the deploy you want
   to roll back to → **Rollback to this deploy**.

Free tier services restart from a cold state (~30 s warm-up) after a
rollback; the smoke script (`apps/sync-api/scripts/smoke.sh`) will
gate the redeploy.

### Mobile APK

There's no live "production APK" running anywhere — the APK is an
artifact testers download. Roll back by:

1. Re-attach the previous APK to the GitHub Release, **or**
2. Cut a hotfix release (`v0.2.1`) and re-run the release workflow.

## On-call basics

| Symptom | First check |
|---|---|
| Sync API 5xx on staging | Render → Logs for the staging service. If the process is OOM, bump plan from `free` to `starter`. |
| Sync API returning `qdrant=down` on `/readyz` | Check Qdrant Cloud status; rotate `QDRANT_API_KEY` if it leaked. |
| CI failing on `mobile-apk` for unrelated reasons | Most likely a flaky `gradlew assembleRelease`. Re-run the job from the Actions UI. |
| PR failing on `clippy` lint | Rust added a new lint. Run `cargo clippy --workspace --all-targets -- -D warnings` locally, fix, push. |

## Repo secrets to configure

Go to **GitHub → Settings → Secrets and variables → Actions** for
this repo and add:

| Secret | Used by | Notes |
|---|---|---|
| `FIREBASE_APP_ID` | release.yml → `firebase-distribute` | The Firebase App Distribution app id (`1:123:android:abc`). **Leave blank to skip Firebase.** |
| `FIREBASE_TOKEN` | release.yml → `firebase-distribute` | Output of `firebase login:ci`. **Leave blank to skip Firebase.** |

For Render, set the equivalent secrets in each service's
**Environment** tab (Render never reads them from git):

| Secret | Set on | Notes |
|---|---|---|
| `QDRANT_URL` | staging + prod | Different clusters for each. |
| `QDRANT_API_KEY` | staging + prod | Different keys for each. |
| `JWT_SECRET` | staging + prod | Auto-generated by Render (`generateValue: true`). |

## What this doc does NOT cover

- **Native cross-compile** (Rust → Android `.so`). That's done
  locally via `scripts/build-android.sh` (requires Android NDK +
  Rust targets). CI currently builds the JS-only APK; the native
  layer is added later when we have a self-hosted runner with NDK
  pre-installed.
- **Mobile OTA / CodePush.** Out of scope for the hackathon —
  testers reinstall from the APK artifact on each release.
