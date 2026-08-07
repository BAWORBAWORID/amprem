# 🚀 AM Premium Creator

Platform web premium untuk **AM (Alight Motion) Premium Accounts** — generator akun, auto-generator email bulk, manajemen API key, chat global, dan panel admin. Tampilan modern dengan theme **Light / Dark Premium**, glassmorphism, dan animasi halus.

Website: [https://am.alwayscodex.my.id](https://am.alwayscodex.my.id)

---

## ✨ Fitur Utama

| Fitur | Deskripsi |
|---|---|
| 🎨 **AM Generator** | Kirim magic link verifikasi ke email, aktivasi premium otomatis |
| ⚡ **Auto Generator** | Batch generate ribuan akun via `generator.email` (custom prefix + 155+ domain), didukung **puppeteer + Google Chrome** |
| 🎬 **Netflix (Demo)** | Generate token Netflix demo (4K / billing date) |
| 🔑 **API Key System** | Generate / revoke API key, paket Lifetime & Monthly, role `premium` / `autogen` |
| 💬 **Chat Global** | Realtime via SSE, sensor kata kasar, moderasi admin |
| ⭐ **Rating & Ulasan** | Rating 1–5 bintang per user |
| 📊 **Dashboard Admin** | Statistik live, manajemen user (ban, role, kredit, reset password), IP ban, log aktivasi, transaksi, log duplikat |
| 💳 **Transaksi** | Purchase API key + konfirmasi admin (owner) |
| 🌗 **Theme Mode** | Light / Dark / System (disimpan di localStorage, tanpa reload) |
| 🔒 **Keamanan** | Anti-bot/anti-curl, anti-devtools, security headers, sensor IP (maks 3 akun/IP) |

---

## 🛠 Teknologi

- **Runtime:** Node.js ≥ 18 (disarankan 22 LTS)
- **Server:** HTTP native (tanpa framework), ESM (`"type": "module"`)
- **Database:** File JSON di folder `data/` (tanpa perlu database eksternal)
- **Library:** `bcryptjs`, `cheerio`, `puppeteer-core`
- **Frontend:** HTML + CSS + Vanilla JS (satu halaman `public/home.html`)
- **Container:** Docker (Ubuntu 22.04 + Node 22 + Google Chrome)

---

## 📁 Struktur Project

```
├── server.js              # Server utama (HTTP, API, routing, logika bisnis)
├── security.js            # Script anti-devtools/anti-scraper (sumber dev)
├── dec.js                 # Dekripsi helper
├── scraper-genemail.js    # Scraper daftar domain generator.email
├── services/
│   ├── auth.js            # AMAuth — kirim magic link + verifikasi + aktivasi premium
│   └── bulk.js            # Auto generator bulk (puppeteer-core + Chrome)
├── public/                # Frontend (di-serve ke browser)
│   ├── home.html          # Halaman utama (single-page app)
│   ├── security.js        # Anti-devtools versi public (di-serve di /security.js)
│   ├── css/redesign.css   # Design system + theme light/dark (CSS Variables)
│   └── js/
│       ├── home.js        # Logika utama UI
│       └── enhance.js     # Hardening + mikro-interaksi
├── data/                  # ⚠️ STATE RUNTIME (JSON) — WAJIB di-backup/volume
│   ├── users.json         #   user, role, kredit, API key
│   ├── sessions/          #   sesi login
│   ├── chat.json, history.json, reviews.json, logs.json, ...
├── Dockerfile             # Image Docker (Ubuntu 22.04 + Node 22 + Chrome)
└── package.json
```

---

## 🚀 Cara Menjalankan (Lokal)

```bash
# 1. Install dependensi
npm install

# 2. Jalankan server
npm start
```

Server berjalan di **http://localhost:5000**.

### Akun Owner (default)

| Username | Password | Role |
|---|---|---|
| `alwayscodex` | `Akunff+62` | `owner` (full akses) |

> ⚠️ Ganti password owner segera setelah deploy! File-nya di `server.js` (`seedOwner`).

---

## 🐳 Cara Menjalankan dengan Docker (Ubuntu 22.04)

> Image berisi: Ubuntu 22.04 + Node.js 22 + Google Chrome (untuk auto generator) + app. Sudah teruji penuh (build, healthcheck, API, dan puppeteer launch di dalam container).

```bash
# 1. Build image
docker build -t am-creator .

# 2. Jalankan container (volume am-data = penyimpanan data persisten)
docker run -d --name am \
  -p 5000:5000 \
  -v am-data:/app/data \
  am-creator
```

### Pakai data server yang sudah ada

```bash
docker run -d --name am \
  -p 5000:5000 \
  -v /root/am/data:/app/data \
  am-creator
```

> Container berjalan sebagai root agar mounting folder data milik root langsung jalan tanpa masalah permission.

### Perintah Docker berguna

```bash
docker logs -f am                 # lihat log
docker exec -it am bash           # masuk ke container
docker restart am                 # restart
docker inspect --format '{{json .State.Health}}' am   # cek health
docker rm -f am                   # hapus container (data di volume aman)
```

---

## ⚙️ Variabel Lingkungan

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `5000` | Port server |
| `CHROME_PATH` | `/usr/bin/google-chrome` (Docker) | Path binary Chrome untuk puppeteer-core |
| `NODE_ENV` | `production` (Docker) | Mode runtime |

---

## 🔌 Endpoint API Utama

| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| `POST` | `/api/auth/register` | - | Registrasi (maks 3 akun/IP) |
| `POST` | `/api/auth/login` | - | Login (set cookie sesi) |
| `POST` | `/api/auth/logout` | Sesi | Logout |
| `GET` | `/api/auth/profile` | Sesi | Profil user |
| `POST` | `/api/auth/reset-key` | Sesi | Generate ulang API key |
| `POST` | `/api/am/send-link` | Sesi | Kirim magic link verifikasi |
| `POST` | `/api/am/claim-premium` | Sesi | Aktivasi premium via magic link |
| `GET` | `/api/am/history` | Sesi | Riwayat akun user |
| `GET` | `/api/am/domains` | - | Daftar domain generator.email (155+) |
| `POST` | `/api/am/autogen/start-batch` | premium | Mulai batch auto generator |
| `GET` | `/api/am/autogen/active-batch` | Sesi | Status batch berjalan |
| `GET` | `/api/am/netflix/token` | Sesi | Generate token Netflix (demo) |
| `GET` | `/api/public/stats` | - | Statistik publik |
| `GET` | `/api/chat/messages` / `POST` `/api/chat/send` | - / Sesi | Chat global |
| `GET` | `/api/reviews` / `POST` | - / Sesi | Rating & ulasan |
| `GET` | `/api/admin/*` | admin/owner | Panel admin (stats, users, logs, dll) |

---

## 🔒 Keamanan yang Terpasang

1. **Anti-bot / Anti-curl** — semua file statis (HTML/JS/CSS) hanya disajikan ke browser asli. `curl`/`wget`/script otomatis mendapat halaman umpan "Checking your browser..." (status 200). Endpoint `/api/*` tetap normal.
2. **Anti-devtools** (`/security.js`) — blokir F12/Ctrl+Shift+I/Ctrl+U, klik kanan, seleksi teks, deteksi DevTools (dengan guard perangkat sentuh agar user mobile tidak terkunci).
3. **Security headers** — `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `X-XSS-Protection`, `Permissions-Policy` di semua respons (HTML, JSON, SSE, 404/403).
4. **Hash password** — bcryptjs (support migrasi dari SHA-256 lama).
5. **Rate limit registrasi** — maks 3 akun per IP + daftar IP ban.

---

## ❓ Troubleshooting

| Masalah | Solusi |
|---|---|
| `Chrome tidak ditemukan` di auto generator | Set `CHROME_PATH` ke binary Chrome, atau jalankan via Docker (Chrome sudah terinstall) |
| Data hilang setelah restart Docker | Pastikan pakai `-v am-data:/app/data` — folder `data/` adalah volume |
| `EADDRINUSE` port 5000 | Ganti port: `PORT=5001 npm start` |
| Halaman "Just a moment..." saat pakai curl | Itu normal — anti-bot aktif. Akses via browser asli. |
| F12 / klik kanan tidak berfungsi | Itu proteksi `security.js` (anti-devtools). Nonaktifkan dengan menghapus `<script src="/security.js">` dari `public/home.html`. |

---

## 📜 Lisensi

MIT
