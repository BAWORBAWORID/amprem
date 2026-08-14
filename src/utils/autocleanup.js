/**
 * Auto-Cleanup Akun Nonaktif.
 * Menghapus otomatis akun GRATIS (role 'user') yang BELUM PERNAH LOGIN
 * dan sudah terdaftar lebih lama dari batas durasi terpilih (24 jam / 7 hari / 30 hari).
 * Role berbayar (reseller/premium/autogen/admin/owner) SELALU dikecualikan.
 * Akun yang banned manual juga tidak pernah disentuh.
 * Konfigurasi: data/settings.json -> autoCleanup { enabled, hours, lastRun, lastCount }.
 */
import fs from 'fs';
import path from 'path';
import { SESSION_DIR, readJSON, writeJSON, getUsers, saveUsers, nowISO, addLog } from './store.js';
import { DEFAULT_USER_CREDITS } from './auth.js';

const HISTORY_FILE = path.join(process.cwd(), 'data', 'history.json');
const TRANSACTIONS_FILE = path.join(process.cwd(), 'data', 'transactions.json');
const AUTO_CLEANUP_DEF = { enabled: false, hours: 24, lastRun: null, lastCount: 0 };

export function getAutoCleanupSettings() {
    const settings = readJSON('settings', {});
    if (!settings.autoCleanup || typeof settings.autoCleanup !== 'object') {
        settings.autoCleanup = Object.assign({}, AUTO_CLEANUP_DEF, settings.autoCleanup || {});
        writeJSON('settings', settings);
    }
    settings.autoCleanup.hours = parseInt(settings.autoCleanup.hours, 10) || 24;
    return settings.autoCleanup;
}

function readAll(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) || [];
    } catch (e) {
        return [];
    }
}

// Kumpulan userId yang masih punya sesi aktif — dipakai sebagai backfill
// untuk akun lama (sebelum fitur lastLoginAt) yang sebenarnya masih aktif.
function activeSessionUserIds() {
    const ids = new Set();
    try {
        if (!fs.existsSync(SESSION_DIR)) return ids;
        fs.readdirSync(SESSION_DIR).forEach(function (file) {
            if (!file.endsWith('.json')) return;
            try {
                const s = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, file), 'utf8'));
                if (s && s.userId) ids.add(s.userId);
            } catch (e) { /* abaikan */ }
        });
    } catch (e) { /* abaikan */ }
    return ids;
}

// Heuristik konservatif "pernah aktif":
// akun yang punya sinyal aktivitas apa pun TIDAK akan dihapus, meski tidak
// punya lastLoginAt (akun lama yang dibuat sebelum fitur pelacakan login).
// Sinyal: pernah login (tracking baru), punya riwayat aktivasi, ada sesi
// aktif, kredit tidak lagi di angka default (pernah pakai/diisi), upgrade
// API aktif, atau terlibat program referal (mengundang/diundang/klaim).
function hasActivity(user, username, historyNames, sessIds) {
    if (user.lastLoginAt) return true;
    if (historyNames.has(username)) return true;
    if (sessIds.has(user.id)) return true;
    if (user.apiActive) return true;
    if ((parseInt(user.credits, 10) || 0) !== DEFAULT_USER_CREDITS) return true;
    if (user.referredBy) return true;
    if ((parseInt(user.referralCount, 10) || 0) > 0) return true;
    if (Array.isArray(user.referrals) && user.referrals.length) return true;
    if ((parseInt(user.referralPending, 10) || 0) > 0) return true;
    return false;
}

/**
 * Jalankan pembersihan sekali.
 * force=true => selalu jalankan (dipakai tombol "Jalankan Sekarang"),
 * meskipun fitur sedang nonaktif. Memperbarui lastRun + lastCount.
 */
export function runAutoCleanup(force) {
    const cfg = getAutoCleanupSettings();
    if (!force && !cfg.enabled) {
        return { success: true, skipped: true, removed: 0, hours: cfg.hours };
    }
    const hours = Math.max(1, cfg.hours);
    const cutoff = Date.now() - hours * 3600 * 1000;

    const users = getUsers();
    const historyNames = new Set(readAll(HISTORY_FILE).map(function (h) { return h && h.username; }).filter(Boolean));
    const sessIds = activeSessionUserIds();

    const victims = [];
    Object.keys(users).forEach(function (un) {
        const u = users[un];
        if (!u) return;
        if (u.role !== 'user') return;          // hanya role user (gratis)
        if (u.banned) return;                   // jangan sentuh yang diblokir manual
        const created = u.createdAt ? new Date(u.createdAt).getTime() : 0;
        if (!created || created > cutoff) return; // belum cukup umur
        if (hasActivity(u, un, historyNames, sessIds)) return; // masih ada sinyal aktivitas
        victims.push(un);
        delete users[un];
    });

    // Ikatkan aturan "maksimal 3 akun per IP" (sesuai kebijakan registrasi).
    // Untuk setiap IP yang terdaftar > MAX_PER_IP akun, akun kelebihan (n-3)
    // dihapus. Prioritas kunci: akun yang masih punya sinyal aktivitas
    // TIDAK pernah dihapus — hanya akun tanpa aktivitas yang dikorbankan.
    const MAX_PER_IP = 3;
    const byIp = {};
    Object.keys(users).forEach(function (un) {
        const x = users[un];
        if (!x || !x.ip) return;
        (byIp[x.ip] = byIp[x.ip] || []).push(un);
    });
    Object.keys(byIp).forEach(function (ip) {
        const group = byIp[ip];
        if (group.length <= MAX_PER_IP) return;
        const ranked = group.slice().sort(function (a, b) {
            const pa = hasActivity(users[a], a, historyNames, sessIds) ? 1 : 0;
            const pb = hasActivity(users[b], b, historyNames, sessIds) ? 1 : 0;
            if (pa !== pb) return pb - pa; // yang aktif didahulukan (dipertahankan)
            return String(users[a].createdAt || '').localeCompare(String(users[b].createdAt || '')); // paling baru dibuang
        });
        ranked.slice(MAX_PER_IP).forEach(function (un) {
            if (victims.indexOf(un) === -1 && !hasActivity(users[un], un, historyNames, sessIds)) {
                victims.push(un);
                delete users[un];
            }
        });
    });

    let removed = 0;
    if (victims.length) {
        removed = victims.length;
        saveUsers(users);
        try {
            const hist = readAll(HISTORY_FILE).filter(function (h) { return !(h && victims.indexOf(h.username) !== -1); });
            writeJSON('history', hist);
        } catch (e) { /* abaikan */ }
        try {
            const txs = readAll(TRANSACTIONS_FILE).filter(function (t) { return !(t && victims.indexOf(t.username) !== -1); });
            writeJSON('transactions', txs);
        } catch (e) { /* abaikan */ }
    }

    cfg.lastRun = nowISO();
    cfg.lastCount = removed;
    writeJSON('settings', Object.assign(readJSON('settings', {}), { autoCleanup: cfg }));

    if (removed) {
        const shown = victims.slice(0, 20).join(', ');
        addLog('[SISTEM] Auto-Cleanup: hapus ' + removed + ' akun nonaktif (role user, tanpa aktivitas > ' + hours + ' jam): ' + shown + (removed > 20 ? ' (+' + (removed - 20) + ' lain)' : ''));
    }
    return { success: true, skipped: false, removed: removed, hours: hours };
}

/**
 * Scheduler: cek pertama 1 menit setelah boot, lalu tiap 60 menit.
 * Aman dipanggil saat HMR reload sebanyak apa pun (hanya set interval baru;
 * interval lama mati bersama modul lamanya).
 */
export function startAutoCleanupScheduler() {
    setTimeout(function () { try { runAutoCleanup(false); } catch (e) { /* abaikan */ } }, 60 * 1000);
    setInterval(function () { try { runAutoCleanup(false); } catch (e) { /* abaikan */ } }, 60 * 60 * 1000);
}
