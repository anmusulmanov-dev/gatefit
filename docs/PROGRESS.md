# Gatefit: ishlar jurnali

Har sessiya oxirida yangilanadi: nima qilindi, nima qoldi, ma'lum muammolar.

## Holat

| Bosqich                           | Holat                            |
| --------------------------------- | -------------------------------- |
| 0.1 Loyiha karkasi                | Tayyor (2026-11-11)              |
| 0.2 Ko'p mijozlilik va RLS        | Tayyor (2026-11-11)              |
| 0.3 Autentifikatsiya va ruxsatlar | Tayyor (2026-11-17)              |
| MVP (M1–M8)                       | Boshlanmagan                     |
| M1a Tashkilot ichki API           | Tayyor (2026-11-17)              |
| M1b Platforma API                 | Tayyor (2026-11-17)              |
| M1c Sozlamalar UI                 | Tayyor (2026-11-17)              |
| M1d Super-admin UI                | Tayyor (2026-11-17) — M1 yopildi |

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
