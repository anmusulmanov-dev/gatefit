# 0011. Xabarnomalar: shablonlar, navbat, eslatma

Sana: 2026-11-22. Holat: qabul qilingan.

- **`notifications` moduli** `notification_templates` va `notifications` jadvallariga ega. Boshqa modullar xabarni faqat `NotificationsService.send` orqali yuboradi: matn klub shabloni (yo'q bo'lsa `packages/i18n` dagi standart) bilan tashkilot tilida tayyorlanadi, `notifications` ga yoziladi va commit'dan keyin BullMQ navbatiga qo'yiladi.
- **Qayta urinish**: birinchi urinish darhol, keyin 1, 5 va 30 daqiqadan so'ng; to'rttasi ham yiqilsa `failed`. SMS provayder tranzaksiyadan tashqarida chaqiriladi; `sent` bo'lgan xabar qayta yuborilmaydi. `last_error` da telefon va matn yo'q.
- **Bir martalik xabar**: `dedupe_key` (tashkilot ichida yagona), masalan `expiry:<abonement>:<oxirgi kun>`. Muzlatish oxirgi kunni surса — yangi eslatma.
- **Muddat eslatmasi** soatlik vazifa: oxirgi kunga 3 kun qolganda, abonement filialining vaqti bilan 10:00 dan keyin, `active`/`frozen` abonementlar. Tashkilotlarni tor SECURITY DEFINER funksiya beradi.
- **Shablonlar**: tahrirlanadi `payment_receipt`, `expiry_reminder` (uz/ru/en); `body = null` standartga qaytaradi (o'chirilmaydi). Noma'lum `{o'zgaruvchi}` — 422 `INVALID_TEMPLATE`. O'zgarish auditda. SMS-kirish kodi tahrirlanmaydi.
- **Eskiz** drayveri (`SMS_DRIVER=eskiz`, `ESKIZ_*`): token xotirada, 401 da qayta kiradi. Eskiz har matnni oldindan tasdiqlashni talab qiladi — shablon o'zgarsa Eskiz kabinetida ham tasdiqlatish kerak.
- **Kunlik hisobot** (`reports` moduli) jadvalga ega emas: raqamlar egasi bo'lgan modul servislaridan olinadi.
