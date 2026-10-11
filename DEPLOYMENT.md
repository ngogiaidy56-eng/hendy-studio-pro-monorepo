# Deployment Guide

## Local Docker deployment

1. Copy `.env.example` to `.env` and generate strong secrets with `node scripts/generate-secrets.mjs`.
2. Replace every placeholder. For local Compose, `DATABASE_URL`, `REDIS_URL`, and `MONGODB_URI` must use service names `postgres`, `redis`, and `mongo`; Compose injects these values in the API/worker containers.
3. Configure an S3 or Cloudflare R2 bucket. Upload/download and render are unavailable until storage credentials are valid.
4. Set `ADMIN_EMAIL` to a real non-example address and `ADMIN_PASSWORD` to a unique password. The seed script deliberately refuses example domains or placeholder passwords. Run `docker compose up --build`. The API runs versioned migrations and atomically seeds RBAC roles before accepting traffic. Production startup requires bootstrap admin credentials and non-placeholder secrets.
5. Visit Admin Web on port 5173, Studio Web on 5174, health endpoint on 8080.

## Render.com

`render.yaml` defines a Docker web API and a dedicated render worker. Provide all `sync: false` values in the Render dashboard, including `DATABASE_URL`, `REDIS_URL`, `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, S3 credentials, `GEMINI_API_KEY`, and `METRICS_TOKEN`. Configure `CORS_ORIGINS` to exact HTTPS UI origins. Render sets `PORT`; API config respects it when `API_PORT` is absent. Use managed PostgreSQL, Redis-compatible service, MongoDB-compatible service and S3/R2 bucket reachable from both API and worker.

Run migrations as a one-off release task (`bun run --filter @hendy/core-server migrate`) and seed after provisioning. Do not run destructive restores against production without verified backups and explicit confirmation.

## Cloudflare Worker

Set GitHub repository variables `BACKEND_ORIGIN` and `ALLOWED_ORIGINS`, plus secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. `BACKEND_ORIGIN` must be HTTPS. Deploy workflow runs on dispatch and when files under `integrated-pipeline/cloudflare/` change. Store the Telegram bot token and webhook secret as Worker secrets; do not put them in `wrangler.jsonc` or source code.

## GitHub Actions

The release workflow executes Bun typecheck, tests, build and Python agent unit tests; the container job builds the API Docker target. The native workflow creates an Android debug APK, runs Ktor tests and builds the Compose Desktop target. iOS archive/signing is intentionally not claimed because an Xcode project, Apple signing assets and credentials are not included.

## Before public production

- Switch repository to Private if the source is proprietary; otherwise verify no private credentials or customer data are committed.
- Run the full test/build gate with dependencies installed and execute staging end-to-end tests.
- Configure backups, alerting, Prometheus scrape access, TLS, rate-limit monitoring and retention policies.
- The worker supports basic timeline composition: video clips, separate audio tracks, static overlay/PiP, and SRT burn-in. It does not implement live preview, animated keyframes, transitions or ASS/VTT styling. It caps each render at 128 unique assets, 4 GiB aggregate source bytes and a 2 GiB output. Active FFmpeg cancellation, billing webhooks, MFA/session rotation, Sentry/ELK production wiring, complete Ktor auth and signed mobile releases remain separate workstreams. Run the render-runtime smoke test against the final worker image before enabling subtitle renders.

## Render-worker validation

Run `node scripts/verify-render-runtime.mjs` inside the worker image or on a host with FFmpeg/ffprobe and libass. It executes a small synthetic encode with SRT burn-in, overlay, audio mixing and probes the output; CI runs this smoke test. This validates toolchain capabilities, not cloud storage credentials or every user timeline.


## Render multi-service deployment and app publication

1. Push the complete source tree (including `render.yaml`, Dockerfile.api, `scripts/render-build-static.sh` and `.github/workflows`) to the repository selected in Render. The repository currently needs a real source import; a README-only GitHub repository is not deployable.
2. Open the [Render Blueprint flow](https://dashboard.render.com/blueprint/new?repo=https%3A%2F%2Fgithub.com%2Fngogiaidy56-eng%2Fhendy-studio-pro-monorepo) and inspect all services and estimated charges before applying.
3. Enter unique `ADMIN_EMAIL` and high-entropy `ADMIN_PASSWORD` (16+ characters, no example/default); configure Atlas/compatible `MONGODB_URI`, HTTPS R2/S3 endpoint and bucket keys, and optional `GEMINI_API_KEY` in Render's protected environment settings. Never commit these values.
4. Confirm PostgreSQL and Key Value are not publicly exposed; Blueprint `ipAllowList: []` denies public ingress and the apps use private service-to-service connection strings. Verify the Redis worker can reach queues and `GET /healthz` returns healthy only after PostgreSQL, MongoDB and Redis are reachable.
5. Build logs must be green for all four static sites, API Docker image and worker. Test sign-in, role separation, project CRUD, upload/complete/hash verification, render queue, signed downloads and release state transition before custom domains or public downloads are enabled.
6. The direct download catalog publishes only releases approved in the Release Center. Upload each final artifact, compare size and SHA-256, review release notes, and get a second operator to approve the transition to Published.
7. For store releases, set developer account identifiers and signing secrets in GitHub Actions. Run tagged CI and inspect generated checksums. Google Play internal upload is guarded by `ANDROID_SIGNING_ENABLED`, `GOOGLE_PLAY_UPLOAD_ENABLED`, protected keystore credentials and the explicit workflow input. Apple App Store and Microsoft Store are tracked by metadata/checklists but still require their own code-signing, packaging, developer account and vendor submission/review steps. An iOS simulator validation build is **not** an IPA.
8. Review `store-assets/RELEASE_CHECKLIST.md`, `store-assets/STORE_LISTING_VI.md`, and complete `/privacy`, `/terms`, `/support` pages before publishing. These pages are clearly marked as draft templates until legal/support placeholders are replaced.

Render plan notes: `0.5c-512mb` is a paid baseline plan for the API and background worker; Key Value uses `256mb` with `journal-snapshot`; PostgreSQL uses `basic-1gb`. Plan names/specs can change; check current workspace pricing before provisioning. This blueprint has not been applied to a live Render workspace from this source-preparation environment.


## App Store / Release Center tier

- Render hosts the four web interfaces and API; platform signing/package creation runs in `.github/workflows/app-release.yml` on OS-matched GitHub runners.
- Tag `vX.Y.Z` produces candidate build artifacts. It does not by itself publish a public GitHub Release. Public release requires a manual dispatch on that tag, `PUBLIC_RELEASES_ENABLED=true`, Windows Authenticode credentials, and macOS signing/notarization credentials. Test-only Android APK and iOS simulator-validation artifacts are excluded.
- Google Play internal upload, App Store Connect/TestFlight upload, and Microsoft Store AppX builds are individually gated by protected variables/secrets. Public Google Play/App Store/Microsoft store listings still require their vendor console, privacy declarations, review and approval.
- Replace template URLs and legal placeholders in `/privacy`, `/terms`, `/support`; never submit store metadata while placeholders remain. See `docs/APP_PUBLISHING_RUNBOOK.md`.
- Render resource Blueprint uses paid API/worker/database/Key Value plans to support the render queue and data persistence. Review the deployment pricing summary before applying.
