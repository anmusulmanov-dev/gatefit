# ADR 0001: Ko'p mijozlilik — PostgreSQL RLS va Prisma

Sana: 2026-11-11. Holat: qabul qilingan.

## Kontekst

Bitta baza, umumiy sxema, har biznes jadvalida `organization_id` (TZ 5.1). Ajratish ilova kodidagi `WHERE` ga emas, bazaning o'ziga tayanishi kerak: bitta unutilgan filtr boshqa zalning ma'lumotini ochib qo'ymasligi shart.

## Qaror

1. **Ikki baza roli.** `gatefit_app` — API shu rol bilan ulanadi; superuser emas, `BYPASSRLS` yo'q, hech bir jadval egasi emas, shuning uchun RLS unga doim amal qiladi. `gatefit_migrator` — jadvallar egasi; migratsiya, seed va (M1 dan) `platform` moduli shu rol bilan ishlaydi va RLS dan tashqarida. Rollar migratsiyada emas, `infra/postgres/init.sh` da yaratiladi (parol maxfiy).
2. **Siyosat.** Har jadvalda `tenant_isolation`: `organization_id = app_current_org()` ham `USING`, ham `WITH CHECK` da. `app_current_org()` sozlama o'rnatilmagan bo'lsa `NULL` qaytaradi, ya'ni kontekstsiz so'rov hech narsa ko'rmaydi va yoza olmaydi.
3. **Prisma bilan ulash.** `TenantDb.run(orgId, fn)` interaktiv tranzaksiya ochadi, birinchi buyruq sifatida `SELECT set_config('app.current_org', $1, true)` ni bajaradi va `fn` ga shu tranzaksiya mijozini beradi. Sozlama tranzaksiyaga lokal, shuning uchun ulanishlar hovuzi orqali boshqa so'rovga o'tib ketmaydi. HTTP da `TenantTransactionInterceptor` butun so'rovni bitta shunday tranzaksiyaga o'raydi; kod `tenantDb.tx` orqali ishlaydi.
4. **Huquqlar jadvalma-jadval beriladi.** Biznes jadvallarida `DELETE` yo'q (yumshoq o'chirish), `organizations` ga `INSERT` yo'q, `audit_logs` va `consents` faqat `INSERT` va `SELECT`. Yangi jadval migratsiyada huquq berilmaguncha API uchun yopiq.
5. **Kompozit tashqi kalitlar.** Bola jadval ota jadvalga `(organization_id, id)` bilan bog'lanadi: qator boshqa tashkilot qatoriga ishora qila olmaydi.
6. **`audit_logs` oy bo'yicha partition.** Jadval qo'lda SQL bilan yaratiladi; Prisma partitionlarni ko'rmaydi va farq deb hisoblamaydi (tekshirildi). API partitionlarga to'g'ridan-to'g'ri kira olmaydi.

## Oqibatlar

- Har tashkilot so'rovi butun davomida bitta ulanishni ushlab turadi (tranzaksiya limiti 10 soniya). Uzoq ishlar (import, eksport) fon vazifasiga chiqariladi.
- `TenantDb` dan tashqaridagi so'rov bo'sh natija qaytaradi — xato emas. Shuning uchun `tenantDb.tx` kontekst bo'lmasa istisno tashlaydi.
- Yangi jadval qo'shilganda: `organization_id`, siyosat, `GRANT`. Unutilsa `test/rls-coverage.int-spec.ts` yiqiladi.
- `audit_logs` partitionlari 13 oy oldinga yaratilgan; `ensure_audit_logs_partition()` ni chaqirib turuvchi fon vazifasi kerak (BullMQ bilan birga). Unutilsa yozuvlar `audit_logs_default` ga tushadi, yo'qolmaydi.

## Ochiq savollar

Ikkalasi ham 0.3 da hal qilindi, qarang: [ADR 0002](0002-authentication.md) (`users` yopildi, tashkilot `auth_resolve_organization()` orqali topiladi). Quyidagi matn tarix uchun qoldirildi.

- **`users` global va RLS siz.** Bir odam bir nechta tashkilotda ishlashi mumkin (TZ 6). Hozir `gatefit_app` barcha foydalanuvchilarni o'qiy oladi; himoya faqat ilova kodida. Login va xodim qo'shish oqimlari aniq bo'lgach toraytiriladi (masalan, `SECURITY DEFINER` funksiyalar yoki `staff` orqali siyosat).
- **Tashkilotni subdomen bo'yicha topish** kontekstdan oldin sodir bo'ladi, RLS esa `organizations` ni yashiradi. Buning uchun `platform` ulanishi yoki tor `SECURITY DEFINER` funksiya kerak.
