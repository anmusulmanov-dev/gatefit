# 0009. To'lovlar, idempotentlik va kassa

Sana: 2026-11-22. Holat: qabul qilingan.

- **Yozuvlar o'zgarmaydi.** `payments`, `refunds`, `invoice_items` ga API faqat `INSERT` va `SELECT` qila oladi (grant darajasida). Xato faqat qaytarish yoki hisobni `void` qilish bilan tuzatiladi. `invoices.paid_minor` = to'lovlar − qaytarishlar, har amalda hisob qatori `FOR UPDATE` bilan qulflanib yangilanadi.
- **Idempotentlik.** Pul endpointlari `@Idempotent()`: `Idempotency-Key` majburiy. Kalit `idempotency_keys` ga so'rov tranzaksiyasining boshida `INSERT ... ON CONFLICT DO NOTHING` bilan yoziladi, javob shu tranzaksiyada saqlanadi. Takror so'rov avvalgi javobni oladi (`Idempotent-Replayed: true`), boshqa tana bilan — 422. Bir vaqtdagi ikki so'rovni primary key navbatga qo'yadi; birinchisi yiqilsa kalit qayta ishlatiladi. Kalitlar tashkilot ichida abadiy yagona.
- **Sotish bitta tranzaksiyada**: abonement, hisob va to'lov. Bog'liqlik yo'nalishi plans → billing → members; members abonement va qarz ma'lumotini `MEMBERSHIP_FACTS` / `DEBT_FACTS` portlari orqali oladi.
- **Qarz.** `due_at` dan keyin to'lanmagan qoldiq a'zoni `debtor` qiladi (`blocked` dan past, abonementlardan ustun). Muddat berilmasa — darhol. Soatlik vazifa har hisobni bir marta belgilaydi (`overdue_marked_at`); tashkilotlarni tor `SECURITY DEFINER` funksiya beradi.
- **Kassa smenasi** filialda bitta. Naqd to'lov va naqd qaytarish faqat ochiq smenada; terminal va o'tkazma ochiq smenaga bog'lanadi, hisobotda alohida. Yopishda kutilgan = boshlang'ich + naqd − naqd qaytarish, farq saqlanadi. To'lov smenani qulflab bog'lanadi, shuning uchun yopish paytida to'lov o'tib ketmaydi.
- **Fiskal chek** `FiscalProvider` porti ortida, MVP da bo'sh drayver.
