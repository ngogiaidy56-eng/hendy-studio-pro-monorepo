# Render Blueprint deployment guide

## What the Blueprint provisions

`render.yaml` declares eight Render resources:

- Static sites: `hendy-home`, `hendy-admin`, `hendy-studio-web`, `hendy-release-center`.
- Docker web service: `hendy-studio-api`.
- Docker background worker: `hendy-studio-render-worker` (FFmpeg render queue).
- Persistent Key Value: `hendy-redis` for BullMQ/Redis connections.
- PostgreSQL: `hendy-postgres` for user identity, RBAC, audit records, assets and release metadata.

MongoDB and object storage are external providers by design. Enter `MONGODB_URI` and S3-compatible/R2 endpoint, bucket and access credentials in the Render dashboard as protected environment secrets. Do not store any service credential in GitHub source or the browser build.

## Required sequence

1. Finish GitHub source import. The target repository should contain `render.yaml`, root `package.json`, Dockerfiles, applications, migrations and `.github/workflows/`. Do not attempt a Blueprint deploy from the initial README-only repository.
2. Keep the repository private unless you have explicitly decided to publish server and RBAC source. Use the included GitHub import scripts; they stop if the repo is still Public unless you deliberately override the check.
3. Review CI on `main`. The Blueprint uses `autoDeployTrigger: checksPass`; automatic deployment depends on the repository checks being wired into Render's Git provider integration.
4. Open the Render Blueprint import page for the repository:

   `https://dashboard.render.com/blueprint/new?repo=https%3A%2F%2Fgithub.com%2Fngogiaidy56-eng%2Fhendy-studio-pro-monorepo`

5. Select the intended Render workspace, inspect every resource, region and paid plan, and read the price summary before clicking Apply. Do not provision from an unintended workspace.
6. Provide the secret variables requested by Render: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `MONGODB_URI`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. `GEMINI_API_KEY` is optional until AI translation is enabled. Use a unique password of at least 16 characters for the bootstrap administrator; config validation rejects example credentials.
7. After services are live, inspect `/healthz`, API logs, worker logs, database migration logs and a complete media upload → render → download cycle. Confirm the release center can read the public catalog and that the artifact bucket remains private behind expiring signed URLs.
8. Add custom domains and update `CORS_ORIGINS` plus the site environment URLs before sharing production links.

## Cost and durability

The Blueprint deliberately avoids using ephemeral/free background processing and non-persistent queues for production. API/worker, Postgres and Key Value plans can incur charges; read the current Render plan summary at Apply time. Static sites are served on Render's CDN and do not use an instance compute plan. Resource creation is not included in this source package: the Blueprint must be imported and applied in the chosen Render workspace.

## Software publication layer

Render hosts the web control surfaces and release/download center; platform-specific binaries are built in GitHub Actions using Windows, macOS and Linux runners. Configure platform signing/developer secrets only in protected GitHub Actions settings. The build pipeline distinguishes test-only APK/simulator artifacts from signed distribution candidates. Store review and final listing publication must occur in the corresponding vendor console and cannot be bypassed by this application.

Before any public software release, replace every bracketed placeholder on `/privacy`, `/terms`, `/support` and in `store-assets/STORE_LISTING_VI.md`. The public release workflow intentionally fails its strict preflight while those drafts remain.
