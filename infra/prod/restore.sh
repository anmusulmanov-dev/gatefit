#!/usr/bin/env bash
# Restores the production database from the off-site bucket (docs/RUNBOOK.md).
#   infra/prod/restore.sh pitr [<target time, e.g. "2026-12-01 14:30:00+05">]
#       WAL-G: the latest base backup, then WAL replayed up to the target time (default: as
#       far as the archive goes). Replaces the data volume: the API must be stopped.
#   infra/prod/restore.sh dump <dumps/gatefit-....dump>
#       pg_restore of a logical dump into the running database (objects are recreated).
# The .env of the server must be the one the backup was made with: DATA_ENCRYPTION_KEY
# decrypts TOTP secrets and signs member QR codes.
set -euo pipefail

dir="${GATEFIT_DIR:-/srv/gatefit}"
cd "$dir"
compose=(docker compose --project-name gatefit --env-file .env -f infra/docker-compose.prod.yml)
mode="${1:-}"

case "$mode" in
  pitr)
    target="${2:-}"
    echo "Stopping the platform; restoring the latest base backup${target:+ up to $target}."
    "${compose[@]}" stop caddy web member api postgres
    # A fresh data directory, filled by WAL-G, then recovery replays WAL from the bucket.
    "${compose[@]}" run --rm --no-deps --entrypoint sh postgres -c '
      set -eu
      rm -rf "$PGDATA"/* "$PGDATA"/.[!.]* 2>/dev/null || true
      wal-g.sh backup-fetch "$PGDATA" LATEST
      touch "$PGDATA/recovery.signal"
      {
        echo "restore_command = '"'"'/usr/local/bin/wal-g.sh wal-fetch %f %p'"'"'"
        if [ -n "'"$target"'" ]; then
          echo "recovery_target_time = '"'"''"$target"''"'"'"
          echo "recovery_target_action = promote"
        fi
      } >> "$PGDATA/postgresql.auto.conf"
      chown -R postgres:postgres "$PGDATA"
    '
    "${compose[@]}" up -d postgres
    echo "PostgreSQL is replaying WAL. When 'docker compose logs postgres' shows the database"
    echo "accepting connections, check it (infra/prod/restore-check.sh) and start the rest:"
    echo "  ${compose[*]} up -d"
    ;;
  dump)
    object="${2:?which dump? e.g. dumps/gatefit-20261201T023000Z.dump}"
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
    docker run --rm \
      -e MC_HOST_backup="https://${BACKUP_S3_ACCESS_KEY}:${BACKUP_S3_SECRET_KEY}@${BACKUP_S3_ENDPOINT#https://}" \
      cgr.dev/chainguard/minio-client:latest cat "backup/${BACKUP_S3_BUCKET}/${object}" |
      "${compose[@]}" exec -T postgres sh -c \
        'pg_restore --clean --if-exists --no-owner --role=gatefit_migrator -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
    echo "Restored ${object}."
    ;;
  *)
    echo "usage: $0 pitr [target time] | dump <object>" >&2
    exit 2
    ;;
esac
