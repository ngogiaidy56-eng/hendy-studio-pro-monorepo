# Hendy Studio Pro — Unified Monorepo

A full-stack starter workspace for the requested unified Admin Control Plane and user-facing video studio. The source is organized as independent React web apps, a TypeScript/Express API, PostgreSQL RBAC and audit migrations, MongoDB project documents, Redis/BullMQ render jobs, S3-compatible storage, a Cloudflare Worker, and starter Kotlin/Python mobile/agent projects.

## Quick start (Docker)

```bash
node scripts/setup-dev.mjs
# A unique local .env and admin password are generated automatically. Keep .env private.
docker compose up --build
```

- Admin Web: `http://localhost:5173`
- Studio Web: `http://localhost:5174`
- API health: `http://localhost:8080/healthz`

The root `.env.example` is only a template. `node scripts/setup-dev.mjs` creates a local `.env` with random secrets if one does not already exist. The generated admin password is stored in that local file and is not printed. The seed script deliberately rejects sample domains/passwords. Configure S3/R2 credentials and bucket CORS before using direct upload or render.

## Useful commands

```bash
bun install
bun run dev:admin
bun run dev:studio
bun run dev:api
bun run config:validate
bun run config:generate
bun run db:migrate
bun run db:seed
bun run assets:cleanup
bun run renders:cleanup
bun run worker:render
bun run typecheck
bun run test
bun run build
node scripts/verify-render-runtime.mjs
bun run release:gate
```

The API and render worker must run in separate processes in production. Docker Compose manages PostgreSQL, Redis, MongoDB, both frontends and the API/render worker. Timeline tracks are persisted in MongoDB and validated against user-owned, uploaded PostgreSQL assets before they enter BullMQ.

## Core paths

- `apps/admin-web/` — separate administrative interface, account status and role assignment controls
- `apps/studio-web/` — studio workspace, project list, assets, render status and subtitle translation
- `integrated-pipeline/server/src/` — auth, RBAC APIs, AI translation, asset presign/complete/delete, project API, timeline compositor, SRT burn-in, persistent render jobs and worker
- `system-config/system.config.json` — validated non-secret single source of truth for app identity, ports, media limits, security limits and feature flags; run `bun run config:validate` and `bun run config:generate` to verify/regenerate the shared TypeScript module
- `docs/VALIDATION_REPORT.md` — checks completed in the source-preparation environment and explicit unverified gates
- `database/postgres-rbac/migrations/` — versioned SQL migrations for identities, RBAC, audit logs, plans, assets, storage quotas, media duration, asset/output deletion lifecycle, storage accounting and Microsoft Store AppX artifacts
- `database/mongo-projects/` — document validation example for flexible project timeline data
- `integrated-pipeline/pipeline-agent/` — local faster-whisper-to-SRT CLI
- `integrated-pipeline/cloudflare/` — edge proxy/Telegram webhook starter
- `integrated-pipeline/ktor-backend/`, `composeApp/`, `androidApp/`, `iosApp/` — JVM/Kotlin and native shells with stated platform limitations
- `infra/`, `scripts/`, `.github/workflows/` — infrastructure, operations scripts and CI/CD
- `docs/API_REFERENCE.md` — route inventory and request permissions
- `docs/INTEGRATION_STATUS.md` — implemented capabilities vs production work remaining
- `SECURITY.md` — secret-handling and release security checklist

## API outline

All routes are under `/api/v1` except `/healthz` and protected `/metrics`.

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `GET/POST/PATCH/DELETE /projects`, `GET /projects/:id/manifest`
- `GET /assets`, `POST /assets/presign`, `POST /assets/complete`, `PUT /assets/:id/metadata`, `GET /assets/download-url`, `DELETE /assets/:id` (with project-reference checks and plan storage quotas)
- `GET/POST /render/jobs`, `GET/DELETE /render/jobs/:id`
- `GET /ai/status`, `POST /ai/translate`
- `/admin/users`, `/admin/users/:id/status`, `/admin/users/:id/roles`, `/admin/roles`, `/admin/audit-logs`, `/admin/stats`, `/admin/settings`, `/admin/settings/:key`

## Deploying

See [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`docs/OPERATIONS_RUNBOOK.md`](docs/OPERATIONS_RUNBOOK.md). Managed deploy requires environment secrets, storage credentials, exact allowed origins, HTTPS, a metrics token, external DB/Redis/Mongo services and CI credentials for Cloudflare.

## Current maturity and limits

This repository is an extensible **production-oriented starter**, not a certified finished production platform. It includes server-side auth/account-status and route RBAC checks, audit records, versioned SQL migrations, owner-scoped asset/project/render APIs, short-lived signed storage URLs, AI translation when configured, a one-source FFmpeg transcode worker, backup/restore scripts, stale upload/render deletion cleanup, health/Prometheus metrics, and CI checks. The FFmpeg worker now supports a bounded multi-track timeline: clips from MP4/MOV, audio from MP3/WAV or video sources, static overlay/PiP transforms, audio mixing with volume/limiting, and SRT hard-sub burn-in. It accepts at most 1,000 clips, 128 unique sources and 4 GiB combined source bytes per render, with a 2 GiB output cap. Live canvas preview, animated keyframes, transitions, VTT/ASS rendering, advanced subtitle styling, active FFmpeg cancellation, token refresh/revocation rotation, payment webhooks, Sentry/ELK production wiring, signed native releases and full Ktor authentication remain to be implemented or validated.

Optional local monitoring is available with `node scripts/prepare-observability.mjs` followed by `docker compose --profile observability up -d prometheus grafana`. Scheduled Telegram health alerts are configured via `.github/workflows/system-health.yml`.

Run `node scripts/validate-env.mjs`, `node scripts/audit-source.mjs`, and `node scripts/verify-render-runtime.mjs`, then `node scripts/release-gate.mjs` on a machine with the required dependencies. The runtime smoke test generates a one-second synthetic MP4 and verifies FFmpeg overlays, SRT burn-in, audio mixing, and output probing. Test deployment in staging with service credentials before opening traffic.


## App Publishing & Store Operations tier

`apps/release-center/` is a distinct public download center and release-operations console. It combines version/channel management, artifact uploads to S3-compatible storage, SHA-256 verification, signed URLs, QA/release gates and store-submission metadata for direct downloads, GitHub Releases, Google Play, Apple App Store and Microsoft Store. Vendor submissions still depend on each store's developer account, signed build, credentials and review; the UI is a workflow manager, not a bypass for store approval.

The dedicated `.github/workflows/app-release.yml` workflow builds all four web applications, Windows/macOS/Linux desktop packages, an Android debug APK, and a simulator-only iOS validation build. A signed Android AAB is optional and requires protected keystore secrets plus `ANDROID_SIGNING_ENABLED=true`. Google Play internal upload additionally requires `GOOGLE_PLAY_UPLOAD_ENABLED=true`, a service account, and an explicit manual workflow input. The CI does not label the debug APK or iOS simulator build as store-ready. The workflow stamps versions across desktop/Android/iOS outputs, includes platform app icons, can create a signed Microsoft Store AppX candidate from protected Partner Center credentials, and stages verified public GitHub Release assets only after explicit manual approval on a version tag, release-enable variable, and Windows/macOS signing/notarization secrets.

Release/operator tools:

```bash
node scripts/validate-release-artifact.mjs path/to/artifact.exe
node scripts/package-release-metadata.mjs --version 1.2.0 --channel stable --notes-file RELEASE_NOTES.md --output release-out/release-manifest.json path/to/artifact.exe
node scripts/store-release-preflight.mjs
node scripts/verify-render-blueprint.mjs
```

Templates for listing text, icon, feature art and screenshot capture instructions are under `store-assets/`; iOS and Android launcher icons are included in the native project tree. Public `/privacy`, `/terms` and `/support` paths are included as **draft templates**; replace the marked placeholders and have the real data practices/legal text reviewed before submitting any store listing.

### Render services

The root `render.yaml` defines independent static sites for marketing, admin, studio and Release Center, plus a Docker API, render worker, managed PostgreSQL and Redis-compatible Key Value. Current Blueprint plans intentionally use paid baseline plans for API/worker/database/Key Value so the render queue and persistent data are not based on expiring Free Postgres or non-persistent Free Key Value. Static sites do not require an instance plan. Costs depend on Render pricing, region and usage; review the Blueprint's pricing screen before pressing Apply. `MONGODB_URI`, admin login, S3/R2 endpoint/bucket/credentials and optional Gemini credentials must be entered securely as Render secrets. The app is not deployed simply by adding `render.yaml`; its code must first be pushed to GitHub and the Blueprint synced.
