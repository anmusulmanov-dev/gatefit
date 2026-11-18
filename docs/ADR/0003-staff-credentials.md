# ADR 0003: Xodim paroli va TOTP tashkilot ichida saqlanadi

Sana: 2026-11-17. Holat: qabul qilingan. ADR 0002 ning 8–10-bandlarini o'zgartiradi. TZ 6-bo'limdan chetlanish (TZ yangilandi).

## Kontekst

`users` — global jadval: bir odam bir nechta tashkilotda ishlashi mumkin. Parol va TOTP ham shu jadvalda edi. M1 da xodim parolini tiklash (`staff.manage`) qo'shilganda muammo ko'rindi: A tashkilot o'z xodimining parolini tiklasa, o'sha odamning B tashkilotga kirishi ham o'zgaradi — u B da owner bo'lsa, A ning menejeri B ni egallab oladi.

## Qaror

1. `password_hash`, `totp_secret`, `must_change_password` **`staff` jadvaliga ko'chirildi**. Ular oddiy tashkilot ma'lumoti, `staff` ning RLS siyosati bilan himoyalangan. Bir odam ikki tashkilotda ishlasa, ikki mustaqil paroli va autentifikatori bo'ladi; u baribir har biriga o'z manzilidan kiradi.
2. `users` da faqat shaxs (telefon) qoladi. U hanuz API uchun yopiq; yangi yozuv faqat `auth_find_or_create_user()` orqali. `auth_staff_credentials` va `auth_enroll_totp` funksiyalari olib tashlandi.
3. Parol va TOTP ustunlari oddiy `staff` so'rovlarida qaytmaydi (Prisma global `omit`). Ularni faqat `StaffCredentialsService` aniq so'raydi.
4. **Vaqtinchalik parol.** Xodimni qo'shgan yoki parolini tiklagan odam parolni o'zi tanlaydi; `must_change_password` yoqiladi. Bunday parol bilan login sessiya ochmaydi: `PASSWORD_CHANGE_REQUIRED` va bir martalik `changeToken` qaytaradi, `POST /auth/password/set` yangi parolni o'rnatadi, keyin xodim odatdagidek kiradi (TOTP tekshiruvlari bilan).
5. **Kim kimnikini tiklay oladi.** `staff.manage` kerak, va: o'zinikini emas; owner'nikini hech kim (faqat platforma, M1b); chaqiruvchi nishonning rolidagi barcha ruxsatlarga ega bo'lishi shart. Tiklash nishonning barcha xodim sessiyalarini tugatadi va auditga yoziladi.
6. **Ruxsatni oshirib bo'lmaydi** — shu qoida rol yaratish, rolni tahrirlash va xodimga rol berishda ham: faqat o'zingda bor ruxsatlarni bera olasan.

## Oqibatlar

- Tashkilotlar bir-birining kirishiga hech qanday yo'l bilan ta'sir qila olmaydi; buni `test/users-lockdown.int-spec.ts` tekshiradi.
- Ikki zalda ishlaydigan odam ikki parolni eslab qolishi kerak.
- A'zolar (SMS-kod) uchun hech narsa o'zgarmadi: ularda parol yo'q.
- "Parolni unutdim" o'z-o'ziga xizmat oqimi yo'q (SMS M7 da ulanadi); hozircha tiklashni `staff.manage` egasi qiladi.
