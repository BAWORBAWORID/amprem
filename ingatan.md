# AM Creator - System Documentation

## Overview
AM Creator adalah sistem generator akun Alight Motion Premium dengan manajemen role, Telegram bot deployment, API key system, dan panel admin.

## Role Hierarchy
```
user < pro < reseller < premium < vip < owner
```

### Role Permissions

| Role | Level | Layanan VIP | Deploy Bot | Max Bots | Bulk Feature | API Key | Credits |
|------|-------|-------------|------------|----------|--------------|---------|---------|
| user | 0 | ❌ | ❌ | - | ❌ | ❌* | 50/hari (max 150) |
| pro | 1 | ✅ | ✅ | 1 | ❌ | ✅ | 200/bulan |
| reseller | 2 | ✅ | ❌ | - | ❌ | ❌ | Unlimited Web |
| premium | 3 | ✅ | ❌ | - | ❌ | ✅ | Unlimited Web + API Single |
| vip | 4 | ✅ | ✅ | 3 | ✅ | ✅ | Unlimited + Bulk |
| owner | 5 | ✅ | ✅ | ∞ | ✅ | ✅ | Unlimited + Superuser |

*user bisa pakai API key jika maintenance.apikeyUserDisabled = false

---

## Core Features

### 1. Alight Motion Generator
- **Manual Generator**: Kirim link verifikasi email → user tempel link → aktivasi premium
- **Auto Generator (Bulk)**: Hanya VIP & Owner, maks 500 akun/batch
- **Credits System**: User gratis 50 kredit/hari (max 150), Pro 200/bulan

### 2. Telegram Bot Deployment
- Role yang bisa deploy: **pro, vip, owner**
- Limits: Pro=1 bot, VIP=3 bot, Owner=unlimited
- Bot dijalankan in-process via long-polling
- Perintah bot: `/start`, `/create`, `/verify`, `/bulk`, `/id`

### 3. API Key System
- Generate/Revoke API Key di halaman Profil
- Role yang support: premium, vip, owner, pro
- Endpoints: `/send-link`, `/activate`
- Auth: Header `x-api-key`, query `apikey`, atau JSON body

### 4. Referral System
- Reward: +40 kredit per referral sukses
- Link referral unik per user
- Klaim kredit manual via halaman Referral

### 5. Netflix Crack
- Generate token Netflix Premium (UHD/4K)
- Butuh VPN untuk akses
- Login options: PC, Android, Smart TV

### 6. Admin Panel
- User management (role, credits, ban/unban)
- Global activity logs
- QRIS transaction monitoring
- Upgrade user via WhatsApp verification
- Maintenance toggles per feature
- Auto-cleanup inactive accounts
- Income panel (H2H)

---

## API Endpoints

### Public
- `GET /api/public/stats` - Stats server (total users, total success, uptime)
- `GET /api/am/domains` - Domain email terverifikasi
- `GET /api/invite/check?code=` - Cek kode referral

### Auth
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register
- `POST /api/auth/change-password` - Ganti password
- `GET /api/auth/me` - Info user aktif
- `POST /api/auth/logout` - Logout

### Generator
- `POST /api/am/send-link` - Kirim link verifikasi (1 kredit)
- `POST /api/am/claim-premium` - Aktivasi premium via magic link
- `GET /api/am/history` - Riwayat aktivasi user

### Telegram Bot
- `POST /api/am/bot/deploy` - Deploy bot (Pro/VIP/Owner)
- `POST /api/am/bot/stop` - Stop bot
- `POST /api/am/bot/start` - Start bot
- `POST /api/am/bot/restart` - Restart bot
- `POST /api/am/bot/remove` - Hapus bot
- `GET /api/am/bot/list` - List bot user

### API Key
- `POST /api/am/apikey/generate` - Generate API key
- `POST /api/am/apikey/revoke` - Revoke API key
- `GET /api/am/apikey/status` - Status API key

### Referral
- `GET /api/am/referral` - Data referral user
- `POST /api/am/referral/claim` - Klaim reward referral

### Purchase
- `POST /api/payment/qris` - Buat pembayaran QRIS
- `GET /api/payment/status` - Cek status pembayaran

### Admin
- `GET /api/admin/stats` - Stats admin
- `GET /api/admin/users` - List user (filter role, status)
- `POST /api/admin/user/role` - Ubah role user
- `POST /api/admin/user/credits` - Tambah/kurang kredit
- `POST /api/admin/user/ban` - Ban/unban user
- `GET /api/admin/logs` - Log aktivitas global
- `GET /api/admin/transactions` - Transaksi QRIS
- `GET /api/admin/upgrades` - Upgrade user pending
- `POST /api/admin/upgrades/approve` - Approve upgrade
- `GET /api/admin/settings` - Settings (maintenance, auto-cleanup)
- `POST /api/admin/settings` - Update settings
- `GET /api/admin/h2h` - Income panel H2H

---

## Database Structure (JSON Files)

### data/users.json
```json
{
  "username": {
    "id": "unique-id",
    "username": "string",
    "password": "bcrypt-hash",
    "role": "user|pro|reseller|premium|vip|owner",
    "credits": 0,
    "apiKey": "string",
    "apiPlan": "lifetime|monthly|expired|pro|reseller|premium|vip",
    "apiExpiresAt": "ISO-date|null",
    "apiActive": true,
    "apiKeyRevoked": false,
    "createdAt": "ISO-date",
    "banned": false,
    "ip": "string",
    "device": "string",
    "referralCode": "string",
    "referralCount": 0,
    "referralEarned": 0,
    "referralPending": 0,
    "referrals": [...],
    "referralClaimed": 0,
    "lastLoginAt": "ISO-date"
  }
}
```

### data/telegram_bots.json
```json
[
  {
    "id": "unique-id",
    "name": "string",
    "token": "string",
    "ownerId": "string",
    "apiKey": "string",
    "deployedBy": "username",
    "role": "pro|vip|owner",
    "status": "online|offline|error",
    "createdAt": "ISO-date",
    "startedAt": "ISO-date|null",
    "error": "string|null"
  }
]
```

### data/activations.json
```json
[
  {
    "timestamp": "ISO-date",
    "operator": "username",
    "targetEmail": "string",
    "status": "success|failed",
    "note": "string",
    "creditsUsed": 1
  }
]
```

### data/transactions.json
```json
[
  {
    "id": "string",
    "username": "string",
    "refNo": "string",
    "amount": 0,
    "plan": "pro|reseller|premium|vip",
    "days": 0,
    "status": "pending|success|failed|expired",
    "createdAt": "ISO-date",
    "expiresAt": "ISO-date|null"
  }
]
```

### data/settings.json
```json
{
  "maintenance": {
    "generator": false,
    "netflix": false,
    "chat": false,
    "purchase": false,
    "apikeyUserDisabled": false
  },
  "autoCleanup": {
    "enabled": false,
    "hours": 168
  }
}
```

---

## Frontend Architecture

### Screens (public/home.html)
- `#screen-auth` - Login/Register
- `#screen-dashboard` - Stats live, credits, battery, IP, runtime
- `#screen-generator` - Manual + Auto Generator tabs
- `#screen-vip` - Layanan VIP (status paket, deploy bot)
- `#screen-netflix` - Netflix Crack
- `#screen-purchase` - Beli role/paket
- `#screen-history` - Riwayat aktivasi + download .txt
- `#screen-profile` - Profil, API key, ganti password
- `#screen-referral` - Referral link, stats, klaim reward
- `#screen-chat` - Global live chat
- `#screen-apiguide` - Dokumentasi API
- `#screen-admin` - Admin panel (hanya Owner/VIP)
- `#screen-settings` - Settings maintenance (Admin)
- `#screen-reviews` - Rating & ulasan
- `#screen-contributors` - Kontributor project

### Key JS Functions (public/js/home.js)
- `showScreen(name)` - Router screen dengan hash
- `loadVipScreen()` - Load Layanan VIP (check permission)
- `loadDashboard()` - Stats + polling uptime 5s
- `loadGenerator()` - Manual + Auto generator
- `loadNetflix()` - Netflix crack
- `loadProfile()` - Profil + API key management
- `loadAdminPanel()` - Admin panel (Owner/VIP only)
- `canAccessVipService(role)` - Centralized permission check
- `canDeployTelegramBot(role)` - Pro/VIP/Owner
- `hasBulkAccess(role)` - VIP/Owner only

### HMR (Hot Module Replacement)
- `AM_HMR=1` di PM2 ecosystem
- `fs.watch` pada `src/` dan `services/`
- `bump()` update timestamp untuk cache busting
- Dynamic import app engine dari `src/app/index.js`

---

## Backend Architecture

### Entry Point
- `server.js` → shim ke `index.js`
- `index.js` → HTTP server + HMR watcher + load app engine
- `src/app/index.js` → App engine (middleware + routes)

### Middleware (src/middleware/)
- Security headers
- Rate limiting
- CORS
- Body parser
- Session/cookie handling

### Routes (src/routes/api.js)
Semua endpoint `/api/*` terpusat di sini

### Utils (src/utils/)
- `auth.js` - Role permissions, session, password, credits
- `telegram.js` - Bot deploy manager, long-polling
- `am.js` - Generator logic (send-link, claim-premium, batch)
- `chat.js` - Global chat system
- `store.js` - JSON file DB operations
- `logger.js` - Structured logging
- `security.js` - Security utilities

---

## Deployment

### PM2 (ecosystem.config.cjs)
```javascript
{
  name: 'am',
  script: './server.js',
  env: {
    NODE_ENV: 'production',
    PORT: '5000',
    AM_HMR: '1'
  }
}
```

### Commands
```bash
pm2 start ecosystem.config.cjs    # Start
pm2 reload am                     # Reload dengan HMR
pm2 restart am                    # Full restart
pm2 logs am                       # Logs
pm2 status                        # Status
```

---

## Security Features
- bcrypt password hashing
- HttpOnly Secure cookies untuk session
- Rate limiting per IP
- Security headers (CSP, HSTS, X-Frame-Options, etc)
- DevTools detection overlay
- Input sanitization
- Role-based authorization di frontend & backend
- API key validation per request

---

## Maintenance & Monitoring
- Auto-cleanup akun nonaktif (configurable hours)
- Health check endpoint
- Telegram bot polling monitoring
- HMR untuk zero-downtime code updates
- Graceful shutdown handlers

---

## Known Issues / TODO
- [ ] Rate limiting per user (bukan cuma per IP)
- [ ] WebSocket untuk real-time updates (chat, bot status)
- [ ] Backup/restore database otomatis
- [ ] Unit tests untuk critical functions
- [ ] API rate limiting per API key