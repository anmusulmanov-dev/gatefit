#!/usr/bin/env bash
# Restore drill (docs/TZ.md acceptance criterion 12, docs/RUNBOOK.md): dumps the live
# database, restores the dump into a scratch database next to it, compares the row count
# of every table, then drops the scratch database. Exits non-zero on any difference.
# Touches nothing in the live database.
#   infra/restore-drill.sh dev|staging|prod
set -euo pipefail

case "${1:-}" in
  dev) compose=(docker compose --env-file .env -f infra/docker-compose.dev.yml) ;;
  staging) compose=(docker compose --project-name gatefit-staging --env-file .env -f infra/docker-compose.staging.yml) ;;
  prod) compose=(docker compose --project-name gatefit --env-file .env -f infra/docker-compose.prod.yml) ;;
  *)
    echo "usage: $0 dev|staging|prod" >&2
    exit 2
    ;;
esac

scratch=gatefit_restore_drill
psql() { "${compose[@]}" exec -T postgres sh -c "psql -v ON_ERROR_STOP=1 -X -q -A -t -U \"\$POSTGRES_USER\" $*"; }

started=$(date +%s)
psql -d postgres -c "'DROP DATABASE IF EXISTS $scratch'" >/dev/null
psql -d postgres -c "'CREATE DATABASE $scratch'" >/dev/null
trap 'psql -d postgres -c "'"'"'DROP DATABASE IF EXISTS '"$scratch"''"'"'" >/dev/null || true' EXIT

# Dump and restore in one stream: the dump never lands on disk.
"${compose[@]}" exec -T postgres sh -c 'pg_dump --format=custom -U "$POSTGRES_USER" "$POSTGRES_DB"' |
  "${compose[@]}" exec -T postgres sh -c "pg_restore --no-owner --exit-on-error -U \"\$POSTGRES_USER\" -d $scratch"

# Exact row counts of every table (partitions counted on their own too), as name|count.
counts_sql="SELECT format('SELECT %L || ''|'' || count(*) FROM %I.%I', c.relname, n.nspname, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname"
count_all() {
  local db="$1"
  # Inner calls must not read the loop's input: docker exec would swallow the next lines.
  psql -d "$db" -c "\"$counts_sql\"" </dev/null | while read -r query; do
    psql -d "$db" -c "\"$query\"" </dev/null
  done
}
live=$(count_all '"$POSTGRES_DB"')
restored=$(count_all "$scratch")

tables=$(printf '%s\n' "$live" | wc -l)
rows=$(printf '%s\n' "$live" | awk -F'|' '{ s += $2 } END { print s }')
if [ "$live" != "$restored" ]; then
  echo "Restore drill FAILED: row counts differ" >&2
  diff <(printf '%s\n' "$live") <(printf '%s\n' "$restored") >&2 || true
  exit 1
fi
echo "Restore drill passed: $tables tables, $rows rows restored identically in $(($(date +%s) - started)) s."
