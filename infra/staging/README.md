# Staging runbook

Staging runs the whole platform on one server (`web01`, Ubuntu, Docker) from
`infra/docker-compose.staging.yml`. Decision record: `docs/ADR/0005-staging.md`.

| Host                                   | What                                   |
| -------------------------------------- | -------------------------------------- |
| `https://staging.gatefit.uz`           | staff web panel                        |
| `https://admin.staging.gatefit.uz`     | platform back office (super-admin)     |
| `https://<slug>.staging.gatefit.uz`    | an organization's staff panel (`demo`) |
| `https://<slug>.my.staging.gatefit.uz` | an organization's member app           |
| any host + `/api/*`                    | API; Swagger at `/api/docs`            |

Caddy obtains a certificate for each host on its first request, after asking the API
whether the host exists (`/api/v1/tls/allowed`).

## How a change reaches staging

1. A pull request is merged into `main` (CI green).
2. Within two minutes cron runs `infra/staging/deploy.sh` on the server. It pulls `main`,
   builds the images, applies migrations, runs the idempotent seed and restarts what
   changed. Log: `/srv/gatefit/deploy.log`.
3. A commit that fails to deploy is remembered in `.deploy-failed` and not retried until
   `main` moves on. The previous containers keep running.

## One-time setup

DNS (domain registrar), both pointing at the office's public IP:

```
staging.gatefit.uz       A  <public IP>
*.staging.gatefit.uz     A  <public IP>
*.my.staging.gatefit.uz  A  <public IP>
```

Router: forward TCP 80 and 443 (and UDP 443 for HTTP/3) to the server.

Server, as the deploy user (member of the `docker` group, no sudo needed):

```bash
git clone https://github.com/anmusulmanov-dev/gatefit.git /srv/gatefit
cd /srv/gatefit
infra/staging/init-env.sh          # .env with random secrets; prints none of them
infra/staging/deploy.sh --force
crontab -e
```

```
*/2 * * * * /srv/gatefit/infra/staging/deploy.sh >> /srv/gatefit/deploy.log 2>&1
30 2 * * *  /srv/gatefit/infra/staging/backup.sh >> /srv/backups/gatefit.log 2>&1
```

Keep a copy of `/srv/gatefit/.env` somewhere safe: `DATA_ENCRYPTION_KEY` is required to
read TOTP secrets, including those in a restored backup.

## Everyday commands

From `/srv/gatefit`:

```bash
alias dc='docker compose --project-name gatefit-staging --env-file .env -f infra/docker-compose.staging.yml'
dc ps                              # state of every service
dc logs -f --tail 100 api          # API log; console SMS codes appear here (staging only)
infra/staging/deploy.sh --force    # redeploy the current main
grep SEED_ .env                    # demo owner and operator sign-in
```

Backups: `/srv/backups/gatefit/*.dump`, daily, last 14 kept. Restore into the running
database:

```bash
dc exec -T postgres sh -c 'pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < /srv/backups/gatefit/<file>.dump
```
