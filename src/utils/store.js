/**
 * Penyimpanan data + helper dasar (pindahan dari server.js monolit).
 * Satu-satunya sumber untuk akses data JSON, response, dan identitas client.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { SECURITY_HEADERS } from './security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '../..');
export const PORT = process.env.PORT || 5000;
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const SESSION_DIR = path.join(DATA_DIR, 'sessions');
export const SESSION_MAX_AGE = 30 * 24 * 3600 * 1000;

export const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.apk': 'application/vnd.android.package-archive',
    '.txt': 'text/plain; charset=utf-8',
};

export function dataFile(name) {
    return path.join(DATA_DIR, name + '.json');
}

export function readJSON(name, fallback) {
    const file = dataFile(name);
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

export function writeJSON(name, data) {
    // Sama dengan monolit asli: error tulis tidak ditelan agar tidak
    // menyembunyikan kegagalan penyimpanan (request handler akan menangkapnya).
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // Atomik yazma: önce tmp dosyasına yaz, sonra rename. Süreç yazma ortasında
    // ölürse hedef JSON bozulmaz (rename aynı dosya sisteminde atomiktir).
    const target = dataFile(name);
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    try {
        fs.renameSync(tmp, target);
    } catch (e) {
        // rename gagal (jarang) → fallback ke perilaku lama: tulis langsung.
        try { fs.unlinkSync(tmp); } catch (e) { /* abaikan */ }
        fs.writeFileSync(target, JSON.stringify(data, null, 2));
    }
}

export function randomKey(len) {
    return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

/**
 * API Key yang mudah dibaca: "Codex-XXXX-XXXX-XXXX-XXXX"
 * 4 grup x 8 hex (32 hex = 128-bit entropy), huruf besar agar mudah diketik
 * dan dibedakan. Semantik sama dengan key lama; hanya presentasinya beda.
 */
export function generateApiKey() {
    const raw = randomKey(32).toUpperCase();
    return 'Codex-' + raw.slice(0, 8) + '-' + raw.slice(8, 16) + '-' + raw.slice(16, 24) + '-' + raw.slice(24, 32);
}

export function newId() {
    return Date.now().toString(36) + randomKey(6);
}

export function nowISO() {
    return new Date().toISOString();
}

export function fmtDateTime() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

export function sendJSON(res, status, data) {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, SECURITY_HEADERS));
    res.end(JSON.stringify(data));
}

// Maksimum istek gövdesi (1 MB) — bellek DoS'unu önler.
const MAX_BODY_BYTES = 1024 * 1024;

export function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        let bytes = 0;
        let tooLarge = false;
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        req.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > MAX_BODY_BYTES) {
                tooLarge = true;
                req.destroy(); // putuskan koneksi, jangan lanjut konsumsi data
                finish({});    // destroy 'end' tetiklemeyebilir — burada resolve et
                return;
            }
            body += chunk;
        });
        req.on('end', () => {
            if (tooLarge) { finish({}); return; }
            try { finish(JSON.parse(body || '{}')); }
            catch (e) { finish({}); }
        });
        req.on('error', () => finish({}));
        req.on('close', () => finish({})); // son güvenlik ağı: her durumda resolve
    });
}

/**
 * Rate limit sederhana berbasis IP (in-memory, sliding window).
 * Untuk proteksi brute-force login. Default: 15 percobaan per menit.
 * Reset saat HMR reload dapat diterima (hanya pembatas laju).
 */
const rateBuckets = new Map(); // ip -> { windowStart, count }
export function isRateLimited(key, limit = 15, windowMs = 60_000) {
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
        rateBuckets.set(key, { windowStart: now, count: 1 });
        // Bersihkan bucket lama agar memori tidak menumpuk.
        if (rateBuckets.size > 10_000) {
            for (const [k, b] of rateBuckets) {
                if (now - b.windowStart >= windowMs) rateBuckets.delete(k);
            }
        }
        return false;
    }
    bucket.count += 1;
    return bucket.count > limit;
}

export function getClientIP(req) {
    return (req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

export function isLocalIP(ip) {
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].indexOf(ip) !== -1;
}

export function getClientDevice(req) {
    const ua = req.headers['user-agent'] || '';
    if (/android/i.test(ua)) return 'Android';
    if (/iphone|ipad/i.test(ua)) return 'iOS';
    if (/windows/i.test(ua)) return 'Windows';
    if (/mac/i.test(ua)) return 'macOS';
    if (/linux/i.test(ua)) return 'Linux';
    return 'Unknown';
}

/* ============================== USER MODEL ============================== */

export function getUsers() {
    return readJSON('users', {});
}

export function saveUsers(users) {
    writeJSON('users', users);
}

/* ============================== LOG ============================== */

export function addLog(message) {
    const logs = readJSON('logs', []);
    logs.push({ id: newId(), createdAt: fmtDateTime(), message: message });
    if (logs.length > 500) logs.splice(0, logs.length - 500);
    writeJSON('logs', logs);
}

export function addActivationLog(entry) {
    const logs = readJSON('activations', []);
    logs.push(Object.assign({ id: newId() }, entry));
    if (logs.length > 1000) logs.splice(0, logs.length - 1000);
    writeJSON('activations', logs);
}

export function addDuplicateLog(message) {
    const logs = readJSON('duplicates', []);
    logs.push({ id: newId(), createdAt: fmtDateTime(), message: message });
    if (logs.length > 200) logs.splice(0, logs.length - 200);
    writeJSON('duplicates', logs);
}

/* ============================== LAIN-LAIN ============================== */

export function generateOrderId() {
    const d = (n) => String(crypto.randomInt(0, Math.pow(10, n))).padStart(n, '0');
    return 'GPA.' + d(4) + '-' + d(4) + '-' + d(4) + '-' + d(5);
}

/* ============================== RUNTIME ANCHOR ============================== */

/**
 * Waktu mulai PROSES server (sejak `npm start` / proses PM2 boot). Dihitung
 * dari process.uptime(), jadi:
 *  - server restart / mati  -> runtime ikut reset ke 0 (mencerminkan boot baru)
 *  - halaman di-refresh     -> frontend fetch ulang nilai live, TIDAK reset
 * Tidak disimpan di file; runtime adalah milik sistem / proses, bukan milik tab.
 */
export function getServerStartedAt() {
    return Date.now() - Math.round(process.uptime() * 1000);
}

/* ============================== LAIN-LAIN ============================== */

export function isMaintenance(which) {
    const settings = readJSON('settings', {});
    const maint = settings.maintenance || {};
    return !!maint[which];
}

export function requireNoMaintenance(res, which) {
    if (isMaintenance(which)) {
        sendJSON(res, 503, { success: false, message: 'Fitur sedang dalam pemeliharaan (maintenance). Silakan coba lagi nanti.' });
        return false;
    }
    return true;
}
