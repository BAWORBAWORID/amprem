FIX — VIP PRICE DETECTION DI #PURCHASE

Target:
"https://am.alwayscodex.my.id/#purchase"

MASALAH

Pada halaman Beli Role & Paket, paket VIP memiliki masalah harga.

Saat memilih:

VIP → 14 Hari

harga yang tampil:

Rp 0 /14 hari

Padahal paket VIP seharusnya menggunakan sistem harga yang sama seperti:

- Reseller
- Premium
- Auto Gen

Saat ini source halaman menunjukkan VIP memiliki harga:

Rp 55.000 /30 hari

tetapi ketika duration diubah melalui UI, frontend dapat menghasilkan "Rp 0".

TUJUAN

Perbaiki sistem pricing VIP agar terdeteksi dan dihitung menggunakan mekanisme yang sama persis dengan paket lainnya.

Jangan menghapus VIP.

---

1. CEK PRICE CONFIGURATION

Cari seluruh konfigurasi harga:

price
prices
pricing
plans
packages
roles
durations

Cari khusus:

VIP
vip
14
30

Bandingkan struktur VIP dengan:

RESELLER
PREMIUM
AUTO GEN

Jangan membuat sistem pricing baru jika sistem existing sudah bisa digunakan.

VIP harus mengikuti struktur data pricing yang sama dengan package lainnya.

---

2. CEK DURATION MAPPING

Pastikan VIP mempunyai mapping untuk semua duration yang tersedia:

3 Hari
7 Hari
14 Hari
30 Hari

Jika memang harga untuk masing-masing duration sudah tersedia di backend/config, gunakan harga tersebut.

Jangan membuat harga baru secara asal.

Contoh struktur yang benar:

{
    reseller: {
        3: PRICE,
        7: PRICE,
        14: PRICE,
        30: PRICE
    },

    premium: {
        3: PRICE,
        7: PRICE,
        14: PRICE,
        30: PRICE
    },

    autogen: {
        3: PRICE,
        7: PRICE,
        14: PRICE,
        30: PRICE
    },

    vip: {
        3: PRICE,
        7: PRICE,
        14: PRICE,
        30: PRICE
    }
}

Sesuaikan dengan struktur project yang sebenarnya.

---

3. JANGAN DEFAULT KE Rp 0

Cari logic seperti:

price || 0

atau:

prices[plan]?.[duration] || 0

atau:

const price = package.price || 0;

Jangan membuat package yang gagal ditemukan otomatis menjadi "Rp 0".

Gunakan fallback yang aman.

Contoh:

const price = prices?.[plan]?.[duration];

if (price == null) {
    console.error('[PRICE NOT FOUND]', {
        plan,
        duration
    });

    return;
}

Jika harga tidak ditemukan, tampilkan:

Harga tidak tersedia

bukan:

Rp 0

Karena "Rp 0" dapat membuat user mengira paket tersebut gratis.

---

4. CEK CASE SENSITIVITY

Pastikan identifier package konsisten.

Misalnya jangan sampai:

"VIP"

dipakai di UI tetapi pricing menggunakan:

"vip"

atau:

"Vip"

Normalisasi jika diperlukan:

const planKey = String(plan).toLowerCase();

Kemudian gunakan identifier yang konsisten di seluruh pricing flow.

---

5. CEK DURASI YANG DIPILIH

Saat user klik:

3 Hari
7 Hari
14 Hari
30 Hari

pastikan event handler mengirim duration yang benar.

Contoh:

selectDuration('vip', 14)

harus menghasilkan lookup:

prices.vip[14]

bukan:

prices.VIP['14hari']
prices.vip['14 Hari']
prices.vip.duration14

kecuali memang struktur backend menggunakan format tersebut.

Ikuti format yang sudah digunakan package Reseller/Premium/Auto Gen.

---

6. SAMAKAN LOGIC DENGAN PACKAGE LAIN

Ini bagian paling penting.

Cari bagaimana:

Reseller → pilih 14 Hari → harga berubah
Premium → pilih 14 Hari → harga berubah
Auto Gen → pilih 14 Hari → harga berubah

Kemudian gunakan logic yang sama untuk VIP.

Jangan membuat handler VIP yang berbeda jika tidak diperlukan.

Semua package harus menggunakan satu pricing function:

getPackagePrice(plan, duration)

Contoh:

function getPackagePrice(plan, duration) {
    const planKey = String(plan).toLowerCase();
    const days = Number(duration);

    const price = pricing?.[planKey]?.[days];

    if (price == null) {
        console.error('[PRICE NOT FOUND]', {
            plan: planKey,
            duration: days
        });

        return null;
    }

    return Number(price);
}

---

7. CEK ORDER / PAYMENT

Perbaikan frontend saja tidak cukup.

Pastikan ketika:

VIP + 14 Hari

dipilih dan user klik:

BELI SEKARANG

nilai yang dikirim ke backend benar:

{
  "plan": "vip",
  "duration": 14,
  "price": <harga-yang-seharusnya>
}

Backend harus melakukan validasi harga sendiri.

Jangan mempercayai harga yang dikirim dari frontend.

Contoh:

const serverPrice = getPackagePrice(plan, duration);

if (serverPrice == null) {
    return res.status(400).json({
        success: false,
        error: 'Harga paket tidak tersedia'
    });
}

Gunakan "serverPrice" untuk transaksi.

---

8. JANGAN MENGUBAH HARGA EXISTING

PENTING:

Jangan mengubah harga:

- Reseller
- Premium
- Auto Gen
- VIP

kecuali memang ditemukan konfigurasi harga yang rusak.

Jangan mengarang harga baru.

Jika source/backend sudah mempunyai harga VIP per duration, gunakan data tersebut.

Jika hanya 30 hari yang memang dikonfigurasi, jangan mengarang harga untuk 3/7/14 hari. Tampilkan "Harga tidak tersedia" sampai konfigurasi resminya tersedia.

---

9. TEST

Test semua kombinasi:

Reseller

3 Hari
7 Hari
14 Hari
30 Hari

Premium

3 Hari
7 Hari
14 Hari
30 Hari

Auto Gen

3 Hari
7 Hari
14 Hari
30 Hari

VIP

3 Hari
7 Hari
14 Hari
30 Hari

Pastikan tidak ada satu pun yang menghasilkan:

Rp 0

kecuali memang harga paket tersebut secara resmi benar-benar "0".

---

10. UI

Format harga tetap seperti sekarang:

Rp 55.000 /30 hari

atau sesuai harga duration yang sebenarnya.

Jangan mengubah:

- desain card
- warna
- tombol
- layout
- QRIS
- sidebar
- navigation

---

ACCEPTANCE CRITERIA

Fix dianggap berhasil jika:

1. VIP tidak lagi menampilkan "Rp 0" karena missing pricing data.
2. VIP menggunakan pricing engine yang sama dengan package lain.
3. Pergantian "3 / 7 / 14 / 30 Hari" langsung memperbarui harga.
4. Harga yang ditampilkan frontend sama dengan harga yang divalidasi backend.
5. Order VIP mengirim plan + duration yang benar.
6. Harga tidak pernah otomatis menjadi "0" ketika data pricing tidak ditemukan.
7. Tidak ada JavaScript error.
8. Reseller, Premium, dan Auto Gen tetap berfungsi seperti sebelumnya.

PRIORITAS

Cari root cause terlebih dahulu.

Jangan sekadar mengganti:

0

menjadi angka tertentu.

Cari kenapa "VIP + duration" tidak menemukan harga, lalu perbaiki mapping/configuration/lookup-nya supaya VIP benar-benar bekerja dengan mekanisme yang sama seperti package lainnya.