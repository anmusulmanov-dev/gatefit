#!/bin/sh
# Runs WAL-G with the S3 settings of the container (WALG_S3_PREFIX, AWS_*). Used by
# archive_command, the nightly base backup and restores (docs/RUNBOOK.md).
set -eu
: "${WALG_S3_PREFIX:?WALG_S3_PREFIX is not set}"
export PGHOST="${PGHOST:-/var/run/postgresql}"
export PGUSER="${PGUSER:-$POSTGRES_USER}"
export PGDATABASE="${PGDATABASE:-$POSTGRES_DB}"
exec /usr/local/bin/wal-g "$@"
