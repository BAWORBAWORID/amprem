# 🧠 INGATAN — AM Premium Creator

> Dokumentasi lengkap seluruh state project per **12 Agustus 2026**.
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
    qris.js            → QRIS statis (TLV, CRC16, PNG)
    gopay.js           → GoPay merchant utility + watcher
    autocleanup.js     → Cleanup akun nonaktif + scheduler
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
| `services/auth.js` | 140 | AMAuth — magic link + verifikasi Alight Creative |
| `services/bulk.js` | 362 | Puppeteer bulk generator |
| `services/telegram/tele.js` | 517 | Runner Telegram legacy/pendukung |
| `src/utils/gopay.js` | 710 | GoPay Merchant, history, analytics, journal, watcher |
| `src/utils/autocleanup.js` | 162 | Cleanup akun gratis nonaktif + scheduler |
| `src/utils/qris.js` | 191 | Parser/encoder QRIS statis + generator PNG |
| `test/gopay-login.test.js` | 114 | Test import, kredensial kosong, cache, watcher |
| `ecosystem.config.cjs` | - | Konfigurasi PM2 + AM_HMR=1 |
| `dec.js` | - | Tool decode halaman referensi ryezenstore.online |
| `gobiz-probe.mjs` | - | Probe request GoBiz menggunakan Playwright |

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
- QRIS statis dibuat oleh `src/utils/qris.js`, disimpan di `data/qris/`, dan dilayani melalui `/files/*`.
- Harga QRIS dibaca dari `settings.json` (`qris.prices`), bukan dari amount yang dipercaya dari client.
- Order QRIS memiliki status `pending/success/failed/expired` dan masa berlaku default 30 menit.

### 5.14 API Guide (`#apiguide`)
- Dokumentasi API profesional
- Code examples: cURL, Node.js, Python, PHP
- Copy button, syntax highlighting
- Bisa diakses semua role

### 5.15 GoPay Merchant Utility
- Implementasi berada di `src/utils/gopay.js` dan berkomunikasi dengan `https://api.gobiz.co.id`.
- `GoPayMerchant` mendukung login berbasis `GOPAY_EMAIL`/`GOPAY_PASSWORD`, validasi token, deteksi merchant, history transaksi, analytics, dan journal.
- Cache token/merchant disimpan lokal di `src/utils/.gopay_cache.json`; kredensial dibaca dari `src/utils/.env` dan tidak boleh dimasukkan ke frontend atau dokumentasi publik.
- `GoPayWatcher` memakai polling/event emitter untuk memantau pembayaran dan memiliki singleton watcher melalui `getGoPayWatcher()`.
- **Status integrasi:** utility dan test sudah tersedia, tetapi tidak ada route `/api/gopay/*` publik yang terdaftar di `src/routes/api.js`. Endpoint pembayaran publik saat ini adalah QRIS di bawah `/api/payment/*`.

### 5.16 Auto-Cleanup Akun Nonaktif
- Modul: `src/utils/autocleanup.js`.
- Hanya menyasar akun gratis dengan role `user` yang sudah melewati batas umur dan belum memiliki sinyal aktivitas.
- Role berbayar/admin/owner dan akun yang dibanned manual selalu dikecualikan.
- Sinyal aktivitas meliputi login, riwayat, sesi aktif, kredit yang berubah dari default 20, API aktif, atau aktivitas referral.
- Konfigurasi berada di `data/settings.json` pada `autoCleanup`: `enabled`, `hours`, `lastRun`, `lastCount`.
- Scheduler berjalan 1 menit setelah boot, lalu setiap 60 menit. Konfigurasi runtime saat dokumentasi ini diperbarui: aktif, batas 24 jam.

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
- **Entry:** `npm start` menjalankan `node index.js`; PM2 digunakan untuk deployment host bila diperlukan.
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

### 12 Agustus 2026 — Sinkronisasi Struktur Server Modular
- ✅ Struktur aktual `index.js` → `src/app/index.js` → middleware/routes didokumentasikan.
- ✅ Ditambahkan dokumentasi `src/utils/gopay.js`, `src/utils/autocleanup.js`, `ecosystem.config.cjs`, dan `test/gopay-login.test.js`.
- ✅ Dicatat bahwa GoPay masih berupa utility/test dan belum memiliki route `/api/gopay/*` publik.
- ✅ QRIS statis, route `/files/*`, scheduler auto-cleanup, dan konfigurasi `AM_HMR=1` didokumentasikan.

### 11 Agustus 2026 — Login/Register Bersih Tanpa Topbar (sesuai git HEAD)
- ✅ Keputusan user: halaman auth (login/register) TIDAK menampilkan topbar — persis perilaku git HEAD (kotak login bersih, tanpa ⋮/brand/ikon)
- ✅ Kembalikan `$('mobile-top-bar').classList.add('hidden')` di `updateNavbar` (guest) + `showScreen('auth')`; hapus mekanisme `body.auth-mode` (JS toggle + rule CSS ≥769px) yang kini redundan
- ✅ Setelah login topbar + ⋮ muncul kembali; setelah logout kembali bersih. Drawer AKSES tamu tetap ada di kode (tapi tidak bisa dibuka dari layar login — per desain, login/register/WA/APK sudah ada di halaman)
- ✅ Test: guest mobile/desktop bersih full-width tanpa overflow; login → topbar flex + ⋮; logout → bersih; regresi drawer 12/12 PASS; versi `v=20260811-8` live

### 11 Agustus 2026 — Drawer Tamu Terpisah (AKSES)
- ✅ Menu ⋮ untuk tamu = section **"AKSES"** (label berubah MENU→AKSES): Login · Register · WhatsApp · APK — grup navigasi home TIDAK dirender untuk tamu
- ✅ Item `data-auth-tab="login|register"` → showScreen('auth') + klik `link-to-login`/`link-to-register` (tab bertukar benar, drawer tertutup); `.mobile-drawer-login-btn` diberi aksen warna
- ✅ Logout drawer hanya untuk yang login

### 11 Agustus 2026 — FIX MOBILE DASHBOARD BLANK/TERGESER
- 🔴 **Root cause (bukan CSS responsive, tapi DOM rusak)**: edit pemindahan tombol ⋮ kemarin menghilangkan `</div>` penutup `#mobile-top-bar` → SEMUA `<section class="screen">` terkurung di dalam topbar (flex row `space-between`) → dashboard terdorong ke kanan (x≈261, lebar 33px), card menciut `42px 42px` → terlihat blank/kosong kiri. Gejala persis laporan screenshot
- ✅ **Fix**: tambah `</div>` tutup topbar sebelum `<section id="screen-auth">`; buang `</div>` yatim setelah `</main>`; tambah 1 `</div>` penutup `admin-control-card` yang kurang (bug template lama di `#admin-duplicates-card` — 5 div buka, 4 tutup)
- ✅ Verifikasi: stack-walk semua tag balance 355/355; DOM benar (screen→main, drawer/overlay→body); viewport 360/375/390/412/430 → stats grid full width (x=10, 2 kolom), tanpa horizontal overflow, tanpa error JS; invite `?code=dtd-ana` normal (banner muncul, param dipertahankan); regresi drawer 12/12 PASS; guest ⋮ kiri x=21
- ⚠️ Pelajaran: setelah edit HTML manual WAJIB cek keseimbangan tag + parent chain di browser (script stack-walk di simpan dalam ingatan ini)
- ✅ Versi asset bump `v=20260811-5`, CF sudah serve

### 11 Agustus 2026 — FIX BLANK PAGE + ⋮ Menu untuk Tamu
- 🔴 **Root cause blank**: browser user memakai `home.js?v=20260810` LAMA dari cache (URL tidak di-bump) + HTML baru (element `#btn-sidebar-toggle` sudah dihapus) → `Cannot read properties of null (reading 'addEventListener')` → JS init mati → layar blank. Dibuktikan via simulasi Playwright (stale JS + new HTML = blank; keduanya baru = OK)
- ✅ **Fix**: semua asset di `home.html` di-bump `v=20260811-3` (7 file: home.js, enhance.js, 4 css, security.js) → browser paksa ambil JS baru. CF sudah menyajikan versi baru (md5 cocok dengan lokal)
- ✅ Duplikat `sweetalert2@11` (2x load) dihapus — cukup 1 di `<head>`
- ✅ **⋮ untuk tamu**: topbar + `#btn-mobile-menu-trigger` (kanan atas) kini tampil juga di layar login/guest di MOBILE (tadinya `hidden` oleh `updateNavbar`/`showScreen('auth')`); body class `auth-mode` + CSS ≥769px menahan topbar tetap tersembunyi di DESKTOP (desain login lama tidak berubah)
- ✅ Drawer tamu: item "Masuk / Daftar" (→ `#screen-auth`) + link WhatsApp/APK, tombol Logout di footer drawer disembunyikan
- ✅ `bindNav` di-hardening: semua binding drawer/trigger pakai null-guard
- ✅ Test headless: guest (⋮ terlihat x=327/390, drawer 15 item/4 grup, tanpa grup admin, logout hidden, klik "Masuk/Daftar" → login screen) + logged-in (16 item/5 grup) + desktop guest (topbar none) + desktop login (topbar none by design — `.mobile-top-bar` memang mobile-only) + regresi 12/12 PASS
- ⚠️ Cleanup session: hapus HANYA session hasil test (userId owner-msgsyfbc + mtime <20 menit); session asli (turzz, manustest123) dibiarkan

### 11 Agustus 2026 — Mobile Menu (Drawer ⋮) untuk `home.html`
- ✅ **UI mobile baru**: topbar kini punya brand (cube AM CREATOR) di kiri + tombol ⋮ (`.mobile-menu-trigger`, 42×42) di kanan; hamburger lama `#btn-sidebar-toggle` dihapus
- ✅ **Drawer**: `.mobile-drawer` (min(340px,82vw), 100dvh, slide `translateX(-100%) → 0` .22s, z-9999, `--bg-sidebar`) + `.mobile-drawer-overlay` (blur 5px, z-9998); dibuka ⋮ / ditutup overlay / × / ESC (keydown), scroll body di-lock saat terbuka
- ✅ **Navigasi**: struktur kategori accordion (`.mobile-nav-cat` + chevron rotate 180°), satu-buka-satu (buka 1 → tutup lain), submenu `max-height 0 → 480px` .25s
- ✅ **Router**: klik item → `location.hash` di-set → drawer auto-tutup + item jadi `.active` (sync via `#app-router` popstate)
- ✅ **Role-aware**: kategori Pengaturan Admin hanya dirender utk owner; kategori Layanan & API/Support & APK utk admin+owner (aturan sama seperti `.sidebar-nav`)
- ✅ **CSS**: di `premium-polish.css` (section `MOBILE MENU`); media query: ≤768 `#app-sidebar{display:none!important}` + drawer/trigger tampil; ≥769 elemen mobile disembunyikan
- ✅ **Test headless (Playwright)**: 12/12 PASS — build drawer per role (owner: 5 grup/16 item), ⋮+overlay+scroll lock, accordion + chevron, satu-buka-satu, routing `#lifetime`, active-sync `#referral`, ESC/overlay/× tutup, desktop flat (16 link sidebar), mobile tidak overflow horizontal, link eksternal (WhatsApp/APK) utuh
- ⚠️ **Catatan**: `data/sessions/` ter-track git; saat cleanup manual jangan hapus session mtime < 30 menit (bisa session live)

### 11 Agustus 2026 — QRIS Static Payment (update.md Part 7–8)
- ✅ **`src/utils/qris.js`** (baru): `parseTLV` (tag 2-char), `buildTLV`, `crc16ccitt` (0x1021/0xFFFF — sanity test string DANA = `0343` ✓), `withCRC`, `normalizeAmount` (regex `^\d+$` + safe integer), `setAmount` (tag 54 disisipkan setelah tag 53, CRC dihitung ulang), `generatePaymentQRIS(amount)` → PNG via paket `qrcode` (satu-satunya dep baru) ke `data/qris/`
- ✅ **`POST /api/payment/qris`** (auth + gate `maintenance.purchase`): body `{role, days}` (klien TIDAK kirim amount); harga dari `settings.qris.prices` (seed = tabel UI `PLAN_PRICES`); order `{refNo 'AM'+8, role, days, plan, amount, status:'pending', createdAt, expiresAt (+30 menit), method:'QRIS'}` di `transactions.json`; respon `{order:{id,refNo,amount,status,expiresAt}, payment:{method:'QRIS',qr:{url:'/files/...png'}}}`
- ✅ **`GET /api/payment/status/:refNo`** diperluas: `amount/plan/expiresAt` + auto `expired` jika lewat waktu
- ✅ **`POST /api/payment/cancel`** diisi (dulu stub no-op): pending → `failed` + log
- ✅ **Approve diperluas** (kompatibel lama): bila `tx.role`+`tx.days` → reseller (web-only, lifetime, tanpa API key) / autogen / premium|admin (`apiPlan` = `lifetime` jika days≥90, else `expired` + `apiExpiresAt = now+days`); jalur lama `lifetime/monthly/autogen` tetap
- ✅ **Route `/files/*`** → serve `data/qris/` (anti-traversal, gambar utuh utk semua request)
- ✅ **Frontend**: klik "QRIS (E-Wallet)" di modal metode → `startQRISPayment()` (home.js) → modal "Pembayaran QRIS Otomatis": QR image `min(360px,82vw)`, total `id-ID`, countdown dari `expiresAt`, tombol **Cek Status** (pending→tahan / success→refresh profil+tutup / expired→disable / failed→tutup) & **Batal** (panggil cancel dulu); DANA/GoPay/OVO/Shopee tetap → WhatsApp
- ✅ CSS `.payment-qris-*` di `premium-polish.css` (pakai CSS vars theme)
- ⚠️ **Go-live**: set `settings.json` → `maintenance.purchase = false`

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

1. **Jangan ubah backend** tanpa sepengetahuan — semua perubahan fokus pada frontend, kecuali user meminta perubahan server secara eksplisit
2. **Data di `data/`** adalah state runtime — wajib di-backup
3. **Server jalan via PM2** — gunakan `ecosystem.config.cjs`; `pm2 restart am` untuk restart penuh
4. **HMR aktif** — dengan `AM_HMR=1`, perubahan `src/` dan `services/` reload tanpa restart proses
5. **Chrome** dibutuhkan untuk auto generator (puppeteer-core)
6. **GoPay credentials** hanya di `src/utils/.env`; jangan expose ke frontend, git, log, atau `ingatan.md`
7. **API pihak ketiga:**
   - `atlantich2h.com` — H2H payment/deposit
   - `nftools.aroshi.my.id` — Netflix token
   - `generator.email` — Email temporary untuk bulk
   - `ryezenstore.online` — Referensi UI/UX
8. **Session:** Cookie-based, max 10 sesi per user, cleanup 30 hari tidak aktif
9. **Password:** bcryptjs (auto-migrasi dari SHA-256)

---

> **Update terakhir:** 12 Agustus 2026 — Dokumentasi disinkronkan dengan struktur server modular, GoPay utility, auto-cleanup, PM2/HMR, dan test suite.
