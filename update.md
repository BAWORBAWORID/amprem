Betul. Prompt sebelumnya terlalu banyak syntax tambahan sehingga bisa terbaca sebagai blank/invalid oleh coding agent. Ini versi yang sudah dibersihkan—tanpa id, tanpa syntax aneh, dan siap copy-paste.

FIX TOTAL LOGIN & REGISTER — AM CREATOR

Website:
https://am.alwayscodex.eu.cc/

Gunakan screenshot/referensi desain yang saya berikan sebagai acuan utama.

Saya ingin kamu memperbaiki TOTAL halaman Login dan Register AM Creator, bukan hanya CSS.

Fokus:

- UI
- UX
- Login
- Register
- Authentication
- Session
- Validation
- Loading
- Success notification
- Error notification
- Responsive mobile
- Responsive desktop
- Password visibility
- Keyboard Android
- Redirect
- Logout
- Bug fixing

Jangan merusak dashboard, API, database, generator, profile, role system, atau fitur lain yang sudah berjalan.

---

1. DESAIN UTAMA

Buat authentication page dengan gaya:

- premium
- modern
- clean
- futuristic
- dark
- glassmorphism
- cyan/blue/purple gradient
- soft glow
- rounded card
- responsive

Pertahankan branding:

AM CREATOR

Premium Creator Platform

Gunakan logo AM Creator/Aligmotion Creator yang sudah tersedia.

Jangan membuat logo baru jika asset existing tersedia.

---

2. BACKGROUND

Gunakan background premium:

- dark navy
- black
- subtle cyan glow
- subtle purple glow
- very subtle grid
- soft radial gradient

Jangan terlalu ramai.

Authentication harus terlihat seperti premium creator platform.

---

3. LOGIN DAN REGISTER

Jangan tampilkan Login dan Register sebagai dua form panjang sekaligus.

Gunakan SATU authentication card.

Di bagian atas card:

LOGIN | REGISTER

Jika LOGIN aktif:

Tampilkan Login.

Jika REGISTER aktif:

Tampilkan Register.

Ketika berpindah:

Login → Register

atau

Register → Login

gunakan animasi ringan:

- fade
- slide
- 200–300ms

Jangan reload halaman jika tidak diperlukan.

---

4. LOGIN DESIGN

Header:

Logo AM Creator

AM CREATOR

Premium Creator Platform

Title:

Masuk ke Akun

Subtitle:

Selamat datang kembali. Silakan login untuk melanjutkan.

Field:

USERNAME

Placeholder:

Username kamu

PASSWORD

Placeholder:

Password kamu

Tambahkan:

- username icon
- password icon
- show/hide password
- focus state
- validation state

Button:

LOGIN →

Gunakan gradient:

cyan → blue → purple

Footer:

Belum punya akun? Daftar Akun

Klik Daftar Akun:

Login form diganti Register.

---

5. REGISTER DESIGN

Header tetap sama.

Title:

Daftar Akun

Subtitle:

Buat akun baru untuk mulai menggunakan AM Creator.

Field:

USERNAME

Placeholder:

Min. 3 karakter

PASSWORD

Placeholder:

Min. 6 karakter

KONFIRMASI PASSWORD

Placeholder:

Ulangi password

KODE REFERRAL (opsional)

Placeholder:

Punya kode referral?

Jangan tampilkan teks referral dua kali.

Hapus duplicate seperti:

"Kode referral opsional"

jika sudah ada label:

"KODE REFERRAL (opsional)"

Button:

DAFTAR ✓

Footer:

Sudah punya akun? Login

---

6. PASSWORD

Login:

Password harus memiliki tombol show/hide.

Register:

Password dan Confirm Password harus memiliki tombol show/hide.

Jangan sampai icon mata mengubah ukuran input.

Gunakan autocomplete yang benar.

Login:

username
current-password

Register:

username
new-password

---

7. PASSWORD STRENGTH

Pada Register, tampilkan password strength secara compact.

Contoh:

Lemah | Sedang | Kuat

Indicator harus berubah berdasarkan password.

Jangan membuat indicator terlalu besar.

---

8. VALIDATION

Username:

- required
- minimal 3 karakter jika itu requirement backend
- trim whitespace

Password:

- required
- minimal sesuai backend

Confirm Password:

- required
- harus sama dengan password

Referral:

- optional
- hanya kirim jika backend memang mendukungnya

Jangan melakukan API request jika validation frontend gagal.

Error tampilkan dekat field atau melalui toast.

---

9. LOGIN LOADING

Saat login:

Button berubah menjadi:

Sedang masuk...

Button disabled.

Cegah:

- double click
- duplicate request
- spam Enter

Setelah request selesai atau gagal:

Button kembali normal jika diperlukan.

---

10. REGISTER LOADING

Saat register:

Button berubah menjadi:

Membuat akun...

Button disabled.

Cegah duplicate request.

---

11. REGISTER SUCCESS

Jangan menampilkan success message besar secara permanen di bawah form.

Gunakan toast atau modal modern.

Contoh:

Pendaftaran Berhasil!

Akun berhasil dibuat.

Silakan login untuk melanjutkan.

Tombol:

LOGIN SEKARANG

Setelah register sukses:

Register → Login

Username boleh otomatis diisi.

Password harus dikosongkan.

Confirm Password harus dikosongkan.

---

12. LOGIN SUCCESS

Ketika login berhasil:

Tampilkan:

Login Berhasil!

Selamat datang kembali, {username}

Kemudian:

Mempersiapkan dashboard...

Setelah authentication state benar-benar tersimpan:

→ redirect ke Dashboard.

Jangan redirect sebelum session/auth state siap.

---

13. ERROR HANDLING

Jangan menggunakan browser alert().

Gunakan toast atau inline error.

Contoh:

Username atau password salah.

Username sudah digunakan.

Password tidak cocok.

Password terlalu pendek.

Username terlalu pendek.

Server sedang mengalami gangguan.

Tidak dapat terhubung ke server.

Session telah berakhir.

Jangan menampilkan raw error seperti:

TypeError
AxiosError
FetchError
undefined
stack trace
raw JSON

kepada user.

Technical error boleh masuk console untuk debugging.

---

14. SESSION

Audit authentication secara menyeluruh.

Flow:

Login
→ Dashboard
→ Refresh
→ Tetap login

Jangan sampai:

Login
→ Dashboard
→ Refresh
→ Login lagi

Jika session/token valid:

→ user tetap authenticated.

Jika session/token expired:

→ clear authentication
→ redirect Login
→ tampilkan:

Session telah berakhir. Silakan login kembali.

---

15. REDIRECT

Jika user belum login dan mencoba membuka Dashboard:

→ redirect Login.

Jika user sudah login dan membuka halaman Login:

→ jangan meminta login lagi jika session masih valid.

Hindari redirect loop.

---

16. LOGOUT

Logout harus:

- menghapus authentication state
- menghapus session/token sesuai mekanisme existing
- membersihkan user state
- redirect Login

Jangan merusak browser history/security route.

---

17. MOBILE

Prioritas utama adalah Android.

Test:

360px
375px
390px
412px
430px

Authentication card harus:

- hampir full width
- margin kiri/kanan sekitar 16–24px
- compact
- tidak overflow
- tidak horizontal scrolling
- input full width
- button full width

Jangan menggunakan height fixed yang menyebabkan keyboard Android memotong form.

Gunakan viewport yang aman seperti:

min-height: 100dvh

jika sesuai dengan struktur project.

---

18. MOBILE KEYBOARD

Screenshot saat Register menunjukkan keyboard Android membuat bagian bawah form terpotong.

Perbaiki.

Saat keyboard muncul:

- user tetap bisa scroll
- confirm password tetap bisa diakses
- referral tetap bisa diakses
- button tetap bisa ditekan
- footer tidak menutupi form
- tidak ada horizontal overflow

---

19. CARD

Authentication card:

Desktop:

max-width sekitar 420–460px.

Mobile:

width:

calc(100% - 32px)

Gunakan:

- border radius sekitar 20–24px
- padding konsisten
- subtle border
- soft shadow
- subtle neon glow

Jangan membuat card terlalu tinggi.

Jangan memberikan whitespace kosong terlalu banyak.

---

20. INPUT

Semua input harus memiliki ukuran yang konsisten.

Gunakan:

- height sekitar 50–56px
- radius konsisten
- padding konsisten
- icon alignment konsisten
- font size 15–16px

Jangan ada icon yang terlalu besar.

Jangan ada input yang ukurannya berbeda sendiri.

---

21. SPACING

Rapikan spacing antara:

Logo
↓
Brand
↓
Title
↓
Subtitle
↓
Label
↓
Input
↓
Input berikutnya
↓
Button
↓
Footer

Jangan terlalu rapat.

Jangan terlalu renggang.

Gunakan spacing system yang konsisten.

---

22. APK BUTTON

Jika tombol:

Unduh Aplikasi Android (.APK)

memang masih tersedia dan valid, pertahankan.

Namun jadikan secondary action.

Style:

- outline/subtle
- tidak lebih mencolok daripada Login
- tinggi sekitar 48–52px

Jika link APK rusak atau tidak tersedia, perbaiki link atau sembunyikan tombol tersebut.

---

23. FOOTER

Footer jangan terlalu besar.

Gunakan:

© 2026 AM Premium
By Alwayscodex Project

Join channel WhatsApp

Buat subtle dan tidak memakan banyak ruang pada mobile.

---

24. TYPOGRAPHY

Gunakan hierarchy yang jelas.

Page title:

24–28px

Subtitle:

14–15px

Label:

12–13px

Input:

15–16px

Button:

14–16px

Footer:

13–14px

Gunakan font weight secara konsisten.

---

25. RESPONSIVE DESKTOP

Test:

768px
1024px
1280px
1440px
1920px

Authentication tetap berada di tengah dan proporsional.

Jangan membuat card terlalu lebar.

---

26. ACCESSIBILITY

Pastikan:

- label benar
- semantic form
- semantic button
- keyboard navigation
- focus state
- Enter submit
- autocomplete
- aria-label jika diperlukan

Tab order harus benar.

---

27. API

Jangan mengubah API hanya untuk membuat UI bekerja.

Periksa API Login dan Register yang sebenarnya.

Pastikan:

- endpoint benar
- HTTP method benar
- payload benar
- headers benar
- response handling benar
- error handling benar

Jangan mengasumsikan response API memiliki format tertentu.

Gunakan format response yang benar-benar digunakan backend.

---

28. SECURITY

Jangan:

- hardcode password
- hardcode token
- expose secret
- log password
- log token
- menampilkan cookie sensitif
- menyimpan password plaintext

Jangan mengubah mekanisme authentication existing tanpa alasan.

Jika backend menggunakan HTTP-only cookie, pertahankan mekanisme tersebut.

---

29. DUPLICATE REQUEST

Pastikan satu submit hanya menghasilkan satu API request.

Test:

- double click
- double tap
- spam Enter
- fast repeated click

---

30. CLEANUP

Rapikan:

- duplicate form
- duplicate text
- duplicate event listener
- unused auth UI
- unused CSS
- conflicting CSS
- browser alert
- debug console credential
- broken responsive styles

Jangan menghapus kode yang digunakan halaman lain.

---

31. TEST LOGIN

Test:

- login valid
- username kosong
- password kosong
- credential salah
- server error
- network error
- timeout
- double click
- Enter spam
- refresh
- logout
- expired session

---

32. TEST REGISTER

Test:

- register valid
- username kosong
- username terlalu pendek
- password kosong
- password terlalu pendek
- confirm password berbeda
- username sudah digunakan
- referral valid
- referral invalid
- network error
- server error
- timeout
- double click
- Enter spam

---

33. TEST MOBILE

Test:

- 360px
- 375px
- 390px
- 412px
- 430px

Dengan:

- keyboard tertutup
- keyboard terbuka
- Login
- Register
- Password visibility
- validation
- toast

Pastikan tidak ada bagian form yang terpotong.

---

34. FINAL VISUAL TARGET

Hasil akhir harus memiliki struktur seperti:

AM CREATOR

Premium Creator Platform

LOGIN | REGISTER

┌─────────────────────────────┐
│                             │
│       Masuk ke Akun         │
│                             │
│ USERNAME                    │
│ ┌─────────────────────────┐ │
│ │ Username kamu            │ │
│ └─────────────────────────┘ │
│                             │
│ PASSWORD                    │
│ ┌─────────────────────────┐ │
│ │ Password kamu        👁  │ │
│ └─────────────────────────┘ │
│                             │
│ ┌─────────────────────────┐ │
│ │         LOGIN →         │ │
│ └─────────────────────────┘ │
│                             │
│ Belum punya akun?           │
│ Daftar Akun                 │
│                             │
└─────────────────────────────┘

Ketika Register aktif, card yang sama berubah menjadi Register.

Jangan tampilkan dua form sekaligus.

---

35. HASIL YANG WAJIB

Setelah selesai:

1. Login terlihat rapi.
2. Register terlihat rapi.
3. Login dan Register tidak tampil bersamaan.
4. Card compact.
5. Tidak ada whitespace berlebihan.
6. Tidak ada duplicate referral text.
7. Password show/hide bekerja.
8. Password strength bekerja.
9. Validation bekerja.
10. Loading bekerja.
11. Register success bekerja.
12. Login success bekerja.
13. Error notification bekerja.
14. Session tetap setelah refresh.
15. Logout bekerja.
16. Protected route bekerja.
17. Mobile keyboard tidak memotong form.
18. Tidak ada horizontal overflow.
19. Tidak ada console error.
20. Tidak ada browser alert.
21. Tidak ada credential/token logging.
22. Dashboard dan fitur lain tetap bekerja.

---

FINAL INSTRUCTION

Jangan berhenti pada perubahan tampilan.

Lakukan full fix terhadap:

UI + UX + Authentication + API handling + Validation + Session + Redirect + Success + Error + Loading + Responsive.

Gunakan screenshot referensi sebagai acuan visual.

Prioritas tertinggi:

MOBILE ANDROID HARUS RAPI.

Hasil akhir harus terlihat seperti authentication page premium AM CREATOR, bukan form HTML biasa.

Pertahankan backend dan API yang sudah ada.