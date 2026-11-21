# 0007. Fayllar va fon vazifalari

Sana: 2026-11-21. Holat: qabul qilingan.

- **Fayllar** `FileStorage` porti ortida (`src/common/storage`): `s3` drayveri (MinIO va har qanday S3), `memory` drayveri testlar va MinIO'siz mashina uchun (productionda taqiqlangan). Kalit doim `orgs/<organizationId>/...` bilan boshlanadi.
- **Brauzerga fayl faqat imzolangan havola orqali** (TZ 9): `/api/v1/files/<payload>.<hmac>`, 1–2 soat amal qiladi. API faylni o'zi oqim bilan beradi, shuning uchun MinIO tashqariga ochilmaydi (staging Tailscale ortida, alohida domen va CORS kerak emas). Havola tashkilot sessiyasini talab qilmaydi: havolaning o'zi ruxsat.
- **Yuklash API orqali** (multipart, multer xotirada, 5 MB). Rasm turi fayl baytlaridan aniqlanadi (JPEG, PNG, WebP); SVG va boshqalar rad etiladi. O'lchamni kichraytirish yo'q (paket kerak bo'ladi) — kerak bo'lsa keyin.
- **Fon vazifalari:** BullMQ, Redis, API jarayonining o'zida ishlaydi (`QueueService`). Har vazifa qayta ishga tushsa zarar qilmaydi (6-qoida): import `status` bilan "egallanadi", a'zolar `skipDuplicates` bilan yoziladi va `members.import_id` bo'yicha sanaladi. Testlarda har ilova o'z navbat prefiksini oladi.
- Eksport hozircha so'rov ichida, oqim bilan (so'rov tranzaksiyasi 10 soniya). Juda katta tashkilotlar uchun fon vazifasiga o'tkaziladi.
