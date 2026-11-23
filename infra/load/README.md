# Load test

`k6.js`: 100 concurrent users on the demo organization (docs/TZ.md section 4, acceptance
criterion 14). 70 % of iterations open staff pages (members, search, entry journal,
payments, daily report, plans), 30 % check a member QR code at the desk. It fails when
API p95 ≥ 300 ms, QR check p95 ≥ 500 ms or more than 1 % of requests fail.

## Run

1. Demo data: `pnpm --filter api seed` then `pnpm --filter api seed:demo` (300 members, a
   month of payments and visits).
2. A staff account without TOTP that may verify entries, read payments and the daily
   report (a manager), in the root `.env` — never in chat or in the repository:
   ```
   LOAD_STAFF_PHONE=+998...
   LOAD_STAFF_PASSWORD=...
   ```
3. QR codes for the next minutes (they expire): `pnpm --filter api load:tokens 10`.
4. The API running (`pnpm --filter api dev`, or staging), then from the repository root:
   ```bash
   set -a; . ./.env; set +a
   docker run --rm -i -v "$PWD/infra/load:/load" -w /load \
     -e BASE_URL=http://host.docker.internal:8000 -e TENANT_HOST=demo.localhost:3000 \
     -e STAFF_PHONE="$LOAD_STAFF_PHONE" -e STAFF_PASSWORD="$LOAD_STAFF_PASSWORD" \
     grafana/k6:2.3.0 run --summary-export results/summary.json k6.js
   ```
   Against staging: `BASE_URL=https://demo.staging.gatefit.uz`, `TENANT_HOST=demo.staging.gatefit.uz`,
   and the codes made with staging's `DATA_ENCRYPTION_KEY`.

Each virtual user sends its own `X-Forwarded-For`, so the per-IP rate limit sees 100
users, as in a real club, not one machine.
