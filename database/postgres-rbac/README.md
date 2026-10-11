# PostgreSQL RBAC

`001_init.sql` creates users, roles, permissions, join tables, append-oriented audit events, subscription plans, subscriptions and payment event deduplication. `seed.ts` creates the role/permission catalog. Permission checks run in the API, never only in the UI.

For production, manage migrations with a versioned migration runner and a non-superuser schema owner. Restrict direct DB access, enforce TLS, encrypt backups, and define retention/access controls for audit and payment event payloads. Never store card numbers or secrets in `payment_events.payload`.


Migration 003 adds the per-plan `maxStorageBytes` metadata used by the upload API. The API locks the account row while reserving a pending upload so concurrent uploads cannot exceed a user's configured quota. A pending reservation is counted for 24 hours or until it becomes uploaded/deleted.

Migration 004 adds optional `duration_seconds`, used by the studio for clip placement. The browser supplies duration metadata, but the worker re-probes media and does not rely on client metadata for media safety.
