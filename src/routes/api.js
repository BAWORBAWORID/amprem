/**
 * Rute API utama (semua endpoint /api/*).
 * Pindahan verbatim dari server.js monolit — memakai helper dari utils.
 */
import { getClientIP, sendJSON, readBody, getUsers, saveUsers, readJSON, writeJSON, newId, nowISO, fmtDateTime, randomKey, getClientDevice, isLocalIP, requireNoMaintenance, addLog, addDuplicateLog } from '../utils/store.js';
import { CHAT_CLIENTS } from '../utils/chat.js';

// Panel H2H (atlantich2h.com) — API key disimpan di data/settings.json -> h2h.apiKey
const H2H_API_URL = 'https://atlantich2h.com/get_profile';

// Format lama menyimpan bannedIps sebagai string, sedangkan panel admin
// membutuhkan metadata untuk ditampilkan. Normalisasi di satu tempat agar
// data lama tetap terbaca dan data baru konsisten sebagai record.
function getBannedIPRecords() {
    const source = readJSON('ips', { bannedIps: [] });
    const list = Array.isArray(source && source.bannedIps) ? source.bannedIps : [];
    return list.map(function (entry) {
        if (typeof entry === 'string') return { ip: entry.trim(), createdAt: '-' };
        return {
            ip: String(entry && entry.ip || '').trim(),
            createdAt: entry && entry.createdAt ? String(entry.createdAt) : '-',
        };
    }).filter(function (entry) { return entry.ip; });
}

function saveBannedIPRecords(records) {
    const source = readJSON('ips', {});
    writeJSON('ips', Object.assign({}, source, { bannedIps: records }));
}

import { createSession, setSessionCookie, destroySession, getSessionUser } from '../utils/session.js';
import { sanitizeUser, hashPassword, verifyPassword, isUnlimitedRole, hasApiRole, hasBulkRole, prepareApiRole, isPremiumExpired, canUseGenerator, canUseBatch, generateReferralCode, ensureReferralCode, findReferralOwner, getReferralData, claimReferralRewards, REFERRAL_REWARD } from '../utils/auth.js';
import { getChatMessages, broadcastChat, broadcastChatEvent, containsBadword, reviewStats } from '../utils/chat.js';
import { sendLink, claimPremium, getActiveBatch, startBatch, startBatchWorker, progressBatch, serializeBatch, generateNetflixDemoToken, GENEMAIL_DOMAINS, GENEMAIL_VERIFIED_DOMAINS } from '../utils/am.js';
import { deployBot, stopBot, startBot, restartBot, removeBot, listBots, canManageBot, isBotOwnedBy, rekeyBotsForUser } from '../utils/telegram.js';
import { SECURITY_HEADERS } from '../utils/security.js';

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

    // Validasi kode referal (dipakai halaman /invite?code=xxx supaya banner
    // undangan hanya muncul bila kode benar-benar milik akun yang masih ada).
    if (pathname === '/api/invite/check' && method === 'GET') {
        const code = String(url.searchParams.get('code') || '').trim();
        if (!code) return sendJSON(res, 400, { success: false, valid: false, message: 'Parameter code wajib diisi.' });
        const owner = findReferralOwner(getUsers(), code);
        if (!owner || owner.banned) {
            return sendJSON(res, 200, { success: true, valid: false, error: 'INVALID_REFERRAL', message: 'Kode referal tidak ditemukan / tidak aktif.' });
        }
        return sendJSON(res, 200, { success: true, valid: true, error: null, username: owner.username, message: 'Kode referal valid.' });
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
        const user = getSessionUser(req, res);
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
        const user = getSessionUser(req, res);
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
        const user = getSessionUser(req, res);
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

    /* ---------- REFERRAL (halaman Program Referal) ---------- */
    if (pathname === '/api/referral' && method === 'GET') {
        const user = getSessionUser(req, res);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        ensureReferralCode(user);
        const users = getUsers();
        const data = getReferralData(users[user.username] || user);
        return sendJSON(res, 200, {
            success: true,
            data: Object.assign({}, data, {
                referralUrl: (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers.host || 'localhost') + '/invite?code=' + encodeURIComponent(data.referralCode),
            }),
        });
    }

    if (pathname === '/api/referral/claim' && method === 'POST') {
        const user = getSessionUser(req, res);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        const users = getUsers();
        const fresh = users[user.username];
        if (!fresh) return sendJSON(res, 404, { success: false, message: 'Akun tidak ditemukan.' });
        const result = claimReferralRewards(fresh);
        if (!result.success) return sendJSON(res, 200, result);
        users[user.username] = fresh;
        saveUsers(users);
        addLog('[REFERAL] ' + user.username + ' klaim reward +' + result.claimedReward + ' credit (pending ' + fresh.referralPending + ')');
        return sendJSON(res, 200, {
            success: true,
            message: result.message,
            claimedReward: result.claimedReward,
            credits: fresh.credits,
            pendingReward: 0,
            claimedRewardTotal: getReferralData(fresh).claimedReward,
        });
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
        if (users[username]) return sendJSON(res, 409, { success: false, error: 'USERNAME_EXISTS', message: 'Username sudah terdaftar.' });
        const banned = getBannedIPRecords().map(function (entry) { return entry.ip; });
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
            role: 'user', credits: 20, apiKey: '', apiPlan: '', apiExpiresAt: null, apiActive: false,
            createdAt: nowISO(), banned: false, ip: ip, device: getClientDevice(req),
            referralCode: generateReferralCode(users), referredBy: '', referralCount: 0, referralEarned: 0,
            referralPending: 0, referralClaimed: 0, referrals: [],
        };
        // ==== REFERAL ====
        // Kode opsional. Kode tidak valid / tidak ditemukan DIBIARKAN (registrasi
        // tetap jalan normal tanpa bonus) sesuai keputusan owner.
        const referralInput = String(body.referralCode || '').trim();
        let referralBonus = false;
        if (referralInput) {
            const inviter = findReferralOwner(users, referralInput);
            // Cegah farming kredit: jangan beri komisi jika pendaftar memakai IP
            // yang sama dengan pengundang (self-referral / multi-akun 1 IP).
            // Akun banned juga tidak berhak menerima komisi (konsisten dgn /api/invite/check).
            const sameIp = !isLocalIP(ip) && inviter && String(inviter.ip || '') === ip;
            if (inviter && !inviter.banned && !sameIp) {
                // Yang diundang hanya dapat 10 credit (bukan 20 default).
                user.credits = 10;
                user.referredBy = inviter.username;
                user.referredByCode = inviter.referralCode;
                // Pengundang TIDAK langsung dapat kredit — reward masuk status
                // pending dan diklaim lewat halaman Program Referal (anti-abuse,
                // klaim atomik via POST /api/referral/claim).
                inviter.referralCount = (parseInt(inviter.referralCount, 10) || 0) + 1;
                inviter.referralPending = (parseInt(inviter.referralPending, 10) || 0) + 1;
                if (!Array.isArray(inviter.referrals)) inviter.referrals = [];
                inviter.referrals.push({
                    id: newId(),
                    username: username,
                    joinedAt: nowISO(),
                    status: 'pending',
                });
                users[inviter.username] = inviter;
                referralBonus = true;
                addLog('[REFERAL] ' + username + ' daftar dengan kode ' + inviter.referralCode + ' dari ' + inviter.username + ' (reward +' + REFERRAL_REWARD + ' pending)');
            }
        }
        users[username] = user;
        saveUsers(users);
        addLog('[SISTEM] Registrasi baru: ' + username + (referralBonus ? ' (via referal)' : ''));
        return sendJSON(res, 200, {
            success: true, message: 'Registrasi sukses.',
            referralApplied: referralBonus,
            referralBonus: referralBonus ? 10 : 0,
        });
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
        // Akun lama (sebelum fitur referal) otomatis diberi kode referal saat login.
        ensureReferralCode(user);
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
        const user = getSessionUser(req, res);
        if (!user) return sendJSON(res, 200, { success: false, message: 'Tidak terautentikasi.' });
        ensureReferralCode(user);
        return sendJSON(res, 200, { success: true, user: sanitizeUser(user) });
    }

    if (pathname === '/api/auth/reset-key' && method === 'POST') {
        const user = getSessionUser(req, res);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        if (!hasApiRole(user.role)) {
            return sendJSON(res, 403, { success: false, message: 'Role Anda tidak memiliki akses API Key. Upgrade ke Premium atau Auto Generator.' });
        }
        const users = getUsers();
        const oldKey = user.apiKey || '';
        user.apiKey = 'Codex' + randomKey(31);
        user.apiKeyRevoked = false;
        user.apiActive = true;
        users[user.username] = user;
        saveUsers(users);
        // Bot Telegram milik user otomatis memakai key baru & di-restart,
        // supaya tidak tertolak 403 karena key lama sudah dicabut.
        let botsUpdated = 0;
        try {
            botsUpdated = rekeyBotsForUser(oldKey, user.apiKey, user.username);
        } catch (e) {
            console.error('[RESET-KEY] Gagal update API Key bot telegram: ' + e.message);
        }
        addLog('[SISTEM] ' + user.username + ' generate ulang API Key' + (botsUpdated ? ' (API Key ' + botsUpdated + ' bot otomatis diperbarui)' : ''));
        return sendJSON(res, 200, { success: true, message: 'API Key berhasil di-generate.', apiKey: user.apiKey, botsUpdated: botsUpdated });
    }

    if (pathname === '/api/auth/change-username' && method === 'POST') {
        const user = getSessionUser(req, res);
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
        const user = getSessionUser(req, res);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Silakan login terlebih dahulu.' });
        if (!canUseGenerator(user)) return sendJSON(res, 403, { success: false, message: 'Masa aktif paket Anda telah berakhir. Silakan perpanjang untuk melanjutkan.' });
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
        const user = getSessionUser(req, res);
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
        const user = getSessionUser(req, res);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        const history = readJSON('history', []);
        const mine = history.filter(function (h) { return h.username === user.username; });
        return sendJSON(res, 200, { success: true, history: mine });
    }

    if (pathname === '/api/am/domains' && method === 'GET') {
        // Tampilkan domain TERVERIFIKASI (aktif & terbukti) di UI, bukan 154
        // domain penuh yang banyak mati — konsisten dgn mode random batch.
        return sendJSON(res, 200, { success: true, domains: GENEMAIL_VERIFIED_DOMAINS });
    }

    if (pathname === '/api/am/autogen/start-batch' && method === 'POST') {
        const user = getSessionUser(req, res);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        if (!hasBulkRole(user.role)) return sendJSON(res, 403, { success: false, message: 'Fitur Bulk Auto Generator hanya untuk role AutoGen, Admin, atau Owner.' });
        const body = await readBody(req);
        const result = startBatch(user, String(body.domain || '').trim() || 'random', parseInt(body.count, 10), String(body.prefix || ''));
        return sendJSON(res, result.success ? 200 : 400, result);
    }

    if (pathname === '/api/am/autogen/active-batch' && method === 'GET') {
        const user = getSessionUser(req, res);
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
        const user = getSessionUser(req, res);
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
        const user = getSessionUser(req, res);
        if (!user) return sendJSON(res, 401, { success: false, message: 'Tidak terautentikasi.' });
        const batch = getActiveBatch();
        if (batch && !canUseBatch(user, batch)) return sendJSON(res, 403, { success: false, message: 'Batch ini bukan milik Anda.' });
        writeJSON('batch', null);
        return sendJSON(res, 200, { success: true, message: 'Batch dibersihkan.' });
    }

    if (pathname === '/api/am/netflix/token' && method === 'GET') {
        const user = getSessionUser(req, res);
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
        const user = getSessionUser(req, res);
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

    if (pathname === '/api/admin/h2h/profile' && method === 'GET') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const settings = readJSON('settings', {});
        const apiKey = (settings.h2h && settings.h2h.apiKey) || '';
        if (!apiKey) return sendJSON(res, 200, { success: false, message: 'API Key H2H belum dikonfigurasi.' });
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 12000);
            const resp = await fetch(H2H_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                },
                body: 'api_key=' + encodeURIComponent(apiKey),
                signal: ctrl.signal,
            });
            clearTimeout(timer);
            const data = await resp.json().catch(() => ({}));
            if (data && data.status === 'true' && data.data) {
                return sendJSON(res, 200, {
                    success: true,
                    name: data.data.name || '',
                    balance: data.data.balance != null ? data.data.balance : 0,
                    settlementBalance: data.data.settlement_balance != null ? data.data.settlement_balance : 0,
                    status: data.data.status || '',
                });
            }
            return sendJSON(res, 200, { success: false, message: 'Gagal mengambil profil H2H: ' + String(data.message || 'respon tidak valid').slice(0, 120) });
        } catch (e) {
            return sendJSON(res, 200, { success: false, message: 'Tidak dapat terhubung ke server H2H.' });
        }
    }

    if (pathname === '/api/admin/users' && method === 'GET') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const users = getUsers();
        const list = Object.keys(users).map(function (k) {
            const u = users[k];
            const expired = isPremiumExpired(u);
            return {
                id: u.id, username: u.username, role: u.role, credits: isPrivilegedRole(u.role) ? null : u.credits,
                banned: !!u.banned, ip: u.ip, device: u.device, createdAt: u.createdAt,
                apiPlan: u.apiPlan || '', apiExpiresAt: u.apiExpiresAt || null, expired: expired,
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
        const bannedIPRecords = getBannedIPRecords();
        const bannedIPSet = new Set(bannedIPRecords.map(function (entry) { return entry.ip; }));
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
                banned: !!u.banned, bannedIp: bannedIPSet.has(u.ip),
            };
        });
        return sendJSON(res, 200, { success: true, users: list, bannedIps: bannedIPRecords });
    }

    if (pathname === '/api/admin/reset-all-credits' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const users = getUsers();
        Object.keys(users).forEach(function (k) {
            if (users[k].role === 'user') users[k].credits = 20;
        });
        saveUsers(users);
        addLog('[ADMIN ' + admin.username + '] Reset semua kredit user menjadi 20');
        return sendJSON(res, 200, { success: true, message: 'Semua kredit user di-reset menjadi 20.' });
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
        const records = getBannedIPRecords();
        if (!records.some(function (entry) { return entry.ip === ip; })) {
            records.push({ ip: ip, createdAt: nowISO() });
            saveBannedIPRecords(records);
        }
        addLog('[ADMIN ' + admin.username + '] Blokir IP ' + ip);
        return sendJSON(res, 200, { success: true, message: 'IP ' + ip + ' berhasil diblokir.' });
    }

    if (pathname === '/api/admin/ip/unban' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        const ip = String(body.ip || '').trim();
        const records = getBannedIPRecords().filter(function (entry) { return entry.ip !== ip; });
        saveBannedIPRecords(records);
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
        // Semua role premium (reseller/premium/autogen/admin) mendukung
        // masa aktif: apiPlan 'lifetime' (selamanya) atau expired dgn durasi.
        // Default admin/owner tanpa body.apiPlan = lifetime (kompatibel lama).
        const premiumRoles = ['reseller', 'premium', 'autogen', 'admin'];
        if (premiumRoles.indexOf(role) !== -1) {
            // Default lifetime bila apiPlan tidak dikirim (kompatibel lama).
            const plan = body.apiPlan === 'expired' ? 'expired' : 'lifetime';
            target.apiPlan = plan;
            if (plan === 'lifetime') {
                target.apiExpiresAt = null;
            } else {
                const days = Math.max(1, parseInt(body.expiresInDays, 10) || 30);
                target.apiExpiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
            }
            // Reseller = web only (tanpa API key). Premium/autogen/admin dapat API key.
            if (role === 'reseller') {
                target.apiKey = '';
                target.apiKeyRevoked = false;
                target.apiActive = false;
            } else {
                prepareApiRole(target, previousRole);
            }
        } else if (role === 'user') {
            target.apiKey = '';
            target.apiKeyRevoked = false;
            target.apiPlan = '';
            target.apiExpiresAt = null;
            target.apiActive = false;
            if (target.credits == null || target.credits < 0) target.credits = 20;
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

    /* ---------- TELEGRAM BOT DEPLOY (admin/owner) ---------- */
    // Helper: cek kepemilikan bot. Owner bisa semua; admin hanya bot miliknya.
    function botManageable(id, admin) {
        return canManageBot(String(id || ''), admin.username, admin.role === 'owner');
    }
    function botsFor(admin) {
        return listBots(admin.username, admin.role === 'owner');
    }

    if (pathname === '/api/telegram/bots' && method === 'GET') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        return sendJSON(res, 200, { success: true, bots: botsFor(admin) });
    }

    if (pathname === '/api/telegram/deploy' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        // Pastikan admin punya API Key untuk dipakai bot memanggil API internal.
        const users = getUsers();
        let apiKey = admin.apiKey;
        if (!apiKey) {
            apiKey = 'Codex' + randomKey(31);
            admin.apiKey = apiKey;
            admin.apiActive = true;
            users[admin.username] = admin;
            saveUsers(users);
        }
        try {
            const bot = await deployBot({ name: body.name, token: body.token, ownerId: body.ownerId, apiKey: apiKey, deployedBy: admin.username, isOwner: admin.role === 'owner' });
            addLog('[ADMIN ' + admin.username + '] Deploy bot telegram: ' + bot.name);
            return sendJSON(res, 200, { success: true, message: 'Bot ' + bot.name + ' berhasil di-deploy dan online.', bots: botsFor(admin) });
        } catch (e) {
            return sendJSON(res, 400, { success: false, message: e.message });
        }
    }

    if (pathname === '/api/telegram/start' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        if (!botManageable(body.id, admin)) return sendJSON(res, 403, { success: false, message: 'Bot ini bukan milik akun Anda.' });
        try {
            const bot = await startBot(String(body.id || ''));
            addLog('[ADMIN ' + admin.username + '] Start bot telegram: ' + bot.name);
            return sendJSON(res, 200, { success: true, message: 'Bot ' + bot.name + ' dijalankan.', bots: botsFor(admin) });
        } catch (e) {
            return sendJSON(res, 400, { success: false, message: e.message });
        }
    }

    if (pathname === '/api/telegram/stop' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        if (!botManageable(body.id, admin)) return sendJSON(res, 403, { success: false, message: 'Bot ini bukan milik akun Anda.' });
        stopBot(String(body.id || ''));
        addLog('[ADMIN ' + admin.username + '] Stop bot telegram.');
        return sendJSON(res, 200, { success: true, message: 'Bot dihentikan.', bots: botsFor(admin) });
    }

    if (pathname === '/api/telegram/restart' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        if (!botManageable(body.id, admin)) return sendJSON(res, 403, { success: false, message: 'Bot ini bukan milik akun Anda.' });
        try {
            const bot = await restartBot(String(body.id || ''));
            addLog('[ADMIN ' + admin.username + '] Restart bot telegram: ' + bot.name);
            return sendJSON(res, 200, { success: true, message: 'Bot ' + bot.name + ' di-restart.', bots: botsFor(admin) });
        } catch (e) {
            return sendJSON(res, 400, { success: false, message: e.message });
        }
    }

    if (pathname === '/api/telegram/delete' && method === 'POST') {
        const admin = requireAdmin(res);
        if (!admin) return sendJSON(res, 403, { success: false, message: 'Akses ditolak.' });
        const body = await readBody(req);
        if (!botManageable(body.id, admin)) return sendJSON(res, 403, { success: false, message: 'Bot ini bukan milik akun Anda.' });
        removeBot(String(body.id || ''));
        addLog('[ADMIN ' + admin.username + '] Hapus bot telegram.');
        return sendJSON(res, 200, { success: true, message: 'Bot dihapus.', bots: botsFor(admin) });
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

    if (pathname === '/api/v1/bot-premium/bulk') {
        const body = await readBody(req);
        const key = body.apikey || url.searchParams.get('apikey') || req.headers['x-api-key'];
        if (!key) return sendJSON(res, 401, { success: false, message: 'API Key wajib disertakan.' });
        const users = getUsers();
        const user = Object.keys(users).map(function (k) { return users[k]; }).find(function (u) { return u.apiKey === key && u.apiActive && !isPremiumExpired(u); });
        if (!user) return sendJSON(res, 403, { success: false, message: 'API Key tidak valid, tidak aktif, atau masa aktif sudah berakhir.' });
        if (!hasApiRole(user.role)) {
            return sendJSON(res, 403, { success: false, message: 'Fitur API generator hanya untuk role Premium, AutoGen, Admin, atau Owner.' });
        }
        if (!hasBulkRole(user.role)) {
            return sendJSON(res, 403, { success: false, message: 'Fitur Bulk Auto Generator hanya untuk role AutoGen, Admin, atau Owner.' });
        }
        if (!requireNoMaintenance(res, 'generator')) return;
        const count = parseInt(body.count, 10);
        const domain = String(body.domain || '').trim() || 'random';
        const prefix = String(body.prefix || '').trim();
        // Bila dipanggil dari bot Telegram, simpan identitas chat agar hasil
        // batch otomatis dikirim balik ke chat yang meminta. Hanya bot milik
        // user itu sendiri yang boleh dipakai (anti-spoofing chat orang lain).
        const tgBotId = String(body.tgBotId || '');
        const tgChatId = String(body.tgChatId || '');
        if (tgBotId && !isBotOwnedBy(tgBotId, user.apiKey)) {
            return sendJSON(res, 403, { success: false, message: 'Bot Telegram tidak dikenali / bukan milik API Key ini.' });
        }
        const notify = { tgBotId: tgBotId, tgChatId: tgChatId };
        const result = startBatch(user, domain, count, prefix, notify);
        return sendJSON(res, result.success ? 200 : 400, result);
    }

    return sendJSON(res, 404, { success: false, message: 'Endpoint tidak ditemukan.' });
}


export default handleAPI;
