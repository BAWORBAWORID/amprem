@Pencarian web https://am.alwayscodex.eu.cc/#generator

Tambahkan fitur CUSTOM ORDER ID PREFIX pada halaman Generator.

POSISI

Letakkan card CUSTOM ORDER ID PREFIX tepat setelah bagian:

“Kapasitas Pembuatan: Maksimal 500 Akun / Batch”

dan sebelum bagian “Paket Aktif”.

Jangan mengubah struktur atau menghilangkan fitur generator yang sudah ada.

DESAIN

Buat tampilannya mengikuti style UI halaman saat ini dan referensi screenshot yang diberikan:

- Card modern, clean, dan rapi.
- Border radius mengikuti komponen existing.
- Spacing/padding konsisten.
- Responsive untuk mobile dan desktop.
- Input memiliki icon kecil di sebelah kiri.
- Tombol menggunakan style primary button existing.
- Jangan membuat card terlalu tinggi.
- Pastikan tidak terjadi duplicate component.

CONTENT

CUSTOM ORDER ID PREFIX

"Atur prefix kustom untuk Alight Motion Order ID Anda (khusus pengguna VIP)."

Input:

"Contoh: Codex"

Button:

"💾 SIMPAN PREFIX"

LOGIC

Fitur hanya dapat digunakan oleh akun dengan status VIP.

Jika user VIP:

- Input aktif.
- User dapat memasukkan custom prefix.
- Prefix dapat disimpan.
- Prefix tersimpan harus digunakan oleh generator ketika membuat Order ID.
- Tampilkan feedback sukses setelah berhasil disimpan.
- Saat halaman dibuka kembali, prefix yang sebelumnya disimpan harus otomatis dimuat.

Jika user bukan VIP:

- Input disabled.
- Tombol disabled.
- Tampilkan status "🔒 VIP Only".
- Jangan izinkan request/API untuk menyimpan prefix secara manual.
- Backend tetap wajib melakukan validasi status VIP, jangan hanya mengandalkan frontend.

ORDER ID

Jika prefix "Codex" disimpan, Order ID baru harus menggunakan prefix tersebut, misalnya:

"Codex-0001"
"Codex-0002"
"Codex-0003"

Jika prefix belum diset, gunakan format default yang sudah digunakan sistem saat ini.

Jangan merusak Order ID lama yang sudah tersimpan.

VALIDASI

Tambahkan validasi prefix:

- Tidak boleh kosong jika user mencoba menyimpan.
- Trim whitespace.
- Tolak karakter yang berpotensi merusak format Order ID.
- Gunakan whitelist karakter yang aman, misalnya huruf, angka, "_" dan "-".
- Batasi panjang prefix agar tidak berlebihan.
- Jangan izinkan HTML/script/injection.
- Tampilkan error message yang jelas dan tidak mengganggu UI.

BACKEND

Implementasikan penyimpanan prefix secara persistent menggunakan sistem/database/config storage yang memang sudah digunakan project.

Jangan menggunakan localStorage sebagai satu-satunya penyimpanan.

Backend harus:

1. Mengecek user sudah login.
2. Mengecek status VIP.
3. Memvalidasi prefix.
4. Menyimpan prefix ke user/account yang benar.
5. Mengembalikan response sukses/error yang konsisten dengan API existing.

Saat generator membuat Order ID, ambil prefix dari backend/user configuration sehingga prefix tidak dapat dimanipulasi hanya dari frontend.

UX

Setelah klik SIMPAN PREFIX:

"✓ Prefix berhasil disimpan"

Gunakan toast/alert existing jika project sudah memiliki sistem notification.

Saat loading:
"Menyimpan..."

Jangan membuat tombol dapat diklik berkali-kali selama request berlangsung.

IMPORTANT

- Pertahankan desain generator yang sekarang.
- Jangan menghapus atau merombak fitur existing.
- Jangan membuat duplicate API endpoint jika endpoint/configuration existing dapat digunakan.
- Cari terlebih dahulu logic Order ID generator yang sudah ada dan integrasikan fitur ini ke logic tersebut.
- Pastikan prefix benar-benar memengaruhi Order ID hasil generate, bukan hanya tampil di frontend.
- Pastikan responsive.
- Test akun VIP dan akun non-VIP.
- Test refresh halaman untuk memastikan prefix tetap tersimpan.
- Test generate beberapa Order ID untuk memastikan numbering tetap benar.
- Pastikan tidak ada error console, API error, duplicate UI, atau regression pada generator.

Target akhir: fitur Custom Order ID Prefix terlihat rapi seperti screenshot referensi, berada di posisi yang tepat pada "#generator", hanya tersedia untuk VIP, tersimpan persistent, dan benar-benar digunakan oleh sistem generator.