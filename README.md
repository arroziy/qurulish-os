# Qurilish OS — A–E bloklar boshqaruv web-ilovasi

Bu loyiha `index.html` faylingiz asosida ko'p blokli web-ilova uchun birinchi ishlaydigan backend/frontend asosidir. Original fayl `legacy-index.html` nomi bilan saqlangan va o'zgartirilmagan.

## Hozirgi paketda bor

- A, B, C, D, E bloklar uchun yagona dashboard.
- Har blok uchun konseptual 3D-ko'rinishdagi bino maketi va 1–16 qavat tanlash.
- Administrator (glavniy) barcha 5 blokni ko'radi.
- Har blok uchun alohida `a_prorab`, `b_prorab`, `c_prorab`, `d_prorab`, `e_prorab` hisoblari.
- SQLite bazasida foydalanuvchilar, bloklar, bo'limlar va audit jurnali.
- Parollar bcrypt orqali xeshlanadi; sessiyalar SQLite'da saqlanadi.
- Blok prarabi faqat o'z blokini tahrirlaydi; server tomonda ruxsat tekshiriladi.
- Administrator yangi foydalanuvchi va bo'lim qo'sha oladi.
- Bo'lim holatlari: rejalashtirilgan, jarayonda, bajarildi, muammo.
- `legacy-index.html` ichida asl yuklangan fayl zaxira nusxasi mavjud.

## Ishga tushirish

Talab: Node.js 20 yoki undan yangiroq.

1. Ushbu papkada terminal oching.
2. Bog'liqliklarni o'rnating:

   ```bash
   npm install
   ```

3. `.env.example` faylidan `.env` nusxa yarating va `SESSION_SECRET` qiymatini uzun, tasodifiy maxfiy kalitga almashtiring. Ishlab chiqarish serverida `NODE_ENV=production` va HTTPS/proxy sozlamalarini to'g'ri o'rnating.
4. Ishga tushiring:

   ```bash
   npm start
   ```

5. Brauzerda `http://localhost:3000` manzilini oching.
6. Birinchi ishga tushishda yaratilgan hisoblarning parollari terminalda bir marta ko'rsatiladi. Ularni xavfsiz joyga yozib oling va ulashgandan so'ng almashtiring. Ishlayotgan bazada hisoblar qayta yaratilmaydi; parollar keyingi ishga tushishda yana ko'rsatilmaydi.

Bosh hisob login: `admin`. Blok hisoblari: `a_prorab`, `b_prorab`, `c_prorab`, `d_prorab`, `e_prorab`.

Agar `.env` orqali `ADMIN_PASSWORD`, `A_PRORAB_PASSWORD` va hokazo qiymatlar belgilansa, shu parollar ishlatiladi. Parollarni repozitoriyga yoki ochiq chatga joylamang.

## Muhim cheklovlar

- Hozirgi bino tasviri haqiqiy arxitektura geometriyasi emas; CSS bilan yasalgan konseptual 3D-ko'rinish. Aniq 3D model uchun `.glb/.gltf`, IFC yoki boshqa manba model kerak bo'ladi.
- Asl `index.html` ichidagi barcha C-blok ma'lumotlari yangi bazaga avtomatik ko'chirilmagan. Original fayl zaxira sifatida saqlangan. Ma'lumotlarni import qilishdan oldin `DB`, `F`, `ALL` va `localStorage` yozuvlari uchun alohida migratsiya hamda solishtirish kerak.
- Ushbu birinchi versiyada bo'limlar va ularning holatlari serverda saqlanadi; original sahifadagi barcha maxsus jadval, eshik, panjara, o'lchov, rasmlar va hisobotlar hali to'liq qayta ulanmagan.
- SQLite bir serverdagi kichik jamoa uchun boshlang'ich yechim. Ko'p serverli yoki katta yuklama uchun PostgreSQL, HTTPS reverse proxy, avtomatik zaxira, monitoring va deployment sozlamalari kerak.
- Internetga ochishdan oldin maxfiy `SESSION_SECRET`, HTTPS, zaxira, hisoblarni topshirish tartibi va server xavfsizligi bo'yicha tekshiruvni bajaring.

## Ma'lumotlar bazasi

`data/construction.sqlite` avtomatik yaratiladi. Uni o'chirish barcha saqlangan hisoblar, bo'limlar va audit yozuvlarini o'chiradi. Zaxira nusxa olishdan oldin serverni to'xtating yoki SQLite'ning mos backup usulidan foydalaning.

## Eski C-blok ma'lumotlarini ehtiyotkorlik bilan saqlash

`migration/legacy-embedded-db.json` — original HTML ichidagi `DB` obyektining ajratib olingan JSON nusxasi. `migration/legacy-inventory.json` manba fayl hajmi, SHA-256, qavatlar va ayrim kolleksiyalar sonini qayd etadi. `legacy-index.html` original yuklangan fayl bilan baytma-bayt bir xil bo'lishi kerak.

Tekshiruv (Node.js bilan, ilova paketlarini o'rnatish shart emas):

```bash
npm run audit:legacy
```

Brauzer xotirasidagi `bm_c_newsec_v1` ma'lumoti HTML ichida emas; u alohida eksport qilinishi kerak. Administrator sifatida tizimga kirib **Eski ma'lumotlar arxivi** bo'limini oching. Undagi ko'rsatma bilan eski ilova ishlatilgan brauzer Console'idan JSON eksport qiling, so'ng JSON faylni arxivga yuklang. Arxiv endpointi original JSON matnini, hajmini va SHA-256 summasini saqlaydi; bu amal ma'lumotni yangi ishchi jadvallarga avtomatik o'tkazmaydi va eski brauzer xotirasini o'chirmaydi.

**Muhim:** arxivlangan JSON yangi jadvalga import qilingan deb hisoblanmaydi. Keyingi migratsiya bosqichida har bir `F` qavati, xonalar, eshiklar, materiallar, o'lchovlar, qo'lda yozilgan va hisoblangan jami, `?` / `—` qiymatlari, fasad, kontaktlar va `bm_c_newsec_v1` qaydlari alohida maydonlarga xaritalanadi; oldin/ keyin sonlar va nazorat summalari solishtirilmaguncha migratsiya tugallangan deyilmaydi.
