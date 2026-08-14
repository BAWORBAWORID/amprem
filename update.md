Prompt — Tambahkan Web Preview AM Creator

@Pencarian web "https://am.alwayscodex.my.id"

Cek dan update AM Creator karena saat ini bagian metadata untuk link preview / social preview belum lengkap seperti pada "https://api.alwayscodex.my.id".

Tambahkan dan rapikan bagian berikut tanpa merusak UI, routing, JavaScript, authentication, API, atau fitur yang sudah berjalan:

1. Open Graph

Tambahkan metadata:

- "og:title" → AM Creator — Premium Dashboard
- "og:description" → Alight Motion Premium Creator by AlwaysCodex
- "og:url" → "https://am.alwayscodex.my.id/"
- "og:type" → "website"
- "og:site_name" → AlwaysCodex
- "og:image" → gunakan logo/preview resmi AM Creator yang tersedia di website.

2. Twitter Card

Tambahkan:

- "twitter:card" → "summary_large_image"
- "twitter:title"
- "twitter:description"
- "twitter:image"

Gunakan image yang sama dengan Open Graph agar preview konsisten.

3. Favicon & Logo

Pastikan website memiliki:

- favicon PNG/ICO
- logo untuk browser/tab
- logo yang dapat digunakan sebagai social preview
- path asset yang valid dan tidak 404

Jika folder "/images/" sudah tersedia, gunakan struktur asset yang sudah ada. Jangan membuat duplicate logo jika asset yang sesuai sudah tersedia.

4. Preview Image

Jika AM Creator belum memiliki image khusus untuk preview, buat/gunakan asset:

"/images/preview.png"

Spesifikasi yang disarankan:

- 1200 × 630 px
- branding AM Creator
- teks AlwaysCodex
- desain mengikuti tema website AM Creator
- terlihat jelas pada preview WhatsApp, Telegram, Discord, Facebook, dan platform lainnya.

5. SEO Metadata

Tambahkan metadata dasar:

- "<title>AM Creator — Premium Dashboard</title>"
- meta description
- canonical URL
- theme-color
- robots
- viewport

6. Validasi Asset

Setelah update:

- cek semua URL image
- pastikan tidak ada "404"
- pastikan "og:image" dapat diakses langsung tanpa authentication
- pastikan image menggunakan HTTPS
- pastikan metadata berada di "<head>"
- jangan gunakan image dari domain eksternal jika asset lokal tersedia.

7. Jangan Mengubah Fitur

PENTING:

Jangan mengubah atau menghapus:

- login/register
- profile
- subscription
- lifetime
- referral
- API guide
- settings
- authentication
- backend/API
- routing SPA
- Cloudflare configuration
- database
- existing JavaScript logic

Fokus hanya pada SEO, favicon, logo, Open Graph, Twitter Card, dan social preview.

Target Akhir

Ketika seseorang membagikan:

"https://am.alwayscodex.my.id"

ke WhatsApp / Telegram / Discord / Facebook, tampil:

AM Creator — Premium Dashboard
Alight Motion Premium Creator by AlwaysCodex

+ gambar/logo preview AM Creator

Buat implementasinya bersih, modern, ringan, dan mengikuti struktur branding AlwaysCodex yang sudah digunakan pada "api.alwayscodex.my.id".