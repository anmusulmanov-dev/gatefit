# Staging runbook

Staging runs the whole platform on one server (`web01`, Ubuntu, Docker) from
`infra/docker-compose.staging.yml`. Decision record: `docs/ADR/0005-staging.md`.

| Host                                   | What                                   |
| -------------------------------------- | -------------------------------------- |
| `https://staging.gatefit.uz`           | staff web panel                        |
| `https://admin.staging.gatefit.uz`     | platform back office (super-admin)     |
| `https://<slug>.staging.gatefit.uz`    | an organization's staff panel (`demo`) |
| `https://<slug>-my.staging.gatefit.uz` | an organization's member app           |
| any host + `/api/*`                    | API; Swagger at `/api/docs`            |

Caddy obtains a certificate for each host on its first request, after asking the API
whether the host exists (`/api/v1/tls/allowed`).

**Staging is private.** The office line sits behind the provider's CGNAT (no public IP of
its own), so nothing on it can be reached from the internet. Staging is reached over
Tailscale only: the DNS records point at the server's Tailscale address, and Caddy issues
certificates from its own CA (`CADDY_TLS_ISSUER=internal`), which each device trusts once.

## How a change reaches staging

1. A pull request is merged into `main` (CI green).
2. Within two minutes cron runs `infra/staging/deploy.sh` on the server. It pulls `main`,
   builds the images, applies migrations, runs the idempotent seed and restarts what
   changed. Log: `/srv/gatefit/deploy.log`.
3. A commit that fails to deploy is remembered in `.deploy-failed` and not retried until
   `main` moves on. The previous containers keep running.

## One-time setup

Tailscale on the server (`sudo tailscale up`; its address: `tailscale ip -4`).

DNS (ahost DNS manager), each pointing at the server's Tailscale address. The ahost panel
does not accept wildcard names, so every organization's two hosts are added by hand:

```
staging.gatefit.uz          A  <tailscale IP>
admin.staging.gatefit.uz    A  <tailscale IP>
demo.staging.gatefit.uz     A  <tailscale IP>
demo-my.staging.gatefit.uz  A  <tailscale IP>
```

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

## Opening staging on a device

1. Install Tailscale and sign in to the team's tailnet.
2. Trust Caddy's root certificate, once per device. Get it from the server:

   ```bash
   ssh web01 "docker compose -p gatefit-staging --env-file /srv/gatefit/.env -f /srv/gatefit/infra/docker-compose.staging.yml exec -T caddy cat /data/caddy/pki/authorities/local/root.crt" > gatefit-staging-root.crt
   ```

   - Windows: open the file → Install Certificate → Current User → "Trusted Root
     Certification Authorities". Restart the browser.
   - macOS: open it in Keychain Access, then set "Always Trust".
   - Android: Settings → Security → Encryption & credentials → Install a certificate → CA
     certificate.
   - iPhone: open the file, install the profile, then Settings → General → About →
     Certificate Trust Settings → enable it.

   The certificate is valid for ten years and only for names Caddy signs on this server.
   It stays the same as long as the `caddy-data` volume is kept.

3. Open `https://demo.staging.gatefit.uz`.

## Public through Cloudflare Tunnel

Until Gatefit moves to a server with a public address, `web01` serves the real domain
(`gatefit.uz`) to the internet through a Cloudflare Tunnel. `cloudflared` already runs on
the server as a system service (`systemctl status cloudflared`, tunnel `WEB01`, token in
`/etc/cloudflared/token`) and keeps an outbound connection to Cloudflare. Cloudflare serves
`gatefit.uz` and `*.gatefit.uz` with its own certificate and forwards each request to
Caddy on `http://localhost:80` (`Caddyfile.cloudflare`). Nothing is opened on the router
and CGNAT does not matter. The free certificate covers one level below the domain only,
which is why member apps live at `<slug>-my.gatefit.uz`.

| Host                           | What                          |
| ------------------------------ | ----------------------------- |
| `https://gatefit.uz`           | staff web panel               |
| `https://admin.gatefit.uz`     | platform back office          |
| `https://<slug>.gatefit.uz`    | an organization's staff panel |
| `https://<slug>-my.gatefit.uz` | an organization's member app  |

1. Cloudflare: add `gatefit.uz` (free plan); at the registrar (ahost) replace the name
   servers with the two Cloudflare gives. Wait until Cloudflare shows the domain as active.
2. SSL/TLS: mode **Full**; Edge Certificates: **Always Use HTTPS** on.
3. Networking → Tunnels → `WEB01` → add two published application routes, both to the
   service `http://localhost:80`: `gatefit.uz` and `*.gatefit.uz`. Cloudflare creates the
   DNS records. The tunnel's other routes belong to other sites: leave them alone.
4. On the server, in `/srv/gatefit/.env`:

   ```
   APP_BASE_DOMAIN=gatefit.uz
   CADDY_CONFIG=Caddyfile.cloudflare
   CADDY_BIND=127.0.0.1
   ```

   then `infra/staging/deploy.sh --force`. Check: `https://demo.gatefit.uz` opens from a
   phone on mobile data.

Visitors' addresses reach the API from Cloudflare's `CF-Connecting-IP` header, trusted only
from private addresses; `CADDY_BIND=127.0.0.1` keeps the office network from talking to
Caddy directly. If the office loses power or internet, the site is down.

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
