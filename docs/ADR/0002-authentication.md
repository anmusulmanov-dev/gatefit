# ADR 0002: Autentifikatsiya va ruxsatlar

Sana: 2026-11-11. Holat: qabul qilingan. ADR 0001 dagi ikki ochiq savolni yopadi.

> 8–10-bandlar [ADR 0003](0003-staff-credentials.md) bilan o'zgardi: parol va TOTP endi `users` da emas, `staff` da; `auth_staff_credentials` va `auth_enroll_totp` funksiyalari olib tashlangan.

## Qaror

1. **Tashkilot subdomendan aniqlanadi.** Xost nomining birinchi bo'lagi slug (`demo.gatefit.uz`, devda `demo.localhost`). `TenantResolutionMiddleware` uni `auth_resolve_organization()` orqali topadi. Access token faqat o'z tashkiloti manzilida qabul qilinadi (TZ 5.1).
2. **So'rov quvuri qat'iy tartibda** (`AppModule`): OriginCheck → TenantResolution → RateLimitGuard → AuthGuard → TenantTransactionInterceptor → AccessInterceptor.
3. **Ruxsat tekshiruvi interceptor'da, guard'da emas.** U so'rov tranzaksiyasi ichida ishlashi kerak, shunda tekshiruv alohida tranzaksiya emas, bitta so'rov bo'ladi. Sessiya, xodim holati va ruxsatlar har so'rovda bazadan o'qiladi: chiqarilgan xodim yoki o'zgargan rol darhol kuchga kiradi.
4. **Har endpoint uch belgidan bittasini oladi:** `@Public`, `@AnyAuthenticated`, `@RequirePermission(...)`. Belgisiz endpoint ish vaqtida rad etiladi va `test/endpoint-protection.int-spec.ts` yiqiladi.
5. **Tokenlar.** Access JWT (HS256, 15 daqiqa) va refresh token (256 bit tasodifiy, bazada faqat SHA-256) httpOnly, `SameSite=Lax` cookie'larda. Refresh token `Path=/api/v1/auth` bilan cheklangan. Xodim va a'zo cookie'lari alohida nomda; qaysi juftlik o'qilishini `X-Gatefit-Client` sarlavhasi belgilaydi.
6. **Refresh aylanishi.** Har token bir marta ishlaydi. Ishlatilgan token qayta kelsa — butun sessiya zanjiri bekor qilinadi. Istisno: 10 soniya ichidagi takror (ikki varaq bir vaqtda yangilaganda) rad etiladi, lekin zanjir saqlanadi.
7. **CSRF.** Holatni o'zgartiruvchi so'rovda `Origin` so'ralgan xostga yoki `CORS_ORIGINS` ga mos kelishi shart.
8. **`users` yopildi.** `gatefit_app` faqat joriy tashkilotga bog'langan foydalanuvchilarning maxfiy bo'lmagan ustunlarini o'qiydi; `password_hash` va `totp_secret` ga ustun darajasida huquq yo'q; yozish huquqi yo'q. Qolgan hammasi tor `SECURITY DEFINER` funksiyalar orqali: `auth_staff_credentials`, `auth_enroll_totp`, `auth_find_or_create_user`. Har biri bitta telefon yoki bitta foydalanuvchi bilan ishlaydi — jadvalni ro'yxatlab bo'lmaydi.
9. **Parol Argon2id** (19 MiB, 2 iteratsiya). Noma'lum telefon uchun ham soxta xesh tekshiriladi, javob vaqti farq qilmasligi uchun.
10. **TOTP.** Sir bazada AES-256-GCM bilan shifrlangan. Owner va accountant uchun majburiy: sozlanmagan bo'lsa login sessiya o'rniga `setupToken` qaytaradi. Sozlash paytida sir bazaga yozilmaydi, shifrlangan holda `enrollToken` ichida yuradi va birinchi kod tasdiqlangach saqlanadi. Mavjud TOTP ni almashtirish API orqali mumkin emas. Har kod bir marta qabul qilinadi.
11. **SMS-kod.** 6 raqam, bazada tashkilot va telefonga bog'langan HMAC, 5 daqiqa, 5 urinish. Urinish avval sanaladi, keyin solishtiriladi (parallel taxminlar limitdan osha olmaydi).
12. **Tezlik cheklovi Redis'da.** IP bo'yicha umumiy va kirish endpointlari uchun qattiqroq; telefon bo'yicha: login 10 ta muvaffaqiyatsiz urinish / 15 daqiqa, SMS so'rovi 3 ta / 10 daqiqa.

## Oqibatlar

- Har autentifikatsiyalangan so'rov ruxsat uchun 2 ta qo'shimcha so'rov qiladi (sessiya, xodim+rol). Tezlik muammo bo'lsa Redis'da qisqa kesh qo'shiladi.
- Tashkilotni topish ham har so'rovda bazaga boradi; xuddi shunday keshlanishi mumkin.
- Yangi maxfiy sozlamalar: `JWT_SECRET`, `DATA_ENCRYPTION_KEY`. `DATA_ENCRYPTION_KEY` yo'qolsa barcha TOTP sirlari o'qilmaydi — zaxira nusxaga kiritilishi shart.
- `auth` moduli hozir `staff`, `roles`, `role_permissions` jadvallarini to'g'ridan-to'g'ri o'qiydi. `staff` moduli paydo bo'lganda (M1) bu uning servisi orqali o'tadi (7-qoida).

## Ochiq qolganlar

- **A'zo kirishi `members` ga bog'lanmagan.** Hozir tasdiqlangan istalgan telefon kira oladi va `users` da yozuv yaratadi. M2 da "shu tashkilotda a'zo bo'lishi shart" tekshiruvi qo'shiladi.
- **Parolni o'zgartirish va tiklash, TOTP ni tiklash** yo'q. Xodim qo'shish bilan birga M1 da.
- **Super-admin kirishi** M1 da (`platform` moduli).
