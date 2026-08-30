/**
 * Manajemen sesi file-based (data/sessions/*.json).
 * Pindahan dari server.js monolit — menggunakan helper dari store.js.
 */
import fs from 'fs';
import path from 'path';
import { SESSION_DIR, SESSION_MAX_AGE, randomKey, getUsers } from './store.js';

function sessionFile(token) {
    return path.join(SESSION_DIR, token + '.json');
}

// Batasi jumlah sesi per user (buang yang paling lama) agar file tidak menumpuk,
// TAPI jangan pernah menghapus semua sesi lama — itu penyebab login mendadak hilang
// di perangkat/tab lain. Multi-perangkat sekarang bisa login bersamaan.
function capUserSessions(userId, max) {
    try {
        if (!fs.existsSync(SESSION_DIR)) return;
        const files = [];
        fs.readdirSync(SESSION_DIR).forEach(function (file) {
            if (!file.endsWith('.json')) return;
            try {
                const s = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, file), 'utf8'));
                if (s && s.userId === userId) files.push({ file: file, time: s.lastActiveAt || s.createdAt || 0 });
            } catch (e) { /* abaikan file korup */ }
        });
        files.sort(function (a, b) { return b.time - a.time; });
        files.slice(max).forEach(function (f) {
            try { fs.unlinkSync(path.join(SESSION_DIR, f.file)); } catch (e) { /* abaikan */ }
        });
    } catch (e) { /* abaikan */ }
}

export function createSession(userId) {
    const token = randomKey(32);
    const session = { userId: userId, createdAt: Date.now(), lastActiveAt: Date.now() };
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(sessionFile(token), JSON.stringify(session));
    capUserSessions(userId, 10);
    return token;
}

export function readSession(token) {
    try {
        const session = JSON.parse(fs.readFileSync(sessionFile(token), 'utf8'));
        if (!session || typeof session.userId !== 'string') return null;
        // Sesi berjalan (sliding): kadaluarsa dihitung dari aktivitas terakhir,
        // jadi pengguna yang tetap aktif TIDAK tiba-tiba logout walau login sudah lama.
        const lastActive = session.lastActiveAt || session.createdAt || 0;
        if (Date.now() - lastActive > SESSION_MAX_AGE) {
            fs.unlinkSync(sessionFile(token));
            return null;
        }
        if (Date.now() - lastActive > 60 * 1000) {
            session.lastActiveAt = Date.now();
            fs.writeFileSync(sessionFile(token), JSON.stringify(session));
            session._refreshed = true; // sinyal in-memory saja — TIDAK ikut tersimpan ke file
        } else {
            delete session._refreshed;
        }
        return session;
    } catch (e) {
        return null;
    }
}

export function getSessionUser(req, res) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/connect\.sid=([^;]+)/);
    if (!match) return null;
    const token = decodeURIComponent(match[1]);
    const session = readSession(token);
    if (!session) return null;
    // Perpanjang cookie (sliding session) saat sesi aktif diperbarui,
    // agar browser tidak kehilangan login setelah 30 hari walau tetap dipakai.
    if (res && session._refreshed && !res.headersSent) {
        setSessionCookie(res, token);
    }
    const users = getUsers();
    for (const key of Object.keys(users)) {
        if (users[key].id === session.userId) return users[key];
    }
    return null;
}

export function destroySession(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/connect\.sid=([^;]+)/);
    if (match) {
        const file = sessionFile(decodeURIComponent(match[1]));
        try { fs.unlinkSync(file); } catch (e) { /* abaikan */ }
    }
}

export function cleanupExpiredSessions() {
    try {
        if (!fs.existsSync(SESSION_DIR)) { fs.mkdirSync(SESSION_DIR, { recursive: true }); return; }
        const now = Date.now();
        const users = getUsers();
        const sessionsByUser = {};
        fs.readdirSync(SESSION_DIR).forEach(function (file) {
            if (!file.endsWith('.json')) return;
            try {
                const session = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, file), 'utf8'));
                const userExists = session && typeof session.userId === 'string' &&
                    Object.keys(users).some(function (k) { return users[k].id === session.userId; });
                // Hapus sesi yang penggunanya sudah dihapus, atau yang benar-benar
                // tidak aktif selama SESSION_MAX_AGE (sliding expiry).
                const lastActive = session ? (session.lastActiveAt || session.createdAt || 0) : 0;
                if (!userExists || now - lastActive > SESSION_MAX_AGE) {
                    fs.unlinkSync(path.join(SESSION_DIR, file));
                    return;
                }
                if (!sessionsByUser[session.userId]) sessionsByUser[session.userId] = [];
                sessionsByUser[session.userId].push({ file: file, time: lastActive });
            } catch (e) {
                try { fs.unlinkSync(path.join(SESSION_DIR, file)); } catch (e2) { /* abaikan */ }
            }
        });
        // JANGAN paksa satu sesi per user (itu penyebab logout mendadak).
        // Cukup batasi jumlah sesi per user — sisakan 10 yang paling baru.
        Object.keys(sessionsByUser).forEach(function (userId) {
            sessionsByUser[userId].sort(function (a, b) { return b.time - a.time; });
            sessionsByUser[userId].slice(10).forEach(function (s) {
                try { fs.unlinkSync(path.join(SESSION_DIR, s.file)); } catch (e) { /* abaikan */ }
            });
        });
    } catch (e) { /* abaikan */ }
}

export function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie', 'connect.sid=' + encodeURIComponent(token) + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + (30 * 24 * 3600));
}
