# ADR 0004: Platforma (super-admin) va tariflar

Sana: 2026-11-17. Holat: qabul qilingan.

## Qaror

1. **Platforma o'z manzilida yashaydi:** `admin.<APP_BASE_DOMAIN>` (devda `admin.localhost`). `/api/v1/platform/*` endpointlari boshqa har qanday manzilda 404 qaytaradi. `admin` band qilingan slug, tashkilot bo'la olmaydi.
2. **Platforma operatorlari alohida jadvalda** (`platform_admins`), `users` bilan hech qanday bog'liq emas. `gatefit_app` roliga bu jadvalga ham, `platform_sessions` ga ham hech qanday huquq berilmagan.
3. **RLS dan tashqaridagi ulanish faqat shu modulda.** `PlatformPrismaService` `gatefit_migrator` bilan ulanadi va `modules/platform` dan eksport qilinmaydi; buni `test/platform-boundary.int-spec.ts` tekshiradi. Tashkilot ichidagi amallar (masalan, owner parolini tiklash) baribir `TenantDb.run()` va tashkilot servislari orqali, RLS ostida bajariladi.
4. **Kirish:** telefon, parol va **doim** TOTP; autentifikatori yo'q operator avval uni sozlaydi. Tokenlarning maqsadi va auditoriyasi alohida, ya'ni tashkilot kirishi uchun yaratilgan hech narsa bu yerda ishlamaydi va aksincha.
5. **Sessiya sodda:** bitta tasodifiy token, `SameSite=Strict` httpOnly cookie'da, bazada faqat xeshi; 12 soat; har so'rovda bazadan tekshiriladi. Refresh ham, JWT ham yo'q: bekor qilish darhol kuchga kiradi.
6. **Endpoint belgisi:** `@Platform()` (to'rtinchi belgi). U global `AuthGuard` va `AccessInterceptor` ni chetga suradi va o'z guard'larini qo'yadi. Faqat `Platform*Controller` larda ishlatilishi test bilan tekshiriladi.
7. **Tariflar ma'lumot, kod emas.** `saas_plans`: narx, limit, modullar. Tashkilotlar uni faqat o'qiy oladi. `organizations.saas_plan_id` — amaldagi tarif; `saas_subscriptions` — tarix (yopilmagan qator joriy).
8. **Tashkilot o'z tarifini o'zgartira olmaydi — baza darajasida.** `gatefit_app` `organizations` da faqat `name`, `locale`, `updated_at` ustunlarini yangilay oladi; `status`, `trial_ends_at`, `saas_plan_id`, `country`, `currency` ga huquqi yo'q.
9. **`@RequireModule('...')`** endpointni mahsulot moduliga bog'laydi. Ruxsat tekshiruvidan keyin, shu so'rov tranzaksiyasida tashkilot tarifi o'qiladi; modul bo'lmasa 403 `MODULE_NOT_AVAILABLE`. Tarifsiz tashkilotda hech bir modul yo'q.
10. **Pul satr ko'rinishida uzatiladi** (`priceMinor: "45000000"`), bazada `bigint`. Hech bir klient pulni `number` da ushlamaydi (2-qoida). M4 dagi to'lovlar ham shu qoidaga amal qiladi.
11. **Platformaning tashkilotga qilgan ishi o'sha tashkilotning `audit_logs` ida**, `platform.` prefiksi bilan; `actor_id` bu holda `platform_admins.id`.

## Oqibatlar

- API endi `DATABASE_ADMIN_URL` ni ham talab qiladi. Bu jadvallar egasining paroli: platforma moduli buzilsa, RLS himoya qilmaydi. Shuning uchun modul kichik va chegarasi test bilan qo'riqlanadi. Kelajakda alohida, `BYPASSRLS` li lekin jadval egasi bo'lmagan rol ajratish mumkin.
- Tarif o'zgarishi (narx, modul) tashkilotga tegishli bo'lmagani uchun `audit_logs` ga emas, ilova logiga yoziladi. Platforma darajasidagi audit jadvali hali yo'q.
- Faol a'zolar limiti hisoblagichi (`ActiveMemberCounter`) hozir 0 qaytaradi; M2 da `members` moduli haqiqiysini beradi. Limit oshsa tizim bloklamaydi (TZ 12).

## Ochiq qolganlar

- **Ofertaga rozilik.** Tashkilotni operator yaratganda, `offerVersion` berilsa, rozilik mijoz nomidan yoziladi (kim yozgani auditda). Mijozning o'zi tasdiqlaydigan oqim o'z-o'zidan ro'yxatdan o'tish bilan (v1) keladi.
- **Sinov muddati tugashi** hech narsani avtomatik o'zgartirmaydi (kelishilganidek); bloklash qo'lda.
- **Operatorlarni boshqarish** (qo'shish, o'chirish, parolini tiklash) uchun endpoint yo'q: hozircha seed va baza orqali.
- **Mijoz hisobiga vaqtincha kirish** (TZ 2-bo'lim) qilinmagan.
