#!/usr/bin/env bash
# Nightly production backup (cron, docs/RUNBOOK.md):
#   1. a WAL-G base backup to the off-site bucket; with the WAL segments PostgreSQL ships
#      every minute it restores the database to any moment of the last 14 days;
#   2. a logical dump (pg_dump), also to the bucket, kept 30 days: readable by any
#      PostgreSQL 16, independent of WAL-G.
# Prints no secrets. Exits non-zero on any failure, so cron mail or the log shows it.
#   infra/prod/backup.sh
set -euo pipefail

dir="${GATEFIT_DIR:-/srv/gatefit}"
cd "$dir"
compose=(docker compose --project-name gatefit --env-file .env -f infra/docker-compose.prod.yml)
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

# 1. Base backup, then keep the 14 newest (older WAL goes with them).
"${compose[@]}" exec -T postgres sh -c 'wal-g.sh backup-push "$PGDATA"'
"${compose[@]}" exec -T postgres wal-g.sh delete retain FULL 14 --confirm

# 2. Logical dump streamed to the bucket, no copy left on this server.
set -a
# shellcheck disable=SC1091
. ./.env
set +a
dump="dumps/gatefit-${stamp}.dump"
"${compose[@]}" exec -T postgres sh -c 'pg_dump --format=custom -U "$POSTGRES_USER" "$POSTGRES_DB"' |
  docker run --rm -i \
    -e MC_HOST_backup="https://${BACKUP_S3_ACCESS_KEY}:${BACKUP_S3_SECRET_KEY}@${BACKUP_S3_ENDPOINT#https://}" \
    cgr.dev/chainguard/minio-client:latest pipe "backup/${BACKUP_S3_BUCKET}/${dump}"
docker run --rm \
  -e MC_HOST_backup="https://${BACKUP_S3_ACCESS_KEY}:${BACKUP_S3_SECRET_KEY}@${BACKUP_S3_ENDPOINT#https://}" \
  cgr.dev/chainguard/minio-client:latest rm --recursive --force --older-than 30d \
  "backup/${BACKUP_S3_BUCKET}/dumps/" >/dev/null

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup ok: base backup and ${dump}"
