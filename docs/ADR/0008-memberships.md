# 0008. Abonement sanalari va holat vazifasi

Sana: 2026-11-22. Holat: qabul qilingan.

- **Sana — filial kalendari.** Abonement va muzlatish `DATE` (`starts_on`, `ends_on`, ichiga oladi) sotilgan filialning `timezone` i bo'yicha; yonida mos lahzalar `timestamptz` (`starts_at`, `ends_at` = `ends_on` dan keyingi yarim tun). Hisob sof funksiyalarda (`packages/shared/src/dates.ts`, `apps/api/src/modules/plans/membership-rules.ts`), faqat `Intl`, yangi paket yo'q. Oy qo'shishda yo'q kun oy oxiriga qisiladi: 31-yanvar + 1 oy → 28/29-fevralgacha.
- **Shartlar nusxasi.** Sotilganda tarif nomi, turi, narxi, cheklovlari va muzlatish limitlari abonementga ko'chiriladi: tarif keyin o'zgarsa sotilgan abonement o'zgarmaydi.
- **Muzlatish** `ends_on` ni kunlar soniga suradi. Erta tugatilsa faqat o'tgan kunlar qoladi; boshlanmagani bekor qilinadi. Muzlatishlar ustma-ust tushmaydi; limit (jami kun, marta, eng kam kun) shartnoma nusxasidan.
- **Holat vazifasi.** Har abonementda `status_changes_at`: holat o'zi o'zgaradigan keyingi lahza (boshlanish, muzlatish chegarasi, tugash). Soatlik BullMQ vazifasi faqat shu lahzasi kelganlarni oladi. Tashkilotlar ro'yxatini tor `SECURITY DEFINER` funksiya (`jobs_organizations_with_due_memberships`, faqat id) beradi, ish esa har tashkilot ichida RLS bilan. Yozuv faqat o'qilgan holat o'zgarmagan bo'lsa yangilanadi: qayta yoki parallel ishga tushish zarar qilmaydi. O'zgarish `membership.status` auditi (`actor_id` = null).
- **A'zo holati** abonementlardan: active > frozen > expired > inactive; `blocked` va `debtor` (M4) ustun. Members moduli abonement ma'lumotini `MEMBERSHIP_FACTS` porti orqali oladi (plans moduli beradi, `ModuleRef` bilan chaqiruv paytida topiladi: ikki modul bir-biriga bog'liq).
- Kirishda cheklovlarni tekshirish va tashrif ayirish — M5; narx va muzlatish to'lovi — M4.
