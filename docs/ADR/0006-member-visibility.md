# 0006. Kim qaysi a'zoni ko'radi

Sana: 2026-11-21. Holat: qabul qilingan.

- A'zoning bitta "uy filiali" bor (`members.home_location_id`, majburiy).
- Standart `owner` va `accountant` rollari tashkilot darajasida (TZ 2-bo'lim): barcha a'zolarni ko'radi. Qolgan rollar, maxsus rollar ham, faqat o'zi biriktirilgan filiallar a'zolarini ko'radi, qo'shadi va o'zgartiradi. Ro'yxat `ORGANIZATION_WIDE_ROLES` (`packages/shared/src/roles.ts`), tekshiruv `StaffCaller.locationIds` orqali.
- Ko'rinmaydigan a'zo 404 qaytaradi (bor-yo'qligi oshkor qilinmaydi). Istisno: telefon takrori. Telefon tashkilot ichida yagona, shuning uchun band telefon egasi (ism, filial) boshqa filial xodimiga ham ko'rsatiladi.
- Bu RLS emas, ilova darajasidagi filtr: tashkilotlar orasidagi chegara RLS da qoladi.
- Maxsus rolni tashkilot darajasiga chiqarish (masalan "direktor") hozircha uni barcha filiallarga biriktirish bilan. Kerak bo'lsa keyin rolga belgi qo'shiladi.
