# Integration status and production checklist

This file distinguishes implemented starter flows from extension points that still require development, credentials, or live deployment validation.

| Area | Status | Notes |
|---|---|---|
| System configuration | Implemented | `system-config/system.config.json`, JSON Schema, validator and generated TypeScript constants; CI checks generated output remains synchronized |
| React Admin + Studio | Implemented foundation | Separate Vite apps, API-backed session, user/project/media panels and basic timeline operations |
| PostgreSQL identities/RBAC/audit | Implemented foundation | Versioned migrations, atomic seed transaction, route permissions, status check, last-active-admin guard |
| MongoDB projects | Implemented foundation | Owner-scoped project documents and schema validation |
| S3-compatible/R2 asset upload | Implemented | Presigned PUT/GET, content-length verification, quotas, owner namespace, project reference checks |
| Render queue | Implemented foundation | BullMQ/Redis, persisted job state, queued cancellation, retry handling |
| FFmpeg timeline compositor | Implemented bounded baseline | MP4/MOV clips, separate audio, static PiP/overlay, SRT burn-in and output probe smoke test |
| Gemini subtitle translation | Implemented when configured | `GEMINI_API_KEY` required; provider rate/usage costs are external |
| Local Whisper transcription | CLI only | `bun run worker:whisper -- <input>` (pass arguments after `--`); not exposed as an authenticated API or queued service |
| Cloudflare edge + Telegram webhook | Starter | WAF/Workers routing needs real Cloudflare variables/secrets; webhook sends simple responses, not full Mini App billing/auth |
| Prometheus metrics | Implemented baseline | `/metrics` token protection in production; rate limit storage is process-local |
| Grafana dashboard | Starter | Optional Compose profile; configure secure admin credentials and persistent retention |
| Sentry / ELK / OpenTelemetry export | Not wired end-to-end | Environment placeholders exist; real SDKs/collectors and retention policy are required |
| Payment/subscription schema | Database only | No Stripe/Telegram payment webhook or entitlement synchronization yet |
| Ktor backend | Health/capabilities starter | Express/PostgreSQL API remains authoritative; internal authenticated service contract is not wired |
| Android / iOS / Desktop | Store-oriented wrappers and packaging foundation | Android supports WebView file chooser and launcher icons; iOS SwiftUI/WKWebView shell has an XcodeGen project and AppIcon set; Electron builds Windows/macOS/Linux packages. They are hosted-Web clients, not a local/offline native editor. Signed distribution requires platform certificates and device validation |
| CI/CD and app publishing | Extended release pipeline | `app-release.yml` builds four web bundles, desktop packages, Android debug artifact, iOS simulator-validation job, optional signed AAB/TestFlight IPA and Microsoft Store AppX; public GitHub Release is separately gated. Official store approval remains a manual vendor review and is never inferred by the app |
| Production readiness | Requires staging gate | Dependency install, semantic typecheck, container build, live service tests, restore drill, security review, legal-page completion, platform signing, store metadata and user acceptance are mandatory |

## Operational commands

```bash
node scripts/setup-dev.mjs
node scripts/validate-env.mjs
node scripts/audit-source.mjs
node scripts/validate-system-config.mjs
node scripts/generate-system-config.mjs
node scripts/verify-render-runtime.mjs
bun install
bun run typecheck
bun run test
bun run build
bun run release:gate
bun run assets:cleanup
bun run renders:cleanup
```

Keep `.env` private. `node scripts/verify-render-runtime.mjs` validates the local FFmpeg/ffprobe build and basic filter graph; it does not test object-store credentials or all real user media formats.
