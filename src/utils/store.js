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
    fs.writeFileSync(dataFile(name), JSON.stringify(data, null, 2));
}

export function randomKey(len) {
    return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
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

export function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(body || '{}')); }
            catch (e) { resolve({}); }
        });
        req.on('error', () => resolve({}));
    });
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
    return 'Alwayscodex-' + randomKey(8).toUpperCase();
}

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
