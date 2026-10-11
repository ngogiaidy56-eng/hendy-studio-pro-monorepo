#!/usr/bin/env bash
set -Eeuo pipefail
DB="${MONGODB_DATABASE:-hendy_studio}"
OUT_DIR="${BACKUP_DIR:-./backups/mongodb}"
mkdir -p "$OUT_DIR"; chmod 700 "$OUT_DIR"; umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/hendy-mongo-$STAMP.archive.gz"
if docker compose ps --status running mongo >/dev/null 2>&1 && docker compose ps --status running mongo | grep -q mongo; then
  docker compose exec -T mongo mongodump --db "$DB" --archive --gzip > "$OUT"
elif [[ -n "${MONGODB_URI:-}" ]] && command -v mongodump >/dev/null 2>&1; then
  mongodump --uri="$MONGODB_URI" --db "$DB" --archive="$OUT" --gzip
else
  echo 'Need a running Compose mongo service or MONGODB_URI plus mongodump installed.' >&2
  exit 2
fi
[[ -s "$OUT" ]] || { rm -f "$OUT"; echo 'Backup output is empty' >&2; exit 1; }
sha256sum "$OUT" > "$OUT.sha256"
printf 'MongoDB backup created: %s\n' "$OUT"
