/**
 * QRIS Static Payment — generator QRIS tanpa library eksternal.
 * Implementasi TLV (Tag-Length-Value) + CRC16-CCITT sesuai standar QRIS
 * (QR Code Payment Specification, EMVCo) dan spek update.md.
 * Render gambar PNG memakai paket `qrcode` (pure JS, tanpa native dep).
 */
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { DATA_DIR } from './store.js';

export const QRIS_IMAGE_DIR = path.join(DATA_DIR, 'qris');

// QRIS statis DANA (merchant: AlwaysCodex, Kab. Banyumas).
// Struktur: tag 00 payload, 01 static, 26 merchant account info (DANA),
// 52 kategori, 53 currency IDR, 58 negara, 59 nama merchant, 60 kota,
// 61 kode pos, 63 CRC. Tag 54 (amount) diisi dinamis oleh setAmount().
const QRIS_STATIC =
    '00020101021126570011ID.DANA.WWW011893600915302410041602090241004160303UMI' +
    '51440014ID.CO.QRIS.WWW0215ID10265087435920303UMI' +
    '5204654053033605802ID5911AlwaysCodex6013Kab. Banyumas61055317463040343';

/**
 * Parsing string QRIS menjadi daftar entri TLV.
 * Format QRIS (EMVCo): tag 2 karakter + panjang 2 digit + nilai.
 * (Tag 26 berisi sub-TLV dengan struktur yang sama.)
 */
export function parseTLV(payload) {
    const entries = [];
    let offset = 0;
    while (offset + 4 <= payload.length) {
        const tag = payload.slice(offset, offset + 2);
        offset += 2;
        if (offset + 2 > payload.length) break;
        const length = parseInt(payload.slice(offset, offset + 2), 10);
        offset += 2;
        if (isNaN(length) || offset + length > payload.length) break;
        const value = payload.slice(offset, offset + length);
        offset += length;
        entries.push({ tag, value });
    }
    return entries;
}

/**
 * Menyusun satu entri TLV: tag (2 karakter) + panjang (2 digit) + nilai.
 */
export function buildTLV(tag, value) {
    const length = String(String(value).length).padStart(2, '0');
    return String(tag) + length + String(value);
}

/**
 * CRC16-CCITT (polynomial 0x1021, initial 0xFFFF, tanpa reflection).
 * Dihitung terhadap seluruh payload QRIS termasuk placeholder "6304".
 */
export function crc16ccitt(data) {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= (data.charCodeAt(i) << 8) & 0xffff;
        for (let j = 0; j < 8; j++) {
            if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
            else crc = (crc << 1) & 0xffff;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Menempelkan tag 63 + CRC16 ke payload QRIS.
 */
export function withCRC(payload) {
    const base = payload.replace(/6304[0-9A-Fa-f]{4}$/, '6304');
    return base + crc16ccitt(base);
}

/**
 * Validasi amount: harus string angka bulat positif, aman untuk integer.
 * Mengembalikan string nominal (bukan parse awal yang longgar).
 */
export function normalizeAmount(amount) {
    const value = String(amount == null ? '' : amount).trim();
    if (!/^\d+$/.test(value)) {
        throw new Error('Amount harus berupa angka bulat');
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error('Amount harus berupa angka bulat positif');
    }
    return String(number);
}

/**
 * Mengganti nominal (tag 54) pada QRIS string, menghitung ulang CRC.
 * Tag 54 disisipkan tepat setelah tag 53 (currency) bila belum ada,
 * sesuai urutan standar QRIS.
 */
export function setAmount(qrString, amount) {
    const normalized = normalizeAmount(amount);
    const entries = parseTLV(String(qrString).trim());
    const result = [];
    let inserted = false;
    for (const entry of entries) {
        if (entry.tag === '54') {
            result.push(buildTLV('54', normalized));
            inserted = true;
            continue;
        }
        result.push(buildTLV(entry.tag, entry.value));
        if (!inserted && entry.tag === '53') {
            result.push(buildTLV('54', normalized));
            inserted = true;
        }
    }
    if (!inserted) {
        throw new Error('QRIS payload tidak valid: tag 53 (currency) tidak ditemukan');
    }
    return withCRC(result.join(''));
}

function ensureImageDir() {
    if (!fs.existsSync(QRIS_IMAGE_DIR)) fs.mkdirSync(QRIS_IMAGE_DIR, { recursive: true });
}

/**
 * Membersihkan file PNG QRIS yang berumur lebih dari 24 jam agar
 * folder data/qris tidak menumpuk.
 */
function cleanupOldImages() {
    try {
        ensureImageDir();
        const cutoff = Date.now() - 24 * 3600 * 1000;
        for (const name of fs.readdirSync(QRIS_IMAGE_DIR)) {
            // Jangan hapus QRIS statis merchant (dipakai card #purchase).
            if (name === 'qris-static.png') continue;
            const file = path.join(QRIS_IMAGE_DIR, name);
            const stat = fs.statSync(file);
            if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(file);
        }
    } catch (e) {
        // Cleanup gagal tidak menghentikan pembayaran.
    }
}

/**
 * Membuat QRIS statis merchant (tanpa nominal/amount — tag 01 static)
 * untuk ditampilkan di card pembayaran bawah #purchase.
 * File ditulis sekali ke data/qris/qris-static.png bila belum ada.
 */
export async function ensureStaticQRIS() {
    try {
        ensureImageDir();
        const filePath = path.join(QRIS_IMAGE_DIR, 'qris-static.png');
        if (fs.existsSync(filePath)) return '/files/qris-static.png';
        // withoutCRC ulang dari payload dasar (tanpa tag 54 amount).
        const qrString = withCRC(QRIS_STATIC.replace(/6304[0-9A-Fa-f]{4}$/, '6304'));
        await QRCode.toFile(filePath, qrString, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 640,
        });
        return '/files/qris-static.png';
    } catch (e) {
        return '/files/qris-static.png';
    }
}

/**
 * Membuat QRIS statis untuk nominal tertentu:
 * - QRIS string dengan tag 54 + CRC terhitung ulang
 * - PNG di-render ke data/qris/<ts>.png
 * - URL relatif /files/<nama> (disajikan route /files/* di app)
 */
export async function generatePaymentQRIS(amount) {
    const normalized = normalizeAmount(amount);
    const qrString = setAmount(QRIS_STATIC, normalized);
    cleanupOldImages();
    ensureImageDir();
    const filename = 'qris-' + Date.now() + '.png';
    const filePath = path.join(QRIS_IMAGE_DIR, filename);
    await QRCode.toFile(filePath, qrString, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 640,
    });
    return {
        qrString: qrString,
        imageUrl: '/files/' + filename,
        amount: normalized,
    };
}
