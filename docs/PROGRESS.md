# Gatefit: ishlar jurnali

Har sessiya oxirida yangilanadi: nima qilindi, nima qoldi, ma'lum muammolar.

## Holat

| Bosqich                           | Holat               |
| --------------------------------- | ------------------- |
| 0.1 Loyiha karkasi                | Tayyor (2026-11-11) |
| 0.2 Ko'p mijozlilik va RLS        | Tayyor (2026-11-11) |
| 0.3 Autentifikatsiya va ruxsatlar | Boshlanmagan        |
| MVP (M1–M8)                       | Boshlanmagan        |

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
