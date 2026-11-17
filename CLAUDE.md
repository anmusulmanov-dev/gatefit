# Gatefit

Trenajor zallari, fitnes klublar va studiyalar uchun bulutli (SaaS) boshqaruv platformasi. Bitta kod, bitta baza, ko'p mijoz (multi-tenant). Birinchi bozor O'zbekiston, keyin boshqa mamlakatlar. Domen: gatefit.uz.

To'liq talablar: `docs/TZ.md`. Bosqichlar va har bosqich uchun promptlar: `docs/PROMPTS.md`. Bajarilgan ishlar jurnali: `docs/PROGRESS.md` (har sessiya oxirida yangilanadi).

## Muloqot tili

- Men (Anvar) bilan o'zbek tilida, qisqa va aniq gaplash.
- Kod, o'zgaruvchi nomlari, kommentlar, commit xabarlari, API va baza nomlari faqat ingliz tilida.
- Foydalanuvchi interfeysi matnlari hech qachon kodga qattiq yozilmaydi: faqat tarjima fayllari orqali (uz, ru, en).

## Stack (o'zgartirilmaydi, o'zgartirish kerak bo'lsa avval so'ra)

- Monorepo: pnpm workspaces + Turborepo, Node.js 22, TypeScript strict.
- Backend: NestJS (`apps/api`), REST, OpenAPI (Swagger) avtomatik.
- Baza: PostgreSQL 16, Prisma ORM, migratsiyalar `prisma migrate`. RLS siyosatlari qo'lda yozilgan SQL migratsiyalarda.
- Kesh va navbat: Redis 7, BullMQ.
- Web panel: Next.js (App Router), React, Tailwind, shadcn/ui (`apps/web`).
- A'zo ilovasi: Next.js PWA (`apps/member`).
- Umumiy kod: `packages/shared` (zod sxemalar, tiplar, konstantalar), `packages/i18n` (tarjimalar).
- Validatsiya: zod. Bitta sxema backend va frontendda ishlatiladi.
- Testlar: Jest (birlik va integratsiya, API), Playwright (e2e).
- Infratuzilma: Docker Compose (dev va prod), Caddy (TLS), GitHub Actions (CI/CD).
- Fayllar: S3 mos saqlash (devda MinIO).

## Repozitoriy tuzilmasi

```
apps/
  api/        NestJS backend
    src/modules/<module>/   auth, tenancy, members, plans, access, billing,
                            schedule, staff, crm, notifications, reports, platform
    src/common/             guards, interceptors, filters, decorators, tenancy context
    prisma/                 schema.prisma, migrations, seed
    test/                   integratsiya testlari
  web/        boshqaruv paneli (xodimlar va super-admin)
  member/     a'zo PWA
  agent/      mahalliy agent (v1, hozircha yo'q)
packages/
  shared/     zod sxemalar, tiplar, xato kodlari
  i18n/       uz.json, ru.json, en.json
docs/         TZ.md, PROMPTS.md, PROGRESS.md, ADR/
infra/        docker-compose.*.yml, Caddyfile, backup skriptlari
```

## Buyruqlar

Barchasi repozitoriy ildizidan ishga tushiriladi. Muhit: ildizdagi bitta `.env` (`.env.example` dan nusxa).

```
pnpm install                 # bog'liqliklar + prisma generate
pnpm infra:up                # postgres, redis, minio (docker compose -f infra/docker-compose.dev.yml up -d)
pnpm infra:down
pnpm dev                     # barcha ilovalar: web :3000, member :3001, api :8000
pnpm --filter api dev        # bitta ilova: api | web | member
pnpm lint && pnpm typecheck
pnpm test                    # birlik va integratsiya (postgres va redis ishlab turishi kerak)
pnpm --filter api test       # bitta paket; bitta fayl: pnpm --filter api test -- health
pnpm build
pnpm format                  # prettier --write; tekshirish: pnpm format:check
pnpm --filter api prisma migrate dev --name <nom>   # yangi migratsiya
pnpm --filter api prisma migrate deploy             # CI va server
pnpm --filter api prisma generate                   # sxema o'zgargach (migrate dev o'zi qilmaydi)
pnpm --filter api seed                              # demo tashkilot, filiallar, rollar (idempotent)
```

- API: `http://localhost:8000/api/v1`, Swagger: `/api/docs`, health: `/api/v1/health`.
- Testlar: `*.spec.ts` kod yonida (birlik), `apps/api/test/*.int-spec.ts` (integratsiya, haqiqiy baza bilan).
- `packages/*` `dist` ga yig'iladi; turbo `lint`, `typecheck`, `test`, `dev` dan oldin ularni o'zi yig'adi.
- Baza rollari: API `gatefit_app` (`DATABASE_URL`, RLS ostida), migratsiya va seed `gatefit_migrator` (`DATABASE_ADMIN_URL`). Testlar `gatefit_test` bazasida, har ishga tushishda tozalanadi.
- Tashkilot ma'lumotiga faqat `TenantDb.run(orgId, fn)` yoki so'rov ichida `tenantDb.tx` orqali. `PrismaService` ni to'g'ridan-to'g'ri ishlatma: RLS bo'sh natija qaytaradi. Qarang: `docs/ADR/0001-multi-tenancy.md`.
- Yangi jadval: `organization_id`, kompozit FK `(organization_id, id)`, qo'lda SQL migratsiyada `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` siyosati + `GRANT ... TO gatefit_app`.
- `prisma migrate dev` ni doim `--name` bilan chaqir: nomsiz chaqirilsa interaktiv savolda osilib qoladi.
- Har endpoint aynan bitta belgi oladi: `@Public()`, `@AnyAuthenticated()` yoki `@RequirePermission(...)` (`src/modules/auth/auth.decorators.ts`). Ruxsatlar ro'yxati: `packages/shared/src/permissions.ts`. Qarang: `docs/ADR/0002-authentication.md`.
- Tashkilot subdomendan aniqlanadi: devda `http://demo.localhost:3000`. Testlarda `Host` sarlavhasi (`test/support/app.ts` dagi `hostOf`).
- `users` — faqat shaxs (telefon); API unga yozmaydi, yangi yozuv `auth_find_or_create_user()` orqali. Xodim paroli va TOTP si `staff` da (har tashkilot uchun alohida), ularni faqat `StaffCredentialsService` o'qiydi. Qarang: `docs/ADR/0003-staff-credentials.md`.
- Ruxsatga oid o'zgarishda chaqiruvchi faqat o'zida bor ruxsatlarni bera oladi (`holdsAll`). O'zgarishni `AuditService.record` bilan shu tranzaksiyada yoz.
- Ro'yxat endpointi: `pageQuerySchema` + `pageArgs` / `toPage` (`src/common/pagination`). Testda sessiya: `cookiesFor` va `apiAs` (`test/support/app.ts`).
- So'rov tranzaksiyasi ichida unique xatosini ushlab davom etib bo'lmaydi (tranzaksiya buziladi): avval tekshir, keyin yoz.
- So'rov tanasi: `@Body(new ZodPipe(schema))`, sxema `packages/shared` da. Vaqt: `Clock` servisi.
- Playwright e2e (`pnpm --filter api test:e2e`) hali yo'q: birinchi foydalanuvchi oqimi bilan qo'shiladi.
- API porti 4000 emas, 8000: Windows'da 3345–4144 oralig'i Hyper-V tomonidan band bo'lishi mumkin.

## Buzilmaydigan qoidalar

1. **Tashkilotlarni ajratish.** Har biznes jadvalida `organization_id` bor va PostgreSQL RLS yoqilgan. Har so'rov tranzaksiya ichida `set_config('app.current_org', <id>, true)` bilan ishlaydi. RLS ni chetlab o'tadigan ulanish faqat `platform` modulida va migratsiyalarda. Yangi jadval qo'shsang: RLS siyosati va "A tashkilot B ni ko'rmaydi" testi majburiy.
2. **Pul.** Summalar butun son, eng kichik birlikda (tiyin, sent), yonida `currency` (ISO 4217). `float` va `number` bilan pul hisoblanmaydi. To'lov yozuvlari o'chirilmaydi va tahrirlanmaydi: tuzatish faqat `refund` yoki teskari yozuv.
3. **Vaqt.** Bazada faqat UTC (`timestamptz`). Muddat va cheklovlar filialning `timezone` qiymati bo'yicha hisoblanadi. `new Date()` biznes mantiqida to'g'ridan-to'g'ri ishlatilmaydi: `Clock` servisi orqali (testda almashtirish uchun).
4. **Ruxsatlar.** Har endpointda `@RequirePermission(...)`. Frontendda yashirish himoya emas.
5. **Audit.** To'lov, qaytarish, abonement o'zgarishi, qo'lda kiritish va ruxsat o'zgarishlari `audit_logs` ga yoziladi. `audit_logs` va `check_ins` faqat qo'shiladi.
6. **Idempotentlik.** Pul amallari `Idempotency-Key` sarlavhasini talab qiladi. Fon vazifalari takror ishga tushsa zarar qilmaydi.
7. **Modul chegaralari.** Modul boshqa modulning jadvaliga to'g'ridan-to'g'ri murojaat qilmaydi, faqat uning eksport qilingan servisi orqali.
8. **Tashqi xizmatlar adapter ortida.** SMS, to'lov, fiskal chek, fayl saqlash: har biri interfeys va kamida `dev` (konsol yoki soxta) drayveri bilan.
9. **Maxfiy ma'lumot.** Kalit va parollar faqat `.env` da, `.env.example` yangilanadi. Karta ma'lumotlari saqlanmaydi. Loglarga telefon, parol, token, OTP yozilmaydi.
10. **O'chirish.** Yumshoq o'chirish (`deleted_at`). Qattiq `DELETE` faqat GDPR o'chirish so'rovi oqimida.

## Kod uslubi

- ESLint + Prettier, `any` taqiqlangan, `strict: true`.
- Kontroller yupqa: validatsiya va servisni chaqirish. Mantiq servisda, baza bilan ish repository yoki Prisma servisida.
- Xatolar yagona formatda: `{ code, message, details }`. Kodlar `packages/shared/errors.ts` da.
- Ro'yxat endpointlari kursor bilan sahifalanadi.
- Har ommaviy servis metodiga birlik testi, har endpointga kamida bitta integratsiya testi.
- Commitlar Conventional Commits: `feat(members): ...`, `fix(access): ...`. Bitta commit bitta mantiqiy o'zgarish.

## Ish tartibi

1. Vazifani boshlashdan oldin `docs/TZ.md` dagi tegishli talab (F-raqam) va `docs/PROGRESS.md` ni o'qi.
2. Ikki-uch qadamdan ko'p ish bo'lsa, avval qisqa reja ko'rsat va tasdiq kut. Kichik ishni darhol bajar.
3. Faqat joriy bosqich doirasida ishla. MVP da v1 va v2 funksiyalarini yozma, lekin ularga joy qoldir (adapter, enum, jadval ustuni).
4. Tugatishdan oldin: `pnpm lint && pnpm typecheck && pnpm test` yashil bo'lsin. Yashil bo'lmasa "tayyor" dema.
5. Baza sxemasi o'zgarsa: migratsiya, RLS, seed va test birga.
6. Muhim arxitektura qarori bo'lsa `docs/ADR/NNNN-nom.md` yoz (5-10 qator).
7. Sessiya oxirida `docs/PROGRESS.md` ga yoz: nima qilindi, nima qoldi, ma'lum muammolar.
8. TZ bilan ziddiyat yoki noaniqlik bo'lsa taxmin qilma, so'ra. Paket qo'shishdan oldin sababini ayt.
9. `main` ga to'g'ridan-to'g'ri yozma: har vazifa alohida branch va PR.
