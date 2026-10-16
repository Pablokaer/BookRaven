#!/bin/sh
# Periodic backups: a PostgreSQL dump plus the book files, kept for BACKUP_KEEP_DAYS.
# Runs as the "backup" service in docker-compose.yml (postgres image: has pg_dump and tar).
#
#   BACKUP_DIR             where backups go (default /backups)
#   DATA_DIR               BookRaven storage folder (default /data); skipped when empty
#                          (with STORAGE_DRIVER=s3, back up the bucket with its own tools)
#   BACKUP_KEEP_DAYS       how long to keep backups (default 14)
#   BACKUP_INTERVAL_HOURS  time between backups (default 24)
#   BACKUP_ONCE=1          take one backup and exit
#   PGHOST/PGUSER/PGPASSWORD/PGDATABASE  database connection
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DATA_DIR="${DATA_DIR:-/data}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"

backup() {
  stamp=$(date -u +%Y-%m-%dT%H%MZ)
  work="$BACKUP_DIR/.in-progress-$stamp"
  mkdir -p "$work"

  pg_dump --format=custom --file="$work/database.dump"

  if [ -d "$DATA_DIR/books" ]; then
    # Temp uploads are never worth keeping, and the CBZ copies of comics are made again when needed.
    tar -czf "$work/files.tar.gz" -C "$DATA_DIR" --exclude=./tmp --exclude=./derived .
  fi

  # Only a complete backup gets its final name.
  mv "$work" "$BACKUP_DIR/$stamp"
  echo "$(date -u +%FT%TZ) backup written: $BACKUP_DIR/$stamp ($(du -sh "$BACKUP_DIR/$stamp" | cut -f1))"

  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf {} +
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '.in-progress-*' -mmin +720 -exec rm -rf {} +
}

mkdir -p "$BACKUP_DIR"
if [ "${BACKUP_ONCE:-0}" = "1" ]; then
  backup
  exit 0
fi
while true; do
  backup || echo "$(date -u +%FT%TZ) backup FAILED" >&2
  sleep $((INTERVAL_HOURS * 3600))
done
