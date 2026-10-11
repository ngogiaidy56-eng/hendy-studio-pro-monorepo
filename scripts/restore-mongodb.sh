#!/usr/bin/env bash
set -Eeuo pipefail
DB="${MONGODB_DATABASE:-hendy_studio}"
if [[ $# -ne 1 || ! -f "$1" ]]; then echo "Usage: $0 path/to/backup.archive.gz" >&2; exit 2; fi
if [[ "${CONFIRM_DESTRUCTIVE_RESTORE:-}" != "YES" ]]; then
  echo 'Restore with --drop removes collections in the selected database.' >&2
  echo 'Set CONFIRM_DESTRUCTIVE_RESTORE=YES after verifying the target and backup.' >&2
  exit 2
fi
if docker compose ps --status running mongo >/dev/null 2>&1 && docker compose ps --status running mongo | grep -q mongo; then
  docker compose exec -T mongo mongorestore --nsInclude="$DB.*" --archive --gzip --drop < "$1"
elif [[ -n "${MONGODB_URI:-}" ]] && command -v mongorestore >/dev/null 2>&1; then
  mongorestore --uri="$MONGODB_URI" --nsInclude="$DB.*" --archive="$1" --gzip --drop
else
  echo 'Need a running Compose mongo service or MONGODB_URI plus mongorestore installed.' >&2
  exit 2
fi
echo 'MongoDB restore completed. Verify collections and application health.'
