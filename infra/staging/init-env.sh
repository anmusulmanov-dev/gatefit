#!/usr/bin/env bash
# Creates the staging .env from infra/staging/.env.example with fresh random secrets.
# Refuses to overwrite an existing file. Prints no secret.
#   infra/staging/init-env.sh [target]        default target: .env in the repository root
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
target="${1:-$root/.env}"
if [[ -e "$target" ]]; then
  echo "$target already exists; not touching it." >&2
  exit 1
fi

# URL-safe, so the values can sit inside connection strings unescaped.
token() { openssl rand -base64 "$1" | tr '+/' '-_' | tr -d '=\n'; }

app="$(token 24)"
migrator="$(token 24)"
sed \
  -e "s|CHANGE_ME_JWT|$(token 48)|" \
  -e "s|CHANGE_ME_KEY|$(openssl rand -base64 32)|" \
  -e "s|CHANGE_ME_PG|$(token 24)|" \
  -e "s|CHANGE_ME_APP|$app|g" \
  -e "s|CHANGE_ME_MIGRATOR|$migrator|g" \
  -e "s|CHANGE_ME_S3|$(token 24)|" \
  -e "s|CHANGE_ME_OWNER|$(token 12)|" \
  -e "s|CHANGE_ME_OPERATOR|$(token 12)|" \
  "$root/infra/staging/.env.example" > "$target"
chmod 600 "$target"
echo "Created $target. Review APP_BASE_DOMAIN before the first deploy."
