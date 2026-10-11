#!/usr/bin/env bash
set -Eeuo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then echo "Usage: $0 path/to/backup.dump" >&2; exit 2; fi
if [[ "${CONFIRM_DESTRUCTIVE_RESTORE:-}" != "YES" ]]; then
  echo 'Restore may replace database objects in the target database.' >&2
  echo 'Take a fresh backup, validate the target, then set CONFIRM_DESTRUCTIVE_RESTORE=YES.' >&2
  exit 2
fi
if docker compose ps --status running postgres >/dev/null 2>&1 && docker compose ps --status running postgres | grep -q postgres; then
  docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-hendy}" -d "${POSTGRES_DB:-hendy_studio}" --clean --if-exists --no-owner --no-acl < "$1"
elif [[ -n "${DATABASE_URL:-}" ]] && command -v pg_restore >/dev/null 2>&1; then
  pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-acl "$1"
else
  echo 'Need a running Compose postgres service or DATABASE_URL plus pg_restore installed.' >&2
  exit 2
fi
echo 'PostgreSQL restore command completed. Validate row counts and application health before reopening traffic.'
