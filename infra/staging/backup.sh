#!/usr/bin/env bash
# Daily database backup for staging (cron). Keeps the last 14 dumps.
#   infra/staging/backup.sh [backup-dir]       default: /srv/backups/gatefit
# Restore: pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB" < dump
# The .env file (DATA_ENCRYPTION_KEY) is needed to read TOTP secrets in a restored database.
set -euo pipefail

dir="${GATEFIT_DIR:-/srv/gatefit}"
out="${1:-/srv/backups/gatefit}"
mkdir -p "$out"
cd "$dir"

file="$out/gatefit-$(date -u +%Y%m%dT%H%M%SZ).dump"
# The superuser's name and database come from the container's own environment.
docker compose --project-name gatefit-staging --env-file .env -f infra/docker-compose.staging.yml \
  exec -T postgres sh -c 'pg_dump --format=custom -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$file.tmp"
mv "$file.tmp" "$file"
chmod 600 "$file"

ls -1t "$out"/gatefit-*.dump | tail -n +15 | xargs -r rm --
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup $(basename "$file") $(du -h "$file" | cut -f1)"
