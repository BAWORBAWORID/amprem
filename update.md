FIX ADMIN — IP ANGGOTA & PEMBERSIHAN TERLALU PANJANG

Target:
https://am.alwayscodex.my.id/#admin

Masalah:
Section "IP Anggota & Pembersihan" saat ini memanjang terlalu jauh
ke bawah karena list IP menampilkan banyak row.

Akibatnya:
- card IP terlalu tinggi
- IP Terblokir terdorong jauh ke bawah
- layout admin menjadi tidak seimbang
- halaman terasa sangat panjang
- pagination tidak berada pada posisi yang rapi

JANGAN hanya menambahkan pagination.

Perbaiki layout + list container + pagination.

==================================================
1. BATASI AREA LIST IP
==================================================

Jangan biarkan seluruh card IP mengikuti tinggi semua data.

Buat area khusus:

.ip-list-container

dengan tinggi terbatas.

Desktop:

max-height: 420px;
overflow-y: auto;

Mobile:

max-height: 360px;
overflow-y: auto;

atau sesuaikan dengan tinggi viewport.

CONTOH:

IP ANGGOTA & PEMBERSIHAN
────────────────────────────

[Search]
[Filter]

10 data per halaman

┌────────────────────────────┐
│ IP 1                       │
│ IP 2                       │
│ IP 3                       │
│ IP 4                       │
│ IP 5                       │
│ IP 6                       │
│ IP 7                       │
│ IP 8                       │
│ IP 9                       │
│ IP 10                      │
└────────────────────────────┘

      1  2  3  ...  31

────────────────────────────

IP TERBLOKIR


==================================================
2. JANGAN BUAT CARD IP MEMANJANG
==================================================

Gunakan:

.ip-list-container {
    max-height: 420px;
    overflow-y: auto;
    overflow-x: hidden;
}

Card utama:

.ip-management-card {
    height: auto;
}

Jangan:

height: auto;

pada list sehingga seluruh data membuat section semakin panjang.

List harus memiliki viewport sendiri.


==================================================
3. MOBILE
==================================================

Untuk Android/mobile:

.ip-list-container {
    max-height: 360px;
    overflow-y: auto;
}

Jika tinggi layar kecil, gunakan:

max-height: min(360px, 50vh);

Tujuannya agar IP list tidak mengambil setengah halaman
atau bahkan lebih.

Jangan membuat halaman horizontal scroll.


==================================================
4. CUSTOM SCROLLBAR

Scrollbar di dalam list harus tipis dan mengikuti theme.

Contoh:

.ip-list-container::-webkit-scrollbar {
    width: 5px;
}

.ip-list-container::-webkit-scrollbar-thumb {
    border-radius: 10px;
}

Gunakan CSS variable existing untuk warna.

Jangan menggunakan warna hardcode jika website sudah mempunyai
theme variables.


==================================================
5. PAGINATION TETAP DI LUAR SCROLL AREA

PENTING:

Pagination jangan ikut scroll bersama list.

Struktur:

.ip-management-card
│
├── header
├── toolbar
├── info
├── .ip-list-container
│      ├── row
│      ├── row
│      ├── row
│      └── ...
│
└── .ip-pagination


Jadi:

LIST = scroll
PAGINATION = fixed di bawah list


==================================================
6. CONTOH LAYOUT

┌──────────────────────────────────────┐
│ IP Anggota & Pembersihan             │
│                                      │
│ Pantau perangkat dan alamat IP       │
│ Maksimal 3 akun per IP               │
│                                      │
│ [Refresh] [Bersihkan ry_]            │
│                                      │
│ [🔍 Cari username, IP...]            │
│ [Semua IP ▼]                         │
│                                      │
│ 10 data per halaman                  │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ IP       USER       DEVICE       │ │
│ │ ──────────────────────────────── │ │
│ │ 127.0.0.1 user1     Unknown      │ │
│ │ 140.xxx   user2     Android      │ │
│ │ 114.xxx   user3     Android      │ │
│ │ 103.xxx   user4     Android      │ │
│ │ 182.xxx   user5     Android      │ │
│ │ ...                              │ │
│ │                                  │ │
│ │        ↕ scroll                  │ │
│ └──────────────────────────────────┘ │
│                                      │
│       1  2  3  4  5  ... 31  >      │
└──────────────────────────────────────┘

Kemudian langsung:

┌──────────────────────────────────────┐
│ IP TERBLOKIR                         │
│                                      │
│ [Masukkan IP...] [BAN IP]            │
│                                      │
└──────────────────────────────────────┘


==================================================
7. JANGAN MENAMPILKAN SEMUA DATA SEKALIGUS
==================================================

Tetap:

10 data per halaman.

Tetapi container tetap dibatasi.

Jika backend mengembalikan 10 row:

→ tampilkan 10 row dalam scroll container.

Jika row sedikit:

→ jangan memaksa container menjadi tinggi 420px.

Gunakan:

min-height: 0;
max-height: 420px;

bukan fixed height.


==================================================
8. ROW HARUS LEBIH COMPACT
==================================================

Selain membatasi tinggi, kecilkan row agar lebih compact.

Contoh:

padding:
10px 12px;

font-size:
12px / 13px;

line-height:
1.3;

Jangan menggunakan padding besar.

Desktop row:

height sekitar 48–58px.

Mobile:

height sekitar 55–65px.

Jangan membuat satu row sangat tinggi.


==================================================
9. MOBILE CARD MODE

Pada mobile, jika tabel terlalu lebar, gunakan compact card/row.

Contoh:

┌─────────────────────────────┐
│ 127.0.0.1          USER     │
│ Android                     │
│ 1 akun             [Detail] │
└─────────────────────────────┘

Jangan menampilkan 6 kolom horizontal yang menyebabkan
overflow.

Desktop boleh menggunakan table.

Mobile gunakan responsive card/list.


==================================================
10. PAGINATION

Pagination berada setelah list container:

<div class="ip-list-container">
    ...
</div>

<div class="ip-pagination">
    ...
</div>

Pagination tidak boleh berada di:

- luar card
- bawah IP Terblokir
- bawah seluruh admin dashboard


==================================================
11. PAGINATION STYLE

Gunakan pagination yang sama persis dengan:

Daftar Anggota
Aktivitas Global

Contoh:

[1] [2] [3] [4] [5] ... [31] [>]

Active page menggunakan class/style existing.

Jangan membuat warna baru.


==================================================
12. SEARCH

Search hanya memengaruhi isi:

.ip-list-container

Bukan membuat card semakin tinggi.

Saat search:

→ reset page = 1
→ render hasil
→ pagination update


==================================================
13. FILTER

Filter:

Semua IP
1 Akun
2 Akun
3 Akun
>3 Akun

juga hanya mengubah isi list.

Jika hasil sedikit:

container ikut mengecil secara natural.

Jangan tetap memakan ruang kosong besar.


==================================================
14. EMPTY STATE

Jika tidak ada hasil:

┌─────────────────────────────┐
│                             │
│      Tidak ada data IP      │
│                             │
└─────────────────────────────┘

Container jangan tetap menjadi sangat tinggi.


==================================================
15. LOADING

Saat loading:

┌─────────────────────────────┐
│                             │
│      Memuat data IP...      │
│                             │
└─────────────────────────────┘

Setelah selesai:

render list.


==================================================
16. JANGAN MENGUBAH BACKEND

Jangan mengubah:

- endpoint
- database
- IP detection
- account limit
- cleanup logic
- ban IP logic

Fokus pada frontend rendering/layout.

Jika pagination backend sudah tersedia, gunakan.

Jika belum, gunakan pagination frontend berdasarkan data yang
sudah dikirim backend.


==================================================
17. IP TERBLOKIR HARUS NAIK

Setelah fix:

IP Terblokir harus berada tepat setelah card IP.

Tidak boleh lagi terdorong jauh ke bawah karena IP list.

Layout:

Daftar Anggota
↓
Aktivitas Global
↓
Transaksi QRIS
↓
IP Anggota & Pembersihan
↓
IP Terblokir
↓
Duplicate Attempt Logs
↓
Pengaturan


==================================================
18. RESPONSIVE

Desktop:

IP card normal.
List max-height sekitar 420px.

Tablet:

max-height sekitar 380px.

Mobile:

max-height:
min(360px, 50vh);

Pastikan:

overflow-x: hidden;
overflow-y: auto;

dan:

box-sizing: border-box;


==================================================
19. IMPORTANT — JANGAN BUAT PAGE TERLALU PANJANG

Tujuan utama:

SEBELUM:

IP 1
IP 2
IP 3
IP 4
IP 5
IP 6
IP 7
IP 8
IP 9
IP 10
↓
card sangat panjang
↓
IP Terblokir jauh di bawah


SESUDAH:

IP 1
IP 2
IP 3
IP 4
IP 5
IP 6
IP 7
IP 8
↓ scroll
IP 9
IP 10

[ 1 2 3 4 5 ... 31 > ]

↓
IP Terblokir langsung terlihat di bawahnya.


==================================================
20. FINAL ACCEPTANCE TEST

[ ] IP card tidak memanjang mengikuti seluruh halaman
[ ] List IP memiliki scroll internal
[ ] Max-height diterapkan
[ ] Mobile max-height sekitar 360px / 50vh
[ ] Pagination berada di dalam card
[ ] Pagination tidak ikut scroll
[ ] Pagination sama dengan Daftar Anggota
[ ] 10 data per halaman tetap
[ ] Search bekerja
[ ] Filter bekerja
[ ] Refresh bekerja
[ ] Cleanup bekerja
[ ] Empty state benar
[ ] IP Terblokir tidak terdorong jauh
[ ] Tidak ada horizontal overflow
[ ] Tidak merusak layout admin lain

HASIL YANG DIINGINKAN:

IP Anggota & Pembersihan menjadi card dengan
TINGGI TERKONTROL.

List IP boleh memiliki banyak data,
tetapi yang memanjang hanya area scroll internal,
BUKAN seluruh halaman.