# 🧠 INGATAN — AM Premium Creator

> Dokumentasi lengkap seluruh state project per **10 Agustus 2026**.
> Website: [https://am.alwayscodex.my.id](https://am.alwayscodex.my.id)

---

## 📋 DAFTAR ISI

1. [Gambaran Umum](#1-gambaran-umum)
2. [Arsitektur Project](#2-arsitektur-project)
3. [Struktur File](#3-struktur-file)
4. [Sistem Role & Limit](#4-sistem-role--limit)
5. [Fitur-Fitur](#5-fitur-fitur)
6. [API Endpoints](#6-api-endpoints)
7. [Keamanan](#7-keamanan)
8. [Frontend — Screens & UI](#8-frontend--screens--ui)
9. [Sistem Referral](#9-sistem-referral)
10. [Telegram Bot Deploy](#10-telegram-bot-deploy)
11. [Batch Auto Generator](#11-batch-auto-generator)
12. [HMR (Hot Module Reload)](#12-hmr-hot-module-reload)
13. [Docker](#13-docker)
14. [Akun Default](#14-akun-default)
15. [Perubahan Terbaru](#15-perubahan-terbaru)
16. [Catatan Penting](#16-catatan-penting)

---

## 1. GAMBARAN UMUM

**AM Premium Creator** adalah platform web untuk membuat akun **Alight Motion Premium**. Dibangun dengan **Node.js native (ESM)**, **tanpa framework**, database **JSON file-based**, dan frontend **vanilla HTML/CSS/JS** (single-page app).

- **Server:** `server.js` (entry point via `index.js` + HMR)
- **Port:** 5000
- **Runtime:** Node.js ≥ 18 (ESM, `"type": "module"`)
- **Process Manager:** PM2 (`pm2 restart am`)
- **Domain:** `am.alwayscodex.my.id`

---

## 2. ARSITEKTUR PROJECT

```
index.js              → Entry point (HMR wrapper)
server.js             → Server HTTP utama (routing, API, logika bisnis)
src/
  app/index.js        → App initialization
  middleware/index.js  → Middleware (CORS, security headers, anti-bot)
  routes/api.js       → Semua endpoint API
  utils/
    am.js             → Logika AM (send-link, claim-premium, bulk)
    auth.js           → Autentikasi (login, register, session, hash)
    session.js        → Manajemen sesi (create, validate, cleanup)
    store.js          → Data store (read/write JSON, ID generator)
    telegram.js       → Bot Telegram manager (deploy, polling, command)
    chat.js           → Chat global (SSE, badwords filter)
    logger.js         → Logger utility
    security.js       → Anti-devtools / anti-scraper
  hooks/
    hot-reload.js     → Hot Module Reload (watch file changes)
services/
  auth.js             → AMAuth — kirim magic link + verifikasi
  bulk.js             → Auto generator bulk (puppeteer-core + Chrome)
  telegram/
    tele.js           → Telegram bot commands & polling
public/               → Frontend (di-serve ke browser)
  home.html           → Single-page app (3342 lines)
  security.js         → Anti-devtools versi public
  css/
    redesign.css      → Design system + theme (1202 lines)
    admin-controls.css→ Admin panel styles (670 lines)
    design-system.css → Design tokens
    premium-polish.css→ Premium visual polish
    responsive.css    → Responsive breakpoints
  js/
    home.js           → UI logic (2741 lines)
    enhance.js        → Hardening + micro-interactions (79 lines)
data/                 → ⚠️ STATE RUNTIME (JSON)
  users.json          → User accounts, roles, credits, API keys
  sessions/           → Login sessions
  chat.json           → Global chat messages
  history.json        → Activation history
  reviews.json        → User ratings & reviews
  logs.json           → Activity logs
  transactions.json   → Payment transactions
  notifications.json  → User notifications
  ips.json            → IP tracking & banned IPs
  duplicates.json     → Duplicate account logs
  batch.json          → Active batch state
  settings.json       → App settings
  telegram_bots.json  → Deployed Telegram bots
  activations.json    → Activation records
  badwords.json       → Bad word filter list
```

---

## 3. STRUKTUR FILE (RINGKAS)

| File | Lines | Fungsi |
|---|---|---|
| `public/home.html` | 3342 | SPA — semua screen (login, dashboard, generator, admin, dll) |
| `public/js/home.js` | 2741 | Logika UI — screen routing, API calls, rendering |
| `public/css/redesign.css` | 1202 | Design system, CSS variables, theme light/dark |
| `public/css/admin-controls.css` | 670 | Admin panel khusus (tabel, card, tab, scroll) |
| `src/routes/api.js` | 995 | Semua endpoint API |
| `src/utils/auth.js` | 218 | Login, register, hash password, session |
| `src/utils/session.js` | 133 | Session create/validate/cleanup (cap 10/user) |
| `src/utils/store.js` | 163 | JSON read/write, ID generator, config |
| `server.js` | 14 | Entry legacy (redirect ke index.js) |
| `index.js` | - | Entry point utama + HMR |
| `services/auth.js` | 140 | AMAuth — magic link + verifikasi alight creative |
| `services/bulk.js` | - | Puppeteer bulk generator |

---

## 4. SISTEM ROLE & LIMIT

### 4.1 Role User

| Role | Credit | Limit | API Key | Bulk | Expired |
|---|---|---|---|---|---|
| **user** | 20 (default) | Credit-based | ❌ | ❌ | ❌ |
| **premium** | Unlimited/day | Harian | ✅ | ❌ | ✅ (durasi) |
| **reseller** | Unlimited | Web only | ❌ | ❌ | ✅ (durasi/Lifetime) |
| **autogen** | Unlimited | Unlimited | ✅ | ✅ | ✅ (durasi) |
| **admin** | Unlimited | All unlocked | ✅ | ✅ | ✅ (durasi/Lifetime) |
| **owner** | Unlimited | Full access | ✅ | ✅ | ❌ (permanen) |

### 4.2 Durasi Role (3/7/14/30 hari + Lifetime)

- Reseller, Premium, Autogen, Admin bisa dibeli dengan durasi: **3, 7, 14, 30 hari** atau **Lifetime**
- Admin bisa menjual role ke user lain
- Expired dicek via `apiExpiresAt`

### 4.3 Kredit Default

- Register **tanpa** kode referral: **20 credits**
- Register **dengan** kode referral: **+10 credits** (total 30)
- Yang mengundang (inviter): **+40 credits**

---

## 5. FITUR-FITUR

### 5.1 AM Generator (Send Link + Claim Premium)
- User input email → kirim magic link verifikasi ke alight creative
- User input magic link → verifikasi & aktivasi premium
- Credit berkurang 1 per aktivasi (role user)

### 5.2 Auto Generator (Bulk)
- Prefix custom + domain dari generator.email (155+ domain)
- Puppeteer-core + Chrome headless
- Proses send+verify di latar belakang
- Maks 5 akun per batch (web), lebih untuk autogen/admin
- Hasil dikirim ke Telegram (jika bot terhubung)

### 5.3 Netflix (Demo)
- Generate token Netflix demo
- Scraper dari `nftools.aroshi.my.id`
- Fallback dihapus — respon murni dari pihak ketiga

### 5.4 API Key System
- Generate manual oleh user (tidak auto-generate)
- Reset API key → bot Telegram otomatis restart dengan token baru
- Endpoint: `/api/auth/reset-key`

### 5.5 Chat Global
- Real-time via SSE (Server-Sent Events)
- Sensor kata kasar (badwords.json)
- Moderasi admin (hapus pesan)

### 5.6 Rating & Ulasan
- Rating 1–5 bintang
- Tampil di halaman utama
- Logo bintang warna **kuning** (konsisten dengan mahkota Lifetime)

### 5.7 Dashboard Admin
- **Statistik:** Total anggota, total request, berhasil, gagal
- **Profil H2H Income:** Nama, balance, settlement balance, status (dari API atlantich2h.com)
- **Daftar Anggota:** Search, filter role/status, edit kredit/role, ban/unban, pagination 10
- **Aktivitas Global:** Log semua aktivitas, pagination 10
- **Transaksi QRIS:** Pembayaran masuk, konfirmasi
- **Duplicate Logs:** Log akun duplikat
- **IP Anggota & Pembersihan:** ❌ SUDAH DIHAPUS (10 Agustus 2026)

### 5.8 Theme Mode
- Light / Dark / System
- Disimpan di localStorage
- Toggle di navbar (sebelah notifikasi)

### 5.9 Notifikasi
- Lonceng di topbar dengan badge merah (jumlah notif)
- Style: bulat (radius 50%), background transparent, badge lingkaran merah #ef4444

### 5.10 Referral System
- Kode referral random 6 karakter (format: `xxx-xxx`, contoh: `628-hs6`, `dtd-ana`)
- Link: `https://am.alwayscodex.my.id/invite?code=CODE`
- Register: input kode referral (opsional)
- Komisi: inviter +40 credits, invitee +10 credits
- Screen khusus: `#referral` — Program Referral (link, stats, claim, activity, how-it-works)
- Screen diakses dari titik 3 menu

### 5.11 Lifetime Screen
- Screen khusus: `#lifetime`
- Menampilkan info role Lifetime
- Deploy bot Telegram (dipindah dari Profile)
- Logo mahkota kuning di sidebar

### 5.12 Telegram Bot Deploy
- Khusus role **admin** dan **owner**
- Admin: **maks 1 bot**
- Owner: **tanpa batasan**
- Fitur bot: `/start`, `/create`, `/verify`, `/bulk`, `/id`
- Inline keyboard + callback query
- Tampilan hasil bulk rapi dengan format HTML
- Auto-restart saat API key di-reset
- Hanya menampilkan bot milik user sendiri (filter by username)

### 5.13 H2H Payment Integration
- API: `atlantich2h.com`
- Endpoint: `/get_profile`, `/deposit/metode`
- QRIS generation untuk pembayaran
- Profil income di dashboard admin (tersembunyi, tidak tampil domain)

### 5.14 API Guide (`#apiguide`)
- Dokumentasi API profesional
- Code examples: cURL, Node.js, Python, PHP
- Copy button, syntax highlighting
- Bisa diakses semua role

---

## 6. API ENDPOINTS

### Auth
| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| POST | `/api/auth/register` | - | Registrasi (maks 3/IP) |
| POST | `/api/auth/login` | - | Login |
| POST | `/api/auth/logout` | Sesi | Logout |
| GET | `/api/auth/profile` | Sesi | Profil user |
| POST | `/api/auth/reset-key` | Sesi | Reset API key |

### AM
| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| POST | `/api/am/send-link` | Sesi | Kirim magic link |
| POST | `/api/am/claim-premium` | Sesi | Aktivasi premium |
| GET | `/api/am/history` | Sesi | Riwayat aktivasi |
| GET | `/api/am/domains` | - | Daftar domain |
| POST | `/api/am/autogen/start-batch` | Sesi | Mulai batch |
| GET | `/api/am/autogen/active-batch` | Sesi | Status batch |
| GET | `/api/am/netflix/token` | Sesi | Token Netflix |

### Chat
| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| GET | `/api/chat/messages` | - | Pesan chat |
| POST | `/api/chat/send` | Sesi | Kirim pesan |

### Reviews
| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| GET | `/api/reviews` | - | Rating & ulasan |
| POST | `/api/reviews` | Sesi | Kirim ulasan |

### Admin
| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| GET | `/api/admin/stats` | admin | Statistik |
| GET | `/api/admin/users` | admin | Daftar user |
| POST | `/api/admin/user/update` | admin | Update user |
| POST | `/api/admin/user/ban` | admin | Ban user |
| POST | `/api/admin/user/unban` | admin | Unban user |
| POST | `/api/admin/user/reset-password` | admin | Reset password |
| POST | `/api/admin/ip/ban` | admin | Ban IP |
| POST | `/api/admin/ip/unban` | admin | Unban IP |
| GET | `/api/admin/ips` | admin | Data IP |
| POST | `/api/admin/cleanup-ry` | admin | Bersihkan akun ry_ |
| GET | `/api/admin/logs` | admin | Log aktivitas |
| GET | `/api/admin/transactions` | admin | Transaksi |
| POST | `/api/admin/transaction/confirm` | admin | Konfirmasi |

### Invite
| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| GET | `/api/invite/check?code=CODE` | - | Cek validitas kode referral |

### Telegram Bots
| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| GET | `/api/telegram/bots` | Sesi | List bot user |
| POST | `/api/telegram/deploy` | Sesi | Deploy bot baru |
| POST | `/api/telegram/stop` | Sesi | Stop bot |
| POST | `/api/telegram/start` | Sesi | Start bot |
| POST | `/api/telegram/restart` | Sesi | Restart bot |
| DELETE | `/api/telegram/remove` | Sesi | Hapus bot |

---

## 7. KEAMANAN

1. **Anti-bot / Anti-curl** — File statis hanya disajikan ke browser asli. curl/wget dapat halaman "Checking your browser..."
2. **Anti-devtools** (`/security.js`) — Blokir F12, Ctrl+Shift+I, klik kanan, deteksi DevTools
3. **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, dll
4. **Hash password** — bcryptjs (support migrasi dari SHA-256)
5. **Rate limit IP** — Maks 3 akun per IP
6. **Session cap** — Maks 10 sesi per user
7. **Badwords filter** — Chat & username

---

## 8. FRONTEND — SCREENS & UI

### 8.1 Daftar Screen (hash routing)

| Hash | Screen ID | Keterangan |
|---|---|---|
| `#login` | `screen-login` | Login/Register form |
| `#dashboard` | `screen-dashboard` | Dashboard utama |
| `#generator` | `screen-generator` | AM Generator |
| `#profile` | `screen-profile` | Profil, API key, kredit |
| `#apiguide` | `screen-apiguide` | Dokumentasi API |
| `#admin` | `screen-admin` | Dashboard admin |
| `#chat` | `screen-chat` | Chat global |
| `#netflix` | `screen-netflix` | Netflix (under maintenance) |
| `#purchase` | `screen-purchase` | Pembelian role |
| `#lifetime` | `screen-lifetime` | Info & deploy bot (mahkota kuning) |
| `#referral` | `screen-referral` | Program referral |

### 8.2 Titik 3 Menu (Sidebar)

Menu di titik 3 (kanan atas):
- ⭐ Rating & Ulasan (bintang kuning)
- 👑 **Lifetime** (mahkota kuning)
- 🔗 **Referral Code**
- 📡 **Deploy Bot Telegram** (dipindah dari Profile)
- 🚪 Logout

### 8.3 Design System

- **Theme:** Dark premium (background `#09090B`, `#101014`, `#15151C`)
- **Accent:** `#7C4DFF` (indigo/violet), `#5B8CFF` (blue), `#00D4FF` (cyan)
- **Success:** `#22C55E`, Warning: `#F59E0B`, Error: `#EF4444`
- **Style:** Glassmorphism, soft shadows, rounded 12-20px, smooth animations
- **Font:** Inter (body), modern display fonts untuk heading

---

## 9. SISTEM REFERRAL

- **Format kode:** 6 karakter random (3 huruf/angka - 3 huruf/angka), contoh: `dtd-ana`
- **Link:** `https://am.alwayscodex.my.id/invite?code=CODE`
- **Register tanpa kode:** 20 credits
- **Register dengan kode valid:** +10 credits (user baru), +40 credits (inviter)
- **Screen referral:** Stats (total diundang, reward), claim button, activity accordion, how-it-works
- **Validasi:** `/api/invite/check?code=CODE` — cek apakah kode milik user yang valid

---

## 10. TELEGRAM BOT DEPLOY

### 10.1 Fitur Bot
- `/start` / `/help` — Menu utama dengan inline keyboard
- `/create <email>` — Kirim magic link verifikasi
- `/verify <email> <link>` — Verifikasi & aktivasi premium
- `/bulk <jumlah> [domain]` — Auto generator massal (khusus owner ID)
- `/id` — Cek ID chat

### 10.2 Batasan
- **Admin:** Maks 1 bot, hanya melihat bot sendiri
- **Owner:** Tanpa batasan
- **Rate limit:** 20 req/menit, 300 req/hari per chat
- **Bulk max:** 5 akun per batch

### 10.3 Auto-Restart
- Saat user reset API key → bot otomatis restart dengan token baru
- Token bot diupdate otomatis di `telegram_bots.json`

---

## 11. BATCH AUTO GENERATOR

- **Browser:** Puppeteer-core + Chrome headless
- **Proses:** Latar belakang (background worker)
- **Domain:** 155+ domain dari generator.email
- **Prefix:** Custom name (default: random)
- **Batch state:** Disimpan di `data/batch.json`
- **Notifikasi hasil:** Web (polling) + Telegram (jika bot terhubung)

---

## 12. HMR (HOT MODULE RELOAD)

- File: `src/hooks/hot-reload.js`
- Auto-reload saat file berubah (tanpa restart manual)
- Registry global (`globalThis`) untuk mempertahankan state bot Telegram
- PM2 tetap digunakan untuk process management

---

## 13. DOCKER

- **Base:** Ubuntu 22.04 + Node.js 22 + Google Chrome
- **Port:** 5000
- **Volume:** `am-data:/app/data` (persisten)
- **Healthcheck:** `curl http://localhost:5000/api/public/stats`

---

## 14. AKUN DEFAULT

| Username | Password | Role |
|---|---|---|
| `alwayscodex` | `Akunff+62` | owner |

---

## 15. PERUBAHAN TERBARU

### 10 Agustus 2026
- ✅ **IP Anggota & Pembersihan dihapus total** dari `#admin` (card, tab, tabel, form ban, cleanup button)
- ✅ `loadAdminIps` dibuat safe no-op (return early jika elemen tidak ada)
- ✅ Code examples di `#apiguide` (cURL, Node.js, Python, PHP) difix — sekarang muncul dengan benar
- ✅ Tombol "Back to Dashboard" di `#apiguide` dihapus
- ✅ Refresh halaman mempertahankan hash URL (tetap di screen yang sama)

### Sebelumnya (Agustus 2026)
- ✅ Tab-based redesign IP card (IP Anggota | Pembersihan) — lalu dihapus
- ✅ Bounded scroll container untuk IP list (max-height 420px desktop, min(360px,50vh) mobile)
- ✅ Screen Lifetime & Referral ditambahkan ke titik 3 menu
- ✅ Deploy bot Telegram dipindah dari Profile ke screen Lifetime
- ✅ Logo bintang rating diubah ke warna kuning
- ✅ Sistem referral: kode 6-char, inviter +40 credits, invitee +10 credits
- ✅ Register default 20 credits (turun dari 50)
- ✅ Admin reset all credits ke 20
- ✅ Role reseller/premium/autogen/admin support durasi (3/7/14/30 hari) + Lifetime
- ✅ API key tidak auto-generate, manual oleh user
- ✅ Reset API key → auto restart bot Telegram
- ✅ Notifikasi badge: lingkaran merah, style seperti ryzen
- ✅ Admin stat cards: logo modern
- ✅ Profil H2H Income di dashboard admin
- ✅ Bot Telegram: inline keyboard, tampilan bulk rapi
- ✅ Admin max 1 bot, owner unlimited
- ✅ Netflix: full proxy via proxysite.com (16 server US/EU)
- ✅ Netflix: fallback dihapus, respon murni dari pihak ketiga
- ✅ Netflix: halaman under maintenance
- ✅ Session fix: tidak logout sendiri (cap 10 sesi/user, cleanup 30 hari)
- ✅ HMR aktif (hot-reload.js)
- ✅ PM2 untuk process management
- ✅ `expired` diganti `Lifetime` untuk role permanen
- ✅ Credit text: "Kredit: 50 Credits"
- ✅ Security: anti-curl, anti-devtools, security headers
- ✅ Logo web preview: `public/images/logo.jpg`
- ✅ Dockerfile + README.md + .gitignore
- ✅ Welcome banner: "2026 AM Premium by Alwayscodex Project"

---

## 16. CATATAN PENTING

1. **Jangan ubah backend** tanpa sepengetahuan — semua perubahan fokus pada frontend
2. **Data di `data/`** adalah state runtime — wajib di-backup
3. **Server jalan via PM2** — `pm2 restart am` untuk restart
4. **HMR aktif** — perubahan file langsung reload tanpa restart PM2
5. **Chrome** dibutuhkan untuk auto generator (puppeteer-core)
6. **API pihak ketiga:**
   - `atlantich2h.com` — H2H payment/deposit
   - `nftools.aroshi.my.id` — Netflix token
   - `generator.email` — Email temporary untuk bulk
   - `ryezenstore.online` — Referensi UI/UX
7. **Session:** Cookie-based, max 10 sesi per user, cleanup 30 hari tidak aktif
8. **Password:** bcryptjs (auto-migrasi dari SHA-256)

---

> **Update terakhir:** 10 Agustus 2026 — IP Anggota & Pembersihan dihapus dari #admin
