# ADR 0005: Staging serveri va deploy

Sana: 2026-11-18. Holat: qabul qilingan.

## Qaror

1. **Bitta server, Docker Compose** (`infra/docker-compose.staging.yml`): postgres, redis, minio, migrate (bir martalik), api, web, member, caddy. Tashqariga faqat Caddy ochiq (80, 443).
2. **Caddy (Nginx Proxy Manager emas)**, Anvar tasdiqlagan: sozlama repoda (`infra/caddy/Caddyfile`), TLS sertifikatlari avtomatik. Serverdagi NPM to'xtatildi; uning ma'lumotlari `/srv/proxy` da qoldi.
3. **Manzillar:** `<base>`, `admin.<base>`, `<slug>.<base>` (xodimlar paneli), `<slug>-my.<base>` (a'zo ilovasi; 2026-11-28 gacha `<slug>.my.<base>`). `/api/*` istalgan manzilda API ga boradi. Staging'da `<base>` = `staging.gatefit.uz`.
4. **Sertifikatlar talab bo'yicha (on-demand TLS):** tashkilotlar ish vaqtida qo'shiladi, wildcard sertifikat esa registrator API'sini talab qiladi. Caddy har yangi manzil uchun avval `GET /api/v1/tls/allowed?domain=` dan so'raydi; faqat mavjud tashkilot (bloklangani ham) va platforma manzillari ruxsat oladi.
5. **Deploy server tomondan tortib olinadi:** cron har 2 daqiqada `infra/staging/deploy.sh` ni ishga tushiradi: `main` o'zgargan bo'lsa image'larni serverda yig'adi, migratsiya va seed, keyin qayta ishga tushirish. GitHub'ga serverga kirish kerak emas (server NAT ortida); ochiq repoda self-hosted runner xavfli; registry va tokenlar ham kerak emas. `main` ga faqat CI yashil PR'lar tushadi.
6. **`APP_ENV`:** staging `NODE_ENV=production` bilan ishlaydi (secure cookie, optimallashgan build), lekin `APP_ENV=staging` dev drayverlarga (konsol SMS) ruxsat beradi. Kodlar `docker compose logs api` da ko'rinadi. `APP_ENV=production` da taqiqlangan.
7. **Zaxira:** har kuni `pg_dump`, oxirgi 14 tasi `/srv/backups/gatefit` da. `.env` (`DATA_ENCRYPTION_KEY`) nusxasi alohida saqlanadi.

## Qo'shimcha (2026-11-21): staging yopiq, Tailscale orqali

- **Sabab:** ofis liniyasi (Uzonline, PPPoE) provayderning CGNAT'i ortida: routerning WAN manzili `100.100.95.183`, tashqi IP o'zgarib turadi. Port yo'naltirish ishlay olmaydi.
- **Qaror (Anvar tasdiqlagan):** staging internetga ochilmaydi. Server Tailscale'da (`100.103.7.74`); DNS yozuvlari shu manzilga qaraydi, ya'ni manzillar faqat Tailscale'ga ulangan qurilmalarda ochiladi.
- **Sertifikatlar:** Let's Encrypt yopiq serverga kira olmaydi, ahost DNS'ida API yo'q. Caddy o'z ichki CA'si bilan beradi (`CADDY_TLS_ISSUER=internal`), har qurilma uning ildiz sertifikatini bir marta o'rnatadi. Production'da `acme` (standart) qoladi.
- **DNS:** ahost paneli wildcard (`*`) yozuvini qabul qilmaydi: har tashkilotning ikkita manzili qo'lda qo'shiladi. Production uchun wildcard'ni qo'llaydigan DNS (masalan, Cloudflare) kerak.
- **Production:** statik IP yoki O'zbekistondagi VPS, alohida qaror.

## Qo'shimcha (2026-11-28): Cloudflare Tunnel orqali ochiq

- **Sabab:** birinchi 1–2 mijozni yangi server olmasdan sinash kerak (Anvar), web01 esa CGNAT ortida.
- **Qaror:** web01 `gatefit.uz` ni Cloudflare Tunnel orqali internetga beradi. serverda allaqachon ishlayotgan `cloudflared` xizmati (`WEB01` tunneli) Cloudflare'ga o'zi ulanadi, routerda port ochilmaydi. Sertifikatni Cloudflare beradi, Caddy `Caddyfile.cloudflare` bilan HTTP'da ishlaydi, umumiy marshrutlar `routes.caddy` da.
- **A'zo ilovasi manzili `<slug>-my.<base>`:** Cloudflare'ning bepul sertifikati faqat bir darajani (`*.gatefit.uz`) qoplaydi. Slug `-my` bilan tugay olmaydi va 60 belgidan oshmaydi.
- **Mijoz IP'si:** Caddy `CF-Connecting-IP` ni faqat xususiy manzillardan ishonadi va API'ga `X-Forwarded-For` ni o'zi qo'yadi; tunnel rejimida Caddy faqat `127.0.0.1` da tinglaydi.
- **Cheklov:** ofisda tok yoki internet o'chsa, sayt ham o'chadi. Doimiy server alohida qaror.

## Oqibatlar

- API image'i to'liq workspace bilan (dev bog'liqliklar ham): migratsiya va seed shu image'da. Ixcham production image'i va image registry M8 da.
- Image serverda yig'iladi: deploy bir necha daqiqa oladi va server CPU'sini band qiladi.
- Production uchun alohida qaror kerak: alohida server, real SMS drayveri, monitoring, zaxirani serverdan tashqariga ko'chirish.
