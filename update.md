@Pencarian web https://am.alwayscodex.eu.cc/#dashboard

FIX TOTAL BUG "LAYANAN VIP" TIDAK MUNCUL UNTUK ROLE VIP DAN PRO.

Masalah:
Pada halaman #dashboard, card/menu "Layanan VIP" tidak muncul untuk akun dengan role:
- vip
- pro

Perbaiki seluruh sistem role-gating dari frontend sampai backend.

ROLE HIERARCHY FINAL:
user < pro < reseller < premium < vip < owner

ATURAN AKSES:
- user      : TIDAK boleh melihat/mengakses Layanan VIP
- pro       : BOLEH melihat dan mengakses Layanan VIP
- reseller  : sesuai permission reseller yang sudah ada
- premium   : sesuai permission premium yang sudah ada
- vip       : BOLEH melihat dan mengakses Layanan VIP
- owner     : BOLEH melihat dan mengakses semuanya

PENTING:
1. Normalisasi role sebelum pengecekan:
   - VIP
   - Vip
   - vip
   semuanya harus dianggap sebagai "vip".
2. Jangan membuat pengecekan hanya:
   role === "vip"
   karena role "pro" juga harus mendapat akses.
3. Gunakan permission/access check terpusat agar frontend dan backend konsisten.
4. Jangan membuat role baru.
5. Jangan menghapus role yang sudah ada.
6. Jangan mengubah hierarchy:
   user > pro > reseller > premium > vip > owner
7. Pastikan role yang berasal dari session/API/database sudah selesai dimuat sebelum dashboard menentukan menu yang boleh ditampilkan.
8. Jika role belum tersedia saat initial render, jangan langsung menganggap user sebagai "user" lalu menyembunyikan VIP secara permanen.
9. Setelah user/session berhasil dimuat, lakukan re-render/update permission.
10. Pastikan refresh halaman tetap mempertahankan akses yang benar.
11. Pastikan logout/login dengan akun berbeda tidak menyebabkan permission role sebelumnya tersimpan di UI/cache.
12. Bersihkan cache/localStorage/session state yang menyimpan role lama jika memang menyebabkan stale permission.
13. Pastikan route/endpoint backend Layanan VIP juga menerima role "pro" dan "vip".
14. Jangan hanya memperbaiki tampilan card. Test akses endpoint sebenarnya.
15. Jika ada middleware seperti:
    requireRole()
    hasRole()
    canAccess()
    checkPermission()
    isVip()
    isPremium()
    atau sejenisnya,
    audit semuanya dan gunakan satu sumber permission yang konsisten.

BUAT ACCESS CHECK TERPUSAT:

const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase();

const ROLE_LEVEL = {
  user: 0,
  pro: 1,
  reseller: 2,
  premium: 3,
  vip: 4,
  owner: 5
};

const canAccessVipService = (role) => {
  const normalized = normalizeRole(role);
  return ["pro", "reseller", "premium", "vip", "owner"].includes(normalized);
};

ATAU gunakan role level jika sistem memang menggunakan hierarchy.

FRONTEND:
Pastikan menu/card "Layanan VIP" muncul untuk:
pro, reseller, premium, vip, owner.

Jangan render:
user.

BACKEND:
Endpoint Layanan VIP harus menggunakan permission yang sama.
Role pro dan vip wajib lolos authentication + authorization.

CEK JUGA:
- API response user.role
- session/JWT role
- database role
- middleware authorization
- dashboard permission loader
- menu/card visibility
- route guard
- API endpoint guard
- localStorage/sessionStorage
- React/Vue/JS state jika ada
- cache service worker jika ada

TEST WAJIB:

1. Login sebagai user
   → Layanan VIP TIDAK muncul
   → endpoint VIP ditolak

2. Login sebagai pro
   → Layanan VIP MUNCUL
   → endpoint VIP bisa digunakan

3. Login sebagai reseller
   → sesuai permission reseller
   → jangan merusak permission existing

4. Login sebagai premium
   → sesuai permission premium
   → jangan merusak permission existing

5. Login sebagai vip
   → Layanan VIP MUNCUL
   → endpoint VIP bisa digunakan

6. Login sebagai owner
   → semua layanan yang memang diperbolehkan owner MUNCUL

7. Test role uppercase/mixed case:
   VIP / Vip / vip
   → semuanya diperlakukan sebagai vip.

8. Logout dari VIP lalu login PRO
   → permission berubah menjadi PRO
   → tidak menggunakan permission VIP lama.

9. Logout dari PRO lalu login USER
   → Layanan VIP hilang
   → endpoint VIP ditolak.

10. Hard refresh dashboard pada setiap role
    → hasil permission tetap benar.

JANGAN mengubah fitur lain yang sudah berjalan.
JANGAN menghapus autogen karena autogen memang sudah dihapus.
JANGAN membuat role "VIP" tambahan.
Satukan semua variasi VIP menjadi role canonical "vip".

Setelah selesai:
- audit seluruh role/permission system
- fix semua mismatch frontend/backend
- build production
- cek console error
- cek network/API error
- test semua role
- pastikan "Layanan VIP" benar-benar muncul untuk PRO dan VIP.