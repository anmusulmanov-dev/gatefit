#!/usr/bin/env bash
# Deploys the latest main to staging when it changed. Cron runs it every two minutes, so a
# merged pull request reaches staging without anyone logging in. The server only pulls:
# GitHub never needs access to it.
#
#   infra/staging/deploy.sh            deploy origin/main if it is new
#   infra/staging/deploy.sh --force    rebuild and redeploy the current origin/main
#
# A commit that fails to deploy is remembered and not retried until main moves on (or
# --force). The running containers stay as they were when a build fails.
set -euo pipefail

# Everything runs inside main(): git replaces this file during a deploy, and bash would
# otherwise keep reading the new version halfway through.
main() {
  local dir="${GATEFIT_DIR:-/srv/gatefit}"
  cd "$dir"

  exec 9> "$dir/.deploy.lock"
  flock --nonblocking 9 || return 0

  git fetch --quiet origin main
  local target deployed failed
  target="$(git rev-parse origin/main)"
  deployed="$(cat .deployed 2> /dev/null || true)"
  failed="$(cat .deploy-failed 2> /dev/null || true)"
  if [[ "${1:-}" != "--force" ]] && [[ "$target" == "$deployed" || "$target" == "$failed" ]]; then
    return 0
  fi

  log "deploying ${target:0:7}"
  git reset --hard --quiet "$target"
  if ! compose build --pull || ! compose up --detach --remove-orphans || ! wait_healthy; then
    echo "$target" > .deploy-failed
    log "FAILED ${target:0:7}; see: docker compose -p gatefit-staging logs migrate api"
    return 1
  fi
  # The Caddyfile is a bind mount: an edit does not recreate the container, so reload it.
  # A broken Caddyfile fails here and Caddy keeps serving the previous configuration.
  if ! compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile; then
    echo "$target" > .deploy-failed
    log "FAILED ${target:0:7}: Caddy rejected the Caddyfile; see: docker compose -p gatefit-staging logs caddy"
    return 1
  fi
  echo "$target" > .deployed
  rm -f .deploy-failed
  docker image prune --force > /dev/null
  log "deployed ${target:0:7}"
}

compose() {
  docker compose --project-name gatefit-staging --env-file .env \
    -f infra/docker-compose.staging.yml "$@"
}

# Waits up to three minutes for the API healthcheck (it starts after migrations).
wait_healthy() {
  local id status
  for _ in $(seq 1 36); do
    id="$(compose ps --quiet api)"
    status="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2> /dev/null || true)"
    [[ "$status" == "healthy" ]] && return 0
    sleep 5
  done
  return 1
}

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

main "$@"
exit
