# Gatefit: Texnik topshiriq (Claude Code uchun)

Versiya: 2026-11-11. Belgi: **M** = MVP, **1** = v1, **2** = v2. Hozirgi ish doirasi: 0-bosqich va MVP. v1 va v2 talablari kontekst uchun berilgan, ularni yozma, lekin arxitekturada joy qoldir.

## 1. Maqsad va qamrov

Zal egasi oylik obuna to'laydi va brauzer yoki telefon orqali ishlaydi.

Maqsadlar:
- Zalning kundalik ishi: a'zolar, abonementlar, kirish nazorati, to'lovlar, jadval, xodimlar, hisobotlar.
- Istalgan mamlakatda ishlash: ko'p til, ko'p valyuta, vaqt mintaqalari, mahalliy to'lov va soliq qoidalari.
- Bitta zaldan 100+ filialli tarmoqqacha.
- Yangi zal 30 daqiqada, dasturchi ishtirokisiz ishga tushadi.

Qamrovga kiradi: web boshqaruv paneli, a'zo PWA, backend API, fon vazifalari, integratsiyalar, super-admin paneli, zaldagi qurilmalar uchun mahalliy agent (v1).

Qamrovga kirmaydi: to'liq buxgalteriya, ish haqi hisoblash, o'z turniket qurilmasi, onlayn video-mashg'ulotlar.

## 2. Rollar

Uch daraja: platforma, tashkilot, filial. Huquqlar ruxsatlar (permissions) to'plami; tashkilot o'z rollarini yarata oladi. Quyidagilar standart rollar.

| Rol | Daraja | Asosiy huquqlar |
| --- | --- | --- |
| super_admin | Platforma | Tashkilotlar, tariflar, obunalar, tizim sozlamalari, mijoz hisobiga vaqtincha kirish (audit bilan) |
| owner | Tashkilot | Barcha filiallar, moliya, xodimlar, sozlamalar, obuna |
| manager | Filial | Filial a'zolari, jadval, smenalar, filial hisobotlari |
| receptionist | Filial | A'zo qo'shish, abonement sotish, to'lov qabul qilish, kirishni qayd etish |
| trainer | Filial | O'z jadvali, o'z mijozlari, dasturlar, o'z komissiyasi |
| accountant | Tashkilot | To'lovlar, qaytarishlar, moliyaviy hisobotlar, eksport |
| member | Mijoz | O'z profili, abonement, QR, yozilish, to'lov tarixi |
| lead | Mijoz | Sinov tashrifiga yozilish, onlayn sotib olish |

## 3. Funksional talablar

### 3.1. A'zolar
- F-1.1 (M) A'zo kartasi: ism, telefon, tug'ilgan sana, jins, foto, favqulodda aloqa, izohlar.
- F-1.2 (M) Telefon bo'yicha qidiruv va takrorlanishni aniqlash.
- F-1.3 (M) Holat: active, frozen, expired, debtor, blocked.
- F-1.4 (M) Excel/CSV import va eksport.
- F-1.5 (1) Oila va korporativ guruhlar: bitta to'lovchi, bir nechta a'zo.
- F-1.6 (1) Elektron shartnoma va rozilik hujjatlari.
- F-1.7 (1) Tana o'lchovlari va maqsadlar tarixi.
- F-1.8 (2) Hujjatlar (tibbiy ma'lumotnoma) va amal qilish muddati.

### 3.2. Abonementlar va tariflar
- F-2.1 (M) Tarif turlari: muddatli (kun, oy, yil), tashriflar soni bo'yicha, bir martalik, sinov.
- F-2.2 (M) Cheklovlar: kirish vaqti oralig'i, hafta kunlari, kuniga tashriflar soni, filiallar ro'yxati.
- F-2.3 (M) Muddat tugashini avtomatik hisoblash va holatni o'zgartirish.
- F-2.4 (M) Muzlatish: qo'lda va a'zo so'rovi bilan, limit va narx bilan.
- F-2.5 (1) Avtomatik uzaytirish va bekor qilish qoidalari.
- F-2.6 (1) Chegirmalar, promokodlar, aksiyalar, tavsiya bonusi.
- F-2.7 (1) Tarifni almashtirish va qoldiqni qayta hisoblash.
- F-2.8 (1) Qo'shimcha xizmatlar: shaxsiy mashg'ulot paketi, shkaf, sochiq.
- F-2.9 (2) Tarmoq abonementi va mehmon tashrifi.

### 3.3. Kirish nazorati
- F-3.1 (M) Shaxsiy QR: a'zo telefonida, har 30 soniyada yangilanadi (TOTP uslubida imzolangan token).
- F-3.2 (M) Qabulxona ekrani: a'zo fotosi, abonement holati, qolgan kun yoki tashrif, ruxsat yoki rad sababi.
- F-3.3 (M) Kirish va chiqish jurnali, zalda hozir nechta odam bor.
- F-3.4 (M) Qo'lda kiritish (telefon yoki ism) va sababi.
- F-3.5 (1) Turniket, eshik qulfi, RFID bilaguzuk va karta (mahalliy agent orqali).
- F-3.6 (1) Oflayn rejim: agent oxirgi ruxsatlar ro'yxati bilan ishlaydi va keyin sinxronlaydi.
- F-3.7 (2) Yuzni tanish (alohida rozilik bilan).
- F-3.8 (2) Anti-passback.

### 3.4. To'lovlar va moliya
- F-4.1 (M) To'lov: naqd, karta terminali, o'tkazma; qisman to'lov va qarz.
- F-4.2 (M) Chek yoki kvitansiya (chop etish, SMS yoki Telegram).
- F-4.3 (M) Qaytarish va bekor qilish, sababi va mas'uli bilan.
- F-4.4 (M) Kassa smenasi: ochish, yopish, naqd qoldiq.
- F-4.5 (1) Onlayn to'lov va takroriy yechib olish.
- F-4.6 (1) Muvaffaqiyatsiz to'lovni qayta urinish va eslatma.
- F-4.7 (1) Hisob-fakturalar, soliq stavkalari mamlakat bo'yicha.
- F-4.8 (1) Do'kon: tovarlar, ombor qoldig'i, sotuv.
- F-4.9 (2) Buxgalteriya tizimlariga eksport.

### 3.5. Jadval va guruh mashg'ulotlari
- F-5.1 (1) Jadval: xona, murabbiy, sig'im, takrorlanish qoidasi.
- F-5.2 (1) A'zo ilovadan yoziladi; navbat ro'yxati; bekor qilish muddati va jarima.
- F-5.3 (1) Kelgan va kelmaganlarni belgilash.
- F-5.4 (1) Shaxsiy mashg'ulotlar: bo'sh vaqtlar, bron, paketdan yechish.
- F-5.5 (2) Resurslarni bron qilish.

### 3.6. Murabbiylar va xodimlar
- F-6.1 (M) Xodim kartasi, roli, filiali.
- F-6.2 (1) Smena jadvali va ish vaqti.
- F-6.3 (1) Komissiya va oylik hisobot.
- F-6.4 (1) Mashg'ulot dasturlari va mashqlar kutubxonasi.
- F-6.5 (2) Ovqatlanish rejasi va chat.

### 3.7. CRM va marketing
- F-7.1 (1) Lidlar voronkasi.
- F-7.2 (1) Avtomatik xabarlar: muddat tugashiga 7, 3, 1 kun; tug'ilgan kun; 14 kun kelmaganlar.
- F-7.3 (1) Kanallar: SMS, Telegram, WhatsApp, email, push.
- F-7.4 (1) Segmentlar bo'yicha ommaviy xabar.
- F-7.5 (2) Sadoqat ballari va tavsiya dasturi.
- F-7.6 (2) Saytga joylanadigan vidjet.

### 3.8. Hisobotlar
- F-8.1 (M) Kunlik xulosa: tushum, yangi a'zolar, tashriflar, muddati tugayotganlar.
- F-8.2 (1) MRR, o'rtacha chek, qarzlar, to'lov usullari.
- F-8.3 (1) Churn, saqlanish, faollik, gavjum soatlar.
- F-8.4 (1) Xodimlar: sotuv, komissiya.
- F-8.5 (1) Filiallarni solishtirish, Excel/PDF eksport.
- F-8.6 (2) Ketish xavfini oldindan aniqlash.

### 3.9. A'zo ilovasi
- F-9.1 (M) PWA: kirish (telefon va SMS-kod), QR, abonement holati, to'lov tarixi.
- F-9.2 (1) Yozilish, uzaytirish va sotib olish, muzlatish so'rovi.
- F-9.3 (1) Push-xabarnomalar.
- F-9.4 (2) Native ilova, dasturlar, white-label.

### 3.10. Platforma boshqaruvi
- F-10.1 (M) Tashkilot yaratish, bloklash, sinov muddati.
- F-10.2 (M) Tarif rejalari va limitlar (a'zolar soni, filiallar soni, modullar).
- F-10.3 (1) Obuna uchun avtomatik hisob-kitob; to'lanmasa cheklash, keyin bloklash.
- F-10.4 (1) O'z-o'zidan ro'yxatdan o'tish va sozlash ustasi.
- F-10.5 (1) Tizim holati va foydalanish statistikasi.

## 4. Nofunksional talablar

| Yo'nalish | Talab |
| --- | --- |
| Tezlik | API p95 < 300 ms; QR tekshiruvi < 500 ms; sahifa < 2 s |
| Ishonchlilik | 99,5% (MVP), 99,9% (v2) |
| Zaxira nusxa | Har kuni to'liq va PITR; 30 kun; boshqa joyda (tashqi S3); tiklash har chorakda sinaladi |
| Tiklanish | RPO 15 daqiqa, RTO 4 soat |
| Masshtab | 1 000 tashkilot, 1 mln a'zo, soatiga 50 000 kirish |
| Oflayn | Qabulxona paneli internet uzilganda kirishni tekshira oladi (MVP: 10 daqiqa, v1: 24 soat agent bilan) |
| Tillar | uz, ru, en; tarjimalar alohida fayllarda; RTL ga tayyor |
| Mahalliylashtirish | Valyuta, sana va son formati, vaqt mintaqasi, hafta boshi har filial uchun |
| Brauzerlar | Chrome, Safari, Edge, Firefox oxirgi 2 versiya; 360 px dan |
| Qulaylik | WCAG 2.1 AA; qabulxona amallari klaviatura bilan |
| Kuzatuv | Markazlashgan loglar, metrikalar, Sentry, ogohlantirishlar |
| Kod sifati | Biznes mantiqida 70%+ test qamrovi; CI da lint, typecheck, test |

## 5. Arxitektura

Modulli monolit. Web panel, a'zo PWA va agent faqat API bilan gaplashadi; baza, navbat va fayllarga faqat API kiradi.

### 5.1. Ko'p mijozlilik
- Bitta baza, umumiy sxema, har biznes jadvalida `organization_id`.
- PostgreSQL RLS: `USING (organization_id = current_setting('app.current_org')::uuid)`.
- Ilova bazaga RLS ga bo'ysunadigan rol bilan ulanadi (superuser emas, `BYPASSRLS` yo'q). Migratsiya va `platform` moduli uchun alohida rol.
- Tashkilot JWT dan va subdomendan (`<slug>.gatefit.uz`) aniqlanadi; ikkalasi mos kelishi shart.
- Har so'rov tranzaksiyada: `SELECT set_config('app.current_org', $1, true)`.

### 5.2. Backend modullari
- `auth`: kirish, tokenlar, rollar, ruxsatlar
- `tenancy`: tashkilotlar, filiallar, sozlamalar
- `members`: a'zolar, import va eksport
- `plans`: tariflar, abonementlar, muzlatish
- `access`: QR, kirish jurnali, qurilmalar, agentlar
- `billing`: to'lovlar, hisob-fakturalar, kassa, provayder adapterlari
- `schedule` (v1), `staff`, `crm` (v1)
- `notifications`: shablonlar, kanallar, navbat
- `reports`: agregatlar, eksport
- `platform`: super-admin, SaaS tariflari, limitlar

### 5.3. Fon vazifalari
- Har soatda: muddati tugagan abonementlar holati (filial vaqt mintaqasi bo'yicha).
- Har kuni: eslatmalar, hisobot agregatlari.
- Hodisa bo'yicha: xabar yuborish, chek, eksport fayllari.
- Barcha vazifalar idempotent.

### 5.4. Muhitlar
- dev, staging, production. Boshlanishda bitta o'z serverimiz (Docker Compose, Caddy).
- CI: lint, typecheck, test, build. Staging ga avtomatik, production ga qo'lda tasdiq bilan.
- Migratsiyalar orqaga mos.

## 6. Ma'lumotlar modeli

Barcha biznes jadvallarida: `id` (UUID v7), `organization_id`, `created_at`, `updated_at`, `deleted_at`. Jadval va ustun nomlari snake_case.

| Jadval | Asosiy maydonlar | Bog'lanish | Bosqich |
| --- | --- | --- | --- |
| organizations | name, slug, country, currency, locale, status, saas_plan_id, trial_ends_at | — | M |
| locations | name, address, timezone, working_hours | organization | M |
| users | phone (E.164), email, password_hash, totp_secret | — | M |
| staff | position, status | user, organization, locations (M:N) | M |
| roles, role_permissions | name, permissions | organization | M |
| members | first_name, last_name, phone, birth_date, gender, photo_key, status, source, notes | organization, user?, home_location | M |
| plans | name, type, duration, visit_limit, price_minor, currency, restrictions (JSONB), is_active | organization | M |
| memberships | starts_at, ends_at, visits_left, status, auto_renew | member, plan | M |
| membership_freezes | starts_on, ends_on, reason | membership | M |
| check_ins | at, direction, method, result, deny_reason | member, location, device?, staff? | M |
| invoices, invoice_items | number, total_minor, tax_minor, status, due_at | member | M |
| payments | amount_minor, currency, method, provider, external_id, status, idempotency_key | invoice, cash_shift | M |
| refunds | amount_minor, reason | payment, staff | M |
| cash_shifts | opened_at, closed_at, opening_minor, closing_minor | location, staff | M |
| otp_codes, sessions | code_hash, expires_at, attempts; refresh_token_hash, user_agent | user | M |
| notification_templates, notifications | channel, body, status, sent_at | organization, member | M |
| consents | type, version, at, ip | member yoki organization | M |
| audit_logs | actor, action, entity, before, after, ip, at | organization | M |
| saas_plans | name, limits (JSONB), modules (JSONB), price_minor, currency | — | M |
| saas_subscriptions, saas_invoices | period, status | organization | M (qo'lda), 1 (avtomatik) |
| devices, agents | type, model, status, last_seen_at | location | 1 |
| products, stock_movements | name, price_minor, quantity | location | 1 |
| classes, class_sessions, bookings | — | — | 1 |
| pt_packages, pt_sessions | — | — | 1 |
| leads | name, phone, source, stage, next_contact_at | organization, staff | 1 |

Qoidalar:
- Bitta a'zoda bir nechta faol abonement bo'lishi mumkin; kirishda ustuvorlik: avval muddati ertaroq tugaydigani.
- `check_ins` va `audit_logs` faqat qo'shiladi; oy bo'yicha partition.
- Telefon tashkilot ichida yagona.
- To'lov yozuvlari o'chirilmaydi.

## 7. API

- `/api/v1/...`, JSON, OpenAPI avtomatik.
- Xodimlar: telefon va parol (+ TOTP owner va accountant uchun majburiy). A'zolar: telefon va SMS-kod.
- Access token JWT 15 daqiqa, refresh token aylanadigan (rotation), httpOnly cookie.
- Agent va integratsiyalar: API kalitlari (v1).
- Xato formati: `{ code, message, details }`.
- Ro'yxatlar: `?cursor=&limit=&sort=&filter[...]`.
- Tezlik cheklovi IP va foydalanuvchi bo'yicha; OTP va login alohida qattiqroq.

| Guruh | Endpoint | Bosqich |
| --- | --- | --- |
| Auth | POST /auth/login, /auth/otp/request, /auth/otp/verify, /auth/refresh, /auth/logout | M |
| Tashkilot | GET/PATCH /organization, GET/POST/PATCH /locations | M |
| Xodimlar | GET/POST/PATCH /staff, GET/POST/PATCH /roles | M |
| A'zolar | GET/POST /members, GET/PATCH /members/{id}, POST /members/import, GET /members/export | M |
| Tariflar | GET/POST /plans, PATCH /plans/{id} | M |
| Abonementlar | POST /members/{id}/memberships, POST /memberships/{id}/freeze, /unfreeze, /cancel | M |
| Kirish | GET /me/qr, POST /access/verify, POST /access/manual, GET /check-ins, GET /locations/{id}/occupancy | M |
| To'lovlar | POST /invoices, POST /invoices/{id}/payments, POST /payments/{id}/refund, GET /payments | M |
| Kassa | POST /cash-shifts/open, POST /cash-shifts/{id}/close, GET /cash-shifts/current | M |
| Hisobotlar | GET /reports/daily | M |
| A'zo | GET /me, GET /me/memberships, GET /me/payments | M |
| Platforma | GET/POST /platform/organizations, PATCH /platform/organizations/{id}, GET/POST /platform/saas-plans | M |
| Jadval, CRM, Agent, Webhooks | TZ ning v1 qismida | 1 |

`POST /access/verify`: QR tokenni qabul qiladi, imzo va muddatni, abonement, vaqt cheklovi, kunlik limit, muzlatish va qarzni tekshiradi, `check_ins` ga yozadi, `{ allowed, reason, member, membership }` qaytaradi. Javob 500 ms dan tez.

## 8. Integratsiyalar

Har biri interfeys (port) va drayverlar (adapter). MVP da har biri uchun `dev` drayveri bo'lishi shart.

| Yo'nalish | Provayderlar | Bosqich |
| --- | --- | --- |
| SMS | Eskiz, Play Mobile; dev: konsol | M |
| Fayl saqlash | S3 mos (MinIO) | M |
| Onlayn to'lov (UZ) | Payme, Click, Uzum | 1 |
| Onlayn to'lov (xalqaro) | Stripe | 2 |
| Fiskal chek | interfeys M da, drayver keyin | 1 |
| Telegram bot, WhatsApp, email, push | — | 1 |
| Turniket, RFID, qulflar | Wiegand, rele, ZKTeco, Hikvision (agent orqali) | 1 |
| Yuzni tanish | Terminal ichida | 2 |
| Buxgalteriya | 1C, QuickBooks, Xero | 2 |

MVP qurilmasiz ishlaydi: planshet kamerasi yoki USB skaner yetarli.

## 9. Xavfsizlik

- Parollar Argon2id. OTP kodlari xeshlangan, 5 urinish, 5 daqiqa.
- Ruxsatlar serverda har so'rovda.
- RLS avtomatik testlar bilan tekshiriladi.
- TLS 1.2+; zaxira nusxalar shifrlangan.
- Karta ma'lumotlari saqlanmaydi.
- Fayllarga kirish vaqtinchalik imzolangan havola orqali.
- Audit: 5-qoidaga qarang (`CLAUDE.md`). Super-adminning mijoz hisobiga kirishi alohida yoziladi.
- GDPR: rozilikni qayd etish, ma'lumotni eksport va o'chirish oqimi (v1), saqlash muddatlari.
- O'zbekiston: shaxsiy ma'lumotlar mamlakat ichidagi serverda (hozir o'z serverimiz).
- Biometriya (v2): alohida rozilik, shablon qurilmada, 30 kunda o'chirish, mamlakat bo'yicha o'chirib qo'yish.
- CI da bog'liqliklar zaifligi skaneri; OWASP Top 10 bo'yicha tekshiruv ro'yxati har relizda.

## 10. Bosqichlar

| Bosqich | Tarkibi | Tugash mezoni |
| --- | --- | --- |
| 0. Tayyorgarlik | Monorepo, Docker, CI, baza, auth, tenancy, RLS, i18n karkasi | Ikki sinov tashkiloti bir-birining ma'lumotini ko'rmaydi (test) |
| MVP | A'zolar, tariflar, abonementlar, muzlatish, QR kirish, qabulxona ekrani, naqd va terminal to'lovlari, kassa smenasi, kunlik hisobot, SMS, a'zo PWA, super-admin | 11-bo'lim mezonlari |
| v1 | Onlayn to'lov, jadval, shaxsiy mashg'ulotlar, komissiya, CRM, agent va oflayn, kengaytirilgan hisobotlar, o'z-o'zidan ro'yxatdan o'tish | 20+ zal |
| v2 | Native ilova, white-label, yuzni tanish, tarmoq abonementi, Stripe, buxgalteriya | Xorijiy mijozlar |

MVP ga kirmaydi: turniket, yuzni tanish, onlayn to'lov, jadval, CRM.

## 11. MVP qabul mezonlari

Har biri avtomatik test (integratsiya yoki e2e) bilan qoplanadi.

1. Yangi tashkilot va filial 30 daqiqada sozlanadi: tariflar, xodimlar, 500 a'zo importi.
2. Qabulxona 60 soniyada a'zo qo'shib, abonement sotadi va to'lov qabul qiladi.
3. A'zo SMS-kod bilan kiradi va QR-kodini ko'radi.
4. Faol abonementli a'zo QR bilan 1 soniyada o'tadi; muddati tugagan, muzlatilgan yoki vaqt cheklovidan tashqari a'zo sababi bilan rad etiladi.
5. Eski QR skrinshoti 60 soniyadan keyin ishlamaydi.
6. Abonement filial vaqt mintaqasi bo'yicha yarim tunda tugaydi, holat avtomatik o'zgaradi.
7. Muzlatish tugash sanasini to'g'ri suradi.
8. Kassa smenasi yopilganda naqd hisobot to'lovlar yig'indisiga teng.
9. Qaytarish faqat ruxsati bor xodimda ishlaydi va auditga yoziladi.
10. A tashkilot foydalanuvchisi B tashkilotning hech bir yozuvini ola olmaydi.
11. Internet 10 daqiqa uzilganda qabulxona ekrani kirishni tekshiradi va keyin sinxronlaydi.
12. Zaxira nusxadan to'liq tiklash bajarilgan.
13. Interfeys uz, ru, en tillarida to'liq.
14. 100 bir vaqtdagi foydalanuvchi bilan yuklama testi 4-bo'lim talablariga javob beradi.

## 12. SaaS tariflari

Uchta qat'iy tarif, to'lov har filial uchun oylik, har tarifda faol a'zolar limiti. Narx va limitlar kodda emas, `saas_plans` jadvalida va super-admin panelida.

| Tarif | Faol a'zolar (bir filialda) | Modullar |
| --- | --- | --- |
| Start | 200 gacha | A'zolar, abonementlar, QR kirish, to'lovlar, kassa, kunlik hisobot, a'zo PWA |
| Standard | 1 000 gacha | Start + onlayn to'lov, jadval, shaxsiy mashg'ulotlar, CRM, kengaytirilgan hisobotlar |
| Pro | Cheklanmagan | Standard + turniket, tarmoq abonementi, API va vebhuklar |

- Sinov 14 kun, karta talab qilinmaydi. Yillik to'lovda 2 oy bepul.
- Faol a'zo: joriy oyda amal qiluvchi abonementi bor a'zo.
- Limit oshsa tizim bloklamaydi: ogohlantiradi va 7 kun ichida tarifni oshirishni so'raydi.
- Har so'rovda modul yoqilganini tekshiruvchi guard (`@RequireModule('schedule')`).
- Narx summalari hali tasdiqlanmagan, seed da taxminiy qiymat.

## 13. Qabul qilingan qarorlar

- Backend NestJS, ORM Prisma, monorepo pnpm + Turborepo.
- Birinchi bozor O'zbekiston: valyuta UZS, tillar uz va ru, en ham boshidan.
- Server: o'z serverimiz, Docker Compose. Ko'chirish oson bo'lishi shart.
- Fiskal chek MVP da yo'q, faqat interfeys.
- Eski Yii2 tizimidan ko'chirish yo'q, faqat Excel/CSV import.
- Jamoa: bir dasturchi va Claude Code.
- Demo ma'lumotli sinov tashkiloti seed da bo'ladi (sotuv namoyishi uchun).
- Ro'yxatdan o'tishda ofertaga rozilik `consents` ga yoziladi.
