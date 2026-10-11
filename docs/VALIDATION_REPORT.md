# Hendy Studio Pro — Validation Report

Generated: 2026-10-12. This is a source-preparation environment report, not a production certification.

## Checks that passed

- `node scripts/audit-source.mjs`: 223 source files scanned, 10 package manifests and 10 workspaces detected, 0 errors and 0 warnings. The audit checks required paths, local imports, workspace references and common credential patterns.
- `node scripts/validate-system-config.mjs`: PASS for version 1.2.0 configuration and 12 feature flags. The built-in validator parses the schema and enforces project invariants; this is not a full formal JSON Schema conformance run.
- `node scripts/generate-system-config.mjs`: deterministic generated TypeScript configuration was checked in the source preparation workflow.
- TypeScript/TSX syntax parse: 49 `.ts`/`.tsx` files, 0 parser errors. This uses the TypeScript parser only and does not establish semantic type safety.
- `node scripts/verify-render-blueprint.mjs`: static checks passed for the eight expected Render resource names, workspace paths, referenced environment variables, health paths and static publish paths. It does not call Render's authoritative Blueprint schema validator.
- `node scripts/verify-render-runtime.mjs`: actual FFmpeg/ffprobe smoke render passed for H.264 MP4, video overlay/PiP path, SRT subtitle burn-in (libass), audio mixing/delay/limiting and output probing.
- Python subtitle timestamp tests: 3/3 passed.
- Configuration parsing: 25 JSON, 1 JSONC, 12 YAML/YML files (including multi-document Kubernetes YAML), and 13 XML files parsed successfully.
- Shell syntax check: Render static build script, PostgreSQL/MongoDB backup/restore scripts and Bash GitHub import script passed `bash -n`.
- Release metadata helper and version stamping were tested using temporary/sample data; artifact validator calculated SHA-256 for a test artifact.

## Intentionally blocked release gate

`node scripts/store-release-preflight.mjs --strict` must not be considered green until the publisher replaces the legal/listing draft placeholders in:

- `apps/marketing-web/public/privacy.html`
- `apps/marketing-web/public/terms.html`
- `apps/marketing-web/public/support.html`
- `store-assets/STORE_LISTING_VI.md`

The non-strict candidate preflight confirms the expected templates and workflow exist, but warns about these placeholders. Do not ship generic template legal copy as if it described real data handling. Have the actual privacy, terms and support details reviewed before store submission.

## Not run / not verified in this environment

- `bun install`, semantic TypeScript typecheck, all Bun tests, complete monorepo builds and production frontend builds.
- Docker image build/boot and a full Docker Compose end-to-end run.
- Live PostgreSQL/MongoDB/Redis integrations, migration/seed on a real database, and a backup/restore drill.
- S3/R2 credentials and signed upload/download lifecycle, real Gemini API calls, Cloudflare deployment, Telegram billing/login, Stripe, Sentry/ELK/OpenTelemetry export, and load/security testing.
- Android Gradle/AAB signing, Xcode/iOS IPA signing and notarized desktop installers; these require platform toolchains and certificates.
- Render's authoritative cloud Blueprint validation, resource creation, cost confirmation, service deployment and live health check.

The repository currently does not include a committed `bun.lock`. After source import, run Bun 1.2.15 `bun install` in the project and commit its generated lockfile once dependencies have been reviewed; do not use an unverified lockfile in production. The source bundle has not been pushed to GitHub and no Render resources have been provisioned by this report.

## Publication semantics

The Release Center is a separate download and release-operations interface. It prepares metadata, validates artifact file signatures at a basic format/magic-byte level, calculates SHA-256, and tracks workflows. It does not replace Authenticode/Apple/Android signing, developer-account setup, or vendor review. SHA-256 verifies integrity against a trusted manifest; it is not a digital signature.
