import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const PORT = process.env.PORT || 5000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SESSION_DIR = path.join(DATA_DIR, 'sessions');
const SESSION_MAX_AGE = 30 * 24 * 3600 * 1000;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.apk': 'application/vnd.android.package-archive',
    '.txt': 'text/plain; charset=utf-8',
};

/* ============================== SECURITY HEADERS ============================== */

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-XSS-Protection': '1; mode=block',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

/* ============================== ANTI-BOT / ANTI-CURL ============================== */

// Pola User-Agent alat/script otomatis (bukan browser asli)
const BOT_UA_PATTERN = /(curl\/|wget\/|python-requests|python-urllib|python-http|go-http-client|java\/[0-9]|okhttp|libwww-perl|httpie|powershell|scrapy|php\/[0-9]|axios|node-fetch|postmanruntime|insomnia|ruby\/|perl\/)/i;

// Halaman umpan untuk bot — terlihat seperti interstitial "cek browser"
// (meniru Cloudflare), tidak mengandung konten asli sama sekali.
const DECOY_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Just a moment...</title><meta name="robots" content="noindex"></head><body style="margin:0;background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center;max-width:380px"><div style="font-size:2.5rem;margin-bottom:16px">&#128274;</div><h1 style="font-size:1.4rem;margin:0 0 8px">Checking your browser...</h1><p style="color:#94a3b8;font-size:0.9rem;line-height:1.6;margin:0">Please enable JavaScript and cookies to continue loading the page.</p></div></body></html>';

function isBotRequest(req) {
    const ua = String(req.headers['user-agent'] || '').trim();
    const accept = String(req.headers['accept'] || '');
    const via = String(req.headers['via'] || '');

    // 1) User-Agent jelas dari alat/script otomatis
    if (BOT_UA_PATTERN.test(ua)) return true;

    // 2) Tidak ada User-Agent sama sekali (script nakal tanpa identitas)
    if (!ua && !via) return true;

    // 3) Accept tidak menyebut text/html (browser asli selalu kirim ini)
    //    Hanya berlaku jika UA ada tapi jelas bukan browser mainstream.
    if (accept && !/text\/html|application\/xhtml\+xml|\*\/\*/i.test(accept)) return true;

    return false;
}

function dataFile(name) {
    return path.join(DATA_DIR, name + '.json');
}

function readJSON(name, fallback) {
    const file = dataFile(name);
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

function writeJSON(name, data) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(dataFile(name), JSON.stringify(data, null, 2));
}

function hashPassword(password) {
    return bcrypt.hashSync(String(password), 10);
}

function verifyPassword(user, password) {
    const stored = String(user.password || '');
    if (stored.indexOf('$2') === 0) return bcrypt.compareSync(String(password), stored);
    return stored === crypto.createHash('sha256').update(String(password)).digest('hex');
}

function randomKey(len) {
    return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

function newId() {
    return Date.now().toString(36) + randomKey(6);
}

function nowISO() {
    return new Date().toISOString();
}

function fmtDateTime() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function sendJSON(res, status, data) {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, SECURITY_HEADERS));
    res.end(JSON.stringify(data));
}

function readBody(req) {
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

function getClientIP(req) {
    return (req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

function isLocalIP(ip) {
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].indexOf(ip) !== -1;
}

function getClientDevice(req) {
    const ua = req.headers['user-agent'] || '';
    if (/android/i.test(ua)) return 'Android';
    if (/iphone|ipad/i.test(ua)) return 'iOS';
    if (/windows/i.test(ua)) return 'Windows';
    if (/mac/i.test(ua)) return 'macOS';
    if (/linux/i.test(ua)) return 'Linux';
    return 'Unknown';
}

/* ============================== USER MODEL ============================== */

function getUsers() {
    const users = readJSON('users', {});
    return users;
}

function saveUsers(users) {
    writeJSON('users', users);
}

function seedOwner() {
    const users = getUsers();
    if (!users['alwayscodex']) {
        users['alwayscodex'] = {
            id: 'owner-' + Date.now().toString(36),
            username: 'alwayscodex',
            password: hashPassword('Akunff+62'),
            role: 'owner',
            credits: 999999,
            apiKey: 'Codex' + randomKey(31),
            apiPlan: 'lifetime',
            apiExpiresAt: null,
            apiActive: true,
            createdAt: nowISO(),
            banned: false,
            ip: '',
            device: '',
        };
        saveUsers(users);
        console.log('[SEED] Owner account created: alwayscodex');
    }
}

function sanitizeUser(u) {
    if (!u) return null;
    return {
        id: u.id,
        username: u.username,
        role: u.role,
        credits: u.credits,
        apiKey: u.apiKey,
        apiPlan: u.apiPlan || '',
        apiExpiresAt: u.apiExpiresAt || null,
        apiActive: !!u.apiActive,
        createdAt: u.createdAt,
        banned: !!u.banned,
    };
}

/* ============================== ROLE CAPABILITIES ============================== */

function isUnlimitedRole(role) {
    return ['reseller', 'premium', 'autogen', 'admin', 'owner'].indexOf(role) !== -1;
}

function hasApiRole(role) {
    return ['premium', 'autogen', 'admin', 'owner'].indexOf(role) !== -1;
}

function hasBulkRole(role) {
    return ['autogen', 'admin', 'owner'].indexOf(role) !== -1;
}

function prepareApiRole(user, previousRole) {
    if (!user || !hasApiRole(user.role)) return;
    // New API-capable roles start without a key. Renewals preserve a key
    // that the user generated manually.
    if (!hasApiRole(previousRole)) {
        user.apiKey = '';
        user.apiActive = false;
        user.apiKeyRevoked = false;
    }
}

function isPremiumExpired(user) {
    return !!(user && user.role === 'premium' && user.apiExpiresAt && Date.parse(user.apiExpiresAt) <= Date.now());
}

function canUseGenerator(user) {
    return !!(user && (user.role === 'user' || isUnlimitedRole(user.role)) && !isPremiumExpired(user));
}

function canUseBatch(user, batch) {
    if (!user || !batch || !hasBulkRole(user.role)) return false;
    return ['admin', 'owner'].indexOf(user.role) !== -1 || batch.operator === user.username;
}

function addLog(message) {
    const logs = readJSON('logs', []);
    logs.push({ id: newId(), createdAt: fmtDateTime(), message: message });
    if (logs.length > 500) logs.splice(0, logs.length - 500);
    writeJSON('logs', logs);
}

function addActivationLog(entry) {
    const logs = readJSON('activations', []);
    logs.push(Object.assign({ id: newId() }, entry));
    if (logs.length > 1000) logs.splice(0, logs.length - 1000);
    writeJSON('activations', logs);
}

function addDuplicateLog(message) {
    const logs = readJSON('duplicates', []);
    logs.push({ id: newId(), createdAt: fmtDateTime(), message: message });
    if (logs.length > 200) logs.splice(0, logs.length - 200);
    writeJSON('duplicates', logs);
}

/* ============================== SESSION ============================== */

function sessionFile(token) {
    return path.join(SESSION_DIR, token + '.json');
}

function removeUserSessions(userId) {
    // Hapus semua file session milik user yang sama (1 session aktif per user),
    // supaya folder data/sessions tidak membengkak setiap kali login ulang.
    try {
        if (!fs.existsSync(SESSION_DIR)) return;
        fs.readdirSync(SESSION_DIR).forEach(function (file) {
            if (!file.endsWith('.json')) return;
            try {
                const s = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, file), 'utf8'));
                if (s && s.userId === userId) fs.unlinkSync(path.join(SESSION_DIR, file));
            } catch (e) { /* abaikan file korup */ }
        });
    } catch (e) { /* abaikan */ }
}

function createSession(userId) {
    // Re-write: buang session lama milik user yang sama dulu, lalu tulis yang baru.
    removeUserSessions(userId);
    const token = randomKey(32);
    const session = { userId: userId, createdAt: Date.now(), lastActiveAt: Date.now() };
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(sessionFile(token), JSON.stringify(session));
    return token;
}

function readSession(token) {
    try {
        const session = JSON.parse(fs.readFileSync(sessionFile(token), 'utf8'));
        if (!session || typeof session.userId !== 'string') return null;
        if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
            fs.unlinkSync(sessionFile(token));
            return null;
        }
        if (Date.now() - session.lastActiveAt > 60 * 1000) {
            session.lastActiveAt = Date.now();
            fs.writeFileSync(sessionFile(token), JSON.stringify(session));
        }
        return session;
    } catch (e) {
        return null;
    }
}

function getSessionUser(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/connect\.sid=([^;]+)/);
    if (!match) return null;
    const session = readSession(decodeURIComponent(match[1]));
    if (!session) return null;
    const users = getUsers();
    for (const key of Object.keys(users)) {
        if (users[key].id === session.userId) return users[key];
    }
    return null;
}

function destroySession(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/connect\.sid=([^;]+)/);
    if (match) {
        const file = sessionFile(decodeURIComponent(match[1]));
        try { fs.unlinkSync(file); } catch (e) { /* abaikan */ }
    }
}

function cleanupExpiredSessions() {
    try {
        if (!fs.existsSync(SESSION_DIR)) { fs.mkdirSync(SESSION_DIR, { recursive: true }); return; }
        const now = Date.now();
        const users = getUsers();
        const newestByUser = {};
        // 1) Hapus session kedaluwarsa / korup / milik user yang sudah tidak ada (yatim),
        //    sambil catat session terbaru per user.
        fs.readdirSync(SESSION_DIR).forEach(function (file) {
            if (!file.endsWith('.json')) return;
            try {
                const session = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, file), 'utf8'));
                const userExists = session && typeof session.userId === 'string' &&
                    Object.keys(users).some(function (k) { return users[k].id === session.userId; });
                if (!userExists || now - session.createdAt > SESSION_MAX_AGE) {
                    fs.unlinkSync(path.join(SESSION_DIR, file));
                    return;
                }
                const key = session.userId;
                const time = session.lastActiveAt || session.createdAt || 0;
                if (!newestByUser[key] || time > newestByUser[key].time) {
                    newestByUser[key] = { file: file, time: time };
                }
            } catch (e) {
                try { fs.unlinkSync(path.join(SESSION_DIR, file)); } catch (e2) { /* abaikan */ }
            }
        });
        // 2) Dedup bloat lama: hapus session yang bukan yang terbaru untuk user yang sama.
        fs.readdirSync(SESSION_DIR).forEach(function (file) {
            if (!file.endsWith('.json')) return;
            try {
                const s = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, file), 'utf8'));
                if (s && newestByUser[s.userId] && newestByUser[s.userId].file !== file) {
                    fs.unlinkSync(path.join(SESSION_DIR, file));
                }
            } catch (e) { /* abaikan */ }
        });
    } catch (e) { /* abaikan */ }
}

function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie', 'connect.sid=' + encodeURIComponent(token) + '; HttpOnly; Path=/; Max-Age=' + (30 * 24 * 3600));
}

/* ============================== MAINTENANCE ============================== */

function isMaintenance(which) {
    const settings = readJSON('settings', {});
    const maint = settings.maintenance || {};
    return !!maint[which];
}

function requireNoMaintenance(res, which) {
    if (isMaintenance(which)) {
        sendJSON(res, 503, { success: false, message: 'Fitur sedang dalam pemeliharaan (maintenance). Silakan coba lagi nanti.' });
        return false;
    }
    return true;
}

import AMAuth from './services/auth.js';
import { runBulk, closeBrowser } from './services/bulk.js';

/* ============================== AM GENERATOR ============================== */

function generateOrderId() {
    return 'Alwayscodex-' + randomKey(8).toUpperCase();
}

async function sendLink(user, email) {
    const users = getUsers();

    if (!canUseGenerator(user)) {
        return { success: false, message: 'Masa aktif Premium Anda telah berakhir. Silakan perpanjang paket untuk melanjutkan.' };
    }

    if (user.role === 'user') {
        if (user.credits < 1) {
            return { success: false, message: 'Kredit Anda tidak mencukupi. Silakan tunggu reset kredit harian atau beli paket premium.' };
        }
        user.credits -= 1;
        users[user.username] = user;
        saveUsers(users);
    }

    const auth = new AMAuth();
    const result = await auth.sendMagicLink(email);

    if (!result.success) {
        if (user.role === 'user') {
            user.credits += 1;
            users[user.username] = user;
            saveUsers(users);
        }
        return { success: false, message: 'Gagal mengirim magic link: ' + (result.error || result.message || 'Unknown error') };
    }

    const orderId = generateOrderId();
    const history = readJSON('history', []);
    history.push({
        id: newId(),
        username: user.username,
        email: email,
        orderId: orderId,
        status: 'pending',
        note: 'Tautan verifikasi dikirim',
        createdAt: fmtDateTime(),
    });
    writeJSON('history', history);

    addActivationLog({ operator: user.username, email: email, status: 'success', note: 'send-link: tautan dikirim', createdAt: fmtDateTime() });
    addLog('[' + user.username + '] Kirim tautan verifikasi ke ' + email);

    return { success: true, message: 'Magic link berhasil dikirim ke email ' + email + '. Cek inbox/spam.', orderId: orderId };
}

async function claimPremium(user, email, rawLink) {
    const auth = new AMAuth();
    const verifyResult = await auth.verifyAndFetchProfile(email, rawLink);

    if (!verifyResult.success) {
        return { success: false, message: 'Gagal verifikasi: ' + (verifyResult.error || verifyResult.message || 'Unknown error') };
    }

    const premiumResult = await auth.applyPremium(verifyResult.idToken);

    if (!premiumResult.success) {
        return { success: false, message: 'Gagal aktivasi premium: ' + (premiumResult.error || premiumResult.message || 'Unknown error') };
    }

    const history = readJSON('history', []);
    const orderId = generateOrderId();
    history.push({
        id: newId(),
        username: user.username,
        email: email,
        orderId: orderId,
        status: 'success',
        note: 'Premium diaktifkan',
        codeorder: premiumResult.codeorder,
        createdAt: fmtDateTime(),
    });
    writeJSON('history', history);

    addActivationLog({ operator: user.username, email: email, status: 'success', note: 'claim-premium: lisensi aktif', createdAt: fmtDateTime() });
    addLog('[' + user.username + '] Aktivasi premium sukses untuk ' + email + ' (codeorder: ' + premiumResult.codeorder + ')');

    return { success: true, message: 'Premium berhasil diaktifkan! Code order: ' + premiumResult.codeorder, codeorder: premiumResult.codeorder };
}

/* ============================== AUTO GENERATOR ============================== */

/* Daftar domain generator.email (di-scrape dari /api/domains.php, 154 domain) */
const GENEMAIL_DOMAINS = [
    '1win.life', '365boxmail.com', '5xu.vn', '69flix.site', 'ads24h.top', 'ahmadfamily.net', 'aircourriel.com',
    'amiyah.cloud', 'angiiidayyy.click', 'arkoo.site', 'banclonetiktok.com', 'binancepools.cloud', 'boxmail1.com',
    'buniversee.xyz', 'c-tta.top', 'cangcud.com', 'capcut.space', 'casterview.xyz', 'cipcup.site', 'cloudyourfast.net',
    'codzy.net', 'crogra.org', 'cttnoot.us', 'cuahangvppn.shop', 'cuaks.fun', 'cunan.store', 'cuscuscuspen.life',
    'cutevi.us', 'dailynove.com', 'dailynutria.com', 'dcs21sd.com', 'dichvuxe24h.com', 'docash.app',
    'duriancompany.us', 'edugmail.bond', 'emailuae.com', 'enowgntg.site', 'fbins001mail.com', 'fboxmail.com',
    'gamen.me', 'gdfgergrer.online', 'gentleinfopath.com', 'gmail-xsniper.com', 'gmail-xsniper.site',
    'gmail-xsniper.space', 'gmailxsn.site', 'gmailxsn.space', 'goliszek.net', 'googlebox.kr', 'gudri.com',
    'habitnestguide.com', 'herilev.top', 'himacreative.id', 'hitbtcpool.cloud', 'hoeson.top', 'homewiseleaf.com',
    'hutathuww.org', 'huyvillafb.online', 'ichecker.tech', 'jessyx.bond', 'jiangwy.one', 'jiongguo.top',
    'jojomedia.store', 'jywa.social', 'kawneha.site', 'kenari.online', 'kepkat.site', 'kintil.buzz', 'lapluz.xyz',
    'leviacerman.store', 'lifewiseleaf.com', 'lilbahlil.me', 'madeksa.online', 'mailvip.net', 'makeraura.online',
    'makmursrondol.store', 'managedisabled.online', 'maxseeding.vn', 'mengundang.live', 'mnvr.site', 'moryne.site',
    'mtnewtoy.us', 'nabomail.com', 'nanopools.info', 'needshopp.net', 'nestlynotes.com', 'nfengwu.bond',
    'orimassage.com', 'ottsathi.store', 'owo-mailteam.bond', 'pawobby.cfd', 'pipmmotube.store',
    'pkdigitalmart.online', 'plainhomehub.com', 'polysolextcoin.cloud', 'powerdea.me', 'private-year.com',
    'prp-ppdt.app', 'ptnstudio.vn', 'quickdrop.buzz', 'reestore.site', 'rexornge.net', 'reymaticx.com',
    'runcubesapps.id', 'ryuu.codes', 'samaltour.site', 'saovangtiles.site', 'sds-awe.top', 'sendokai.click',
    'sentra-premium.com', 'senvas.me', 'shiita12.com', 'shopcobe.com', 'shopcreative.cc', 'shortweb.live',
    'sim-sppg.com', 'siroja.top', 'skyserver.cyou', 'smakit.vn', 'softbank.id', 'sozenit.com',
    'spotlightdiary.com', 'submitreports.com', 'superti4r.dev', 'taischaves.com', 'tarkashastra.com',
    'tgmaiss.xyz', 'thueotp.net', 'tidylifehub.com', 'tiendadezapasok.com', 'transaksikita.tech', 'trieuhao.site',
    'tubebox.us', 'tunthuta.com', 'unimain.tech', 'usps8.com', 'vectorbrasil.app', 'vividtipzone.com',
    'watsawang.com', 'wintersmail.site', 'xazymarcie.space', 'xsnipersquad.com', 'xsnipersquad.site',
    'xsnipersquad.space', 'xxvd.net', 'yasuo.sbs', 'yellofdf2.click', 'youtube-com-watch-jtpdc8khnpi.bond',
    'youtube-com-watch-jtpdc8khnpi.cyou', 'zevionyx.com', 'zexic.cyou', 'ziellpremium.store', 'znext.bond',
    'zumnime.me', 'jagomail.com',
];

let batchWorkerActive = false;

function getActiveBatch() {
    return readJSON('batch', null);
}

function updateBatch(mutator) {
    const batch = readJSON('batch', null);
    if (!batch) return;
    try { mutator(batch); } catch (e) { /* abaikan */ }
    writeJSON('batch', batch);
}

function startBatch(user, domain, count, prefix) {
    const batch = getActiveBatch();
    if (batch && (batch.status === 'running' || batch.status === 'stalled')) {
        return { success: false, message: 'Masih ada batch yang berjalan. Selesaikan batch sebelumnya terlebih dahulu.' };
    }
    count = Math.min(500, Math.max(1, parseInt(count, 10) || 5));
    const newBatch = {
        id: newId(),
        operator: user.username,
        domain: domain,
        count: count,
        prefix: prefix || '',
        done: 0,
        status: 'running',
        results: [],
        logs: ['[SYSTEM] Logger diinisialisasi...', '[SYSTEM] Batch dimulai oleh ' + user.username, '[SYSTEM] Target: ' + count + ' akun @' + domain],
        createdAt: nowISO(),
        startedAt: Date.now(),
    };
    writeJSON('batch', newBatch);
    addLog('[' + user.username + '] Auto generator batch dimulai (' + count + ' akun @' + domain + ')');
    startBatchWorker(newBatch);
    return { success: true, message: 'Batch dimulai. Worker generator.email berjalan di background.', batch: newBatch };
}

function startBatchWorker(batch, extra) {
    const opts = extra || {};
    const remaining = Math.max(0, batch.count - batch.done);
    if (remaining <= 0) {
        updateBatch(function (b) {
            if (b.id !== batch.id) return;
            b.status = 'completed';
            b.logs.push('[SYSTEM] Semua akun sudah diproses.');
        });
        return;
    }
    batchWorkerActive = true;
    runBulk({
        name: (batch.prefix || 'am') + '{n}',
        domains: [batch.domain],
        count: opts.count || remaining,
        startIndex: opts.startIndex || batch.done + 1,
        maxTries: 20,
        onLog: function (msg) {
            updateBatch(function (b) {
                if (b.id !== batch.id) return;
                b.logs.push('[' + fmtDateTime() + '] ' + msg);
                if (b.logs.length > 300) b.logs.splice(0, b.logs.length - 300);
            });
        },
        onResult: function (r, idx) {
            updateBatch(function (b) {
                if (b.id !== batch.id) return;
                b.results.push(r);
                b.done = b.results.length;
                const tag = r.status === 'success' ? 'OK' : 'GAGAL';
                const extraInfo = r.status === 'success' ? (' -> Alwayscodex ' + (r.codeorder || '-')) : (' (' + (r.error || 'error') + ')');
                b.logs.push('[' + fmtDateTime() + '] ' + tag + ' #' + idx + ' ' + r.email + extraInfo);
                addActivationLog({
                    operator: b.operator, email: r.email,
                    status: r.status === 'success' ? 'success' : 'failed',
                    note: 'autogen: ' + (r.status === 'success' ? (r.codeorder || 'ok') : (r.error || 'gagal')),
                    createdAt: fmtDateTime(),
                });
            });
        },
        onDone: function (results) {
            const ok = results.filter(function (r) { return r.status === 'success'; }).length;
            updateBatch(function (b) {
                if (b.id !== batch.id) return;
                b.status = 'completed';
                b.logs.push('[SYSTEM] Selesai! ' + ok + '/' + results.length + ' akun sukses.');
                const history = readJSON('history', []);
                b.results.forEach(function (r) {
                    history.push({
                        id: newId(), username: b.operator, email: r.email,
                        orderId: generateOrderId(), status: r.status === 'success' ? 'success' : 'failed',
                        note: 'Auto generator', magicLink: r.verifyLink || '', createdAt: fmtDateTime(),
                    });
                });
                writeJSON('history', history);
            });
            addLog('[' + batch.operator + '] Auto generator batch selesai (' + ok + ' akun)');
            batchWorkerActive = false;
        },
    }).catch(function (e) {
        updateBatch(function (b) {
            if (b.id !== batch.id) return;
            b.status = 'failed';
            b.logs.push('[SYSTEM] Batch gagal: ' + e.message);
        });
        addLog('[' + batch.operator + '] Auto generator batch gagal: ' + e.message);
        batchWorkerActive = false;
        closeBrowser().catch(function () { /* abaikan */ });
    });
}

function progressBatch() {
    const batch = getActiveBatch();
    if (!batch || batch.status === 'completed' || batch.status === 'failed') return;
    if (batch.status === 'running' && !batchWorkerActive) {
        batch.status = 'stalled';
        batch.logs.push('[SYSTEM] Worker tidak aktif. Klik "Lanjutkan" untuk menjalankan ulang worker.');
        writeJSON('batch', batch);
    }
}

function serializeBatch(batch) {
    if (!batch) return null;
    return {
        id: batch.id,
        operator: batch.operator,
        domain: batch.domain,
        total: batch.count,
        remaining: batch.count - batch.done,
        status: batch.status,
        results: batch.results,
        logs: batch.logs,
    };
}


/* ============================== NETFLIX (DEMO) ============================== */

function generateNetflixDemoToken() {
    const email = randomKey(8) + randomKey(4) + '@' + ['gmail.com', 'outlook.com', 'yahoo.com'][Math.floor(Math.random() * 3)];
    const months = Math.floor(Math.random() * 6) + 1;
    const billing = new Date();
    billing.setMonth(billing.getMonth() + months);
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    return {
        success: true,
        result: {
            details: {
                Email: email,
                Plan: 'Premium 4K Ultra HD (' + months + ' Bulan)',
                'Billing Date': billing.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
            },
            expires: expires.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
            links: {
                pc: 'https://www.netflix.com/login',
                android: 'https://www.netflix.com/android',
                tv: 'https://www.netflix.com/tv',
            },
        },
    };
}

/* ============================== CHAT ============================== */

const CHAT_CLIENTS = new Set();

function getChatMessages() {
    const messages = readJSON('chat', []);
    return messages.slice(-100);
}

function broadcastChatEvent(event) {
    const payload = 'data: ' + JSON.stringify(event) + '\n\n';
    CHAT_CLIENTS.forEach(function (client) {
        try { client.write(payload); } catch (e) { CHAT_CLIENTS.delete(client); }
    });
}

function broadcastChat(message) {
    broadcastChatEvent({ type: 'new', message: message });
}

/* ---------- Sensor kata kasar chat ---------- */

const BADWORDS = (function () {
    try {
        const raw = readJSON('badwords', []);
        const variants = [];
        raw.forEach(function (w) {
            const base = String(w).toLowerCase().replace(/[^a-z0-9]/g, '');
            if (base) variants.push(base);
        });
        return variants;
    } catch (e) {
        return [];
    }
})();

function normalizeBadwordText(input) {
    const subs = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '+': 't' };
    let out = '';
    const text = String(input || '').toLowerCase();
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (subs[ch]) out += subs[ch];
        else if (/[a-z]/.test(ch)) out += ch;
    }
    return out.replace(/(.)\1+/g, '$1');
}

function containsBadword(text) {
    const normalized = normalizeBadwordText(text);
    if (!normalized) return false;
    for (let i = 0; i < BADWORDS.length; i++) {
        if (normalized.includes(BADWORDS[i])) return true;
    }
    return false;
}

/* ============================== REVIEWS ============================== */

function reviewStats(reviews) {
    const total = reviews.length;
    const sum = reviews.reduce(function (acc, r) { return acc + (r.rating || 0); }, 0);
    return {
        avg: total ? +(sum / total).toFixed(1) : 0,
        count: total,
    };
}

/* ============================== TRANSACTIONS ============================== */

function createTransaction(username, refNo, amount, plan) {
    const txs = readJSON('transactions', []);
    txs.push({
        id: newId(), username: username, refNo: refNo, amount: amount, plan: plan,
        status: 'pending', createdAt: fmtDateTime(),
    });
    writeJSON('transactions', txs);
}

/* ============================== REQUEST HANDLER ============================== */

async function handleAPI(req, res, url) {
    const pathname = url.pathname;
    const method = req.method;
    const clientIP = getClientIP(req);
    console.log('[API REQUEST] ' + method + ' ' + pathname + ' from ' + clientIP);

    /* ---------- PUBLIC ---------- */
    if (pathname === '/api/public/stats' && method === 'GET') {
        const users = getUsers();
        const activations = readJSON('activations', []);
        const success = activations.filter(function (a) { return a.status === 'success'; }).length;
        return sendJSON(res, 200, {
            totalUsers: Object.keys(users).length,
            totalSuccess: success,
            pageViews: 0,
            uptime: process.uptime(),
        });
    }

    if (pathname === '/api/chat/messages' && method === 'GET') {
        return sendJSON(res, 200, { success: true, messages: getChatMessages() });
    }

    if (pathname === '/api/chat/stream' && method === 'GET') {
        res.writeHead(200, Object.assign({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        }, SECURITY_HEADERS));
        res.write(': connected\n\n');
        CHAT_CLIENTS.add(res);
        const heartbeat = setInterval(function () {
            try { res.write(': ping\n\n'); } catch (e) { /* abaikan */ }
        }, 20000);
        req.on('close', function () {
            clearInterval(heartbeat);
            CHAT_CLIENTS.delete(res);
        });
        return;
    }

    if (pathname === '/api/chat/send' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        if (!requireNoMaintenance(res, 'chat')) return;
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        if (!text) return sendJSON(res, 400, { success: false, message: 'Pesan kosong.' });
        if (text.length > 300) return sendJSON(res, 400, { success: false, message: 'Maksimal 300 karakter.' });
        if (containsBadword(text)) return sendJSON(res, 400, { success: false, message: 'Pesan mengandung kata tidak pantas. Harap jaga bahasa saat berchat.' });
        const messages = readJSON('chat', []);
        messages.push({ id: newId(), username: user.username, role: user.role, text: text, createdAt: fmtDateTime() });
        const saved = messages.slice(-300);
        writeJSON('chat', saved);
        broadcastChat(saved[saved.length - 1]);
        return sendJSON(res, 200, { success: true, message: 'Pesan terkirim.' });
    }

    if (pathname === '/api/chat/delete' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        if (user.role !== 'owner' && user.role !== 'admin') return sendJSON(res, 403, { success: false, message: 'Hanya admin yang bisa menghapus pesan.' });
        const body = await readBody(req);
        const id = String(body.id || '');
        if (!id) return sendJSON(res, 400, { success: false, message: 'ID pesan kosong.' });
        const messages = readJSON('chat', []);
        const remaining = messages.filter(function (m) { return m.id !== id; });
        if (remaining.length === messages.length) return sendJSON(res, 404, { success: false, message: 'Pesan tidak ditemukan.' });
        writeJSON('chat', remaining);
        broadcastChatEvent({ type: 'deleted', id: id });
        return sendJSON(res, 200, { success: true, message: 'Pesan dihapus.' });
    }

    if (pathname === '/api/reviews' && method === 'GET') {
        const reviews = readJSON('reviews', []);
        return sendJSON(res, 200, { reviews: reviews, avg: reviewStats(reviews).avg });
    }
    if (pathname === '/api/reviews' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Anda harus login untuk mengirim ulasan.' });
        const body = await readBody(req);
        const rating = parseInt(body.rating, 10);
        if (!rating || rating < 1 || rating > 5) return sendJSON(res, 400, { success: false, message: 'Rating harus 1-5 bintang.' });
        const reviews = readJSON('reviews', []);
        const existing = reviews.find(function (r) { return r.username === user.username; });
        let updated = false;
        if (existing) {
            existing.rating = rating;
            existing.comment = String(body.comment || '').trim();
            existing.createdAt = fmtDateTime();
            updated = true;
        } else {
            reviews.push({ id: newId(), username: user.username, role: user.role, rating: rating, comment: String(body.comment || '').trim(), createdAt: fmtDateTime() });
        }
        writeJSON('reviews', reviews);
        return sendJSON(res, 200, { success: true, message: updated ? 'Ulasan Anda berhasil diperbarui.' : 'Ulasan terkirim.', updated: updated, avg: reviewStats(reviews).avg });
    }

    /* ---------- AUTH ---------- */
    if (pathname === '/api/auth/register' && method === 'POST') {
        const body = await readBody(req);
        const username = String(body.username || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (username.length < 3) return sendJSON(res, 400, { success: false, message: 'Username minimal 3 karakter.' });
        if (password.length < 6) return sendJSON(res, 400, { success: false, message: 'Password minimal 6 karakter.' });
        if (!/^[a-z0-9_.-]+$/.test(username)) return sendJSON(res, 400, { success: false, message: 'Username hanya boleh huruf, angka, titik, garis bawah, dan strip.' });
        const users = getUsers();
        if (users[username]) return sendJSON(res, 409, { success: false, message: 'Username sudah terdaftar.' });
        const banned = readJSON('ips', {}).bannedIps || [];
        const ip = getClientIP(req);
        if (!isLocalIP(ip) && banned.indexOf(ip) !== -1) return sendJSON(res, 403, { success: false, message: 'IP Anda terblokir. Hubungi admin.' });
        const sameIpCount = Object.keys(users).filter(function (k) { return users[k].ip === ip; }).length;
        if (!isLocalIP(ip) && sameIpCount >= 3) {
            addDuplicateLog('[BOT/IP] IP ' + ip + ' mencoba daftar akun ke-' + (sameIpCount + 1) + ' (maksimal 3 akun per IP). Username: ' + username);
            addLog('[SISTEM] Registrasi ditolak (limit 3 akun/IP): ' + username + ' dari ' + ip);
            return sendJSON(res, 403, { success: false, message: 'Batas maksimal 3 akun per IP tercapai. Hubungi admin jika ini akun Anda.' });
        }
        const user = {
            id: newId(), username: username, password: hashPassword(password),
            role: 'user', credits: 50, apiKey: '', apiPlan: '', apiExpiresAt: null, apiActive: false,
            createdAt: nowISO(), banned: false, ip: ip, device: getClientDevice(req),
        };
        users[username] = user;
        saveUsers(users);
        addLog('[SISTEM] Registrasi baru: ' + username);
        return sendJSON(res, 200, { success: true, message: 'Registrasi sukses.' });
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
        const body = await readBody(req);
        const username = String(body.username || '').trim().toLowerCase();
        console.log('[LOGIN] Username: ' + username + ' from ' + clientIP);
        const password = String(body.password || '');
        const users = getUsers();
        const user = users[username];
        if (!user || !verifyPassword(user, password)) {
            return sendJSON(res, 401, { success: false, message: 'Username atau password salah.' });
        }
        let userChanged = false;
        if (String(user.password || '').indexOf('$2') !== 0) {
            user.password = hashPassword(password);
            userChanged = true;
        }
        if (userChanged) {
            users[user.username] = user;
            saveUsers(users);
        }
        if (user.banned) return sendJSON(res, 403, { success: false, message: 'Akun Anda telah diblokir. Hubungi admin.' });
        user.ip = getClientIP(req);
        user.device = getClientDevice(req);
        users[username] = user;
        saveUsers(users);
        const token = createSession(user.id);
        setSessionCookie(res, token);
        addLog('[SISTEM] Login: ' + username);
        return sendJSON(res, 200, { success: true, message: 'Login berhasil.', user: sanitizeUser(user) });
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
        destroySession(req);
        return sendJSON(res, 200, { success: true, message: 'Logout berhasil.' });
    }

    if (pathname === '/api/auth/profile' && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 200, { success: false, message: 'Tidak terautentikasi.' });
        return sendJSON(res, 200, { success: true, user: sanitizeUser(user) });
    }

    if (pathname === '/api/auth/reset-key' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        if (!hasApiRole(user.role)) {
            return sendJSON(res, 403, { success: false, message: 'Role Anda tidak memiliki akses API Key. Upgrade ke Premium atau Auto Generator.' });
        }
        const users = getUsers();
        user.apiKey = 'Codex' + randomKey(31);
        user.apiKeyRevoked = false;
        user.apiActive = true;
        users[user.username] = user;
        saveUsers(users);
        return sendJSON(res, 200, { success: true, message: 'API Key berhasil di-generate.', apiKey: user.apiKey });
    }

    if (pathname === '/api/auth/change-username' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        const body = await readBody(req);
        const newName = String(body.newUsername || '').trim().toLowerCase();
        if (newName.length < 3) return sendJSON(res, 400, { success: false, message: 'Username minimal 3 karakter.' });
        const users = getUsers();
        if (users[newName]) return sendJSON(res, 409, { success: false, message: 'Username sudah dipakai.' });
        const oldName = user.username;
        delete users[oldName];
        user.username = newName;
        users[newName] = user;
        saveUsers(users);

        const migrateField = function (file, field) {
            const list = readJSON(file, []);
            let changed = false;
            list.forEach(function (entry) {
                if (entry[field] === oldName) {
                    entry[field] = newName;
                    changed = true;
                }
            });
            if (changed) writeJSON(file, list);
        };
        migrateField('history', 'username');
        migrateField('activations', 'operator');
        migrateField('chat', 'username');
        migrateField('reviews', 'username');

        const batch = readJSON('batch', null);
        if (batch && batch.operator === oldName) {
            batch.operator = newName;
            writeJSON('batch', batch);
        }

        addLog('[SISTEM] Username "' + oldName + '" diubah menjadi "' + newName + '"');
        return sendJSON(res, 200, { success: true, message: 'Username berhasil diubah.', username: newName });
    }

    if (pathname === '/api/auth/notifications' && method === 'GET') {
        const notifications = readJSON('notifications', []);
        return sendJSON(res, 200, { success: true, notifications: notifications });
    }

    if (pathname === '/api/auth/system/settings' && method === 'GET') {
        const settings = readJSON('settings', {});
        return sendJSON(res, 200, { success: true, maintenance: settings.maintenance || {} });
    }

    /* ---------- AM GENERATOR ---------- */
    if (pathname === '/api/am/send-link' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Silakan login terlebih dahulu.' });
        if (!requireNoMaintenance(res, 'generator')) return;
        const body = await readBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        console.log('[SEND-LINK] User: ' + user.username + ' -> Email: ' + email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return sendJSON(res, 400, { success: false, message: 'Format email tidak valid.' });
        }
        const result = await sendLink(user, email);
        return sendJSON(res, result.success ? 200 : 400, result);
    }

    if (pathname === '/api/am/claim-premium' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Silakan login terlebih dahulu.' });
        if (!canUseGenerator(user)) return sendJSON(res, 403, { success: false, message: 'Masa aktif Premium Anda telah berakhir. Silakan perpanjang paket untuk melanjutkan.' });
        if (!requireNoMaintenance(res, 'generator')) return;
        const body = await readBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const magicLink = String(body.magicLink || '');
        console.log('[CLAIM-PREMIUM] User: ' + user.username + ' -> Email: ' + email);
        const result = await claimPremium(user, email, magicLink);
        return sendJSON(res, result.success ? 200 : 400, result);
    }

    if (pathname === '/api/am/history' && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        const history = readJSON('history', []);
        const mine = history.filter(function (h) { return h.username === user.username; });
        return sendJSON(res, 200, { success: true, history: mine });
    }

    if (pathname === '/api/am/domains' && method === 'GET') {
        return sendJSON(res, 200, { success: true, domains: GENEMAIL_DOMAINS });
    }

    if (pathname === '/api/am/autogen/start-batch' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        if (!hasBulkRole(user.role)) return sendJSON(res, 403, { success: false, message: 'Fitur Bulk Auto Generator hanya untuk role AutoGen, Admin, atau Owner.' });
        const body = await readBody(req);
        const result = startBatch(user, String(body.domain || 'softbank.id'), parseInt(body.count, 10), String(body.prefix || ''));
        return sendJSON(res, result.success ? 200 : 400, result);
    }

    if (pathname === '/api/am/autogen/active-batch' && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        const batch = getActiveBatch();
        if (batch && !canUseBatch(user, batch)) return sendJSON(res, 403, { success: false, message: 'Batch ini bukan milik Anda.' });
        progressBatch();
        return sendJSON(res, 200, {
            success: !!batch,
            isStalled: !!(batch && batch.status === 'stalled'),
            batch: serializeBatch(batch),
        });
    }

    if (pathname === '/api/am/autogen/resume-batch' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        const batch = getActiveBatch();
        if (batch && !canUseBatch(user, batch)) return sendJSON(res, 403, { success: false, message: 'Batch ini bukan milik Anda.' });
        if (batch && batch.status === 'stalled') {
            batch.status = 'running';
            batch.logs.push('[SYSTEM] Batch dilanjutkan...');
            writeJSON('batch', batch);
            startBatchWorker(batch);
            return sendJSON(res, 200, { success: true, message: 'Batch dilanjutkan. Worker dijalankan ulang.' });
        }
        return sendJSON(res, 200, { success: false, message: 'Tidak ada batch stalled untuk dilanjutkan.' });
    }

    if (pathname === '/api/am/autogen/clear-batch' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        const batch = getActiveBatch();
        if (batch && !canUseBatch(user, batch)) return sendJSON(res, 403, { success: false, message: 'Batch ini bukan milik Anda.' });
        writeJSON('batch', null);
        return sendJSON(res, 200, { success: true, message: 'Batch dibersihkan.' });
    }

    if (pathname === '/api/am/netflix/token' && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Silakan login terlebih dahulu.' });
        if (!requireNoMaintenance(res, 'netflix')) return;
        const result = generateNetflixDemoToken();
        addLog('[' + user.username + '] Generate token Netflix (demo)');
        return sendJSON(res, 200, result);
    }

    /* ---------- PAYMENT (LEGACY QRIS) ---------- */
    if (pathname.startsWith('/api/payment/status/') && method === 'GET') {
        const refNo = decodeURIComponent(pathname.split('/').pop());
        const txs = readJSON('transactions', []);
        const tx = txs.find(function (t) { return t.refNo === refNo; });
        if (!tx) return sendJSON(res, 404, { success: false, message: 'Transaksi tidak ditemukan.' });
        return sendJSON(res, 200, { success: true, status: tx.status });
    }
    if (pathname === '/api/payment/cancel' && method === 'POST') {
        return sendJSON(res, 200, { success: true, message: 'Pembayaran dibatalkan.' });
    }

    /* ---------- ADMIN ---------- */
    function requireAdmin(res) {
        const user = getSessionUser(req);
        if (!user) return null;
        if (user.role !== 'admin' && user.role !== 'owner') return null;
        return user;
    }
    function isPrivilegedRole(role) {
        return isUnlimitedRole(role);
    }

    if (pathname === '/api/admin/stats' && method === 'GET') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const users = getUsers();
        const activations = readJSON('activations', []);
        return sendJSON(res, 200, {
            totalUsers: Object.keys(users).length,
            totalRequests: activations.length,
            success: activations.filter(function (a) { return a.status === 'success'; }).length,
            failed: activations.filter(function (a) { return a.status !== 'success'; }).length,
        });
    }

    if (pathname === '/api/admin/users' && method === 'GET') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const users = getUsers();
        const list = Object.keys(users).map(function (k) {
            const u = users[k];
            return {
                id: u.id, username: u.username, role: u.role, credits: isPrivilegedRole(u.role) ? null : u.credits,
                banned: !!u.banned, ip: u.ip, device: u.device, createdAt: u.createdAt,
            };
        });
        return sendJSON(res, 200, { success: true, users: list });
    }

    if (pathname === '/api/admin/logs' && method === 'GET') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const activations = readJSON('activations', []);
        return sendJSON(res, 200, { success: true, logs: activations });
    }

    if (pathname === '/api/admin/transactions' && method === 'GET') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        if (admin.role !== 'owner') return sendJSON(res, 403, { success: false, message: 'Khusus owner.' });
        return sendJSON(res, 200, { success: true, transactions: readJSON('transactions', []) });
    }

    if (pathname === '/api/admin/duplicate-logs' && method === 'GET') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        return sendJSON(res, 200, { success: true, logs: readJSON('duplicates', []) });
    }

    if (pathname === '/api/admin/ips' && method === 'GET') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const users = getUsers();
        const ipCount = {};
        Object.keys(users).forEach(function (k) {
            const i = users[k].ip;
            if (i) ipCount[i] = (ipCount[i] || 0) + 1;
        });
        const list = Object.keys(users).map(function (k) {
            const u = users[k];
            return {
                id: u.id, username: u.username, role: u.role, ip: u.ip, device: u.device,
                ipCount: u.ip ? (ipCount[u.ip] || 0) : 0,
                banned: !!u.banned, bannedIp: (readJSON('ips', {}).bannedIps || []).indexOf(u.ip) !== -1,
            };
        });
        return sendJSON(res, 200, { success: true, users: list, bannedIps: readJSON('ips', {}).bannedIps || [] });
    }

    if (pathname === '/api/admin/reset-all-credits' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const users = getUsers();
        Object.keys(users).forEach(function (k) {
            if (users[k].role === 'user') users[k].credits = 50;
        });
        saveUsers(users);
        addLog('[ADMIN ' + admin.username + '] Reset semua kredit user menjadi 50');
        return sendJSON(res, 200, { success: true, message: 'Semua kredit user di-reset menjadi 50.' });
    }

    if (pathname === '/api/admin/transaction/approve' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        if (admin.role !== 'owner') return sendJSON(res, 403, { success: false, message: 'Khusus owner.' });
        const body = await readBody(req);
        const txs = readJSON('transactions', []);
        const tx = txs.find(function (t) { return t.refNo === body.refNo; });
        if (!tx) return sendJSON(res, 404, { success: false, message: 'Transaksi tidak ditemukan.' });
        tx.status = 'success';
        writeJSON('transactions', txs);
        const users = getUsers();
        if (users[tx.username]) {
            const u = users[tx.username];
            const previousRole = u.role;
            if (tx.plan === 'lifetime') {
                u.role = 'premium'; u.apiPlan = 'lifetime'; u.apiExpiresAt = new Date(Date.now() + 3650 * 24 * 3600 * 1000).toISOString(); prepareApiRole(u, previousRole);
            } else if (tx.plan === 'monthly') {
                u.role = 'premium'; u.apiPlan = 'monthly'; u.apiExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(); prepareApiRole(u, previousRole);
            } else if (tx.plan === 'autogen') {
                u.role = 'autogen'; u.apiPlan = 'autogen'; u.apiExpiresAt = null; prepareApiRole(u, previousRole);
            }
            users[tx.username] = u;
            saveUsers(users);
        }
        addLog('[ADMIN ' + admin.username + '] Setujui transaksi ' + tx.refNo + ' (' + tx.plan + ')');
        return sendJSON(res, 200, { success: true, message: 'Transaksi disetujui. Paket diterapkan ke ' + tx.username + '.' });
    }

    if (pathname === '/api/admin/ip/ban' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        const ip = String(body.ip || '').trim();
        if (!ip) return sendJSON(res, 400, { success: false, message: 'IP kosong.' });
        const ips = readJSON('ips', { bannedIps: [] });
        if (ips.bannedIps.indexOf(ip) === -1) ips.bannedIps.push(ip);
        writeJSON('ips', ips);
        addLog('[ADMIN ' + admin.username + '] Blokir IP ' + ip);
        return sendJSON(res, 200, { success: true, message: 'IP ' + ip + ' berhasil diblokir.' });
    }

    if (pathname === '/api/admin/ip/unban' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        const ip = String(body.ip || '').trim();
        const ips = readJSON('ips', { bannedIps: [] });
        ips.bannedIps = ips.bannedIps.filter(function (i) { return i !== ip; });
        writeJSON('ips', ips);
        return sendJSON(res, 200, { success: true, message: 'IP ' + ip + ' berhasil di-unban.' });
    }

    if (pathname === '/api/admin/cleanup-ry' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        if (admin.role !== 'owner') return sendJSON(res, 403, { success: false, message: 'Khusus owner.' });
        const users = getUsers();
        let removed = 0;
        Object.keys(users).forEach(function (k) {
            if (k.indexOf('ry_') === 0) { delete users[k]; removed++; }
        });
        saveUsers(users);
        writeJSON('transactions', (readJSON('transactions', [])).filter(function (t) { return t.username.indexOf('ry_') !== 0; }));
        const history = readJSON('history', []).filter(function (h) { return h.username.indexOf('ry_') !== 0; });
        writeJSON('history', history);
        addLog('[ADMIN ' + admin.username + '] Bersihkan ' + removed + ' akun ry_');
        return sendJSON(res, 200, { success: true, message: removed + ' akun ry_ berhasil dibersihkan.' });
    }

    if (pathname === '/api/admin/user/delete' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        const users = getUsers();
        const target = Object.keys(users).map(function (k) { return users[k]; }).find(function (u) { return u.id === body.userId; });
        if (!target) return sendJSON(res, 404, { success: false, message: 'User tidak ditemukan.' });
        if (target.role === 'owner' || target.id === admin.id) return sendJSON(res, 403, { success: false, message: 'Tidak bisa menghapus akun ini.' });
        if (admin.role === 'admin' && target.role !== 'user') return sendJSON(res, 403, { success: false, message: 'Admin hanya bisa menghapus member biasa.' });
        delete users[target.username];
        saveUsers(users);
        addLog('[ADMIN ' + admin.username + '] Hapus user ' + target.username);
        return sendJSON(res, 200, { success: true, message: 'User ' + target.username + ' dihapus.' });
    }

    if (pathname === '/api/admin/user/credits' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        const users = getUsers();
        const target = Object.keys(users).map(function (k) { return users[k]; }).find(function (u) { return u.id === body.userId; });
        if (!target) return sendJSON(res, 404, { success: false, message: 'User tidak ditemukan.' });
        if (admin.role === 'admin' && ['admin', 'owner'].indexOf(target.role) !== -1) return sendJSON(res, 403, { success: false, message: 'Admin tidak dapat mengelola akun admin atau owner.' });
        target.credits = Math.max(0, parseInt(body.credits, 10) || 0);
        users[target.username] = target;
        saveUsers(users);
        addLog('[ADMIN ' + admin.username + '] Set kredit ' + target.username + ' = ' + target.credits);
        return sendJSON(res, 200, { success: true, message: 'Kredit ' + target.username + ' diubah menjadi ' + target.credits + '.' });
    }

    if (pathname === '/api/admin/user/reset-password' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        if (!body.newPassword || String(body.newPassword).length < 6) return sendJSON(res, 400, { success: false, message: 'Password minimal 6 karakter.' });
        const users = getUsers();
        const target = Object.keys(users).map(function (k) { return users[k]; }).find(function (u) { return u.id === body.userId; });
        if (!target) return sendJSON(res, 404, { success: false, message: 'User tidak ditemukan.' });
        if (admin.role === 'admin' && ['admin', 'owner'].indexOf(target.role) !== -1) return sendJSON(res, 403, { success: false, message: 'Admin tidak dapat mengelola akun admin atau owner.' });
        target.password = hashPassword(String(body.newPassword));
        users[target.username] = target;
        saveUsers(users);
        addLog('[ADMIN ' + admin.username + '] Reset password ' + target.username);
        return sendJSON(res, 200, { success: true, message: 'Password ' + target.username + ' berhasil di-reset.' });
    }

    if (pathname === '/api/admin/user/toggle-ban' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        const users = getUsers();
        const target = Object.keys(users).map(function (k) { return users[k]; }).find(function (u) { return u.id === body.userId; });
        if (!target) return sendJSON(res, 404, { success: false, message: 'User tidak ditemukan.' });
        if (target.role === 'owner' || target.id === admin.id) return sendJSON(res, 403, { success: false, message: 'Tidak bisa memblokir akun ini.' });
        target.banned = !target.banned;
        users[target.username] = target;
        saveUsers(users);
        addLog('[ADMIN ' + admin.username + '] ' + (target.banned ? 'Blokir' : 'Aktifkan') + ' user ' + target.username);
        return sendJSON(res, 200, { success: true, message: 'User ' + target.username + ' ' + (target.banned ? 'diblokir.' : 'diaktifkan.') });
    }

    if (pathname === '/api/admin/user/role' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        const users = getUsers();
        const target = Object.keys(users).map(function (k) { return users[k]; }).find(function (u) { return u.id === body.userId; });
        if (!target) return sendJSON(res, 404, { success: false, message: 'User tidak ditemukan.' });
        if (target.role === 'owner' || target.id === admin.id) return sendJSON(res, 403, { success: false, message: 'Tidak bisa mengubah role akun ini.' });
        if (admin.role === 'admin' && ['admin', 'owner'].indexOf(target.role) !== -1) return sendJSON(res, 403, { success: false, message: 'Admin tidak dapat mengelola akun admin atau owner.' });
        const role = String(body.role || '');
        const previousRole = target.role;
        if (['user', 'reseller', 'premium', 'autogen', 'admin'].indexOf(role) === -1) return sendJSON(res, 400, { success: false, message: 'Role tidak valid.' });
        if (admin.role === 'admin' && role === 'admin') return sendJSON(res, 403, { success: false, message: 'Admin tidak dapat memberikan role Admin.' });
        target.role = role;
        if (role === 'premium') {
            const plan = body.apiPlan === 'lifetime' ? 'lifetime' : 'monthly';
            target.apiPlan = plan;
            target.apiExpiresAt = plan === 'lifetime'
                ? new Date(Date.now() + 3650 * 24 * 3600 * 1000).toISOString()
                : new Date(Date.now() + (parseInt(body.expiresInDays, 10) || 30) * 24 * 3600 * 1000).toISOString();
            prepareApiRole(target, previousRole);
        } else if (role === 'autogen') {
            target.apiPlan = 'autogen';
            target.apiExpiresAt = null;
            prepareApiRole(target, previousRole);
        } else if (role === 'reseller' || role === 'user') {
            target.apiKey = '';
            target.apiKeyRevoked = false;
            target.apiPlan = '';
            target.apiExpiresAt = null;
            target.apiActive = false;
            if (role === 'user' && (target.credits == null || target.credits < 0)) target.credits = 50;
        } else if (role === 'admin') {
            target.apiPlan = 'lifetime';
            target.apiExpiresAt = null;
            prepareApiRole(target, previousRole);
        }
        users[target.username] = target;
        saveUsers(users);
        addLog('[ADMIN ' + admin.username + '] Ubah role ' + target.username + ' -> ' + role.toUpperCase());
        return sendJSON(res, 200, { success: true, message: 'Role ' + target.username + ' diubah menjadi ' + role.toUpperCase() + '.' });
    }

    if (pathname === '/api/admin/system/settings' && method === 'GET') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        return sendJSON(res, 200, { success: true, maintenance: readJSON('settings', {}).maintenance || {} });
    }
    if (pathname === '/api/admin/system/settings' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        const settings = readJSON('settings', {});
        settings.maintenance = body.value || {};
        writeJSON('settings', settings);
        addLog('[ADMIN ' + admin.username + '] Update maintenance settings');
        return sendJSON(res, 200, { success: true, message: 'Pengaturan maintenance disimpan.' });
    }

    if (pathname === '/api/admin/notifications' && method === 'GET') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        return sendJSON(res, 200, { success: true, notifications: readJSON('notifications', []) });
    }
    if (pathname === '/api/admin/notifications' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        const notifications = readJSON('notifications', []);
        notifications.push({
            id: newId(), type: body.type || 'info', title: String(body.title || '').trim(),
            text: String(body.text || '').trim(), isActive: body.isActive !== false,
            createdAt: fmtDateTime(),
        });
        writeJSON('notifications', notifications);
        return sendJSON(res, 200, { success: true, message: 'Pengumuman ditambahkan.' });
    }
    if (pathname.startsWith('/api/admin/notifications/') && method === 'PUT') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const id = pathname.split('/').pop();
        const body = await readBody(req);
        const notifications = readJSON('notifications', []);
        const n = notifications.find(function (x) { return x.id === id; });
        if (!n) return sendJSON(res, 404, { success: false, message: 'Pengumuman tidak ditemukan.' });
        if (body.isActive !== undefined) n.isActive = !!body.isActive;
        if (body.title !== undefined) n.title = String(body.title).trim();
        if (body.text !== undefined) n.text = String(body.text).trim();
        if (body.type !== undefined) n.type = body.type;
        writeJSON('notifications', notifications);
        return sendJSON(res, 200, { success: true, message: 'Pengumuman diperbarui.' });
    }
    if (pathname.startsWith('/api/admin/notifications/') && method === 'DELETE') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const id = pathname.split('/').pop();
        writeJSON('notifications', readJSON('notifications', []).filter(function (x) { return x.id !== id; }));
        return sendJSON(res, 200, { success: true, message: 'Pengumuman dihapus.' });
    }

    /* ---------- API V1 BOT (publik, via apikey) ---------- */
    if (pathname === '/api/v1/bot-premium' && method === 'GET') {
        return sendJSON(res, 200, { success: true, name: 'AM Premium Bot API', base: '/api/v1/bot-premium', endpoints: ['send-link', 'activate'], docs: 'Lihat menu Panduan API di web' });
    }

    if (pathname === '/api/v1/bot-premium/send-link' || pathname === '/api/v1/bot-premium/activate') {
        const body = await readBody(req);
        const key = body.apikey || url.searchParams.get('apikey') || req.headers['x-api-key'];
        if (!key) return sendJSON(res, 401, { success: false, message: 'API Key wajib disertakan.' });
        const users = getUsers();
        const user = Object.keys(users).map(function (k) { return users[k]; }).find(function (u) { return u.apiKey === key && u.apiActive && !isPremiumExpired(u); });
        if (!user) return sendJSON(res, 403, { success: false, message: 'API Key tidak valid, tidak aktif, atau masa aktif sudah berakhir.' });
        if (!hasApiRole(user.role)) {
            return sendJSON(res, 403, { success: false, message: 'Fitur API generator hanya untuk role Premium, AutoGen, Admin, atau Owner.' });
        }
        if (pathname.endsWith('/send-link')) {
            if (!requireNoMaintenance(res, 'generator')) return;
            const result = await sendLink(user, String(body.email || '').trim().toLowerCase());
            return sendJSON(res, result.success ? 200 : 400, result);
        }
        if (!requireNoMaintenance(res, 'generator')) return;
        const result = await claimPremium(user, String(body.email || '').trim().toLowerCase(), String(body.magicLink || ''));
        return sendJSON(res, result.success ? 200 : 400, result);
    }

    return sendJSON(res, 404, { success: false, message: 'Endpoint tidak ditemukan.' });
}

/* ============================== MAIN SERVER ============================== */

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

    if (url.pathname.startsWith('/api/')) {
        try {
            await handleAPI(req, res, url);
        } catch (e) {
            console.error('[API ERROR]', e.message);
            sendJSON(res, 500, { success: false, message: 'Terjadi kesalahan pada sistem. Silakan coba beberapa saat lagi.' });
        }
        return;
    }

    const requestedPath = url.pathname === '/' ? '/home.html' : url.pathname;
    const publicRoot = path.resolve(PUBLIC_DIR);
    let filePath = path.resolve(publicRoot, '.' + requestedPath);
    const relativePath = path.relative(publicRoot, filePath);
    if (relativePath.startsWith('..' + path.sep) || relativePath === '..' || path.isAbsolute(relativePath)) {
        res.writeHead(403, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS));
        return res.end('Forbidden');
    }

    fs.stat(filePath, (err, stat) => {
        if (!err && stat.isDirectory()) {
            filePath = path.join(filePath, 'home.html');
        }
        fs.readFile(filePath, (readErr, data) => {
            if (readErr) {
                res.writeHead(404, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, SECURITY_HEADERS));
                return res.end('<h1>404 - Halaman tidak ditemukan</h1>');
            }
            const ext = path.extname(filePath);

            // Anti-bot / anti-curl: SEMUA file statis (HTML, JS, CSS, gambar, APK,
            // dll) hanya untuk browser asli. Alat otomatis (curl, wget, python, dll)
            // diberi halaman umpan. Endpoint /api/* TIDAK terpengaruh (ditangani
            // terpisah di atas — tetap bisa dipakai curl dengan apikey).
            if (isBotRequest(req)) {
                res.writeHead(200, Object.assign({
                    'Content-Type': MIME[ext] || 'application/octet-stream',
                    'Cache-Control': 'no-store',
                }, SECURITY_HEADERS));
                return res.end(DECOY_HTML);
            }

            res.writeHead(200, Object.assign({
                'Content-Type': MIME[ext] || 'application/octet-stream',
                'Cache-Control': 'no-cache',
            }, SECURITY_HEADERS));

            // Injeksi script proteksi anti-devtools ke setiap halaman HTML
            let payload = data;
            if (ext === '.html') {
                const tag = '<script src="/security.js"></script>';
                const html = payload.toString('utf8');
                if (html.indexOf(tag) === -1) {
                    payload = Buffer.from(html.replace('</head>', tag + '</head>'));
                }
            }
            res.end(payload);
        });
    });
});

seedOwner();
cleanupExpiredSessions();

server.listen(PORT, '0.0.0.0', () => {
    console.log('AM Premium Creator lokal berjalan di http://0.0.0.0:' + PORT);
    console.log('Owner login: alwayscodex / Akunff+62');
});
