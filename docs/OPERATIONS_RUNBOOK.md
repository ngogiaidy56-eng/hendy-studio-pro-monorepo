# Operations Runbook — Hendy Studio Pro

## Before first deploy

1. Generate secrets with `node scripts/generate-secrets.mjs`; put unique values in the deployment secret store, never commit `.env`.
2. Set `NODE_ENV=production`, `JWT_SECRET` (32+ characters), `METRICS_TOKEN` (24+ characters), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (16+ characters), exact comma-separated `CORS_ORIGINS`, PostgreSQL, Redis, MongoDB and S3/R2 credentials.
3. Set the S3/R2 bucket CORS to allow the real Studio/Admin origins and `PUT` of signed URLs. Use `infra/storage/r2-cors.json` as a template and replace the example domains.
4. Ensure HTTPS is terminated in front of the API. Configure `TRUST_PROXY_HOPS` only for the actual trusted proxy path.
5. Run database migrations once during release: `bun run db:migrate`, then `bun run db:seed`. Restrict migrations to one release job where possible.
6. Deploy API and render worker separately. Verify `/healthz`, the login path, asset upload, render completion, and a signed download from an account-owned object.

## Backups

- PostgreSQL: `bash scripts/backup-postgres.sh` uses Docker Compose service `postgres` when available, otherwise the `pg_dump` executable and `DATABASE_URL`.
- MongoDB: `bash scripts/backup-mongodb.sh` uses Compose service `mongo` when available, otherwise `mongodump` and `MONGODB_URI`.
- Restores require `CONFIRM_DESTRUCTIVE_RESTORE=YES`. Restore into a separate environment first; verify checksums, record counts, login, projects and assets before switching traffic.
- Redis is a queue/cache dependency. Do not delete its persistent volume while jobs are expected to finish.

## Observability

- `GET /healthz`: checks API, PostgreSQL, Redis and MongoDB.
- `GET /metrics`: Prometheus format, requiring `Authorization: Bearer $METRICS_TOKEN`.
- JSON request logs contain request IDs and omit authorization/cookie/API-key headers. Route and latency metrics intentionally use bounded labels and avoid raw URLs where possible.
- Configure an external Prometheus to scrape `/metrics` over a private network. Put Grafana dashboards and alert rules under your infrastructure repository before depending on them for on-call.
- `SENTRY_DSN` is reserved in config; add and verify the Sentry SDK before treating Sentry error reporting as enabled.

## Cloudflare CI variables

Create repository variables `BACKEND_ORIGIN` (HTTPS URL) and `ALLOWED_ORIGINS` (exact comma-separated UI origins). Set secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The worker is an edge proxy/webhook starter, not a replacement for the authenticated API.

## Security notes

- The Admin UI and Studio UI are separate frontends, but both call the same API. Every protected API still enforces JWT, account status and permission checks server-side.
- The API uses 15-minute bearer access tokens; refresh-token rotation/device session management is not implemented yet. Access tokens live in session storage in the browser.
- Asset uploads use short-lived signed URLs and a server-side `HEAD` check, with 2 GiB input/output limits. Validate object lifecycle and malware handling based on your threat model.
- Render worker currently normalizes/transcodes one video clip to MP4. It is not yet a full multi-track timeline compositor: PiP, transitions, subtitle burn-in, TTS mix and waveform rendering still need dedicated FFmpeg filter graph implementation.
- AI translation requires a valid `GEMINI_API_KEY`. Local Whisper transcription requires Python dependencies and a model download; it is currently CLI-based rather than a remote job service.
- Native Android is a Studio WebView shell. iOS currently contains a Swift UI starter, not a signed Xcode archive. Ktor is a health/capabilities starter and is not yet the auth authority.

## Release gate

Run `node scripts/validate-env.mjs`, `bun run typecheck`, `bun run test`, `bun run build`, and `python -m unittest discover -s integrated-pipeline/pipeline-agent/tests -v`. Check a container build and execute staging end-to-end tests before production. Do not treat static syntax checks as a substitute for real dependency-backed tests.


## Local Prometheus/Grafana profile

1. Set a strong `METRICS_TOKEN` and `GRAFANA_ADMIN_PASSWORD` in `.env`.
2. Run `node scripts/prepare-observability.mjs` to create `.secrets/metrics_token` with restricted permissions.
3. Run `docker compose --profile observability up -d prometheus grafana`. Prometheus UI is loopback-only on port 9090 and Grafana on 3000; use an SSH tunnel when operating a VPS.
4. Do not expose these admin ports to the public Internet without an authenticated reverse proxy.

For periodic checks, set repository variable `API_HEALTH_URL` and secrets `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`; `.github/workflows/system-health.yml` checks health every 15 minutes and sends an alert on failure.


## Stale direct-upload cleanup

Run `bun run assets:cleanup` on a scheduled maintenance runner (for example every 6 hours). It locks a bounded batch of pending uploads older than 24 hours and interrupted object deletions older than 15 minutes, deletes any object at the key, then changes an expired `pending` row to `failed` or completes an interrupted `deleting` row as `deleted`. If object storage is unavailable, the row stays pending/deleting and continues to count against the user's quota; repair storage connectivity and retry. This command requires the same database and S3/R2 variables as the API.


## Interrupted render-output deletion

Run `bun run renders:cleanup` on the same scheduled maintenance runner (for example every 6 hours). It retries output objects left in `deleting` for longer than 15 minutes and marks their jobs `deleted` only after the object store confirms the delete. Failed deletes remain in `deleting` and continue counting against storage quota until the next successful retry.
