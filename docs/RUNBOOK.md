# Production runbook

The whole platform runs on one server from `infra/docker-compose.prod.yml` (staging:
`infra/staging/README.md`). Only Caddy is reachable from outside; certificates are public
(ACME) and issued per host on its first request, after the API confirms the host exists.

| Host                           | What                                                    |
| ------------------------------ | ------------------------------------------------------- |
| `https://gatefit.uz`           | staff web panel                                         |
| `https://admin.gatefit.uz`     | platform back office (super-admin)                      |
| `https://<slug>.gatefit.uz`    | an organization's staff panel                           |
| `https://<slug>.my.gatefit.uz` | an organization's member app                            |
| any host + `/api/*`            | API (Swagger off: `SWAGGER_ENABLED=true` to turn it on) |

## First start

1. Server: Ubuntu LTS, Docker, a deploy user in the `docker` group, ports 80 and 443 open.
2. DNS: `gatefit.uz`, `*.gatefit.uz` and `*.my.gatefit.uz` → the server's public address.
3. Code and secrets:
   ```bash
   git clone https://github.com/anmusulmanov-dev/gatefit.git /srv/gatefit && cd /srv/gatefit
   infra/staging/init-env.sh   # .env with random secrets; prints none of them
   ```
   Then edit `.env` for production: `NODE_ENV=production`, `APP_ENV=production`,
   `APP_BASE_DOMAIN=gatefit.uz`, `CORS_ORIGINS`, `SMS_DRIVER=eskiz` and `ESKIZ_*`,
   `S3_*` (the files bucket), `BACKUP_S3_*` (the backup bucket, another provider or
   region), `SEED_PLATFORM_ADMIN_*` (the first operator). The API refuses to start with
   the console SMS driver or in-memory storage in production.
4. **Copy `.env` to a safe place off the server.** Without `DATA_ENCRYPTION_KEY` a
   restored database cannot decrypt TOTP secrets, and every member QR code changes.
5. Start: `docker compose --project-name gatefit --env-file .env -f infra/docker-compose.prod.yml up -d --build`.
   The `migrate` service applies migrations and seeds the platform only (`SEED_DEMO=false`).
6. Sign in at `https://admin.gatefit.uz` with the operator from `.env`, set up TOTP,
   change the password, create the first organization.
7. Cron for the deploy user:
   ```
   30 2 * * *  /srv/gatefit/infra/prod/backup.sh >> /srv/backups/gatefit.log 2>&1
   0  4 * * 1  cd /srv/gatefit && infra/restore-drill.sh prod >> /srv/backups/drill.log 2>&1
   ```

## Updating

```bash
cd /srv/gatefit && git pull
docker compose --project-name gatefit --env-file .env -f infra/docker-compose.prod.yml up -d --build
```

Migrations run before the new API starts; a failed migration leaves the old containers
running. Check `docker compose ... ps` and `logs api`.

## Backups

- **Continuous (WAL-G)**: PostgreSQL ships every finished WAL segment to
  `BACKUP_S3_PREFIX`, at least once a minute. At most about a minute of data is at risk.
- **Nightly** (`infra/prod/backup.sh`): a WAL-G base backup (14 kept, with their WAL:
  any moment of the last two weeks) and a `pg_dump` to `dumps/` (30 days).
- **Weekly drill** (`infra/restore-drill.sh prod`): dumps the live database, restores it
  into a scratch database and compares the row count of every table. A failure in
  `/srv/backups/drill.log` means the backups cannot be trusted: investigate the same day.
- Files (photos, imports) live in the `S3_*` bucket; turn on the provider's versioning.
- Redis holds queues and rate limits only; it is not backed up.

## Restoring

Stop and think first: restoring replaces data. Tell the clubs; note the time.

**To a moment** (a bad deploy, deleted data): the API must be stopped.

```bash
infra/prod/restore.sh pitr "2026-12-01 14:30:00+05"   # or no time: as far as the archive goes
# wait for 'database system is ready to accept connections' in: docker compose ... logs -f postgres
docker compose --project-name gatefit --env-file .env -f infra/docker-compose.prod.yml up -d
```

**From a dump** (WAL archive damaged, or a copy elsewhere):

```bash
infra/prod/restore.sh dump dumps/gatefit-20261201T023000Z.dump
```

**On a new server** (the old one is gone): steps 1–3 of First start with the saved `.env`,
start only PostgreSQL (`up -d postgres`), then `restore.sh pitr`, then `up -d`.

After any restore: sign in to the platform and one organization, open the members list,
the payments journal and the reception screen; run `infra/restore-drill.sh prod`.

## When something is wrong

| Sign                               | Look at                                                       | Usual cause                                    |
| ---------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| Site down                          | `docker compose ... ps`, `logs caddy`                         | a container stopped; certificate rate limit    |
| "Service unavailable" in the panel | `logs api`                                                    | database or Redis down; failed migration       |
| SMS not arriving                   | `notifications` table (`status`, `last_error`), Eskiz panel   | Eskiz balance, unapproved template text        |
| Backup log not updated             | `/srv/backups/gatefit.log`, `logs postgres` (archive_command) | bucket keys, disk full                         |
| Reception screen "offline"         | the screen's network; `logs api`                              | internet at the club; it syncs by itself later |
