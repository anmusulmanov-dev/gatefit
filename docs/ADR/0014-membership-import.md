# ADR 0014: Abonementlarni ko'chirish importi

Sana: 2026-11-27. Holat: qabul qilindi. TZ: F-1.4.1.

**Muammo.** Yangi zal ulanganda unda eski tizimda amaldagi abonementlar bor, hammasi har xil tarifda va sanada. Oddiy sotuv bularga to'g'ri kelmaydi: boshlanish sanasi ko'pi bilan 31 kun orqaga suriladi, tugash sanasini tarif o'zi hisoblaydi, narx esa bugungi tushum yoki qarz bo'lib yoziladi.

**Qaror.**

- **Alohida import.** `membership_imports` jadvali (RLS) va a'zolar importidagi oqim: yuklash → ustunlarni moslash → tekshirish → fon vazifasi.
- **Bir qator — bitta abonement.** Qatorda telefon, tarif nomi, boshlanish va tugash sanasi bo'ladi. Ixtiyoriy ustunlar: qolgan tashriflar, qarz, to'lov muddati, filial.
- **Moslash.** A'zo telefon bo'yicha, tarif nom bo'yicha topiladi (nofaol tariflar ham). Tarif shartlari tarifdan olinadi, sanalar fayldan.
- **Pul.** Sotuv ham, to'lov ham yozilmaydi, tushum va kassaga hech narsa tushmaydi. Qarz bo'lsa, oddiy (`standard`) hisob ochiladi va a'zo qarzdor bo'ladi.
- **Qayerdan kelgani.** `memberships.import_id` va `import_row` saqlanadi, `(organization_id, import_id, import_row)` yagona. Shu sabab fon vazifasi qayta ishlasa, yozilgan qatorlar o'tkazib yuboriladi.
- **Fon vazifasidagi huquqlar.** Fon vazifasi yuklagan xodim nomidan ishlaydi: yuklash paytidagi filiallari saqlanadi (`location_ids`). Shuning uchun u tekshiruvda ko'rsatilgandan ortiq narsa yozmaydi.
- **Bekor qilish.** Butun importni bekor qilish mumkin: abonementlar bekor qilinadi, qarz hisobdan chiqariladi. Agar ulardan biri bilan kirish bo'lgan yoki pul to'langan bo'lsa, bekor qilib bo'lmaydi.
- **Alohida modul.** Kirishni tekshirish access moduli orqali bo'ladi, access esa `PlansModule` ga bog'liq. Aylana bog'liqlik bo'lmasligi uchun import `PlansModule` ichida emas, alohida `MembershipImportsModule` da.
- **Muzlatish.** Eski tizimda ishlatilgan muzlatish kunlari ko'chirilmaydi, limit noldan boshlanadi.
