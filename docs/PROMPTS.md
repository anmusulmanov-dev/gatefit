# Gatefit: Claude Code uchun promptlar

Har prompt alohida sessiyada yoki alohida vazifa sifatida beriladi. Tartibni buzmang: har biri oldingisining natijasiga tayanadi. Har vazifadan keyin kodni ko'rib chiqing, testlar yashil ekanini tekshiring va PR ni birlashtiring.

Har sessiya boshida Claude Code `CLAUDE.md` ni o'zi o'qiydi. Katta vazifada `/plan` rejimidan foydalaning: avval reja, tasdiqdan keyin kod.

---

## 0-bosqich: tayyorgarlik

### 0.1. Loyiha karkasi

```
docs/TZ.md va CLAUDE.md ni o'qi. 0-bosqichning birinchi qismini bajar: loyiha karkasi.

Kerak:
1. pnpm workspaces + Turborepo monorepo, CLAUDE.md dagi tuzilma bo'yicha: apps/api (NestJS), apps/web (Next.js App Router, Tailwind, shadcn/ui), apps/member (Next.js PWA), packages/shared, packages/i18n.
2. TypeScript strict, ESLint, Prettier, umumiy tsconfig.
3. infra/docker-compose.dev.yml: PostgreSQL 16, Redis 7, MinIO. .env.example.
4. apps/api: konfiguratsiya moduli (zod bilan env validatsiyasi), /api/v1/health endpointi, Swagger, yagona xato filtri ({code, message, details}), so'rov ID va strukturali log.
5. Prisma ulangan, bo'sh boshlang'ich migratsiya.
6. packages/i18n: uz.json, ru.json, en.json va web hamda member ilovalarida til almashtirish ishlaydi.
7. GitHub Actions: lint, typecheck, test, build.
8. README.md: loyihani noldan ishga tushirish qadamlari.

Hali biznes mantiq yozma. Avval reja ko'rsat, men tasdiqlagach boshla. Oxirida CLAUDE.md dagi "Buyruqlar" bo'limini haqiqiy buyruqlar bilan yangila va docs/PROGRESS.md ni yarat.
```

### 0.2. Ko'p mijozlilik va RLS

```
docs/TZ.md 5.1 va 6-bo'lim, CLAUDE.md "Buzilmaydigan qoidalar" 1-band.

Kerak:
1. Jadvallar: organizations, locations, users, staff, staff_locations, roles, role_permissions, audit_logs, consents.
2. Ikki baza roli: app (RLS ga bo'ysunadi) va migrator/platform (chetlab o'tadi). Ilova app roli bilan ulanadi.
3. Har biznes jadvalida RLS siyosati (qo'lda SQL migratsiya).
4. TenancyContext: so'rov boshida tashkilotni aniqlaydi va har Prisma so'rovini set_config('app.current_org', ...) bilan tranzaksiyaga o'raydi.
5. Yangi jadval qo'shilganda RLS unutilmasligi uchun test: sxemadagi organization_id li har jadvalda RLS yoqilganini tekshiradi.
6. Integratsiya testi: A va B tashkilot yaratiladi, A konteksti B yozuvlarini o'qiy olmaydi, yoza olmaydi, o'zgartira olmaydi.
7. Seed: demo tashkilot, 2 filial, standart rollar.

RLS ni Prisma bilan qanday ulashni docs/ADR/0001-multi-tenancy.md da qisqa yoz.
```

### 0.3. Autentifikatsiya va ruxsatlar

```
docs/TZ.md 2, 7 va 9-bo'limlar.

Kerak:
1. Xodimlar: telefon + parol (Argon2id), ixtiyoriy TOTP (owner va accountant uchun majburiy).
2. A'zolar: telefon + SMS-kod. SmsProvider interfeysi va dev drayveri (kodni logga yozadi). OTP xeshlangan, 5 daqiqa, 5 urinish.
3. Access token (JWT, 15 daqiqa) va aylanadigan refresh token (httpOnly cookie), sessions jadvali, logout va barcha sessiyalarni tugatish.
4. Ruxsatlar: packages/shared da permissions ro'yxati, @RequirePermission dekoratori va guard, standart rollar seed da.
5. Tezlik cheklovi: login va OTP uchun qattiq, qolganlari uchun umumiy.
6. apps/web: login sahifasi, himoyalangan layout, joriy foydalanuvchi va filial tanlash.
7. apps/member: telefon va kod bilan kirish.
8. Testlar: muvaffaqiyatli va muvaffaqiyatsiz kirish, token aylanishi, ruxsatsiz endpoint 403 qaytaradi.

Tugagach 0-bosqich mezonini tekshir: ikki sinov tashkiloti bir-birining ma'lumotini ko'rmaydi.
```

---

## MVP

### M1. Tashkilot sozlamalari va xodimlar

```
TZ F-6.1, F-10.1, F-10.2 va 12-bo'lim.

Backend: /organization, /locations, /staff, /roles endpointlari; platform moduli: /platform/organizations, /platform/saas-plans, saas_plans va saas_subscriptions jadvallari, limit va modul tekshiruvi (@RequireModule, faol a'zolar limiti hisoblagichi).
Web: sozlamalar bo'limi (tashkilot, filiallar, xodimlar, rollar), super-admin paneli (tashkilotlar ro'yxati, yaratish, bloklash, sinov muddati, tarif biriktirish).
Seed: Start, Standard, Pro tariflari taxminiy narx bilan.
Har endpointga integratsiya testi.
```

### M2. A'zolar

```
TZ F-1.1 dan F-1.4 gacha.

Backend: members jadvali va CRUD, telefon E.164 ga keltiriladi, tashkilot ichida yagona, takrorlanish haqida ogohlantirish, qidiruv (ism, telefon), kursor bilan sahifalash, foto yuklash (S3 imzolangan havola), CSV/XLSX import (oldindan ko'rish, xatolar ro'yxati, fon vazifasi) va eksport.
Web: a'zolar ro'yxati (qidiruv, filtrlar, holat belgisi), a'zo kartasi, qo'shish va tahrirlash formasi, import ustasi.
Qabul mezoni 1 ning import qismi: 500 a'zoli fayl xatosiz yuklanadi (test).
```

### M3. Tariflar, abonementlar, muzlatish

```
TZ F-2.1 dan F-2.4 gacha, 6-bo'lim qoidalari.

Backend: plans (turlar va restrictions JSONB uchun zod sxema), memberships (sotish, boshlanish va tugash sanasini hisoblash, holatlar), membership_freezes (tugash sanasini suradi, limit), soatlik fon vazifasi: filial vaqt mintaqasi bo'yicha muddati tugaganlarni expired ga o'tkazadi va a'zo holatini yangilaydi.
Barcha sana mantiqi Clock servisi orqali va alohida sof funksiyalarda. Birlik testlari: oy oxiri, kabisa yili, vaqt mintaqasi chegarasi, muzlatish ustma-ust tushishi.
Web: tariflar ro'yxati va formasi, a'zo kartasida abonementlar bo'limi, sotish va muzlatish dialoglari.
Qabul mezonlari 6 va 7 testlar bilan.
```

### M4. To'lovlar va kassa

```
TZ F-4.1 dan F-4.4 gacha, CLAUDE.md 2, 5, 6-qoidalar.

Backend: invoices, invoice_items, payments (naqd, terminal, o'tkazma; qisman to'lov; Idempotency-Key), refunds (alohida ruxsat, audit), cash_shifts (ochish, yopish, kutilgan va haqiqiy qoldiq farqi). Abonement sotish va to'lov bitta tranzaksiyada. Chek: oddiy chop etiladigan sahifa va SMS matni. FiscalProvider interfeysi va bo'sh dev drayveri.
Web: abonement sotish oqimi (tarif tanlash, to'lov, chek) 60 soniyada bajariladigan qilib, to'lovlar jurnali, qaytarish, kassa smenasi sahifasi.
Qabul mezonlari 2, 8, 9 testlar bilan. Pul hisob-kitobi uchun birlik testlari.
```

### M5. Kirish nazorati

```
TZ F-3.1 dan F-3.4 gacha, 7-bo'limdagi /access/verify tavsifi.

Backend: QR token (a'zo ID va vaqt oynasi, HMAC imzo, 30 soniyalik oyna, 60 soniyadan keyin yaroqsiz), /me/qr, /access/verify (abonement tanlash ustuvorligi, vaqt va kun cheklovi, kunlik limit, muzlatish, qarz), /access/manual (sabab majburiy), check_ins (oy bo'yicha partition), zaldagi odamlar soni, WebSocket orqali qabulxona ekraniga jonli yangilanish.
Web: qabulxona ekrani (kamera yoki USB skaner, a'zo fotosi, katta yashil yoki qizil natija, rad sababi, oxirgi kirishlar), kirish jurnali.
Oflayn: qabulxona ekrani faol a'zolar ro'yxatini va QR kalitini IndexedDB da saqlaydi, internet uzilganda mahalliy tekshiradi, kirishlarni navbatga yozadi va qayta ulanib yuboradi.
Qabul mezonlari 4, 5, 11 testlar bilan. /access/verify uchun tezlik testi (p95 < 500 ms).
```

### M6. A'zo PWA

```
TZ F-9.1.

apps/member: kirish, bosh sahifa (QR kod avtomatik yangilanadi, abonement holati va qolgan kun), abonementlar tarixi, to'lovlar tarixi, profil, til almashtirish. PWA manifest, bosh ekranga o'rnatish, QR sahifasi oxirgi tokenlar bilan qisqa oflayn ishlaydi. 360 px ekranda sinab ko'r.
Qabul mezoni 3 e2e test bilan.
```

### M7. Xabarnomalar va kunlik hisobot

```
TZ F-4.2, F-8.1.

Backend: notifications moduli (shablonlar uz, ru, en; navbat; qayta urinish; yuborilganlar jurnali), Eskiz SMS drayveri (dev drayveri saqlanadi), muddat tugashiga 3 kun qolganda eslatma (kunlik vazifa), /reports/daily (tushum to'lov usullari bo'yicha, yangi a'zolar, tashriflar, muddati tugayotganlar; filial va sana bo'yicha).
Web: bosh sahifa (kunlik ko'rsatkichlar), xabar shablonlari sozlamasi.
```

### M8. Yakunlash

```
MVP ni yakunla:
1. docs/TZ.md 11-bo'limdagi 14 mezonni birma-bir tekshir, har biri uchun test borligini ko'rsat, yo'qlarini yoz.
2. Uch tilda tarjima to'liqligini tekshiruvchi skript va CI qadami.
3. infra/docker-compose.prod.yml, Caddyfile (gatefit.uz va *.gatefit.uz), zaxira nusxa skripti (pg_dump + WAL, tashqi S3 ga), tiklash yo'riqnomasi docs/RUNBOOK.md da.
4. k6 yoki autocannon bilan yuklama testi: 100 bir vaqtdagi foydalanuvchi.
5. Demo tashkilot seed: 300 a'zo, tariflar, bir oylik to'lov va kirishlar.
6. Xavfsizlik tekshiruv ro'yxati (OWASP Top 10) bo'yicha o'tib chiq va topilganlarni docs/PROGRESS.md ga yoz.
Hech narsani "tayyor" dema, agar test bilan isbotlanmagan bo'lsa.
```

---

## Doimiy ishlatiladigan promptlar

Kodni ko'rib chiqish:
```
Oxirgi PR dagi o'zgarishlarni CLAUDE.md "Buzilmaydigan qoidalar" bo'yicha tekshir. Har qoida uchun: buzilgan joy bormi, fayl va qator bilan ayt. Keyin test qamrovidagi bo'shliqlarni sanab ber. Hech narsani o'zgartirma, faqat hisobot.
```

Xatoni tuzatish:
```
Muammo: <nima bo'lyapti, qanday takrorlash>. Avval xatoni takrorlaydigan test yoz, keyin sababini top va tuzat. Tuzatishdan oldin sababni menga bir-ikki gapda tushuntir.
```

Sessiyani davom ettirish:
```
docs/PROGRESS.md ni o'qi va qayerda to'xtaganimizni ayt. Keyingi vazifa: docs/PROMPTS.md dagi <M3> bo'limi. Reja ko'rsat.
```

Yangi talab qo'shish:
```
Yangi talab: <tavsif>. docs/TZ.md ning qaysi bo'limiga tegishli ekanini ayt, qaysi bosqichga qo'yishni taklif qil, ta'sir qiladigan modul va jadvallarni sanab ber. Men tasdiqlagach TZ ni yangila, keyin kod.
```
