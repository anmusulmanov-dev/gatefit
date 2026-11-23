# Gatefit: ishlar jurnali

Har sessiya oxirida yangilanadi: nima qilindi, nima qoldi, ma'lum muammolar.

## Holat

| Bosqich                           | Holat                            |
| --------------------------------- | -------------------------------- |
| 0.1 Loyiha karkasi                | Tayyor (2026-11-11)              |
| 0.2 Ko'p mijozlilik va RLS        | Tayyor (2026-11-11)              |
| 0.3 Autentifikatsiya va ruxsatlar | Tayyor (2026-11-17)              |
| MVP (M1–M8)                       | Jarayonda (M1–M7 tayyor)         |
| M1a Tashkilot ichki API           | Tayyor (2026-11-17)              |
| M1b Platforma API                 | Tayyor (2026-11-17)              |
| M1c Sozlamalar UI                 | Tayyor (2026-11-17)              |
| M1d Super-admin UI                | Tayyor (2026-11-17) — M1 yopildi |
| M2a A'zolar API                   | Tayyor (2026-11-21)              |
| M2b Foto, import, eksport         | Tayyor (2026-11-21)              |
| M2c A'zolar UI                    | Tayyor (2026-11-21) — M2 yopildi |
| M3a Tariflar va abonementlar API  | Tayyor (2026-11-22)              |
| M3b Tariflar va abonementlar UI   | Tayyor (2026-11-22) — M3 yopildi |
| M4a To'lovlar va kassa API        | Tayyor (2026-11-22)              |
| M4b To'lovlar va kassa UI         | Tayyor (2026-11-22) — M4 yopildi |
| M5a Kirish nazorati API           | Tayyor (2026-11-22)              |
| M5b Qabulxona ekrani va jurnal    | Tayyor (2026-11-22)              |
| M5c Oflayn qabulxona              | Tayyor (2026-11-22) — M5 yopildi |
| M6a A'zo ilovasi API              | Tayyor (2026-11-22)              |
| M6b A'zo PWA                      | Tayyor (2026-11-22)              |
| M7a Xabarnomalar va hisobot API   | Tayyor (2026-11-22)              |
| M7b Bosh sahifa va shablonlar UI  | Tayyor (2026-11-22) — M7 yopildi |
| M8a Mezonlar, tarjima, xavfsizlik | Tayyor (2026-11-22)              |
| M8b Prod infra, zaxira, tiklash   | Tayyor (2026-11-22)              |

## 2026-11-22 — M8b: production infratuzilma, zaxira va tiklash

Branch: `feat/m8-prod-infra` (`feat/m8-acceptance` ustiga). Yangi paket yo'q; Postgres image'iga WAL-G v3.0.9 binari (sha256 bilan tekshiriladi).

### Qilindi

- **`infra/docker-compose.prod.yml`**: staging asosida; fayllar tashqi S3 da (MinIO yo'q), Postgres o'z image'i (`infra/postgres/Dockerfile`: postgres:16-bookworm + WAL-G) bilan `archive_mode=on`, `archive_timeout=60`; seed faqat platforma (`SEED_DEMO=false`); ACME sertifikatlar; faqat Caddy portlari ochiq.
- **Seed**: `SEED_DEMO=false` — faqat SaaS tariflari va birinchi operator (demo tashkilotsiz).
- **Zaxira** `infra/prod/backup.sh` (kunlik cron): WAL-G base backup (14 ta saqlanadi = 2 hafta istalgan vaqtga tiklash) va `pg_dump` tashqi S3 ga (`dumps/`, 30 kun), serverda nusxa qolmaydi. Uzluksiz WAL arxivi: ko'pi bilan ~1 daqiqa ma'lumot xavfda.
- **Tiklash** `infra/prod/restore.sh pitr [vaqt]` (WAL-G: base backup + WAL qaytadan) va `restore.sh dump <obyekt>` (pg_restore).
- **Tiklash mashqi** `infra/restore-drill.sh dev|staging|prod`: jonli bazadan dump → alohida bazaga tiklash → har jadval qatorlari soni solishtiriladi → alohida baza o'chiriladi. Prod'da haftalik cron.
- **`docs/RUNBOOK.md`**: birinchi ishga tushirish, yangilash, zaxira, tiklash (vaqtga, dump'dan, yangi serverga), nosozliklar jadvali. `.env.example`: `SEED_DEMO`, `BACKUP_S3_*`.

### Tekshirildi

- `infra/restore-drill.sh dev` — o'tdi: 60 jadval, 312 qator bir xil tiklandi, 37 s. Birinchi urinishda xato topildi va tuzatildi (sikl ichidagi `docker exec` qolgan qatorlarni o'qib yuborardi — "1 jadval" degan noto'g'ri natija).
- `docker compose -f infra/docker-compose.prod.yml config` — to'g'ri; barcha skriptlar `bash -n` dan o'tdi.
- `pnpm format:check`, `pnpm i18n:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. **COUNTS**

### Sinalmagan (server kerak)

- WAL-G bilan haqiqiy S3 ga arxiv va vaqtga tiklash (PITR): staging yoki prod serverda bir marta qo'lda (`docs/RUNBOOK.md` → Restoring), bucket va kalitlar kerak.
- Prod image'larining to'liq build'i va ACME sertifikat olish: haqiqiy domen va ochiq IP kerak.

## 2026-11-22 — M8a: qabul mezonlari, tarjima tekshiruvi, xavfsizlik ko'rigi

Branch: `feat/m8-acceptance` (`feat/m7-dashboard-ui` ustiga). Anvar tasdiqlagan M8 javoblari: WAL-G + kunlik pg_dump, tashqi S3 env orqali; yuklama testi k6 (Docker); staging'da bir martalik yuklama va tiklash mashqi; demo seed alohida buyruq; e2e `feat/e2e-playwright` birlashgach. Yangi paket yo'q.

### Qilindi

- **`docs/ACCEPTANCE.md`**: 14 mezon → test fayli va bloki yoki "yo'q". Bor: 2, 4–10, 13. Qisman: 1, 3, 11 (e2e kerak). Yo'q: 12 (tiklash, M8b), 14 (yuklama, M8c).
- **Tarjima tekshiruvi** `pnpm i18n:check` (`packages/i18n/scripts/check-translations.mjs`) va CI qadami: kalitlar bir xil, bo'sh matn yo'q, o'zgaruvchilar inglizchadagi bilan bir xil, inglizcha qolgan matn yo'q (ataylab bir xillar ro'yxati bilan). 770 matn. Buzilgan holat bilan sinab ko'rildi: ikkala xato topildi.
- **Xavfsizlik tuzatishlari**: so'rov logida query qatori va qiymatlari yo'q (`requestForLog`; a'zo qidiruvida telefon logga tushardi — CLAUDE.md qoida 9); Caddy: HSTS, nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy (kamera faqat o'z sayti), `Server` sarlavhasi olib tashlandi; Swagger production'da o'chiq (`SWAGGER_ENABLED` bilan yoqiladi).

### OWASP Top 10 ko'rigi

- **A01 Ruxsatlar**: har endpointda bitta belgi (`endpoint-protection.int-spec.ts`), har jadvalda RLS (`rls-coverage.int-spec.ts`), filial cheklovi va "A B ni ko'rmaydi" testlari. Topilma yo'q.
- **A02 Kriptografiya**: parol Argon2id (19 MiB, 2 iteratsiya), TOTP shifrlangan (AES-256-GCM, HKDF), cookie `httpOnly` + `sameSite=lax` + prod'da `secure`, QR Ed25519. Topilma yo'q.
- **A03 Injection**: faqat Prisma va teglangan `$queryRaw` (`Unsafe` chaqiriqlari yo'q), kirish zod bilan. Topilma yo'q.
- **A04 Dizayn**: pul amallarida idempotentlik, so'rov tezligi cheklovi, OTP urinishlari cheklovi, QR 60 soniya + 5 daqiqalik takror skan qoidasi. QR 60 soniya ichida skrinshot bilan ishlashi mumkin — qabul qilingan xavf (ADR 0010).
- **A05 Sozlamalar**: xavfsizlik sarlavhalari va Swagger tuzatildi. **Qoldi**: web va member uchun Content-Security-Policy (Next inline skriptlari bilan ehtiyotkor sozlash kerak).
- **A06 Komponentlar**: CI'da `pnpm audit` (prod high, hammasi critical). Topilma yo'q.
- **A07 Autentifikatsiya**: kirishda tezlik cheklovi, owner/accountant uchun TOTP, sessiya har so'rovda bazadan tekshiriladi, chiqish va hamma qurilmadan chiqish. Topilma yo'q.
- **A08 Yaxlitlik**: `--frozen-lockfile`, service worker API javoblarini keshlamaydi. Topilma yo'q.
- **A09 Log**: telefon query orqali logga tushardi — tuzatildi; `last_error` da telefon va matn yo'q. Topilma yopildi.
- **A10 SSRF**: foydalanuvchi bergan URL'ga so'rov yo'q (S3, Eskiz manzillari faqat env'dan). Topilma yo'q.

### Tekshirildi

- `pnpm format:check`, `pnpm i18n:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. **COUNTS**
- `request-log.spec.ts`: query va telefon logda yo'q.
- Caddyfile o'zgarishi lokal Docker bilan tekshirilmadi (image yuklanmadi): staging deploy'da `caddy validate` bilan tekshiriladi.

## 2026-11-22 — M7b: bosh sahifa va xabar shablonlari (web)

Branch: `feat/m7-dashboard-ui` (`feat/m7-notifications-api` ustiga). Yangi paket yo'q.

### Qilindi

- **Bosh sahifa** (`reports.daily` bo'lsa): kun xulosasi — filial va kun tanlash, sof tushum (qaytarilgani bilan), yangi a'zolar, tashriflar (a'zolar, rad), bir haftada tugaydiganlar; usullar bo'yicha tushum; tugaydigan abonementlar ro'yxati (a'zo kartasiga havola, telefon).
- **Sozlamalar → Xabarlar** (`notifications.manage`): til bo'yicha chek va muddat eslatmasi matnlari, o'zgaruvchilar, belgilar soni, namuna ko'rinishi, saqlash va standartga qaytarish; noma'lum o'zgaruvchi xatosi.
- Tarjimalar uz/ru/en (`dashboard.*`, `messages.*`, `permissionAreas.notifications`).

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. **COUNTS**
- Brauzerda (`demo.localhost`, owner): Chilonzor bugungi xulosa M4–M5 sinov ma'lumotiga mos (sof 900 000, qaytarilgan 50 000; karta 250 000, naqd 550 000, o'tkazma 150 000; tashriflar 3, 2 a'zo, 1 rad; 2 ta tugaydigan); shablon — noma'lum `{xato}` bilan xato xabari, tuzatib saqlash ("Klub matni"), standartga qaytarish; 375 px da gorizontal aylantirish yo'q.

### Qoldi

- A'zo kartasida yuborilgan xabarlar ro'yxati (API bor: `GET /notifications?memberId=`) — kerak bo'lsa keyin.

## 2026-11-22 — M7a: xabarnomalar va kunlik hisobot (API)

Branch: `feat/m7-notifications-api` (`feat/m6-member-pwa` ustiga). Qaror: `docs/ADR/0011-notifications.md`. Anvar tasdiqlagan javoblar: Eskiz drayveri soxta HTTP bilan, haqiqiy hisob keyin; eslatma tugashiga 3 kun qolganda soat 10:00 da (filial vaqti); tahrirlanadigan shablonlar — muddat eslatmasi va chek (OTP emas); qayta urinish 1, 5, 30 daqiqa; kunlik hisobot faqat web'da. Yangi paket yo'q.

### Qilindi

- **Jadvallar** (RLS): `notification_templates` (body null = standart), `notifications` (matn, holat, urinishlar, `dedupe_key`). `notifications.manage` yangi ruxsat — mavjud owner/manager rollariga migratsiya bilan qo'shildi.
- **`NotificationsService`**: shablon + tashkilot tili, jurnal, commit'dan keyin BullMQ navbati, 3 qayta urinish, keyin `failed`. Chek SMS'i endi shu orqali (klub matni bilan).
- **Eskiz** SMS drayveri (`SMS_DRIVER=eskiz`, `ESKIZ_EMAIL/PASSWORD/FROM`), `.env.example` yangilandi.
- **`ExpiryReminderJob`** (soatlik): oxirgi kunga 3 kun qolganda, 10:00 dan keyin, bir marta.
- **API**: `GET /notification-templates`, `PUT /notification-templates/{key}/{locale}` (audit), `GET /notifications?memberId=`, `GET /reports/daily?locationId=&date=` (tushum usullar bo'yicha, qaytarish, sof; yangi a'zolar; kirishlar, a'zolar, rad; 7 kunda tugaydiganlar).

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. **COUNTS**
- `test/notifications.int-spec.ts` (6): chek navbat orqali yuboriladi va `sent` bo'ladi, a'zo kartasida ro'yxat; klub shabloni ishlatiladi, noma'lum o'zgaruvchi 422, ruxsatsiz 403, standartga qaytish, audit; qayta urinish (yiqilgan → `queued`, keyin `sent`, qayta yuborilmaydi; oxirgi urinish → `failed`); eslatma 09:30 da yo'q, 10:30 da bir marta (takror ishga tushganda ham); kunlik hisobot (usullar, qaytarish, sof, yangi a'zolar, kirishlar, tugaydiganlar, boshqa sana); filial va tashkilot ajratilgan.
- Birlik: Eskiz drayveri (kirish, token, 401 da qayta kirish, xatoda telefon va matn yo'q).

### Ma'lum muammolar

- Haqiqiy Eskiz bilan yuborish sinalmagan: hisob va tasdiqlangan shablonlar kerak.
- Chek SMS'i endi navbat orqali: tugma bosilganda "yuborildi" degani "navbatga qo'yildi" degani.

## 2026-11-22 — M6b: a'zo PWA

Branch: `feat/m6-member-pwa` (`feat/m6-member-api` ustiga). Yangi paket: `qrcode` (+ `@types/qrcode`) — QR rasmini SVG sifatida chizish uchun (Anvar tasdiqlagan).

### Qilindi

- **Bosh sahifa**: QR kod (har 30 soniyada yangi, ortga sanash), abonement holati (tarif, holat, davr, qolgan kun yoki tashrif), qarz bo'lsa ogohlantirish.
- **Oflayn QR**: `/me/qr` dagi hozirgi va keyingi 4 kod `localStorage` da saqlanadi; tarmoq bo'lmasa navbatdagi saqlangan kod ko'rsatiladi (~2,5 daqiqa) va "Internet yo'q" xabari chiqadi.
- **Sahifalar**: abonementlar tarixi, to'lovlar (usul, filial, hisob, qaytarilgan; qarz), profil (ism, telefon, asosiy filial, til, chiqish). Pastki menyu.
- **PWA**: service worker (`public/sw.js`, faqat production'da): sahifalar network-first, `_next/static` cache-first, `/api` keshlanmaydi. Manifest avvaldan bor.
- Tarjimalar uz/ru/en (`member.*`). Sanalar raqamli (brauzerlarda o'zbekcha oy nomlari yo'q).

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. **COUNTS**
- Brauzerda, 360 px (`demo.localhost:3001`, demo a'zo SMS-kod bilan): QR va ortga sanash, "Oylik · Faol · 30 kun qoldi"; abonementlar, to'lovlar (qaytarilgan summa bilan), profil; gorizontal aylantirish yo'q. `/me/qr` so'rovi sun'iy uzilganda saqlangan keyingi kod va "Internet yo'q" xabari ko'rsatildi.
- Tekshiruvda tuzatildi: o'zbekcha sanalar "2026 M11 22" bo'lib chiqardi.

### Ma'lum muammolar

- Service worker faqat production build'da ishlaydi: dev'da sinalmagan; staging'da tekshirish kerak (ilovani o'rnatish, samolyot rejimida ochish).
- Mezon 3 uchun e2e test hali yo'q: `feat/e2e-playwright` birlashgach qo'shiladi.

## 2026-11-22 — M6a: a'zo ilovasi uchun API

Branch: `feat/m6-member-api` (`feat/m5-access-offline` ustiga). Anvar tasdiqlagan javoblar: QR uchun `qrcode` paketi (M6b); `/me/qr` hozirgi + keyingi 4 kod; e2e (mezon 3) `feat/e2e-playwright` birlashgach uning ustiga; profil faqat ko'rish + til; to'lovlar tarixi ro'yxat + qarz.

### Qilindi

- `GET /me/member` (profil), `GET /me/memberships` (o'z abonementlari), `GET /me/payments` (o'z to'lovlari va valyuta bo'yicha qarz). Faqat a'zo sessiyasi (`memberUser`, xodimga 403), a'zo sessiyadan aniqlanadi, id so'rovda berilmaydi. Har modul o'z jadvalini o'zi beradi (CLAUDE.md qoida 7).
- `GET /me/qr` endi `upcoming` (keyingi 4 kod, har biri o'z 30 soniyalik navbatidan amal qiladi): signal yo'qolsa telefon taxminan 2,5 daqiqa ishlaydigan kod ko'rsatadi.

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. **COUNTS**
- `test/member-app.int-spec.ts` (4): o'z profili, abonementlari, to'lovlari va qarzi (boshqa a'zoniki ko'rinmaydi); xodim sessiyasiga 403; bir telefon ikki tashkilotda — B sessiyasi faqat B ma'lumotini ko'radi; kelgusi kod o'z navbatigacha rad, navbatida o'tadi.

### Qoldi

- M6b: yuqoridagi yozuv.
- Mezon 3 e2e — Playwright birlashgach.

## 2026-11-22 — M5c: oflayn qabulxona (web)

Branch: `feat/m5-access-offline` (`feat/m5-access-ui` ustiga). Yangi paket yo'q.

### Qilindi

- **`packages/shared/src/access-offline.ts`**: `checkTokenOffline` (WebCrypto Ed25519, ochiq kalit bilan), `decideOffline` (API bilan bir xil qoidalar; navbatdagi kirishlar bugungi tashrif, tashrif ayirish va 5 daqiqalik takror skan uchun hisobga olinadi), `uuidv7`. `isUnreachable` (`api-client.ts`): tarmoq yo'q yoki proksi API o'rniga javob berdi.
- **IndexedDB** (`reception/offline-store.ts`): filial bo'yicha snapshot va yuborilmagan kirishlar navbati; brauzer qayta ochilsa ham saqlanadi.
- **`useOfflineAccess`**: snapshot har 5 daqiqada yangilanadi, navbat har 30 soniyada va `online` hodisasida yuboriladi (500 tadan), 48 soatdan eskilari tashlanadi. API'ga yetib bo'lmasa ekran o'zi qaror qiladi va kirishni navbatga yozadi.
- Ekranda: "Oflayn: shu yerda tekshirilmoqda · navbatda N ta", internet qaytganda "Yuborilishi kutilmoqda", natijada "Oflayn tekshirildi". Snapshot bo'lmasa — tushunarli xabar.

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. **COUNTS**
- Birlik (`access-offline.spec.ts`, 9): Node'da yaratilgan haqiqiy Ed25519 kalit bilan imzo tekshiruvi, eskirgan va soxta kod, boshqa kalit, navbatga yozish, takror skan, tashrif ayirish, kunlik limit, snapshotda yo'q a'zo, uuidv7 tartibi.
- Brauzerda (mezon 11): snapshot IndexedDB'ga saqlandi (Chilonzor, 23 a'zo); **API serveri to'xtatildi** — QR skan "Kirish mumkin · Oflayn tekshirildi", navbatda 1 ta; soxta kod oflaynda "Kod yaroqsiz", navbatga tushmadi; API qayta yoqilgach navbat o'zi yuborildi, jurnalda "QR, oflayn" yozuvi paydo bo'ldi.

### Ma'lum muammolar

- Oflayn rejimda foto ko'rsatilmaydi (havolalar qisqa muddatli) va "Bugun shu filialda" ro'yxatiga oflayn kirishlar qo'shilmaydi; zaldagilar soni yangilanmaydi.
- Oflayndagi kunlik limit faqat shu ekranning navbatini hisoblaydi: uzilishdan oldingi bugungi kirishlar hisobga olinmaydi (snapshotda yo'q).
- Mezon 11 uchun avtomatik e2e (10 daqiqa uzilish) Playwright qo'shilganda yoziladi; hozir birlik testlari, API sinxron testlari va qo'lda brauzer tekshiruvi bilan qoplangan.

## 2026-11-22 — M5b: qabulxona ekrani va kirish jurnali (web)

Branch: `feat/m5-access-ui` (`feat/m5-access-api` ustiga). Yangi paket: `jsqr` (kamera kadrlaridan QR o'qish; Windows Chrome'da BarcodeDetector yo'q) — Anvar tasdiqlagan.

### Qilindi

- **`/reception`** (`access.verify`): USB skaner uchun doim fokusdagi maydon (kod + Enter), kamera (`jsqr`, 250 ms), katta yashil yoki qizil natija (foto yoki bosh harflar, ism, tarif, qolgan kun yoki tashrif, rad sababi, takror skan belgisi), zaldagilar soni, bugungi kirishlar (jonli, SSE), "Chiqdi", qo'lda kiritish (telefon yoki ism bo'yicha qidiruv, sabab majburiy). Kamera bir xil kodni 5 soniyada bir marta yuboradi.
- **`/check-ins`** (`access.read`): filial, kunlar (filial vaqt mintaqasida), natija filtri; usul va qo'lda kiritish sababi.
- Menyu: "Qabulxona", "Kirishlar". Tarjimalar uz/ru/en (`access.*`), barcha rad sabablari.

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. **COUNTS**
- Brauzerda (`demo.localhost`, owner; kod demo a'zo SMS-kodi bilan olingan): skaner kabi kiritish — "Kirish mumkin", foto o'rnida bosh harflar, tarif va 30 kun; jonli oqim "Zalda: 1" va ro'yxat; 56 soniyada qayta skan — "Hozirgina kirgan"; 60 soniyadan keyin — qizil "Kod eskirgan"; qo'lda kiritish (qidiruv, sabab) — "Zalda: 2"; "Chiqdi" — "Zalda: 1"; jurnal (4 yozuv, sabab ko'rinadi); 375 px da gorizontal aylantirish yo'q, xato so'rov yo'q.
- Tekshiruvda tuzatildi: rad etilgan skan a'zoning "Chiqdi" tugmasini yashirib qo'yardi.

### Ma'lum muammolar

- **Kamera** brauzer panelida bloklangan: "ruxsat berilmadi" xabari to'g'ri chiqadi, lekin haqiqiy kamera bilan skan sinalmagan. Haqiqiy qurilmada tekshirish kerak.
- Qo'lda kiritish qidiruvi faqat xodim ko'radigan a'zolarni topadi (ADR 0006); boshqa filial a'zosi QR bilan kiradi.

## 2026-11-22 — M5a: kirish nazorati (API)

Branch: `feat/m5-access-api` (`feat/m4-billing-ui` ustiga). Qaror: `docs/ADR/0010-access.md`. Anvar tasdiqlagan javoblar: QR imzosi Ed25519; jonli yangilanish SSE; kamera uchun `jsqr` (M5b da); zaldagilar 3 soatdan keyin avtomatik chiqqan + qo'lda "chiqdi"; qarzdor rad etiladi. Standartlar: cheksiz abonement birinchi, keyin tugashi yaqini; 5 daqiqa ichida takror skan yangi tashrif emas; tashrifli abonementda kirish tashrifni kamaytiradi.

### Qilindi

- **QR**: `GET /me/qr` (faqat a'zo sessiyasi) — 30 soniyalik qadamda imzolangan token, 60 soniyada eskiradi. Kalit har tashkilot uchun `DATA_ENCRYPTION_KEY` dan hosil qilinadi, saqlanmaydi.
- **`POST /access/verify`** (`access.verify`): imzo, muddat, a'zo holati (bloklangan, qarzdor), abonementlar (muddat, boshlanish, muzlatish, filial, hafta kuni, soat oynasi, kunlik limit), takror skan; `check_ins` ga yozadi (eskirgan kod ham — a'zo ma'lum), tashrifni ayiradi. Qoidalar `packages/shared/src/access-rules.ts` da.
- **`POST /access/manual`** (`access.manual`, sabab majburiy, audit `check_in.manual`), **`POST /access/exit`**, **`GET /check-ins`** (jurnal, filial cheklovi), **`GET /locations/{id}/occupancy`**.
- **Jonli oqim**: `GET /access/events?locationId=` (SSE), Redis pub/sub, commit'dan keyin (`TenantDb.afterCommit`).
- **Oflayn**: `GET /access/offline` (ochiq kalit, filial a'zolari va abonementlari), `POST /access/sync` (ekran yaratgan id bilan, takror yuborilsa yozilmaydi, 48 soatdan eski rad, tashrif ayiriladi).
- **`check_ins`**: oy bo'yicha partition, RLS, faqat `INSERT` + `SELECT`; kunlik `CheckInPartitionsJob` 3 oy oldinga yaratadi.

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. **COUNTS**
- `test/access.int-spec.ts` (26): mezon 4 (faol o'tadi 1 soniyadan tez; muddati tugagan, muzlatilgan, soatdan tashqari, boshqa kun, boshqa filial, boshlanmagan, abonementsiz, bloklangan, qarzdor — sababi bilan), mezon 5 (55 soniyada o'tadi, 65 da `expired_code`; soxta va boshqa tashkilot kodi), kunlik limit va takror skan, tashrif ayirish, qo'lda kiritish va audit, filial va ruxsat cheklovi, zaldagilar (kirdi, chiqdi, 3 soat), jurnal, oflayn snapshot (ochiq kalit bilan imzo tekshiruvi), sinxron takrori, SSE, "A tashkilot B ni ko'rmaydi", yozuvni o'zgartirish/o'chirish bazada rad, partitionlar, tezlik (p95 < 500 ms).
- Birlik: kirish qoidalari va token formati (shared), `AccessTokensService`.

### Rejadan chetlanishlar

- Oxirgi 31 kunda tugagan abonementlar ham olinadi: rad sababi "abonement yo'q" emas, "muddati tugagan" bo'lishi uchun.
- Noma'lum yoki soxta kod jurnalga yozilmaydi (a'zo noma'lum).

### Qoldi

- M5b: yuqoridagi yozuv.
- M5c: yuqoridagi yozuv.

## 2026-11-22 — M4b: to'lovlar va kassa (web)

Branch: `feat/m4-billing-ui` (`feat/m4-billing-api` ustiga). **M4a bilan birga birlashtiriladi**, avval M4a.

### Qilindi

- **Sotish dialogi**: tarif, filial, boshlanish sanasi va to'lov (usul, summa — standart to'liq narx). Kam to'lansa qarz summasi va ixtiyoriy muddat. Oxirida "Sotildi": chek chop etish, SMS, yopish. Bitta dialog — bitta `Idempotency-Key`.
- **A'zo kartasi**: "Hisoblar va to'lovlar" (`payments.read`): hisoblar holati, muddati o'tgani, qarz belgisi, qoldiqni to'lash (qisman), to'lovlar ro'yxati, chek, SMS, qaytarish (`payments.refund`). Muzlatish dialogida narxni hozir qabul qilish.
- **Sahifalar**: `/receipts/{id}` (chop etiladigan chek), `/payments` (jurnal: filial, kunlar filial vaqt mintaqasida, usul, sof jami, qaytarish), `/cash-shift` (smenani ochish, yig'indilar, sanalgan summa va jonli farq bilan yopish, oxirgi smenalar). Menyu: "To'lovlar", "Kassa".
- **Muzlatish narxi** hisob va chekda "Muzlatish narxi: <tarif>" deb ko'rinadi (`ReceiptDto.items[].kind`).
- **Xato matnlari**: `errorMessageKey` ro'yxati katalogdagi barcha `errors.*` kalitlari bilan tenglashtirildi (M3 va M4 kodlari "Xatolik yuz berdi" bo'lib chiqayotgan edi), sinxronlik testi qo'shildi.
- `useApiGet(null)` — so'rovni kutadi; kassa va jurnal filial yuklanmasdan so'rov yubormaydi.

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. API: **API** test, shared: **SHARED**, i18n: **I18N**.
- Brauzerda (`demo.localhost`, owner): smena ochish (100 000); smenasiz filialda naqd sotish — "Avval kassa smenasini oching", o'sha dialogda filialni almashtirib sotish (kalit qayta ishlatildi); chek sahifasi va SMS (konsol drayveri); karta bilan qisman sotish — `Qarzdor`, qarz belgisi; qoldiqni naqd + o'tkazma bilan to'lash — `Faol`; naqd qaytarish; smenasiz filialda karta bilan sotish; muzlatish narxini karta bilan olish; jurnal (sof 900 000); smena yig'indilari (kutilgan 600 000) va 595 000 bilan yopish (farq −5 000). 375 px da gorizontal aylantirish yo'q, konsolda kutilmagan xato yo'q.

### Ma'lum muammolar

- **Qaytarish qarz qiladi**: `paid = to'lovlar − qaytarishlar`, abonement qoladi, shuning uchun qaytarilgan summa yana qoldiq bo'ladi va muddatsiz hisob a'zoni darhol `debtor` qiladi. Kechirish kerak bo'lsa hisobni `void` qilish (API bor, web'da tugma yo'q) yoki abonementni bekor qilish. Anvar tasdiqladi (2026-11-22): shunday qoladi.
- Hisobni `void` qilish va qo'lda hisob (`POST /invoices`) uchun web'da tugma yo'q.

## 2026-11-22 — M4a: to'lovlar va kassa (API)

Branch: `feat/m4-billing-api`. Qaror: `docs/ADR/0009-billing.md`. Anvar tasdiqlagan reja va savollarga javoblar (taklif qilinganicha): to'lov muddati sotishda tanlanadi, standart — darhol; kassa smenasi filialda bitta; naqd uchun ochiq smena majburiy, terminal va o'tkazma ochiq smenaga bog'lanadi; qaytarish abonementni bekor qilmaydi, abonement bekor qilinsa qoldiq `void`; chek SMS'i faqat xodim bosganda.

### Qilindi

- **Jadvallar** (RLS): `invoices`, `invoice_items`, `invoice_counters`, `payments`, `refunds`, `cash_shifts`, `idempotency_keys`. `payments`, `refunds`, `invoice_items` ga faqat `INSERT` + `SELECT` grant. CHECK: summalar musbat, `paid_minor <= total_minor`, qator summasi = narx × soni. Filialda bitta ochiq smena (qisman yagona indeks).
- **Idempotentlik** (`@Idempotent()`, `src/common/idempotency`): kalit majburiy (400), takror — avvalgi javob (`Idempotent-Replayed`), boshqa tana — 422, parallel so'rovlar navbatga qo'yiladi, yiqilgan so'rov kaliti qayta ishlatiladi.
- **Sotish to'lov bilan**: `POST /members/{id}/memberships` endi `payment` va `dueOn` qabul qiladi va `{ membership, invoice, payment }` qaytaradi; hammasi bitta tranzaksiyada (naqd smenasiz bo'lsa abonement ham yozilmaydi). Bepul tarifga hisob yaratilmaydi.
- **Hisoblar**: `GET/POST /invoices`, `GET /invoices/{id}`, `POST /invoices/{id}/payments` (qisman, qoldiqdan ko'p emas), `POST /invoices/{id}/void` (`payments.refund`). Raqam tashkilot va yil bo'yicha (`2026-000001`).
- **To'lovlar**: `GET /payments` (jurnal: a'zo, filial, usul, smena, vaqt oralig'i), `GET /payments/{id}`, `POST /payments/{id}/refund` (`payments.refund`, sabab, qoldiqdan ko'p emas, naqd — ochiq smenadan), `GET /payments/{id}/receipt`, `POST /payments/{id}/receipt/sms`.
- **Kassa**: `POST /cash-shifts/open`, `GET /cash-shifts/current?locationId=`, `GET /cash-shifts`, `GET /cash-shifts/{id}`, `POST /cash-shifts/{id}/close` (kutilgan, sanalgan, farq).
- **Muzlatish narxi** muzlatishda hisobga yoziladi, `payment` bilan shu yerda to'lanadi; abonement bekor qilinsa uning to'lanmagan hisoblari `void`.
- **`debtor`**: muddati o'tgan qoldiq (blocked dan past, abonementlardan ustun). Soatlik `DebtStatusJob`, har hisob bir marta (`overdue_marked_at`).
- **`FiscalProvider`** porti va bo'sh drayver. Chek SMS matni uz/ru/en.
- **API klienti** har POST ga `Idempotency-Key` qo'shadi (`options.idempotencyKey` bilan bitta amal uchun bir kalit).
- **Audit**: `invoice.create`, `invoice.void`, `payment.create`, `refund.create`, `cash_shift.open`, `cash_shift.close`.
- **Seed**: demo abonementlarga hisob va karta to'lovi; bitta a'zo yarmini to'lagan (`debtor`). Idempotent.

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. API: 463 test, shared: 53, i18n: 11.
- `test/billing.int-spec.ts`: mezon 2 (a'zo qo'shish + sotish + naqd to'lov), mezon 8 (smena hisoboti = jurnaldagi naqd − qaytarish, farq), mezon 9 (qaytarish faqat ruxsat bilan, auditda), qisman to'lov va qarz, muddat o'tishi (Toshkent yarim tuni), soatlik vazifa, bekor qilishda `void`, idempotentlik (takror, boshqa tana, kalitsiz, parallel, yiqilgandan keyin), filial cheklovi, chek va SMS, "A tashkilot B ni ko'rmaydi" (HTTP va RLS), to'lovni tahrirlash va o'chirish bazada rad etiladi.
- Birlik: hisob holati, qoldiq (katta summalar), kutilgan naqd, so'rov xeshi, a'zo holati qarz bilan.
- Seed test bazasida ikki marta ishga tushirildi: 20 hisob, 1 qarzdor.

### Rejadan chetlanishlar

- **`payments` va `refunds` da `updated_at`/`deleted_at` yo'q**: ular hech qachon o'zgarmaydi (TZ 6 dagi umumiy qoidadan istisno, `audit_logs` kabi).
- **Jurnal vaqt filtri** `from`/`to` lahza (ISO), sana emas: klient filial vaqt mintaqasida kun chegarasini hisoblaydi.
- **Hisobni bekor qilish** uchun alohida ruxsat qo'shilmadi: `payments.refund`.
- **Idempotentlik kalitlari muddatsiz** saqlanadi (TZ da muddat yo'q).

### Qoldi

- M4b: web (yuqoridagi yozuv).
- **M4a yolg'iz birlashsa**: web sotishda to'lov so'ramaydi, ya'ni har sotuv qarz bo'lib qoladi. M4b bilan birga birlashtirish kerak.
- Xodim ismi jurnalda yo'q (faqat `received_by` id) — kerak bo'lsa staff servisi orqali.

## 2026-11-22 — M3b: tariflar va abonementlar UI

Branch: `feat/m3-memberships-ui` (`feat/m3-memberships-api` ustidan).

### Qilindi

- **Menyu:** "Tariflar" (`plans.read`).
- **`/plans`:** sotuvdagi / sotuvdan olingan / hammasi filtri. Har qatorda tur, narx, muddat, tashriflar, cheklovlar, muzlatish shartlari. `plans.manage` bo'lsa qo'shish va tahrirlash dialogi: tur, muddat, tashriflar soni, narx (tashkilot valyutasida, `decimalToMinor`), kirish soatlari (4 tagacha oraliq), hafta kunlari, kunlik limit, filiallar, muzlatish (jami kun, marta, eng kam kun, narx), sotuvdan olish.
- **A'zo kartasi → "Abonementlar":** ro'yxat (holat, sanalar, qolgan kun va tashrif, narx, filial, muzlatishlar, bekor qilish sababi). Dialoglar:
  - sotish: filial, shu filialda amal qiladigan tarif, boshlanish sanasi, oxirgi kun oldindan ko'rinadi;
  - muzlatish: sana, kunlar, sabab, kimning tashabbusi, yangi tugash sanasi, qolgan limit, narx;
  - muzlatishni tugatish: qaytadigan kunlar;
  - bekor qilish: sabab.
    Tugmalar ruxsatga qarab, arxivdagi a'zoda yo'q. O'zgarishdan keyin a'zo holati ham yangilanadi.
- **A'zolar ro'yxati:** har qatorda amaldagi abonement: tarif, qolgan kun yoki "keyinroq boshlanadi", qolgan tashriflar.
- Tarjimalar `plans.*`, `memberships.*`, `nav.plans` — uz, ru, en.

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter web build` — yashil.
- **Brauzerda** (`demo.localhost:3000`, menejer, Anvar kirdi): tariflar ro'yxati; a'zolar ro'yxatida qolgan kunlar; abonementsiz a'zoga "Oylik" sotish (a'zo `Faol`), bugundan 7 kun muzlatish (tugash 7 kunga surildi, a'zo `Muzlatilgan`), muzlatishni tugatish (sana qaytdi, `Faol`), sabab bilan bekor qilish (`Abonementsiz`). 375 px da gorizontal skroll yo'q. Bepul muzlatish "bepul" deb ko'rsatiladigan qilindi.
- **Tarif formasi staging'da tekshirildi** (`demo.staging.gatefit.uz`, owner, M3 birlashgandan keyin): "Sinov tarifi (Claude)" qo'shildi (tashriflar bo'yicha, 8 tashrif, 07:00–12:00, Sh/Ya, kuniga 1, Chilonzor, muzlatish 14 kun / 2 marta / 10 000), ro'yxatda hammasi to'g'ri ko'rindi; narx 260 000 ga o'zgartirildi va sotuvdan olindi ("Sotuvdan olinganlar" filtrida ko'rinadi). 375 px da dialog sig'adi, gorizontal skroll yo'q. Sinov tarifi staging'da sotuvdan olingan holda qoldi.

### Qoldi

- Playwright — `feat/e2e-playwright` birlashgach.
- Kirish soatlarida `24:00` ni UI orqali kiritib bo'lmaydi (`type="time"`); `23:59` yetadi.

## 2026-11-22 — M3a: tariflar, abonementlar, muzlatish (API)

Branch: `feat/m3-memberships-api`. Qaror: `docs/ADR/0008-memberships.md`. Anvar tasdiqlagan reja: M3a (API), M3b (web UI). Savollarga javoblar (taklif qilinganicha qabul qilindi): sotish M3 da to'lovsiz, abonement darhol amalda; muzlatish limiti va narxi tarifda, narx faqat yoziladi (M4 da undiriladi); "a'zo so'rovi bilan" muzlatishni xodim `source=member_request` bilan kiritadi (a'zoning o'zi — M6); sinov tarifi bir a'zoga bir marta; boshlanish sanasi sotishda tanlanadi.

### Qilindi

- **Jadvallar** (RLS, `DELETE` grant yo'q, kompozit FK, CHECK: summa manfiy emas, sanalar oldinga):
  - `plans`: tur (`duration`, `visits`, `single`, `trial`), muddat (`day`, `month`, `year`), tashriflar soni, `price_minor` + `currency` (tashkilot valyutasi), `restrictions` JSONB (vaqt oralig'i, hafta kunlari, kunlik limit, filiallar; zod sxema), muzlatish limitlari va narxi, `is_active`.
  - `memberships`: tarif shartlari nusxasi, sotilgan filial, `starts_on`/`ends_on` (filial kalendari) va `starts_at`/`ends_at`, `visits_left`, holat (`scheduled`, `active`, `frozen`, `expired`, `cancelled`), `status_changes_at`, `auto_renew` (v1), bekor qilish ma'lumoti.
  - `membership_freezes`: sanalar va lahzalar, kunlar, sabab, manba, narx, erta tugash va bekor qilish.
- **Sana funksiyalari** (`packages/shared/src/dates.ts`, yangi paket yo'q): kun/oy qo'shish (oy oxiriga qisish), filial vaqt mintaqasida sana va yarim tun (DST va yarim tun o'tkazib yuborilgan zonalar bilan), muddat oxiri.
- **Endpointlar** (`@RequireModule('memberships')`): `GET/POST /plans`, `GET/PATCH /plans/{id}` (`plans.read`, `plans.manage`); `GET /members/{id}/memberships` (`members.read`), `POST /members/{id}/memberships` (`memberships.sell`); `GET /memberships/{id}`; `POST /memberships/{id}/freeze`, `/unfreeze` (`memberships.freeze`); `POST /memberships/{id}/cancel` (`memberships.cancel`, sabab majburiy). Abonementni a'zosini ko'ra oladigan xodim ko'radi (ADR 0006); sotish faqat xodim ishlaydigan va tarif ruxsat bergan filialda.
- **Muzlatish:** tugash sanasini suradi; erta tugatish faqat ishlatilgan kunlarni qoldiradi; boshlanmagani bekor qilinadi; ustma-ust tushmaydi; limitlar shartnoma nusxasidan.
- **Soatlik vazifa** (`MembershipStatusJob`, BullMQ, `0 * * * *` UTC): `status_changes_at` kelgan abonementlar holatini yangilaydi, a'zo holatini qayta hisoblaydi, `membership.status` auditi (tizim). Idempotent va parallel xavfsiz.
- **A'zo holati** abonementlardan (`memberStatusFrom`); `unblock` endi abonementlardan hisoblaydi. `GET /members` har qatorda amaldagi abonement xulosasi (`membership`: tugash sanasi, qolgan kun va tashrif) — M2 dan qolgan ish.
- **Audit:** `plan.create`, `plan.update`, `membership.sell`, `membership.freeze`, `membership.unfreeze`, `membership.cancel`, `membership.status`. `AuditService.record` tizim vazifasi uchun `actor = null` qabul qiladi.
- **Seed:** demo klubga 6 tarif (oylik, ertalabki, 12 tashrif, yillik, bir martalik, sinov) va 20 a'zoga abonement (amaldagi, tugagan, muzlatilgan). Idempotent.
- Xato kodlari va tarjimalari (uz, ru, en); TZ 6 va 7-bo'limlar yangilandi.

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. API: 427 test, shared: 53, i18n: 11.
- Birlik: oy oxiri, kabisa yili, Toshkent/Nyu-York/Berlin (DST)/Santyago (yarim tun yo'q kun), muddat oxiri, holat, keyingi o'zgarish lahzasi, muzlatish limitlari, ustma-ust tushish, erta tugatish.
- `test/memberships.int-spec.ts`: qabul mezoni 6 (Toshkent yarim tunida 18:59:59.999Z da faol, 19:00Z da tugagan, a'zo ham; Nyu-York filiali o'z yarim tunida; qayta ishga tushish auditni takrorlamaydi; soatlik vazifa barcha tashkilotlarni topadi), mezon 7 (10 kun muzlatish tugashni 10 kunga suradi, muzlatilgan kunlarda a'zo `frozen`, erta tugatish 7 kunni qaytaradi), ruxsatlar, filial cheklovi, modul, audit, "A tashkilot B ni ko'rmaydi" (HTTP va RLS, yozish ham).
- Brauzerda tekshirilmagan (UI M3b da).

### Rejadan chetlanishlar

- **Sotish sanasi oralig'i:** 31 kun orqaga (qog'ozdagi abonementlarni kiritish uchun) va 90 kun oldinga. TZ da yo'q, mening tanlovim.
- **Har tarif turida muddat bor:** `visits` (masalan 12 tashrif 2 oy ichida), `single` (1 kun, 1 tashrif), `trial` ham muddatli.
- **`/unfreeze`** joriy muzlatishni tugatadi, bo'lmasa navbatdagi rejalashtirilganini bekor qiladi (alohida endpoint qo'shilmadi).
- **`OrganizationService` eksport qilindi** (`currency`, `findLocation`, `existingLocationIds`): plans moduli tashkilot jadvallariga to'g'ridan-to'g'ri murojaat qilmaydi.

### Qoldi

- M3b: web — tariflar ro'yxati va formasi, a'zo kartasida abonementlar, sotish, muzlatish va bekor qilish dialoglari, ro'yxatda qolgan kunlar. Playwright — `feat/e2e-playwright` birlashgach.
- M4: sotish va to'lov bitta tranzaksiyada, muzlatish narxini undirish, `debtor`.
- M5: kirishda cheklovlar (vaqt, kun, kunlik limit, filial) va tashrif ayirish; tashriflar tugasa `expired`.

## 2026-11-21 — M2c: a'zolar UI

Branch: `feat/m2-members-ui` (`feat/m2-members-files` ustidan).

### Qilindi

- **Menyu:** "A'zolar" (`members.read` bo'lsa).
- **`/members`:** qidiruv (yozish to'xtagach), holat va filial filtri, foto yoki bosh harflar, holat belgisi, "Yana ko'rsatish"; tugmalar ruxsatga qarab: qo'shish, import, eksport (XLSX, CSV — joriy filtrlar bilan).
- **`/members/new` va tahrirlash:** barcha F-1.1 maydonlari; filial standart qiymati — sarlavhada tanlangan filial; yozish davomida takror tekshiruvi: band telefon egasi (ochish yoki arxivdagini tiklash) va bir xil ismli a'zolar ro'yxati.
- **`/members/{id}`:** karta, foto yuklash/almashtirish/o'chirish, bloklash (sabab bilan) va blokdan chiqarish, arxivlash (tasdiq bilan) va tiklash.
- **`/members/import`:** 4 qadamli usta — fayl (namuna yuklab olish), ustunlarni moslash (avtomatik taklif, misollar, filial), tekshiruv natijasi (qator, maydon, sabab), fon importi va natija.
- **API klienti** (`packages/shared`): `put`, `delete`, `upload` (multipart), `download` (fayl va nomi).
- **Tarjimalar:** `members.*`, `nav.members`, yangi xato kodlari — uz, ru, en.
- **Seed tuzatildi:** demo a'zolar telefonida bitta raqam kam edi (`+99890001028`); endi `+998900001000`–`+998900001029`. Mavjud dev bazada `UPDATE` bilan tuzatildi.

### Tekshirildi

- `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil (API 375, shared 33, i18n 11). `pnpm format:check` loyiha fayllarida toza (lokal `.claude/worktrees/` dagi boshqa sessiya fayllari hisobga olinmaydi).
- **Brauzerda** (`demo.localhost:3000`, menejer roli, dev MinIO va Redis bilan): ro'yxat va qidiruv (`karim 1028`), band telefon ogohlantirishi va bir xil ismlilar ro'yxati, a'zo qo'shish, foto yuklash (MinIO → imzolangan havola orqali ko'rindi), bloklash, import (ruscha sarlavhali CSV avtomatik moslandi, 3 ta xato qator ko'rsatildi, 2 ta a'zo fon vazifasida qo'shildi), CSV eksport. 375 px kenglikda gorizontal skroll yo'q. Konsolda xato yo'q.

### Rejadan chetlanishlar

- **Playwright e2e bu PR da yo'q:** e2e infratuzilmasini parallel sessiya (`feat/e2e-playwright`) qilyapti. U birlashgach a'zolar oqimi (kirish → qo'shish → qidiruv) uchun e2e test qo'shiladi.

### Qoldi

- A'zolar uchun Playwright testi (yuqorida).
- Qo'lda qo'shishda telefon faqat format bo'yicha tekshiriladi (importda esa raqam haqiqiyligi) — M2b dagi eslatma.
- Ro'yxatda faol abonement va qolgan kunlar — M3.

## 2026-11-21 — M2b: foto, import, eksport

Branch: `feat/m2-members-files` (`feat/m2-members-api` ustidan). Qaror: `docs/ADR/0007-files-and-jobs.md`.

### Qilindi

- **Yangi paketlar** (Anvar tasdiqlagan): `bullmq` (fon vazifalari), `exceljs` (XLSX o'qish va yozish), `@aws-sdk/client-s3` (fayl saqlash), `libphonenumber-js` (importda telefonni mamlakat bo'yicha E.164 ga keltirish). `msgpackr-extract` ning native build'i o'chirilgan (JS varianti yetadi).
- **Fayl saqlash porti** `FileStorage`: `s3` va `memory` drayverlari, `STORAGE_DRIVER` (productionda `memory` taqiqlangan). **Imzolangan havolalar** `GET /files/{token}` (`@Public`, HMAC va muddat).
- **Foto:** `PUT /members/{id}/photo` (multipart, 5 MB, JPEG/PNG/WebP baytlardan aniqlanadi), `DELETE /members/{id}/photo`; eski fayl o'chiriladi. `MemberDto.hasPhoto` o'rniga `photoUrl`.
- **Import** (`member_imports` jadvali, RLS; `members.import_id`):
  - `POST /members/imports` CSV (`,` `;` tab, BOM) yoki XLSX qabul qiladi; sarlavhalardan ustunlar uz/ru/en da avtomatik moslanadi; 5 ta namuna qator. 10 000 qatorgacha.
  - `POST /members/imports/{id}/validate` moslash va filial bilan har qatorni tekshiradi: ism, telefon (mamlakat bo'yicha, `998901234567` ham), fayl ichida takror, bazada bor, sana (`YYYY-MM-DD`, `DD.MM.YYYY`), jins, manba, uzunlik. Xatolar qator raqami bilan (birinchi 1000 tasi).
  - `POST /members/imports/{id}/commit` BullMQ vazifasi; qayta bosilsa hech narsa o'zgarmaydi; tekshiruvdan keyin band bo'lgan telefon o'tkazib yuboriladi va sanaladi. `member.import` auditi.
  - `GET /members/imports/template` — uz/ru/en sarlavhali bo'sh XLSX.
- **Eksport:** `GET /members/export?format=xlsx|csv` + ro'yxat filtrlari, tashkilot tilida, importga qaytib tushadi. CSV: BOM, formula injeksiyasidan himoya. Faqat ko'rinadigan a'zolar. `member.export` auditi.
- **Ruxsatlar:** foto — `members.manage`, import — `members.import`, eksport — `members.export`. Filial cheklovi importga ham tegishli.
- **Test infratuzilmasi:** `createTestApp` xotira storage va har ilovaga alohida navbat prefiksi beradi; `apiAs` ga `put`, `delete`, `upload`.

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. API: 375 test, shared: 33, i18n: 11.
- **Qabul mezoni 1 (import qismi):** 500 a'zoli XLSX (telefonlar Excel raqami sifatida) xatosiz yuklanadi, fon vazifasi 500 tasini yozadi, qayta `commit` takror yozmaydi (`test/member-files.int-spec.ts`).
- Foto: imzolangan havola, soxta, o'zgartirilgan va muddati o'tgan havola 404; SVG `.jpg` nomi bilan rad etiladi; 5 MB dan katta rad.
- Ajratish: B tashkilot A ning importini ko'rmaydi va boshlay olmaydi; eksportda boshqa tashkilot a'zolari yo'q; filial xodimi boshqa filialga import qila olmaydi.
- S3 drayveri dev MinIO bilan qo'lda tekshirildi (yozish, o'qish, o'chirish). CI da MinIO yo'q, testlar `memory` drayverida.

### Rejadan chetlanishlar

- **Import yo'li `/members/imports/...`** (TZ da `POST /members/import`): bir nechta qadam (yuklash, tekshirish, boshlash, holat) alohida resursni talab qiladi. TZ 7-bo'lim yangilandi.
- **Imzolangan havola S3 ning o'zi emas, API orqali** (ADR 0007).
- **Telefon qat'iyligi farqli:** importda `libphonenumber-js` raqam haqiqiyligini tekshiradi, qo'lda qo'shishda esa hozircha faqat E.164 formati (`phoneSchema`). Bir xil qilish uchun shared ga paket qo'shish kerak — M2c da forma bilan birga ko'rib chiqiladi.

### Qoldi

- M2c: web UI (ro'yxat, karta, forma, import ustasi, eksport), Playwright.
- Rasm o'lchamini kichraytirish (paket kerak) — hozir 5 MB gacha asl holida.
- Juda katta eksport fon vazifasiga (ADR 0007).

## 2026-11-21 — M2a: a'zolar API

Branch: `feat/m2-members-api`. Qaror: `docs/ADR/0006-member-visibility.md`. Anvar tasdiqlagan reja: M2a (API), M2b (foto, import, eksport), M2c (web UI, Playwright).

### Qilindi

- **Jadval `members`** (RLS, `DELETE` grant yo'q): F-1.1 maydonlari, favqulodda aloqa, `blocked_reason`, `home_location_id` (majburiy), `user_id` (a'zo ilovasi). Telefon tashkilot ichida yagona. Qidiruv uchun `pg_trgm` indekslari (ism, familiya, telefon). `consents.member_id` qo'shildi.
- **Holat `inactive`** (abonement yo'q) qo'shildi; `blocked` qo'lda, qolganlari M3/M4 da avtomatik.
- **Endpointlar** (`@RequireModule('members')`):
  - `GET /members`: yangilari birinchi, kursor, `q` (har so'z ism, familiya yoki telefonda), `status`, `locationId`;
  - `GET /members/duplicates`: telefon egasi va bir xil ism (+ tug'ilgan sana);
  - `GET/PATCH /members/{id}`, `POST /members`: band telefon `409 MEMBER_PHONE_TAKEN` va `details.member`;
  - `POST /members/{id}/block` (sabab bilan), `/unblock`, `/archive`, `/restore`.
- **Yangi ruxsat `members.archive`** (owner, manager); mavjud tashkilotlarga migratsiya bilan qo'shildi.
- **Filial cheklovi:** owner va accountant hammani, qolganlar o'z filiallari a'zolarini ko'radi (ADR 0006).
- **Audit:** `member.create`, `member.update` (faqat o'zgargan maydon nomlari, qiymatlar emas), `member.block/unblock/archive/restore`.
- **A'zo kirishi** endi faqat `members` da bor (arxivlanmagan) telefon uchun: notanish telefonga SMS yuborilmaydi, javob o'zgarmaydi. Birinchi kirishda `members.user_id` bog'lanadi; telefon o'zgarsa bog'lanish uziladi.
- **Seed:** demo tashkilotga 30 a'zo (`+998900001000`–`+998900001029`).
- **TZ yangilandi:** 6-bo'lim (`members` ustunlari, qoidalar), 7-bo'lim (endpointlar).

### Tekshirildi

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — yashil. API: 333 test, shared: 33, i18n: 11.
- `test/members.int-spec.ts`: har endpoint, validatsiya, telefon takrori, filial cheklovi, ruxsatlar, modul yo'q tashkilot (403), audit, "A tashkilot B ni ko'rmaydi" (HTTP va RLS darajasida, bir telefon ikki tashkilotda — ikki alohida a'zo).
- `test/auth-otp.int-spec.ts`: a'zo bo'lmagan telefon, boshqa tashkilot a'zosi, arxivlangan a'zo, `user_id` bog'lanishi.
- `rls-coverage` qo'riqchi testi yangi jadvalni qamradi.
- Brauzerda tekshirilmagan (UI M2c da).

### Rejadan chetlanishlar

- **Ro'yxat filtri `?status=&locationId=&q=`**, TZ dagi `filter[...]` emas — `/staff` bilan bir xil.
- **Bloklash alohida endpoint** (`/block`, `/unblock`), `PATCH` emas: sabab majburiy va auditga yoziladi.
- **Faol a'zolar hisoblagichi M3 ga qoldirildi** (Anvar tasdiqlagan): "faol" abonementga bog'liq.

### Qoldi

- M2b: foto (S3), import (BullMQ, CSV/XLSX, 500 a'zo testi), eksport. M2c: web UI, Playwright.
- `unblock` hozir holatni `inactive` ga qaytaradi; M3 da abonementlardan hisoblanadi.
- A'zo sessiyasi (`AccessContext`) hali a'zo yozuvini yuklamaydi — M6 (PWA) da.

## 2026-11-21 — CI: bog'liqliklar auditi

Branch: `chore/ci-dependency-audit`.

### Qilindi

- **CI `audit` jobi** (TZ 9-bo'lim): `pnpm audit` (pnpm o'zida bor, yangi action yo'q), faqat lockfile'ni o'qiydi. Yiqiladi: production bog'liqliklarda `high` va undan yuqori, dev bilan birga hammasida `critical`. Har dushanba 05:00 UTC jadval bo'yicha ham ishlaydi (asosiy `ci` jobi jadvalda ishlamaydi).
- **`minimumReleaseAgeExclude` olib tashlandi:** next-intl 4.15.0 va qarindoshlari 2026-11-11 da chiqqan, cheklovdan o'tadi; `pnpm install --frozen-lockfile` o'tdi.

### Ma'lum muammolar

- Dev'da 1 high (`effect` ReDoS, GHSA-7589-6fvf-x4pw, `prisma` CLI orqali) va 2 moderate. Production'ga kirmaydi; Prisma yangilanganda ketadi.

## 2026-11-21 — Staging yopiq, Tailscale orqali

Branch: `chore/staging-tailscale`. Qaror: `docs/ADR/0005-staging.md` (qo'shimcha).

### Topildi

- **Ofis liniyasi CGNAT ortida:** routerning WAN manzili `100.100.95.183` (provayderning umumiy NAT'i), tashqi IP o'zgarib turadi (`213.230.87.55` → `84.54.73.159`). Routerda 80/443 yo'naltirildi, lekin tashqaridan baribir javob yo'q. Statik IP'siz staging'ni internetga ochib bo'lmaydi.
- **ahost DNS:** domen boshqa nom serverlariga ulangan edi, yozuvlar ishlamagan; Anvar "DNS menejerini ishlatish" ni tanladi. `.uz` reyestri o'zgarishni hali e'lon qilmagan. Panel wildcard (`*`) yozuvini qabul qilmaydi.

### Qilindi

- **web01 Tailscale'da** (`100.103.7.74`); `ssh web01` endi istalgan joydan ishlaydi.
- **Caddy:** sertifikat manbasi `CADDY_TLS_ISSUER` bilan (`acme` standart, staging'da `internal`).
- **`deploy.sh`:** har deploy'dan keyin Caddy sozlamasi qayta yuklanadi (Caddyfile bind mount, o'zgarishi konteynerni qayta yaratmaydi).
- **Runbook:** qurilmada staging'ni ochish (Tailscale va Caddy ildiz sertifikati), DNS yozuvlari qo'lda.

### Qoldi

- Anvar: ahost'da to'rt yozuvni `100.103.7.74` ga o'zgartirish; routerdagi ikkala port qoidasini o'chirish; qurilmalarga ildiz sertifikatini o'rnatish.
- `.uz` delegatsiyasi yetib kelgach manzillarni tekshirish.
- Production: statik IP yoki O'zbekistondagi VPS va wildcard'ni qo'llaydigan DNS.

## 2026-11-18 — Staging serveri

Branch: `chore/staging-deploy`. Qaror: `docs/ADR/0005-staging.md`. Runbook: `infra/staging/README.md`.

### Qilindi

- **Image'lar** (ildizdagi `Dockerfile`): `api` (migratsiya va seed ham shu image'da), `web` va `member` (Next.js standalone, `NEXT_OUTPUT=standalone` bo'lganda).
- **`infra/docker-compose.staging.yml`:** postgres, redis, minio, migrate (bir martalik), api, web, member, caddy. Tashqariga faqat Caddy (80, 443).
- **Caddy** (`infra/caddy/Caddyfile`): `<base>` va `admin.<base>` → web; `<slug>.<base>` → web; `<slug>.my.<base>` → member; `/api/*` → api. Sertifikatlar talab bo'yicha.
- **API:** `GET /api/v1/tls/allowed?domain=` (Caddy uchun ochiq endpoint: faqat platforma manzillari va mavjud tashkilotlar); `APP_ENV` (staging `NODE_ENV=production` bilan, lekin konsol SMS ruxsat).
- **Skriptlar:** `init-env.sh` (tasodifiy sirlar bilan `.env`, hech narsani chiqarmaydi), `deploy.sh` (cron, `main` o'zgarsa yig'adi va yangilaydi, muvaffaqiyatsiz commitni qayta urinmaydi), `backup.sh` (kunlik `pg_dump`, 14 tasi saqlanadi).
- **web01:** Nginx Proxy Manager to'xtatildi (`docker stop`, avtomatik ishga tushishi o'chirilgan; ma'lumotlari `/srv/proxy` da). Repo `/srv/gatefit` da, `.env` serverda yaratildi.

### Tekshirildi

- `pnpm lint`, `pnpm typecheck`, `pnpm test` yashil; yangi testlar: `tls.service.spec.ts`, `test/tls.int-spec.ts`, `env.spec.ts`, ochiq endpointlar ro'yxati.
- web01 da image'lar yig'ildi, stack ishga tushdi: migratsiyalar va seed o'tdi, API healthy. Ichki tarmoqdan: TLS tekshiruvi (mavjud manzillar 200, notanishlari 404), HTTP→HTTPS yo'naltirish, panel, admin va a'zo ilovasi o'z manzillarida, demo ega bilan kirish (kutilganidek TOTP sozlashni so'radi).
- **Tekshirilmagan:** tashqaridan kirish va haqiqiy sertifikat. Avval DNS yozuvlari va routerda port yo'naltirish kerak.

### Qoldi

- ~~Anvar: DNS va routerda 80/443~~ — CGNAT sabab bekor qilindi, 2026-11-21 bo'limiga qarang.
- ~~PR birlashgach: serverda `main` ga o'tish va cron~~ — 2026-11-18 da qilindi, birinchi deploy va zaxira ishladi.
- Ixcham production image'i, registry, monitoring, zaxirani serverdan tashqariga ko'chirish — M8.
- Lokal Docker Desktop'ga 4 GB xotira ajratilgan: to'liq build uchun `--build-arg BUILD_CONCURRENCY=1`.

## 2026-11-18 — GitHub, CI va Node 24

- Repozitoriy: https://github.com/anmusulmanov-dev/gatefit (ochiq). PR #1 (chore/scaffold) main'ga birlashtirildi.
- **CI birinchi marta ishladi va API testlarida yiqildi:** Jest NestJS 12 (ESM) paketlarini faqat Node 24.9+ da yuklaydi (require(esm)), CI esa Node 22 da edi. Mahalliy Node 22.23.5 da aynan takrorlandi. Lokal tekshiruvlar Node 26 da bo'lgani uchun oldin ko'rinmagan.
- **Qaror (Anvar tasdiqlagan):** loyiha Node 24 LTS ga o'tdi (`.nvmrc`, `engines` >=24.9, CLAUDE.md, README). CI action'lari v6 ga ko'tarildi (Node 20 ogohlantirishi). O'zgarish feat/tenancy-rls da qilinib, zanjirdagi har branchga birlashtirildi.
- **Bilib qo'yish kerak:** bu repozitoriyda PR CI'si workflow fayli main'ga tushmaguncha ishga tushmadi. Endi main'da bor.
- **Ikkinchi yiqilish — S3 sozlamalari "undefined":** Turborepo strict env rejimida e'lon qilinmagan muhit o'zgaruvchilarini vazifalarga o'tkazmaydi. `turbo.json` da `envMode: "loose"` (CI `.env` siz, faqat workflow `env` bilan ishlaydi).
- **Uchinchi yiqilish — staff testlarida `beforeAll` 5 s dan oshdi:** fixturalar bir nechta Argon2 xeshlaydi, CI'ga o'xshash muhitda sekinroq. Bitta hook yiqilishi o'nlab testni ergashtirib yiqitdi (79 ta). Jest `testTimeout: 30000`. CI'ga aynan o'xshash muhitda (toza Postgres/Redis konteynerlari, `.env` siz) eng yuqori branch tekshirildi: format, lint, typecheck, build va 278 + 33 + 11 test — yashil.
- **Qoldi:** PR #2–#7 ni ochish va CI yashil ekanini ko'rish; server (staging).

## 2026-11-17 — M1d: super-admin paneli

Branch: `feat/m1-platform-ui` (`feat/m1-settings-ui` ustidan). Shu bilan M1 yopildi.

### Qilindi

- **Manzilga qarab yo'naltirish:** `admin.localhost` (prodda `admin.gatefit.uz`) ochilganda platforma paneliga o'tadi; `/platform/*` sahifalari boshqa har qanday manzilda 404.
- **Operator kirishi:** telefon, parol va doim TOTP (birinchi kirishda sozlash).
- **Tashkilotlar:** ro'yxat (qidiruv, holat filtri, "yana ko'rsatish"), yaratish oynasi (filial, ega, vaqtinchalik parol, tarif, to'lov davri, sinov kunlari, ixtiyoriy oferta versiyasi), tafsilot sahifasi: holat (bloklash), sinov muddati, tarif va to'lov davri, nom, til, mamlakat, valyuta; egalarning parolini va TOTP sini tiklash.
- **Tariflar:** ro'yxat, yaratish va tahrirlash: narx (so'mda kiritiladi), valyuta, a'zolar limiti yoki cheklanmagan, modullar, sotuvda yoki yo'q.
- **Pul yordamchilari** (`packages/shared/src/money.ts`): kiritilgan narxni tiyinga va tiyinni ko'rinishga faqat satr arifmetikasi bilan o'tkazadi, `float`siz (2-qoida). `packages/shared` ga Jest qo'shildi, 33 ta birlik testi.
- **API:** platforma tashkilot tafsilotida joriy `billingPeriod` qaytariladi (test bilan).
- **API klienti:** `prefix` va `refreshOnExpiry` sozlamalari; `useApiGet` klientni parametr sifatida oladi.
- **Tarjimalar:** platforma, 15 ta modul nomi, yangi xato kodlari — uch tilda.

### Tekshirildi

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — yashil. API: 278, shared: 33, i18n: 11.
- Brauzerda: `demo.localhost:3000/platform` 404; `admin.localhost:3000` kirishga yo'naltiradi; demo operator TOTP ni sozlab kirdi.
- Panel orqali tashkilot yaratildi: tafsilot sahifasiga o'tdi, 14 kunlik sinov, Start tarifi; bazada audit yozuvlari va oferta roziligi bor.
- Tashkilot bloklandi, tarifi Standard va yillikka o'zgartirildi: `fitlab-test.localhost:3000` "Tashkilot bloklangan" ko'rsatdi.
- Egasining paroli tiklandi: bazada `must_change_password` va `platform.staff.password_reset` audit yozuvi.
- Tarif narxi: "12.345" rad etildi, "350 000,50" bazaga aniq 35000050 tiyin bo'lib yozildi.
- Tashkilotlar ro'yxati 360 px da gorizontal siljishsiz.
- Sinov ma'lumotlari keyin dev bazadan o'chirildi; Start narxi va operator TOTP si tiklandi.
- **Brauzerda sinalmagan:** yangi tarif yaratish, tarifni sotuvdan olish, egasining TOTP sini o'chirish, "yana ko'rsatish". API tomoni testlar bilan qoplangan. Frontend avtotestlari yo'q (Playwright M2 da).

### Rejadan chetlanishlar

- Panel manzili `admin.localhost:3000/platform/...` (yo'lda `/platform` prefiksi qoladi): middleware yozilmadi, manzil tekshiruvi layout'larda.
- Tafsilot sahifasida tashkilot to'liq manzili emas, faqat slug ko'rsatiladi: web ilova bazaviy domenni bilmaydi.

### Ma'lum muammolar

- Brauzerning `uz` lokal ma'lumotlari to'liq emas: sanalar "2026 M11 17", sonlar "300,000.00" ko'rinishida chiqadi. Rus va ingliz tillarida to'g'ri.
- Operatorlarni boshqarish (qo'shish, o'chirish, parolini tiklash) uchun UI va API yo'q — hozircha seed va baza orqali (ADR 0004).

## 2026-11-17 — M1c: sozlamalar UI

Branch: `feat/m1-settings-ui` (`feat/m1-platform-api` ustidan).

### Qilindi

- **Login:** vaqtinchalik parol bilan kirganda "Yangi parol o'rnating" qadami; yangi parol o'rnatilgach avtomatik kirish (kerak bo'lsa TOTP qadamlari bilan davom etadi).
- **Sozlamalar bo'limi** (`/settings`): menyu ruxsatga qarab; ruxsatsiz bo'limga to'g'ridan-to'g'ri kirilsa "ruxsatingiz yo'q".
  - **Tashkilot:** nom va til (`organization.update` bo'lmasa faqat ko'rish), manzil, mamlakat, valyuta, holat, sinov muddati, tarif va a'zolar limiti.
  - **Filiallar:** ro'yxat, qo'shish va tahrirlash (vaqt mintaqasi, kunlar bo'yicha ish vaqti), arxivlash va tiklash.
  - **Xodimlar:** ro'yxat ("yana ko'rsatish" bilan sahifalash, holat filtri), qo'shish (vaqtinchalik parol avtomatik yaratiladi), tahrirlash, parol va TOTP ni tiklash.
  - **Rollar:** ro'yxat, standart rollarni ko'rish, o'z rollarini yaratish va tahrirlash (ruxsatlar bo'limlar bo'yicha guruhlangan), arxivlash.
  - **Mening hisobim:** o'z parolini almashtirish.
- **Ekran API qoidalarini oldindan aks ettiradi:** o'zingizda yo'q ruxsatlar va sizdan kuchliroq rollar tanlab bo'lmaydi; o'z rolingiz va holatingiz qulflangan; ega va kuchliroq xodim uchun tiklash tugmalari o'rniga sabab ko'rsatiladi. Himoya baribir API'da.
- **Tarjimalar:** 27 ta ruxsat, 12 ta bo'lim, yangi xato kodlari va barcha sozlamalar matnlari — uch tilda.
- **Umumiy:** `useApiGet`, `useApiAction` hooklari, `StaffSessionProvider` (`useCan`), Dialog, Select, Badge, maydon komponentlari; API klientiga `patch`.

### Tekshirildi

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — yashil. API: 278, i18n: 11.
- Brauzerda, `demo.localhost:3000`, demo ega nomidan: tashkilot nomini saqlash (audit yozuvi bazada), ish vaqti bilan filial qo'shish, 4 ruxsatli "Kassir" rolini yaratish, shu rol bilan xodim qo'shish; o'z tahrirlash oynasida rol va holat qulflangan.
- Shu xodim nomidan: vaqtinchalik parol → "Yangi parol" qadami (mos kelmagan parollar xabari) → kirish; sozlamalarda faqat "Tashkilot" (faqat ko'rish) va "Mening hisobim"; `/settings/staff` da "ruxsatingiz yo'q"; noto'g'ri va to'g'ri joriy parol bilan almashtirish. "Mening hisobim" 360 px da gorizontal siljishsiz.
- Sinov ma'lumotlari keyin dev bazadan o'chirildi.
- **Avtomatik frontend testlari yo'q** (Playwright M2 da).
- **Brauzerda sinalmagan:** xodim va TOTP ni tiklash tugmalari, rolni arxivlash, filialni arxivlash, "yana ko'rsatish" (50 dan ortiq xodim kerak). Ularning API tomoni integratsiya testlari bilan qoplangan.

### Ma'lum muammolar

- Vaqt mintaqalari ro'yxati brauzerdan olinadi, tekshiruv esa serverda. Eski nomlar (masalan `Asia/Calcutta`) server Node versiyasida bo'lmasa, saqlashda xato chiqishi mumkin. Asosiy zonalar (`Asia/Tashkent`) muammosiz.
- O'zbek tilida sonlar brauzerga qarab "1,000" ko'rinishida chiqishi mumkin (brauzerning `uz` lokal ma'lumotlari).
- Demo egasi `staff_credentials` migratsiyasidan oldin yaratilgani uchun ismi bo'sh edi; dev bazada qo'lda to'ldirildi. Yangi bazada seed ismni o'zi qo'yadi.

## 2026-11-17 — M1b: platforma API

Branch: `feat/m1-platform-api` (`feat/m1-settings-api` ustidan). Qaror: `docs/ADR/0004-platform.md`.

### Qilindi

- **Jadvallar:** `saas_plans`, `saas_subscriptions` (RLS), `platform_admins`, `platform_sessions`; `organizations.saas_plan_id`.
- **Super-admin kirishi:** `admin.localhost` da; telefon, parol va doim TOTP (birinchi kirishda sozlash). 12 soatlik sessiya, `SameSite=Strict` cookie.
- **Tashkilotlar:** ro'yxat (sahifalash, qidiruv, holat filtri), bitta tashkilot (owner'lari bilan), yaratish (filial, 5 standart rol ruxsatlari bilan, owner vaqtinchalik parol bilan, obuna, ixtiyoriy rozilik — hammasi bitta tranzaksiyada), o'zgartirish (bloklash, sinov muddati, tarif, mamlakat, valyuta).
- **Xodim parol va TOTP sini platformadan tiklash** — owner uchun yagona yo'l.
- **Tariflar:** ro'yxat, yaratish, o'zgartirish (narx, limit, modullar, faollik).
- **`@RequireModule`** va `EntitlementsService`; `GET /organization` endi tashkilot tarifini ham qaytaradi.
- **Baza darajasidagi cheklov:** tashkilot `organizations` da faqat nom va tilni yangilay oladi.
- **Seed:** Start, Standard, Pro (taxminiy narx), demo tashkilotga Standard, demo operator (`SEED_PLATFORM_ADMIN_*`).
- **TZ yangilandi:** 6-bo'lim (platforma jadvallari), 7-bo'lim (platforma endpointlari).

### Tekshirildi

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — yashil. API: 278 test, i18n: 11.
- Platforma kirishi, tashkilotlar, tariflar va modullar uchun integratsiya testlari; yangi tashkilot owner'i o'z manzilida vaqtinchalik parol → yangi parol → TOTP sozlash talabigacha boradi.
- Ajratish: platforma endpointlari tashkilot manzilida 404; xodim sessiyasi platformada, platforma sessiyasi tashkilotda ishlamaydi; `gatefit_app` platforma jadvallarini o'qiy olmaydi; tashkilot o'z tarifini SQL orqali ham o'zgartira olmaydi.
- "Qo'riqchi" testlar: RLS qamrovi (yangi global jadvallar), endpoint belgilari (`@Platform`), platforma ulanishi faqat `modules/platform` da.
- Ishga tushirilgan API da qo'lda: `admin.localhost` da operator kirishi TOTP sozlashni so'raydi, `demo.localhost` da shu yo'l 404.
- CI hali GitHub'da ishlab ko'rilmagan. Brauzerda tekshirilmagan (UI M1d da).

### Rejadan chetlanishlar

- **`PATCH /platform/saas-plans/{id}` va `GET /platform/organizations/{id}` qo'shildi** (TZ da yo'q edi): narxni panelda o'zgartirish va owner'larni ko'rish uchun kerak.
- **Platforma sessiyasi JWT emas**, oddiy token (ADR 0004).
- **`saas_invoices` qilinmadi:** M1 promptida yo'q, avtomatik hisob-kitob v1 da.
- **`saas_subscriptions` da `status` ustuni yo'q:** joriy obuna — `ends_at` bo'sh qator.

### Qoldi

- M1c: sozlamalar UI va login'da vaqtinchalik parol qadami. M1d: super-admin paneli.
- ADR 0004 dagi ochiq qolganlar: rozilik oqimi, operatorlarni boshqarish, mijoz hisobiga kirish, platforma audit jadvali.
- Faol a'zolar hisoblagichi — M2.

### Ma'lum muammolar

- Tarif narxlari taxminiy (TZ 12): Start 300 000, Standard 600 000, Pro 1 200 000 so'm/filial/oy.
- Demo operator ham birinchi kirishda TOTP sozlashi kerak; M1d gacha uni faqat API orqali qilish mumkin.

## 2026-11-17 — M1a: tashkilot ichki API

Branch: `feat/m1-settings-api` (`feat/auth` ustidan). Qaror: `docs/ADR/0003-staff-credentials.md`.

### Qilindi

- **Parol va TOTP `staff` ga ko'chdi** (Anvar tasdiqlagan). Sabab: global `users` da turganida bir tashkilot xodim parolini tiklab, boshqa tashkilotga kira olardi. Mavjud ma'lumot migratsiyada ko'chirildi.
- **`staff` ga `first_name`, `last_name`, `must_change_password`** qo'shildi.
- **`tenancy` moduli:** `GET/PATCH /organization` (nom, til), `GET/POST/PATCH /locations` (vaqt mintaqasi va ish vaqti tekshiruvi, arxivlash va tiklash).
- **`staff` moduli:** `GET/POST/PATCH /staff` (kursor bilan sahifalash, holat filtri), `GET/POST/PATCH /roles` (o'z rollari, arxivlash).
- **Vaqtinchalik parol:** xodim qo'shilganda yoki paroli tiklanganda. Birinchi kirish `PASSWORD_CHANGE_REQUIRED` qaytaradi; `POST /auth/password/set`. O'z parolini almashtirish: `POST /auth/password/change` (boshqa qurilmalar chiqariladi).
- **Tiklash:** `POST /staff/{id}/reset-password`, `POST /staff/{id}/reset-totp` — nishonning sessiyalari tugaydi.
- **Qoidalar:** standart rollar o'zgarmaydi; faqat o'zingda bor ruxsatni bera olasan (rol yaratish, tahrirlash, xodimga rol berish, tiklash); o'z roling va holatingni o'zgartira olmaysan; kamida bitta faol owner qolishi shart; owner'ning parol va TOTP sini tashkilot ichidan tiklab bo'lmaydi.
- **Audit:** `organization.update`, `role.create/update/archive`, `staff.create/update`, `staff.password_reset`, `staff.totp_reset` — o'zgarish bilan bitta tranzaksiyada.
- **Modul chegarasi:** `auth` endi `staff` jadvallarini faqat `StaffCredentialsService`, `StaffAccessService`, `StaffService` orqali o'qiydi.
- **Umumiy:** `AuditService`, kursor sahifalash (`pageArgs`, `toPage`), `packages/shared` da tashkilot, filial, xodim, rol sxemalari.
- **TZ yangilandi:** 6-bo'lim (`users`, `staff` ustunlari), 7-bo'lim (yangi endpointlar).

### Tekshirildi

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — yashil. API: 225 test, i18n: 11.
- Har yangi endpointga integratsiya testi: `organization`, `roles`, `staff` fayllari. Ruxsatni oshirish urinishlari, oxirgi owner, boshqa tashkilot yozuvlariga murojaat (404), audit yozuvlari tekshirilgan.
- Bir odamning ikki tashkilotdagi parollari mustaqilligi: `test/users-lockdown.int-spec.ts`.
- Migratsiya dev bazada qo'llandi: demo owner paroli saqlanib qoldi.
- CI hali GitHub'da ishlab ko'rilmagan. Brauzerda tekshirilmagan (bu qismda UI yo'q).

### Rejadan chetlanishlar

- Parol va TOTP ning ko'chishi (yuqorida) — TZ dan chetlanish, tasdiqlangan.
- `first_name`, `last_name`: TZ jadvalida yo'q edi, lekin xodimlar ro'yxati ismsiz ishlamaydi.
- `GET /locations` sahifalanmagan: filiallar oz va har ekranga hammasi kerak.
- Tiklash endpointlari `auth` modulida (sessiyalarni tugatishi kerak), yo'li `/staff/...`.

### Qoldi

- **Web login `PASSWORD_CHANGE_REQUIRED` ni hali bilmaydi** — umumiy xato ko'rsatadi. M1c da parol almashtirish qadami qo'shiladi. Ungacha yangi qo'shilgan xodim brauzerdan kira olmaydi.
- M1b: platforma (super-admin, tariflar, owner parolini tiklash). M1c, M1d: UI.
- Arxivlangan rol va filial nomi band qoladi (qayta shu nom bilan yaratib bo'lmaydi).
- Filial darajasidagi cheklov (menejer faqat o'z filiali) — M2.
- "Parolni unutdim" — M7 (SMS).

## 2026-11-17 — 0.3 Autentifikatsiya va ruxsatlar, B qism (frontend)

Branch: `feat/auth`. Shu bilan 0-bosqich yopildi.

### Qilindi

- **API bilan aloqa:** brauzer API'ga ilovaning o'z manzili orqali murojaat qiladi (`next.config.ts` dagi `/api/*` proxy), shuning uchun cookie'lar birinchi tomon va CORS kerak emas. `packages/shared` da `createApiClient` (401 da sessiyani bir marta yangilab, so'rovni takrorlaydi; parallel so'rovlar bitta yangilashni kutadi) va server komponentlar uchun `fetchSession`.
- **apps/web:** `/login` (telefon + parol, TOTP qadami, majburiy TOTP ni sozlash), `(app)` himoyalangan layout (tashkilot nomi, filial tanlash, telefon va rol, til, chiqish). Filial tanlovi cookie'da saqlanadi.
- **apps/member:** `/login` (telefon, SMS-kod, qayta yuborish, raqamni o'zgartirish), himoyalangan bosh sahifa, chiqish.
- **Holat sahifalari:** tashkilot topilmadi, bloklangan, xizmat ishlamayapti. Access token muddati tugaganda sahifa o'rniga sessiyani tiklovchi komponent chiqadi.
- **Tarjimalar:** `auth`, `errors`, `roles`, `organization` bo'limlari uch tilda. API xato kodlari `errorMessageKey` orqali tarjimaga bog'lanadi.
- **API:** himoyalangan endpoint tashkilotsiz manzilda 401 emas, 404 `ORGANIZATION_NOT_FOUND` qaytaradi.
- A qismdan qolgan 8 ta lint xatosi tuzatildi.

### Tekshirildi

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (API 162, i18n 11), `pnpm build` — yashil.
- Brauzerda, `http://demo.localhost:3000`: himoyalangan sahifa login'ga yo'naltiradi; noto'g'ri parol xabari; owner uchun TOTP sozlash va kirish; chiqib, kod bilan qayta kirish (noto'g'ri va to'g'ri kod); filial tanlash sahifa yangilangach saqlanadi; kirgan holda `/login` bosh sahifaga qaytaradi; rol va interfeys rus tilida ham to'g'ri; `localhost:3000` da "tashkilot topilmadi".
- Brauzerda, `http://demo.localhost:3001`, 360 px: SMS-kod so'rash, noto'g'ri kod xabari, to'g'ri kod bilan kirish, chiqish. Xodim va a'zo sessiyalari bitta brauzerda bir-biriga xalaqit bermaydi.
- **Brauzerda tekshirilmadi:** access token muddati tugagach sessiyaning avtomatik tiklanishi (15 daqiqa kutish kerak). API tomoni testlar bilan qoplangan; brauzerdagi komponentning faqat "tiklab bo'lmadi, login'ga" tarmog'i ko'rildi.
- Frontend uchun avtomatik test yo'q (Playwright M2 ga qoldirilgan).
- CI hali GitHub'da ishlab ko'rilmagan.

### Rejadan chetlanishlar

- **TOTP sozlashda QR-kod yo'q:** kalit matn ko'rinishida va `otpauth://` havolasi bilan beriladi. QR chizish uchun paket kerak; M5/M6 da a'zo QR kodi uchun baribir tanlanadi, o'shanda shu yerga ham qo'shiladi.
- `.next/dev/types` `tsconfig` dan olib tashlandi: sahifa ko'chirilganda eskirgan tiplar typecheck'ni buzardi.

### Qoldi

- A qismdagi ro'yxat (pastda) o'zgarmadi: a'zo kirishini `members` ga bog'lash (M2), parol va TOTP ni tiklash (M1), super-admin (M1).
- TOTP sozlash sahifasiga QR-kod.
- Playwright e2e: login oqimlari uchun (M2).

### Ma'lum muammolar

- Devda tashkilot manzili `demo.localhost`; `localhost:3000` ning o'zi "tashkilot topilmadi" ko'rsatadi — bu kutilgan holat.
- Devda web va member bitta xostda (portlar farqli) bo'lgani uchun til cookie'si umumiy.

## 2026-11-11 — 0.3 Autentifikatsiya va ruxsatlar, A qism (backend)

Branch: `feat/auth` (`feat/tenancy-rls` ustidan). Qarorlar: `docs/ADR/0002-authentication.md`.

### Qilindi

- **Jadvallar:** `sessions`, `otp_codes` (RLS bilan). `users` API roli uchun yopildi; kirish tor `SECURITY DEFINER` funksiyalar orqali.
- **Tashkilotni aniqlash:** subdomendan (`<slug>.<APP_BASE_DOMAIN>`), band qilingan nomlar ro'yxati bilan. Noma'lum tashkilot 404, bloklangan 403.
- **Xodim kirishi:** telefon + parol (Argon2id), TOTP. Owner va accountant uchun TOTP majburiy, birinchi kirishda sozlash oqimi. Boshqa rollar ixtiyoriy yoqa oladi.
- **A'zo kirishi:** telefon + SMS-kod. `SmsProvider` porti va `console` drayveri (productionda taqiqlangan). SMS matni tashkilot tilida, `packages/i18n` dan.
- **Tokenlar:** access JWT 15 daqiqa, aylanadigan refresh token, httpOnly cookie. Qayta ishlatilgan token butun sessiyani bekor qiladi. `logout`, `logout-all`.
- **Ruxsatlar:** `packages/shared/permissions.ts` (27 ruxsat, standart rollar matritsasi), `@Public` / `@AnyAuthenticated` / `@RequirePermission`. Har so'rovda bazadan tekshiriladi.
- **Tezlik cheklovi:** Redis; IP bo'yicha umumiy va kirish uchun qattiq, telefon bo'yicha login va SMS.
- **CSRF:** `Origin` tekshiruvi.
- **`GET /me`:** foydalanuvchi, tashkilot, rol, ruxsatlar, filiallar.
- **Yordamchilar:** `Clock` (3-qoida), `CryptoService` (AES-GCM, HMAC), `uuidv7`, `ZodPipe` va Swagger uchun `zodBody`.
- **Seed:** standart rollarga ruxsatlar, demo owner (`SEED_OWNER_PHONE`, `SEED_OWNER_PASSWORD`), u ikkala filialga biriktirilgan.
- **TZ 7-bo'lim:** `/auth/logout-all`, `/auth/totp/setup`, `/auth/totp/confirm` qo'shildi.

### Tekshirildi

- `pnpm typecheck` va `pnpm test` yashil (API: 162 test, i18n: 11). `pnpm lint` shu qism oxirida qizil edi (8 xato); B qismda tuzatildi.
- **0-bosqich mezoni to'liq yo'l bilan** (`test/permissions.int-spec.ts`): ikki tashkilot xodimi HTTP orqali kiradi, har biri faqat o'z filiallarini ko'radi, birining sessiyasi ikkinchisining manzilida 401.
- Prompt talab qilgan testlar: to'g'ri va noto'g'ri kirish, token aylanishi, ruxsatsiz endpoint 403. Qo'shimcha: TOTP oqimi va kodni qayta ishlatish, SMS-kod muddati va 5 urinish, bir vaqtdagi ikki refresh, deaktivatsiya qilingan xodim, CSRF, `users` ga to'g'ridan-to'g'ri kirish urinishlari.
- API qo'lda ishga tushirildi: demo owner bilan login `TOTP_SETUP_REQUIRED` qaytaradi, SMS-kod terminalga chiqadi, so'rov loglarida telefon va parol yo'q, Swagger'da so'rov tanalari ko'rinadi.
- CI hali GitHub'da ishlab ko'rilmagan.

### Rejadan chetlanishlar

- **Login cheklovi faqat muvaffaqiyatsiz urinishlarni sanaydi** (muvaffaqiyatli kirish hisoblagichni tozalaydi), aks holda tez-tez kiradigan xodim o'zini bloklab qo'yardi.
- **Ruxsat tekshiruvi guard emas, interceptor** — sababi ADR 0002 da.
- **`NEXT_PUBLIC_API_URL` o'rniga `API_INTERNAL_URL`:** brauzer API'ga o'z domeni orqali murojaat qiladi (B qismda proxy), manzil faqat Next serveriga kerak.
- **`APP_BASE_DOMAIN`, `TRUST_PROXY`** sozlamalari qo'shildi.

### Qoldi

- A'zo kirishini `members` ga bog'lash — M2.
- Parolni o'zgartirish va tiklash, TOTP ni tiklash, xodim qo'shish — M1.
- Super-admin kirishi — M1.
- Tashkilot va ruxsatlarni Redis'da keshlash — yuklama testi (M8) ko'rsatsa.
- Standart rollar matritsasini ko'rib chiqish kerak (`packages/shared/src/permissions.ts`): TZ 2-bo'limdagi tavsifdan men chiqardim.

### Ma'lum muammolar

- Demo owner birinchi kirishda TOTP sozlashi shart (B qismda sahifasi qo'shildi).
- `DATA_ENCRYPTION_KEY` yo'qolsa TOTP sirlari tiklanmaydi; zaxira nusxa rejasiga (M8) kiritish kerak.

## 2026-11-11 — 0.2 Ko'p mijozlilik va RLS

Branch: `feat/tenancy-rls` (`chore/scaffold` ustidan). Qarorlar: `docs/ADR/0001-multi-tenancy.md`.

### Qilindi

- **Baza rollari:** `gatefit_app` (API, RLS ostida) va `gatefit_migrator` (jadvallar egasi; migratsiya, seed). `infra/postgres/init.sh` rollarni va `gatefit_test` bazasini yaratadi. `.env` da `DATABASE_URL` (app), `DATABASE_ADMIN_URL` (migrator), `TEST_DATABASE_URL`, `TEST_DATABASE_ADMIN_URL`.
- **Jadvallar:** `organizations`, `locations`, `users`, `staff`, `staff_locations`, `roles`, `role_permissions`, `audit_logs`, `consents`. UUID v7, snake_case. Bola jadvallar otaga `(organization_id, id)` kompozit kalit bilan bog'langan.
- **RLS (qo'lda SQL):** `organization_id` li har jadvalda va `organizations` da `tenant_isolation` siyosati. Kontekst bo'lmasa hech narsa ko'rinmaydi.
- **Huquqlar:** `gatefit_app` ga jadvalma-jadval. Biznes jadvallarida `DELETE` yo'q, `organizations` ga `INSERT` yo'q, `audit_logs` va `consents` faqat `INSERT` + `SELECT`.
- **`audit_logs`:** oy bo'yicha partition, 13 oy oldinga yaratilgan, `ensure_audit_logs_partition()` funksiyasi va `default` partition.
- **`TenantDb.run(orgId, fn)`:** tranzaksiya + `set_config('app.current_org', ..., true)`. `TenantTransactionInterceptor` HTTP so'rovni bitta tranzaksiyaga o'raydi; kod `tenantDb.tx` dan foydalanadi.
- **Test bazasi:** `pnpm test` `gatefit_test` ni tozalab, migratsiyalardan qayta quradi.
- **Seed:** `pnpm --filter api seed` — `demo` tashkiloti, 2 filial (Chilonzor, Yunusobod), 5 standart rol. Idempotent.
- **`packages/shared`:** `SYSTEM_ROLES`.

### Tekshirildi

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — yashil. API: 55 test (birlik 20, integratsiya 35), i18n: 11.
- 0-bosqich mezoni ("ikki tashkilot bir-birini ko'rmaydi") `test/tenancy.int-spec.ts` da: o'qish, qo'shish, o'zgartirish, o'chirish, boshqa tashkilot qatoriga bog'lash, parallel so'rovlar, kontekstning hovuz orqali o'tib ketmasligi.
- `test/rls-coverage.int-spec.ts`: sxemadagi har jadval yo RLS bilan, yo ataylab global ro'yxatida; `gatefit_app` superuser emas va hech narsaning egasi emas.
- `test/tenant-request.int-spec.ts`: HTTP orqali ajratish va xatoda butun so'rovning qaytarilishi.
- Prisma partitionlarni farq deb ko'rmasligi tekshirildi (`migrate dev --create-only` bo'sh migratsiya berdi).
- CI o'zgarishlari hali GitHub'da ishlab ko'rilmagan.

### Rejadan chetlanishlar

- **`staff.role_id` qo'shildi** (TZ 6 jadvalida yo'q, lekin F-6.1 "xodim roli" ni talab qiladi). Hozircha bir xodim — bir rol.
- **`locations` da `(organization_id, name)` yagona:** seed idempotent bo'lishi uchun.
- **Seed `tsc` + `node` bilan ishlaydi** (`tsx` qo'shilmadi, yangi paket yo'q).

### Qoldi

- 0.3: auth; so'rovga `organizationId` ni JWT va subdomendan qo'yish (hozir interceptor tayyor, lekin uni to'ldiradigan kod yo'q); rollarga ruxsatlar.
- ADR dagi ikki ochiq savol: `users` jadvalini toraytirish va tashkilotni subdomen bo'yicha topish.
- `ensure_audit_logs_partition()` ni chaqiruvchi fon vazifasi (BullMQ bilan, M7 dan kechikmay). 2027-yil noyabrgacha partitionlar bor.
- `organizations.saas_plan_id` — M1. `consents.member_id` — M2.
- Production uchun rollarni yaratish tartibi — staging/M8 runbook.

### Ma'lum muammolar

- **Windows portlari.** Bu kompyuterda dinamik port oralig'i 1024 dan boshlanadi, shuning uchun Hyper-V har yuklashda tasodifiy 100 talik oraliqlarni band qiladi. Bugun 6379 (Redis) va 3001 (member) tushib qoldi; lokal `.env` da Redis 16379 ga ko'chirildi. Doimiy yechim README da (administrator buyrug'i, o'zingiz bajarasiz).
- **`prisma migrate dev` nomsiz chaqirilsa osilib qoladi** va bazada advisory lock qoldiradi. Doim `--name` bilan.
- **Prisma 7 `migrate dev` mijozni qayta yaratmaydi:** sxema o'zgargach `pnpm --filter api prisma generate`. `pnpm build` buni o'zi qiladi.

## 2026-11-11 — 0.1 Loyiha karkasi

### Qilindi

- **Monorepo:** pnpm 12 workspaces + Turborepo. `tsconfig.base.json` (strict), bitta ildiz `eslint.config.mjs` (`any` taqiqlangan, tiplar bilan lint), Prettier.
- **packages/shared:** `errors.ts` — xato kodlari va `{ code, message, details }` sxemasi.
- **packages/i18n:** `uz.json`, `ru.json`, `en.json`; `@gatefit/i18n/config` (tillar ro'yxati, cookie nomi) klient kodi uchun alohida, tarjimalar brauzer to'plamiga kirmasligi uchun. Test: uch fayldagi kalitlar bir xil.
- **infra/docker-compose.dev.yml:** PostgreSQL 16, Redis 7, MinIO va `gatefit-dev` bucketini yaratuvchi bir martalik vazifa. Ildizda `.env.example`.
- **apps/api (NestJS 12):**
  - Config: env zod bilan tekshiriladi, xato bo'lsa ilova ishga tushmaydi (`src/config/env.ts`).
  - `GET /api/v1/health`: PostgreSQL va Redis tekshiruvi; biri ishlamasa 503.
  - Swagger: `/api/docs`.
  - Global xato filtri: har qanday xato `{ code, message, details }` ko'rinishida; kutilmagan xatolarning ichki matni tashqariga chiqmaydi.
  - So'rov ID: `X-Request-Id` qabul qilinadi yoki yaratiladi, javobda qaytadi va har log qatorida bor.
  - Log: pino, JSON; `authorization`, `cookie`, `password`, `token`, `otp`, `phone` yashiriladi.
  - Prisma 7 (pg adapter bilan), modelsiz sxema, bo'sh `init` migratsiyasi.
- **apps/web:** Next.js 16 App Router, Tailwind 4, shadcn/ui (Button), bosh sahifa, til almashtirgich.
- **apps/member:** Next.js 16, Tailwind 4, PWA manifest va ikonka, bosh sahifa, til almashtirgich.
- **CI:** `.github/workflows/ci.yml` — format, lint, typecheck, test, build; PostgreSQL va Redis servis sifatida.
- **Hujjatlar:** `README.md`, `CLAUDE.md` dagi "Buyruqlar".

### Tekshirildi

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (38 test: api 27, i18n 11), `pnpm build` — yashil.
- API ishga tushirilib tekshirildi: health 200, noma'lum yo'l 404 yagona formatda, Swagger ochiladi.
- Brauzerda: web va member da til almashadi, sahifa yangilangandan keyin saqlanadi; member 360 px da gorizontal siljishsiz.
- GitHub Actions hali ishga tushirilmagan (repozitoriy GitHub'ga yuklanmagan).

### Rejadan chetlanishlar va sabablari

- **API porti 8000** (rejada 4000 edi): Windows'da 3345–4144 oralig'i Hyper-V tomonidan band, API ishga tushmadi.
- **TypeScript 6.0** (7.0 emas): typescript-eslint, ts-jest va NestJS CLI hali 7 ni qo'llamaydi.
- **Prisma 7.10** (npm'dagi `latest` 8.0-rc): barqaror versiya tanlandi.
- **MinIO obrazi `cgr.dev/chainguard/minio`:** rasmiy `minio/minio` obrazi Docker Hub'dan olib tashlangan.
- **Jest `--experimental-vm-modules` bilan:** NestJS 12 ESM paket, bu uning rasmiy TS + Jest shablonidagi usul. Testlarda "ExperimentalWarning" chiqadi, zararsiz.
- **Lokal Node 26**, CI va `.nvmrc` da 22. Hozircha muammo chiqmadi.

### Qoldi (keyingi bosqichlarga)

- 0.2: jadvallar, ikki baza roli (`app` va `migrator`), RLS, TenancyContext. Hozir API bazaga bitta `gatefit` foydalanuvchisi bilan ulanadi — bu superuser, 0.2 da almashtiriladi.
- 0.3: auth, `@RequirePermission`. Hozir yagona endpoint (`/health`) ataylab ochiq.
- `Clock` servisi (3-qoida) — birinchi sana mantiqi bilan birga.
- Playwright e2e va `pnpm --filter api test:e2e` — birinchi foydalanuvchi oqimi paydo bo'lganda (0.3).
- CI da bog'liqliklar zaifligi skaneri (TZ 9-bo'lim).
- Service worker va oflayn rejim — M6.
- S3 mijozi — M2 (foto yuklash). Hozir faqat sozlamalar tekshiriladi.

### Ma'lum muammolar

- `pnpm-workspace.yaml` dagi `minimumReleaseAgeExclude`: pnpm 12 yangi chiqqan paketlarni bloklaydi, next-intl 4.15.0 uchun istisno qo'shildi. Bir-ikki haftadan keyin olib tashlash mumkin.
- Dev rejimida web va member bitta `localhost` da bo'lgani uchun til cookie'si ikkalasiga umumiy. Productionda subdomenlar alohida.
