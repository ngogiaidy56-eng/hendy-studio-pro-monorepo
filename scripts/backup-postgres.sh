#!/usr/bin/env bash
set -Eeuo pipefail
OUT_DIR="${BACKUP_DIR:-./backups/postgres}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/hendy-postgres-$STAMP.dump"
umask 077

if docker compose ps --status running postgres >/dev/null 2>&1 && docker compose ps --status running postgres | grep -q postgres; then
  # The default Compose database is not published to the host; dump through its Unix socket.
  docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-hendy}" -d "${POSTGRES_DB:-hendy_studio}" --format=custom --no-owner --no-acl > "$OUT"
elif [[ -n "${DATABASE_URL:-}" ]] && command -v pg_dump >/dev/null 2>&1; then
  pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$OUT"
else
  echo 'Need a running Compose postgres service or DATABASE_URL plus pg_dump installed.' >&2
  exit 2
fi
[[ -s "$OUT" ]] || { rm -f "$OUT"; echo 'Backup output is empty' >&2; exit 1; }
sha256sum "$OUT" > "$OUT.sha256"
printf 'PostgreSQL backup created: %s\n' "$OUT"
printf 'Store backups outside this server and test restoration periodically.\n'
