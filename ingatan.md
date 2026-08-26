# AM Creator - System Documentation

> **Version: 1.5.0** — Terakhir diupdate: Agustus 2026

## Overview
AM Creator adalah sistem generator akun Alight Motion Premium dengan manajemen role, Telegram bot deployment, Netflix token generator, API key system, dan panel admin.

## Role Hierarchy
```
user < pro < reseller < premium < vip < owner
```

### Role Permissions

| Role | Level | Layanan VIP | Deploy Bot | Max Bots | Bulk/AutoGen + Custom ORDER ID | API Key | Credits |
|------|-------|-------------|------------|----------|--------------|---------|---------|
| user | 0 | ❌ | ❌ | - | ❌ | ❌* | **50/hari, reset penuh jam 00.00 WIB** |
| pro | 1 | ✅ | ✅ | 1 | ❌ | ✅ | **100/hari, reset penuh jam 00.00 WIB** |
| reseller | 2 | ✅ (status) | ❌ | - | ❌ | ❌ | Unlimited Web |
| premium | 3 | ✅ (status) | ❌ | - | ❌ | ✅ | Unlimited Web + API |
| vip | 4 | ✅ penuh | ✅ | 3 | ✅ | ✅ | Unlimited + Bulk |
| owner | 5 | ✅ penuh | ✅ | ∞ | ✅ | ✅ | Unlimited + Superuser |

*user bisa pakai API key jika maintenance.apikeyUserDisabled = false

**Catatan penting role:**
- **Admin Panel = OWNER ONLY** (`isAdminOrOwner()` frontend + `requireAdmin()` backend). VIP TIDAK punya akses admin panel.
- Reset kredit = SET PENUH ke nilai harian (bukan top-up). Implementasi: `ROLE_DAILY_CREDITS = { user: 50, pro: 100 }` di `src/utils/auth.js`, timezone Asia/Jakarta.
- Bulk Auto Generator hanya VIP & Owner (`hasBulkRole`) — fitur **Custom ORDER ID** ikut hak ini.

---

## Core Features

### 1. Alight Motion Generator (NATIVE — tanpa axios/API perantara)
- **Manual Generator**: kirim magic link langsung ke Google Identity Toolkit → user tempel link → verifikasi oobCode → aktivasi premium via cloudfunctions `verifyPurchase`
- **Auto Generator (Bulk)**: hanya VIP & Owner, maks 500 akun/batch
- **Custom ORDER ID** (VIP/Owner): dikirim dari form Auto Generator → `POST /api/am/autogen/start-batch` (field `prefix`) → diteruskan ke `new AlightMotionService(orderId)` di worker via **stdin**
- **ORDER_ID default**: format acak Google Play — `GPA.<4digit>.<4digit>.<4digit>.<5digit>` (contoh: `GPA.5926.6296.2753.27637`)
- `generateCodeOrder()` tetap ada sebagai kode referensi internal (muncul sebagai `codeorder` di hasil/riwayat)

### 2. services/auth.js — NATIVE AM Service
- Port dari am.js lama, HTTP client pakai **fetch native** (tanpa axios)
- `sendMagicLink(email)` → createAuthUri + getOobConfirmationCode (langsung Google)
- `verifyAndFetchProfile(email, rawLink)` → extractOobCode + emailLinkSignin + getAccountInfo
- `applyPremium(idToken)` → verifyPurchase cloudfunctions, orderId = `ORDER_ID` apa adanya
- Constructor: `new AlightMotionService(customOrderId?)` — prioritas argumen > default GPA acak (**tanpa env var**)

### 3. Auto Generator Engine (bulk)
- **Web (#generator)**: `src/utils/am.js startBatch()` → `runBulk()` di `services/bulk.js`
- **Engine aktif**: child-process spawn `services/mailtm-worker.cjs` — akun temp mail dibuat lewat **UI mail.tm (Puppeteer)**, browser ditutup SEBELUM magic link dikirim (urutan terbukti berhasil; versi in-process konsisten gagal terima email)
- Worker memakai **native auth** (dynamic import `./auth.js`), custom ORDER ID diterima lewat **stdin**
- Hasil per akun dikomunikasikan via stdout `###RESULT### {json}` (email, password mail.tm, codeorder, status)
- Fallback engine: `services/generator-email-worker.cjs` (inbox publik generator.email, nama/domain bebas)

### 4. CLI Bulk (root/bulk.js)
```bash
node bulk.js list                       # daftar domain generator.email (fallback statis)
node bulk.js --auto                     # 1 akun
node bulk.js --auto --count 5           # 5 akun
node bulk.js --name codex               # prefix nama email
node bulk.js --domain softbank.id       # domain khusus
node bulk.js --name codex --domain ...  # kombinasi
```

### 5. Telegram Bot Deployment
- Role deploy: **pro (1 bot), vip (3 bot), owner (unlimited)** — cek `deployBot()` telegram.js
- Bot jalan in-process long-polling; runner punya **AbortController** → stop/swap instan tanpa konflik 409 saat HMR
- Menu /start (inline keyboard):
  - 🚀 Start Bot | 🛒 Sewa Bot
  - 🎁 Redeem Voucher | 🤝 Undang Teman
  - 🎬 **Netflix Generator**
  - ⚙️ Fitur Owner
- User Info menampilkan Akses/Status yang di-cross-reference dari users.json (role website)
- `/id` menampilkan chat id dalam monospace (tap-to-copy)
- **Sewa Bot**: paket 7 Hari Rp 15.000 / 30 Hari Rp 50.000 (konfirmasi → WA owner)
- **Anti-stuck bulk**: saat `autogen_running`, /start tetap menampilkan menu utama (+info), semua tombol/perintah lain jalan normal, `/cancel` menghentikan notifikasi saja, poller membersihkan state basi otomatis (batch hilang ≥30 detik)

### 6. Netflix Generator
- Service: `services/netflix.js` — port penuh dari scraper teruji (rotasi proxy publik, tunnel CONNECT, UA pool, parsing chunked/gzip, PoW solver, pool cache globalThis)
- Dipakai oleh: web `#screen-netflix` (`POST /api/am/netflix/token`) dan tombol Telegram 🎬 Netflix Generator
- Plan: premium / standard / basic; output URL nftoken + expiry ±1 jam
- Catatan: jangan bungkus ulang `generateNFToken()` am.js untuk kebutuhan baru — gunakan services/netflix.js (parser am.js minim header & tak dukung chunked/gzip)

### 7. API Key System
- Generate/Revoke API Key di halaman Profil
- Role support: pro, premium, vip, owner (+ user kondisional)
- Endpoints v1: `/api/v1/bot-premium/send-link`, `/activate`
- Auth: Header `x-api-key`, query `apikey`, atau JSON body

### 8. Referral System
- Reward: +40 kredit per referral sukses
- Link referral unik per user, klaim manual via halaman Referral

### 9. Admin Panel (OWNER ONLY)
- User management (role, credits, ban/unban, hapus, reset password)
- Global activity logs, QRIS transaction monitoring
- Upgrade user verification, maintenance toggles per feature
- Auto-cleanup inactive accounts, income panel (H2H)
- Guard: `requireAdmin()` = owner saja (semua cek vip lama sudah dihapus — dead code)

---

## API Endpoints

### Public
- `GET /api/public/stats` - Stats server (total users, total success, uptime proses)
- `GET /api/am/domains` - Domain email TERVERIFIKASI (hardcoded `GENEMAIL_VERIFIED_DOMAINS` di src/utils/am.js — BUKAN scraping live)
- `GET /api/am/netflix/token` - Generate NFToken (web Netflix Crack)
- `GET /api/invite/check?code=` - Cek kode referral

### Auth
- `POST /api/auth/login` / `register` / `logout` / `change-password`
- `GET /api/auth/me`, `GET /api/auth/profile`

### Generator
- `POST /api/am/send-link` - Kirim magic link (potong kredit utk role berbayar-kredit)
- `POST /api/am/claim-premium` - Aktivasi premium via magic link (opsional body.orderId utk custom)
- `GET /api/am/history` - Riwayat aktivasi user
- `POST /api/am/autogen/start-batch` - Mulai bulk (VIP/Owner; body: count, prefix=ORDER_ID)
- `GET /api/am/autogen/active-batch` - Progress batch

### Runtime (Dashboard)
- Uptime = `process.uptime()` dari `/api/public/stats`; frontend tick realtime tiap detik + sync berkala; format mendukung Seconds → Minutes → HH:MM:SS → Days/Months/Years

### Telegram Bot (via aplikasi, bukan endpoint publik)
- Deploy/start/stop/restart/remove/list bot — guard role di `deployBot()`

### Purchase
- `POST /api/payment/qris`, `GET /api/payment/status`

### Admin (OWNER ONLY)
- Lihat daftar lengkap di src/routes/api.js (users, role, credits, ban, logs, transactions, upgrades approve, settings, h2h, clear-akun-ry)

---

## Database Structure (JSON Files, folder data/)

### users.json
Field utama: id, username, password(bcrypt), role, credits, creditResetDate, apiKey, apiPlan(lifetime/monthly/dll), apiExpiresAt(null=lifetime), apiActive, banned, ip, device, referral*, lastLoginAt.

### telegram_bots.json
Array: id, name, token, ownerId, apiKey, deployedBy, role, status(online/offline/error), startedAt, error.

### telegram_users.json
Map by telegram-id: quota, totalAccounts, referredBy, referrals[].

### activations.json
Array log aktivasi: operator, email, status(success/failed), note, createdAt.

### batch.json
State auto generator aktif: id, operator, domain(s), count/done, prefix(**ORDER ID**), emails[], results[], status(running/completed/failed/aborted/stalled), logs[], notify(Telegram).

### settings.json
maintenance toggles (generator/netflix/chat/purchase/apikeyUserDisabled), autoCleanup{enabled,hours}.

---

## Frontend Architecture

### Screens (public/home.html — single mega-line per section)
auth, dashboard(stats+battery+IP+runtime), generator(manual+auto tabs), vip, netflix, purchase, history, profile, referral, chat, apiguide(docs), contributors, reviews, admin(owner), settings(owner).

### Key JS Functions (public/js/home.js)
- `showScreen(name)` — router hash; `VALID_SCREENS` termasuk 'vip' (bukan 'lifetime')
- `bindGeneratorTabs()` + form handlers Manual/Auto (guard dataset.bound anti double-bind)
- Auto tab: TANPA dropdown domain; toggle "Custom ORDER ID" → field prefix
- `safeNumber(v,f)` & `formatDuration(sec)` — anti-NaN helpers
- `isAdminOrOwner()` = ['owner'] saja
- Domain dropdown diisi dari `GET /api/am/domains` (fallback statis 3 domain)
- Semua asset/link pakai PATH RELATIVE (/, /images/*, /alwayscodex.apk, /security.js) — tidak ada hardcode domain

### Static Anti-Bot
- `security.js` + DECOY_HTML "Just a moment..." utk non-browser (kecuali gambar) — curl pola dapat decoy, browser dapat file asli

---

## Backend Architecture

### Entry Point
- `server.js` (shim) → `index.js` (HTTP server + HMR watcher + global error handlers **non-exit**) → dynamic import `src/app/index.js`
- `src/app/index.js` → seedOwner, initTelegramBots(), middleware+routes; dipanggil ulang tiap HMR reload

### HMR System (penting!)
- Watcher `fs.watch` recursive pada `src/` & `services/` (.js/.cjs/.json) — AM_HMR=1
- Cache-buster: `src/hooks/hot-reload.js` registerHooks resolve → sisipkan `?amts=<stamp>` utk SEMUA modul src/+services/ sehingga seluruh graph dimuat ulang
- **Telegram runner restart instan**: tiap runner punya AbortController; `runner.stop()` abort getUpdates yang long-poll (tidak nunggu 30–45s) → tidak pernah 409 conflict
- **Proses tidak mati saat update**: index.js `uncaughtException`/`unhandledRejection` = LOG ONLY (bukan exit). Edit telegram.js → hot-swap ±2 detik, PID tetap
- fileSig() telegram.js (mtime:size) dipakai initTelegramBots utk deteksi & restart runner dgn kode baru

### Utils (src/utils/)
- `auth.js` — role hierarchy, ROLE_DAILY_CREDITS, prepareApiRole, session helpers
- `telegram.js` — multi-bot manager, menu/callback handlers, Sewa Bot, Netflix Generator button
- `am.js` — native AM calls wrapper (sendLink/claimPremium), batch engine, GENEMAIL_* domain lists (VERIFIED = sumber dropdown), generateNFToken (legacy; utk kebutuhan baru pakai services/netflix.js)
- `netflix` service ada di **services/netflix.js**

### Services (services/)
- `auth.js` — NATIVE AM (Google/Firebase/cloudfunctions direct, fetch native)
- `bulk.js` — orchestrator bulk web: spawn child `mailtm-worker.cjs` per akun, parse `###RESULT###`, orderId via stdin
- `mailtm-worker.cjs` — Puppeteer UI mail.tm (akun+password), browser close sebelum kirim, poll api.mail.tm, native verify+premium
- `generator-email-worker.cjs` — engine generator.email (CLI fallback)
- `netflix.js` — Netflix token generator (engine tes.cjs)

---

## Deployment

### PM2 (ecosystem.config.cjs)
name `am`, script `./server.js`, env NODE_ENV=production, PORT=5000, AM_HMR=1.

### Commands
```bash
pm2 start ecosystem.config.cjs && pm2 save
pm2 logs am            # live logs
pm2 status             # status
# JANGAN asal pm2 restart utk update kode — HMR sudah handle src/+services/
```

### APK Build
```bash
node apk.js "<url>" "<appName>" <iconPath> [packageName] [versionName]
# output: public/alwayscodex.apk (+ arsip src/apk/) — timeout build 600s
```

### Docker (Dockerfile sudah diperbaiki)
- Node 22 NodeSource + Google Chrome stable + runtime libs (libnss3, libgbm1, dll)
- COPY: server.js index.js, src/, services/, public/ (security.js ikut public/)
- Volume /app/data wajib di-mount; healthcheck fetch port 5000

---

## Security Features
- bcrypt password, HttpOnly cookies, rate limiting, security headers
- DevTools detection overlay (security.js), anti-bot DECOY utk tool otomatis
- Role-based authorization backend (bukan cuma frontend hide)
- Tanpa expose secret ke frontend (password/token hanya hash/sanitized)

## Known Issues / TODO
- [ ] Rate limiting per user (saat ini per IP)
- [ ] WebSocket real-time (chat/bot status)
- [ ] Backup otomatis folder data/
- [ ] Unit tests fungsi kritikal
- [ ] generator.email kadang blokir IP (503 Access temporarily limited) — engine utama bulk sudah pakai mail.tm; CLI masih generator.email
