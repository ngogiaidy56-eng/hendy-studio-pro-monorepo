# API Reference (v1)

Base path: `/api/v1`. Except registration/login, protected endpoints require `Authorization: Bearer <access-token>`. JSON errors have the shape `{ "error": "...", "requestId": "..." }` when produced by the central error handler.

## Authentication

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/register` | Create a basic user (password at least 12 characters) |
| POST | `/auth/login` | Authenticate and issue a short-lived access token |
| GET | `/auth/me` | Return the current account, roles, and permissions |

## Projects and timeline

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/projects` | List owner-scoped projects |
| POST | `/projects` | Create a project, optionally with a validated timeline |
| GET | `/projects/:id` | Read an owned project |
| PATCH | `/projects/:id` | Update project title and/or timeline |
| DELETE | `/projects/:id` | Delete an owned project |
| GET | `/projects/:id/manifest` | Build a validated render manifest for an owned project |

Timeline writes validate clip/time bounds and verify that referenced assets belong to the current account. A PostgreSQL row lock protects asset references against concurrent asset deletion; per-account advisory locks serialize project-quota checks. MongoDB and PostgreSQL do not share a distributed transaction, so recovery should be considered when either database is interrupted during a cross-store project write.

## Assets and object storage

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/assets` | List the current user's uploaded assets |
| POST | `/assets/presign` | Enforce quota and request a 5-minute presigned PUT URL |
| POST | `/assets/complete` | Verify object size with storage HEAD, then finalize upload |
| PUT | `/assets/:id/metadata` | Store validated duration for audio/video and supported timed text |
| GET | `/assets/download-url?key=...` | Return a 5-minute signed download URL for an owned asset or completed render |
| DELETE | `/assets/:id` | Delete unreferenced media; refuses assets used by saved timelines |

Direct uploads require S3/R2 credentials and bucket CORS that permits the configured frontend origins, `PUT`, `HEAD`, and the signed `Content-Type` header. The server verifies the uploaded object's size; it does not perform a malware scan.

## Render queue

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/render/jobs` | List the current user's render history |
| POST | `/render/jobs` | Queue a single-source transcode or saved timeline render |
| GET | `/render/jobs/:id` | Read an owned job and its progress |
| DELETE | `/render/jobs/:id` | Cancel a queued job or delete a completed output object |

Timeline render currently supports MP4/MOV visual clips, MP3/WAV or video-source audio, static overlay/PiP, simple volume/limiting and SRT hard-sub. It caps jobs at 1,000 clips, 128 unique media sources, 4 GiB total source bytes, 12 hours timeline duration and 2 GiB output. It does not yet provide dynamic keyframes, transitions, VTT/ASS styling, or cancellation of an FFmpeg process that has already started.

## AI and administration

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| GET | `/ai/status` | Authenticated user | Report whether Gemini translation is configured |
| POST | `/ai/translate` | Authenticated user + process-local rate limit | Translate supplied text/subtitle structure with Gemini when configured |
| GET | `/admin/users` | `users:read` | Paginated account list |
| PATCH | `/admin/users/:id/status` | `users:manage` | Change account status with audit record and last-admin guard |
| PUT | `/admin/users/:id/roles` | `roles:manage` | Replace assigned roles with audit record and last-admin guard |
| GET | `/admin/roles` | `roles:manage` | List role/permission grants |
| GET | `/admin/audit-logs` | `audit:read` | Read audit history |
| GET | `/admin/stats` | `users:read` | User totals and plan catalogue |
| GET | `/admin/settings` | `config:manage` | List non-secret dynamic settings |
| PUT | `/admin/settings/:key` | `config:manage` | Create/update a validated non-secret setting with audit record |

## Operations endpoints

- `GET /healthz`: checks PostgreSQL, Redis, and MongoDB; returns 503 when any is unavailable.
- `GET /metrics`: Prometheus metrics, protected by `METRICS_TOKEN` in production.
- `GET /edge-health`: Cloudflare Worker edge health.

The API uses JSON bearer access tokens. Refresh-token rotation, MFA, email verification and password reset flows are not implemented yet.
