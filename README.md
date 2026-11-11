# Gatefit

Trenajor zallari, fitnes klublar va studiyalar uchun bulutli (SaaS) boshqaruv platformasi.

- Talablar: [docs/TZ.md](docs/TZ.md)
- Bosqichlar va promptlar: [docs/PROMPTS.md](docs/PROMPTS.md)
- Bajarilgan ishlar: [docs/PROGRESS.md](docs/PROGRESS.md)
- Ish qoidalari: [CLAUDE.md](CLAUDE.md)

## Tuzilma

```
apps/api        NestJS backend (REST, /api/v1, Swagger)
apps/web        boshqaruv paneli (Next.js, Tailwind, shadcn/ui)
apps/member     a'zo PWA (Next.js)
packages/shared umumiy tiplar, zod sxemalar, xato kodlari
packages/i18n   tarjimalar: uz, ru, en
infra           docker-compose fayllari
docs            TZ, promptlar, jurnal
```

## Talab qilinadi

- Node.js 22 yoki undan yuqori (`.nvmrc` da 22)
- pnpm 12 (`npm install -g pnpm`)
- Docker Desktop (PostgreSQL, Redis, MinIO uchun)

## Noldan ishga tushirish

```bash
# 1. Bog'liqliklar
pnpm install

# 2. Muhit o'zgaruvchilari (Windows PowerShell: Copy-Item .env.example .env)
cp .env.example .env

# 3. PostgreSQL 16, Redis 7, MinIO
pnpm infra:up

# 4. Baza migratsiyalari
pnpm --filter api prisma migrate dev

# 5. Barcha ilovalar
pnpm dev
```

Shundan keyin:

| Nima             | Manzil                              |
| ---------------- | ----------------------------------- |
| Boshqaruv paneli | http://localhost:3000               |
| A'zo ilovasi     | http://localhost:3001               |
| API health       | http://localhost:8000/api/v1/health |
| Swagger          | http://localhost:8000/api/docs      |
| MinIO konsoli    | http://localhost:9001               |

MinIO konsoliga kirish ma'lumotlari `.env` dagi `S3_ACCESS_KEY` va `S3_SECRET_KEY`.

## Buyruqlar

```bash
pnpm dev                    # barcha ilovalar (watch rejimida)
pnpm --filter api dev       # faqat bitta ilova: api, web yoki member
pnpm lint                   # ESLint
pnpm typecheck              # TypeScript
pnpm test                   # birlik va integratsiya testlari (PostgreSQL va Redis ishlab turishi kerak)
pnpm build                  # production build
pnpm format                 # Prettier

pnpm infra:up               # docker servislarni ko'tarish
pnpm infra:down             # to'xtatish (ma'lumot saqlanadi)

pnpm --filter api prisma migrate dev --name <nom>   # yangi migratsiya
pnpm --filter api prisma migrate deploy             # migratsiyalarni qo'llash (CI, server)
pnpm --filter api prisma studio                     # bazani ko'rish
```

## Bilib qo'yish kerak

- **Bitta `.env`.** Fayl repozitoriy ildizida turadi; API, Prisma va docker-compose shuni o'qiydi. API ishga tushganda barcha o'zgaruvchilarni tekshiradi va xato bo'lsa qaysi biri noto'g'riligini aytib to'xtaydi.
- **Portlar.** API 8000-portda. Windows'da Hyper-V/Docker ayrim port oraliqlarini band qiladi (masalan 3345–4144), shu sabab 4000 ishlatilmadi. Port band bo'lsa `.env` da `API_PORT`, `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_PORT` ni o'zgartiring. Band oraliqlarni ko'rish: `netsh interface ipv4 show excludedportrange protocol=tcp`.
- **Tarjimalar.** Interfeys matni faqat `packages/i18n/src/{uz,ru,en}.json` da. Uch fayldagi kalitlar bir xil bo'lishi test bilan tekshiriladi. Tanlangan til `gatefit_locale` cookie'sida saqlanadi.
- **Umumiy paketlar.** `packages/*` o'zgarsa `pnpm dev` ularni o'zi qayta yig'adi. Alohida ilovani ishga tushirayotgan bo'lsangiz avval `pnpm build --filter "./packages/*"`.
- **Prisma mijozi.** `apps/api/src/generated` git'ga kirmaydi; `pnpm install` uni o'zi yaratadi.
