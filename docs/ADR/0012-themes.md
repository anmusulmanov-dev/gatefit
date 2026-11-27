# ADR 0012: Mavzular (ranglar va uslub) har tashkilot uchun

Sana: 2026-11-24. Holat: qabul qilingan.

## Qaror

1. **To'rt mavzu:** `zumrad` (standart), `olov`, `neon`, `moviy`. Ro'yxat `packages/shared/src/theme.ts` da, bazada `organizations.theme` (enum `organization_theme`). Tashkilot uni sozlamalarda o'zi tanlaydi (`PATCH /organization`, `organization.update` ruxsati, audit bilan). `gatefit_app` ga faqat shu ustunni yangilash huquqi qo'shildi.
2. **Bitta CSS manba:** `packages/shared/styles/themes.css`, web va member ikkalasi import qiladi. Har mavzu CSS o'zgaruvchilar to'plami; Tailwind tokenlari (`bg-primary`, `text-ok-ink`, `shadow-card`, `font-heading`) shularga qaraydi. Komponentlarda rang yozilmaydi.
3. **Yorug' va qorong'i — har kimning o'z tanlovi**, mavzu emas: `gf-mode` cookie (`system` / `light` / `dark`). Ranglar `light-dark()` bilan yoziladi, `<html data-mode>` faqat `color-scheme` ni o'rnatadi, shuning uchun har mavzu bitta blok.
4. **Holat ranglari umumiy:** kirdi (yashil), rad (qizil), ogohlantirish (sariq) to'rt mavzuda bir xil ma'noda va bir xil rangda. Matn kontrasti WCAG AA (≥ 4.5:1).
5. **Kirishdan oldin mavzu:** `GET /branding` (`@Public`, faqat subdomen tashkiloti uchun) faqat `name` va `theme` qaytaradi. Root layout uni har so'rovda so'raydi (`cache: 'no-store'`, tashkilotlar orasida kesh bo'lmasin); xato bo'lsa standart mavzu.
6. **Shriftlar `next/font/google` orqali** (yangi paket yo'q), lotin va kirill. Faqat standart mavzu shriftlari oldindan yuklanadi; qolganlarini brauzer mavzu ishlatgandagina oladi. Build vaqtida Google Fonts'ga internet kerak.
7. **Harakat:** animatsiyalar Tailwind tokenlari (`animate-pop`, `animate-shake`, `gf-skeleton`, ...); `prefers-reduced-motion: reduce` da hammasi o'chadi.

8. **Logo (F-10.7, 2026-11-27).** `organizations.logo_key`, fayl `FileStorage` da (`orgs/<id>/branding/logo-<uuid>.<ext>`). `PUT/DELETE /organization/logo` (`organization.update`, audit). Faqat PNG, JPEG, WebP, baytlariga qarab; 2 MB va 4096 px gacha (o'lcham sarlavhadan o'qiladi, rasm ochilmaydi). SVG rad etiladi: ichida skript bo'lishi mumkin, tozalash uchun paket kerak. `GET /organization` va `GET /branding` imzolangan `logoUrl` qaytaradi (bir xil vaqt oynasida bir xil havola, brauzer keshlaydi), alohida ommaviy endpoint shart bo'lmadi. PWA o'rnatish belgisi Gatefit'niki qoladi: aniq 192/512 px kerak, kichraytirish paket talab qiladi.

## Oqibatlar

- Yangi mavzu: `THEMES` ga kalit, migratsiyada enum qiymati, `themes.css` da blok, tarjimalarda nom va tavsif.
- Zal o'z logotipi va brend rangi (white-label, TZ F-9.4) keyin shu tokenlar ustiga quriladi.
