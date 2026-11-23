# 0010. Kirish nazorati: QR imzosi, kirish jurnali, jonli oqim

Sana: 2026-11-22. Holat: qabul qilingan.

- **QR imzosi Ed25519** (PROMPTS dagi HMAC o'rniga, Anvar tasdiqlagan). Token `gf1.<payload>.<imzo>`, payload: tashkilot, a'zo, berilgan vaqt (30 soniyalik qadam), kalit id. 60 soniyadan keyin yaroqsiz, 5 soniya soat farqi qabul qilinadi. Kalit har tashkilot uchun `DATA_ENCRYPTION_KEY` dan HKDF bilan hosil qilinadi: bazada saqlanmaydi, yangi env yo'q. Qabulxona ekrani oflaynda faqat ochiq kalit bilan tekshiradi va yangi kod yasay olmaydi.
- **Qoidalar `packages/shared/src/access-rules.ts` da** (sof funksiya): API ham, oflayn ekran ham bir xil qaror qabul qiladi. Tartib: bloklangan va qarzdor rad; abonementlardan avval cheksiz, keyin tugashi yaqin; rad bo'lsa "ishlashga eng yaqin" sabab ko'rsatiladi.
- **`check_ins` oy bo'yicha partition** (PK `(id, at)`), faqat `INSERT`/`SELECT`. Oylar oldindan `access_ensure_check_in_partitions` (SECURITY DEFINER) bilan kunlik vazifada yaratiladi; `check_ins_default` zaxira. Chiqish — `direction = 'out'` yangi qator.
- **Zaldagilar**: oxirgi 3 soatdagi oxirgi harakati `in` bo'lganlar. 5 daqiqa ichida takror skan yangi tashrif emas.
- **Qo'lda kiritish** qoidadan qat'i nazar `allowed` yoziladi (xodim qarori), sabab majburiy, auditda qoida nima degani (`refusal`) bilan.
- **Jonli oqim SSE** (`GET /access/events`, paketsiz), Redis pub/sub orqali barcha API nusxalariga. Voqea faqat tranzaksiya commit bo'lgach yuboriladi (`TenantDb.afterCommit`). Oqim 1 soatda yopiladi, ekran qayta ulanadi (sessiya qayta tekshiriladi).
- Kirish filial ko'rinishi (ADR 0006) bilan cheklanmaydi: a'zo abonementi ruxsat bergan istalgan filialga kiradi; xodim faqat o'z filialida tekshiradi.
