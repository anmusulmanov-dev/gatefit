#!/bin/bash
# Creates the two database roles and the test database. Runs once, when PostgreSQL
# initialises an empty data directory (docker-entrypoint-initdb.d), and in CI.
#
#   gatefit_migrator  owns the schema; used by migrations, seed and the platform module.
#                     As table owner it is not subject to RLS.
#   gatefit_app       used by the API for every tenant request. Not a superuser, no
#                     BYPASSRLS, owns nothing: RLS always applies to it.
#
# Role names are fixed because migrations grant privileges to them by name.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v app_password="$DB_APP_PASSWORD" \
  -v migrator_password="$DB_MIGRATOR_PASSWORD" <<'SQL'
-- CREATEDB lets `prisma migrate dev` create its shadow database.
CREATE ROLE gatefit_migrator LOGIN CREATEDB PASSWORD :'migrator_password';
CREATE ROLE gatefit_app LOGIN PASSWORD :'app_password';

ALTER DATABASE :"db" OWNER TO gatefit_migrator;
CREATE DATABASE gatefit_test OWNER gatefit_migrator;
SQL
