FIX ONLY BAGIAN RUNTIME

Target:
https://am.alwayscodex.eu.cc/#dashboard

Referensi Runtime:
https://api.alwayscodex.eu.cc/stats

PERATURAN UTAMA:
- HANYA ubah komponen Runtime.
- Jangan mengubah komponen Dashboard lainnya.
- Jangan mengubah UI/UX section lain.
- Jangan mengubah role/permission.
- Jangan mengubah authentication.
- Jangan mengubah API key.
- Jangan mengubah Layanan VIP.
- Jangan mengubah endpoint/fitur lain.

RUNTIME:
Ubah Runtime yang sekarang masih menampilkan "--:--:--" agar menggunakan
server uptime yang akurat seperti telemetry di:

https://api.alwayscodex.eu.cc/stats

Tampilan Runtime dibuat seperti referensi:

Runtime

2 Hari, 02:09:41
Waktu Aktif Server

[ICON STOPWATCH]

DETAIL:
1. Ambil uptime dari server/backend, bukan waktu sejak browser membuka halaman.
2. Refresh halaman tidak boleh mereset Runtime.
3. Runtime harus terus bertambah secara realtime setiap detik.
4. Gunakan data uptime server yang sama/selaras dengan /stats.
5. Sinkronisasi ulang secara berkala untuk mencegah timer frontend drift.
6. Jika server restart, uptime otomatis kembali dari awal.
7. Hilangkan tampilan "--:--:--".
8. Jika data sedang dimuat, tampilkan "Memuat..." sementara.
9. Jika gagal mengambil uptime, tampilkan status error yang wajar tanpa angka palsu.

FORMAT:
< 1 menit:
XX Detik

< 1 jam:
XX Menit, XX Detik

< 24 jam:
HH:MM:SS

>= 24 jam:
X Hari, HH:MM:SS

Contoh:
2 Hari, 02:09:41

DESAIN:
- Pertahankan posisi Runtime yang sekarang.
- Buat tampilannya seperti referensi /stats.
- Judul "Runtime".
- Angka uptime besar dan jelas.
- Subtitle "Waktu Aktif Server".
- Icon stopwatch di sisi kanan.
- Rounded card.
- Shadow halus.
- Responsive untuk mobile.
- Sesuaikan dengan theme Dashboard yang sudah ada.

IMPORTANT:
JANGAN melakukan perubahan apa pun di luar komponen Runtime.
Jangan refactor Dashboard secara keseluruhan.
Jangan mengganti CSS global.
Jangan mengubah layout section lain.
Jangan mengubah JavaScript fitur lain.

Setelah fix, test hanya:
- Runtime muncul.
- Runtime mengambil uptime server yang benar.
- Runtime bertambah setiap detik.
- Refresh tidak mereset angka.
- Tidak ada console error terkait Runtime.
- Tampilan mobile tetap rapi.