# ADR 0015: A'zo uchun qabulxona kodi

Sana: 2026-11-28. Holat: qabul qilingan.

## Kontekst

Eskiz hisobi hali yo'q, ya'ni a'zolarga SMS kodi bormaydi va ular ilovaga kira olmaydi. Anvar a'zolar uchun login va parol o'rniga qabulxona kodini tanladi.

## Qaror

1. **Mavjud SMS kodi oqimining o'zi.** `POST /members/{id}/sign-in-code` (`members.manage`, xodimning filiallari ichida) `otp_codes` ga xuddi SMS'dagidek kod yozadi, lekin yubormaydi: kodni javobda qaytaradi. A'zo uni `POST /auth/otp/verify` bilan kiritadi. Yangi jadval va ustun yo'q.
2. **Muddat 15 daqiqa** (SMS'da 5): a'zo ilovani ochguncha vaqt kerak. Urinishlar soni o'sha (5).
3. **Bitta amaldagi kod.** Har yangi kod (qabulxona yoki SMS) oldingilarini bekor qiladi. Shuning uchun a'zo ilovasida «Kodni qabulxonadan oldim» tugmasi SMS so'ramay to'g'ridan-to'g'ri kod kiritishga o'tadi.
4. **Audit:** `member.sign_in_code.issue` (kodni olgan kishi a'zo nomidan kira oladi). Kodning o'zi saqlanmaydi, faqat kalitli xeshi.
5. Endpoint `auth` modulida (`MemberDeskCodeController`): kirish kodlari shu modulga tegishli; a'zo `MembersService.get` orqali olinadi (filial cheklovi bilan).

## Oqibatlar

- Eskiz ulangach ikkala yo'l birga ishlaydi, hech narsa o'chirilmaydi.
- Qabulxona xodimi a'zo nomidan kira oladi: bu xavf auditda ko'rinadi va xodimga `members.manage` ruxsati kerak.
