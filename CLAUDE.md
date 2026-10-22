# KKUM sayti — Claude uchun ko'rsatma

Bu loyiha — KKUM do'koni sayti (statik HTML/CSS/JS). Mahsulotlar Telegram kanali `kkum_youu` (https://t.me/kkum_youu) postlaridan avtomatik olinadi.

## Tuzilish

- `index.html`, `style.css`, `script.js` — sayt sahifasi va mijoz tomoni logikasi.
- `script.js` — avval `products.json` ni o'qiydi; fayl bo'lmasa, Telegram sahifasini ochiq proxy'lar orqali to'g'ridan-to'g'ri o'qiydi (fallback).
- `products.json` — sinxronizatsiya natijasi (`updatedAt`, `channel`, `products[]`). **Qo'lda tahrirlamang**, u skript tomonidan yoziladi.
- `images/products/<id>-<n>.jpg` — mahsulot rasmlari (skript yuklaydi). Qo'lda tahrirlamang.
- `scripts/sync-products.mjs` — kanal postlarini o'qib, `products.json` va rasmlarni yangilaydi. `--loop` bilan har 30 daqiqada ishlaydi.
- `scripts/dev.mjs` — `http://localhost:8766` da saytni ko'rsatadi va sinxronizatsiyani fon rejimida ishga tushiradi.
- `.github/workflows/sync-products.yml` — GitHub Actions har 30 daqiqada sinxronizatsiya qilib, o'zgarish bo'lsa commit/push qiladi.

## Buyruqlar

- `npm run sync` — kanaldan bir marta yangilash.
- `npm start` — sayt + doimiy sinxronizatsiya (localhost:8766).

Node.js 20+ kerak (sinov: Node 24 da ishlaydi). Zavisimlik (`npm install`) yo'q — faqat standart kutubxona.

## Muhim qoidalar

- `products.json` va `images/products/` ni qo'lda o'zgartirmang; manba — Telegram kanali.
- Sinxronizatsiya xato bersa, avvalgi `products.json` saqlanadi — bu ataylab shunday.
- Sayt matnlari rus/o'zbek tilida. Mahsulot kategoriyalari `scripts/sync-products.mjs` dagi `categoryNames` jadvalida.
- Telegram sahifasi tuzilishi o'zgarsa, `parsePage()` ishdan chiqadi — avval shu funksiyani tekshiring.

## Ma'lum muammo

`products.json` dagi ba'zi `title` maydonlarida HTML qoldig'i bor (masalan, `tgme_widget_message_text js-message_text" dir="auto">`). Sababi: `parsePage()` da `indexOf('tgme_widget_message_text')` klass atributining o'zini topadi, shuning uchun matnga tegning qolgan qismi (`js-message_text" dir="auto">`) kirib qoladi. Tuzatish: matn boshlanishini shu tegning `>` belgisidan keyin hisoblash.
