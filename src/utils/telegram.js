/**
 * TELEGRAM BOT DEPLOY MANAGER (multi-bot)
 * ---------------------------------------------------------------
 * Sistem deploy bot Telegram untuk role Admin/Owner.
 * - Konfigurasi bot tersimpan di data/telegram_bots.json
 * - Bot dijalankan IN-PROCESS via long-polling API Telegram (fetch native,
 *   TANPA dependency eksternal — tidak perlu node-telegram-bot-api/axios).
 * - Perintah bot:
 *     /start | /help   -> menu bantuan (inline keyboard)
 *     /create <email>  -> kirim tautan verifikasi AM (send-link)
 *     /verify <email> <link> -> verifikasi & aktifkan premium (alias /verif)
 *     /bulk <jumlah> [domain] -> auto generator massal (KHUSUS Owner ID)
 *     /id              -> cek ID chat (membantu mencari Owner ID)
 *
 * Registry disimpan di globalThis agar reload HMR (hot-reload) tidak
 * men-duplikat polling bot yang sedang berjalan.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, PORT, newId, nowISO, generateOrderId, randomKey, getUsers, readJSON } from './store.js';

const gpaSeg = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

const TELEGRAM_BOTS_FILE = path.join(DATA_DIR, 'telegram_bots.json');
const TELEGRAM_API = 'https://api.telegram.org';
const MAX_BOTS = 500;
const BULK_MAX = 5;

// Naikkan saat ada perubahan kode polling/handler agar HMR me-restart runner lama.
const CODE_VERSION = 'v3-redesign-merged';

// Signature file telegram.js (mtime+size) — berubah otomatis saat file diedit,
// sehingga HMR me-restart runner bot dengan kode terbaru tanpa bump manual.
function fileSig() {
    try {
        const st = fs.statSync(new URL(import.meta.url));
        return st.mtimeMs + ':' + st.size;
    } catch (e) {
        return CODE_VERSION;
    }
}

// Registry global lintas reload (HMR). Menyimpan runner polling aktif.
const registry = globalThis.__amTelegramBots || (globalThis.__amTelegramBots = { inited: false, runners: new Map(), codeVersion: '' });

/* ============================== PERSISTENSI ============================== */
function loadBots() {
    try {
        if (!fs.existsSync(TELEGRAM_BOTS_FILE)) {
            fs.writeFileSync(TELEGRAM_BOTS_FILE, JSON.stringify([]));
        }
        const list = JSON.parse(fs.readFileSync(TELEGRAM_BOTS_FILE, 'utf8'));
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function saveBots(list) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TELEGRAM_BOTS_FILE, JSON.stringify(list, null, 2));
}

function updateBotStatus(id, status, error) {
    const bots = loadBots();
    const b = bots.find((x) => x.id === id);
    if (!b) return;
    b.status = status;
    if (error !== undefined) b.error = error || null;
    if (status === 'online') b.startedAt = nowISO();
    saveBots(bots);
}

/* ============================== TELEGRAM API ============================== */

async function tgRequest(token, method, params, abortSignal) {
    const resp = await fetch(TELEGRAM_API + '/bot' + token + '/' + method, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {}),
        signal: abortSignal || AbortSignal.timeout(45000),
    });
    return resp.json().catch(() => ({}));
}

/**
 * Validasi token via getMe. Melempar Error bila token tidak valid.
 */
async function validateToken(token) {
    const data = await tgRequest(token, 'getMe', {});
    if (!data.ok) {
        const desc = String(data.description || 'token tidak valid').slice(0, 120);
        throw new Error('Token tidak valid: ' + desc);
    }
    return data.result; // { id, username, first_name }
}

/* ============================== BOT RUNNER ============================== */

function escHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function callLocalAPI(bot, endpoint, payload) {
    const resp = await fetch('http://127.0.0.1:' + PORT + '/api/v1/bot-premium/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': bot.apiKey || '' },
        body: JSON.stringify(payload || {}),
        signal: AbortSignal.timeout(120000),
    });
    return resp.json().catch(() => ({}));
}

function apiResultText(res) {
    if (!res) return 'Tidak ada respon dari server.';
    if (res.success) return res.message || 'Berhasil.';
    return res.message || 'Gagal.';
}

/* -------- DUKUNGAN INLINE KEYBOARD & EDIT MESSAGE TERSTRUKTUR -------- */

async function sendText(token, chatId, text, parseMode, replyMarkup) {
    try {
        const params = {
            chat_id: chatId,
            text: text,
            parse_mode: parseMode || 'HTML',
            disable_web_page_preview: true,
        };
        if (replyMarkup) params.reply_markup = replyMarkup;
        const data = await tgRequest(token, 'sendMessage', params);
        if (!data || data.ok === false) {
            console.error('[TELEGRAM] Gagal kirim pesan: ' + String(data && data.description || 'unknown'));
            return false;
        }
        return true;
    } catch (e) {
        console.error('[TELEGRAM] Gagal kirim pesan: ' + e.message);
        return false;
    }
}

async function answerCallbackQuery(token, callbackQueryId, text) {
    try {
        await tgRequest(token, 'answerCallbackQuery', {
            callback_query_id: callbackQueryId,
            text: text || ''
        });
    } catch (e) {}
}

async function editMessageText(token, chatId, messageId, text, replyMarkup) {
    try {
        const params = {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        };
        if (replyMarkup) params.reply_markup = replyMarkup;
        const data = await tgRequest(token, 'editMessageText', params);
        if (!data || data.ok === false) {
            // 'message is not modified' = user menekan tombol yang sama lagi;
            // bukan error — jangan kirim pesan duplikat.
            const desc = String(data && data.description || '');
            if (data && data.error_code === 400 && desc.indexOf('not modified') !== -1) {
                return true;
            }
            return sendText(token, chatId, text, 'HTML', replyMarkup);
        }
        return true;
    } catch (e) {
        return sendText(token, chatId, text, 'HTML', replyMarkup);
    }
}

/* -------- TEMPLATE TAMPILAN KATEGORI & STATISTIK -------- */
function checkRateLimit(chatId) {
    const now = Date.now();
    registry.usage = registry.usage || { minute: new Map(), day: new Map() };
    const m = registry.usage.minute.get(chatId) || { t: now, n: 0 };
    const d = registry.usage.day.get(chatId) || { t: now, n: 0 };
    if (now - m.t >= 60000) { m.t = now; m.n = 0; }
    if (now - d.t >= 86400000) { d.t = now; d.n = 0; }
    if (m.n >= 20 || d.n >= 300) return false;
    m.n += 1;
    d.n += 1;
    registry.usage.minute.set(chatId, m);
    registry.usage.day.set(chatId, d);
    return true;
}

/* -------- FORMAT PESAN STATUS DAN HANDLER TERSTRUKTUR -------- */
async function runPollLoop(bot, runner) {
    while (!runner.stopped) {
        try {
            runner.ac = new AbortController(); // siklus poll baru = controller baru
            const data = await tgRequest(bot.token, 'getUpdates', {
                timeout: 30,
                limit: 100,
                offset: runner.offset,
                allowed_updates: ['message', 'callback_query'],
            }, runner.ac.signal);
            if (runner.stopped) break;
            if (!data.ok) {
                if (data.error_code === 409) {
                    console.error('[TELEGRAM] Bot ' + bot.name + ' konflik (409): token dipakai instance lain.');
                    updateBotStatus(bot.id, 'error', 'Token sedang dipakai instance/bot lain (409). Stop bot lain dengan token ini.');
                    runner.stop();
                    break;
                }
                if (data.error_code === 401) {
                    console.error('[TELEGRAM] Bot ' + bot.name + ' token tidak valid (401).');
                    updateBotStatus(bot.id, 'error', 'Token tidak valid (401). Deploy ulang dengan token baru dari @BotFather.');
                    runner.stop();
                    break;
                }
                throw new Error(String(data.description || 'unknown error'));
            }
            runner.failCount = 0;
            const updates = data.result || [];
            for (const u of updates) {
                runner.offset = Math.max(runner.offset, u.update_id + 1);
                if (u.message) {
                    try {
                        await handleUpdate(bot, u.message);
                    } catch (e) {
                        console.error('[TELEGRAM] Bot ' + bot.name + ' handler error: ' + e.message);
                    }
                } else if (u.callback_query) {
                    try {
                        await handleCallbackQuery(bot, u.callback_query);
                    } catch (e) {
                        console.error('[TELEGRAM] Bot ' + bot.name + ' callback error: ' + e.message);
                    }
                }
            }
        } catch (e) {
            // Abort dari stop() = shutdown normal saat HMR restart — jangan log error.
            if (runner.stopped || /abort/i.test(e.name === 'AbortError' ? 'AbortError' : String(e.message))) {
                if (runner.stopped) break;
            }
            runner.failCount++;
            console.error('[TELEGRAM] Bot ' + bot.name + ' polling error: ' + e.message);
            if (runner.stopped) break;
            await new Promise((r) => setTimeout(r, Math.min(30000, 2500 * runner.failCount)));
        }
    }
    // Hanya hapus runner ini dari registry bila masih menunjuk ke dirinya sendiri
    // (hindari menghapus runner baru yang terdaftar saat bot di-start ulang).
    if (registry.runners.get(bot.id) === runner) registry.runners.delete(bot.id);
}

function startBotRunner(bot) {
    const existing = registry.runners.get(bot.id);
    if (existing && !existing.stopped) return existing;
    if (existing) registry.runners.delete(bot.id);
    const runner = { botId: bot.id, stopped: false, offset: 0, failCount: 0, loop: null, ac: new AbortController() };
    // stop() langsung abort getUpdates yang sedang long-poll (tanpa nunggu
    // timeout 30-45s), supaya runner baru dari HMR tidak kena konflik 409.
    runner.stop = function () { this.stopped = true; try { this.ac.abort(); } catch (e) {} };
    registry.runners.set(bot.id, runner);
    runner.loop = runPollLoop(bot, runner);
    return runner;
}

/* ============================== MANAJEMEN BOT ============================== */

/**
 * Deploy bot baru (atau ganti token lama yang sama).
 * input: { name, token, ownerId, apiKey, deployedBy, role }
 * - deployedBy: username website yang men-deploy (pemilik bot).
 * - role: 'owner' (unlimited) atau 'vip' (maksimal 3 bot).
 *   Role lain tidak diizinkan men-deploy bot.
 */
async function deployBot(input) {
    let name = String(input.name || '').trim().slice(0, 40);
    const token = String(input.token || '').trim();
    const ownerId = String(input.ownerId || '').trim();
    const apiKey = String(input.apiKey || '').trim();
    const deployedBy = String(input.deployedBy || '').trim();
    const role = String(input.role || '').trim();
    const isOwner = role === 'owner';

    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('Format Bot Token tidak valid. Ambil token dari @BotFather.');
    if (!/^-?\d+$/.test(ownerId)) throw new Error('Owner ID harus berupa angka (dapatkan dari @userinfobot atau perintah /id di bot).');
    if (!apiKey) throw new Error('API Key akun Anda kosong. Generate API Key di menu Profil terlebih dahulu.');
    if (!deployedBy) throw new Error('Username deploy tidak valid.');

    // Hanya role VIP (maks 3 bot), Pro (maks 1 bot), dan Owner (unlimited) yang boleh deploy.
    // Bot dengan token yang sama (flow update/replace) tidak dihitung sebagai bot tambahan.
    if (role !== 'owner' && role !== 'vip' && role !== 'pro') {
        throw new Error('Hanya akun VIP, Pro, dan Owner yang dapat men-deploy bot Telegram.');
    }
    if (role === 'vip') {
        const own = loadBots().filter((b) => b.deployedBy === deployedBy);
        const dupOwn = own.find((b) => b.token === token);
        if (own.length - (dupOwn ? 1 : 0) >= 3) throw new Error('Role VIP hanya dapat men-deploy maksimal 3 bot. Hapus bot lama Anda terlebih dahulu.');
    } else if (role === 'pro') {
        const own = loadBots().filter((b) => b.deployedBy === deployedBy);
        const dupOwn = own.find((b) => b.token === token);
        if (own.length - (dupOwn ? 1 : 0) >= 1) throw new Error('Role Pro hanya dapat men-deploy maksimal 1 bot. Hapus bot lama Anda terlebih dahulu.');
    }

    const me = await validateToken(token);
    if (!name) name = String(me.username || me.first_name || 'Telegram Bot').slice(0, 40);

    let bots = loadBots();
    if (bots.length >= MAX_BOTS) throw new Error('Maksimal ' + MAX_BOTS + ' bot terdeploy.');

    // Token sama dengan bot lain -> stop & hapus dulu agar tidak konflik 409.
    const dup = bots.find((b) => b.token === token);
    if (dup) {
        const runner = registry.runners.get(dup.id);
        if (runner) runner.stop();
        bots = bots.filter((b) => b.id !== dup.id);
    }

    const id = newId();
    const bot = {
        id: id,
        name: name,
        token: token,
        ownerId: ownerId,
        apiKey: apiKey,
        deployedBy: deployedBy,
        me: { id: me.id, username: me.username, first_name: me.first_name },
        status: 'online',
        error: null,
        createdAt: nowISO(),
        startedAt: nowISO(),
    };
    bots.push(bot);
    saveBots(bots);
    startBotRunner(bot);
    console.log('[TELEGRAM] Bot "' + name + '" deployed (@' + (me.username || me.id) + ').');
    return bot;
}

function stopBot(id) {
    const runner = registry.runners.get(id);
    if (runner) runner.stop();
    const bots = loadBots();
    const b = bots.find((x) => x.id === id);
    if (b) {
        b.status = 'offline';
        b.error = null;
        saveBots(bots);
    }
}

async function startBot(id) {
    const bots = loadBots();
    const b = bots.find((x) => x.id === id);
    if (!b) throw new Error('Bot tidak ditemukan.');
    await validateToken(b.token);
    const runner = registry.runners.get(id);
    if (runner) {
        runner.stop();
        registry.runners.delete(id);
    }
    b.status = 'online';
    b.error = null;
    b.startedAt = nowISO();
    saveBots(bots);
    startBotRunner(b);
    return b;
}

async function restartBot(id) {
    stopBot(id);
    await new Promise((r) => setTimeout(r, 600));
    return startBot(id);
}

function removeBot(id) {
    const runner = registry.runners.get(id);
    if (runner) runner.stop();
    const bots = loadBots().filter((b) => b.id !== id);
    saveBots(bots);
}

function maskToken(token) {
    if (!token || token.length < 12) return '****';
    return token.slice(0, 8) + '****' + token.slice(-4);
}

/**
 * Validasi kepemilikan bot: apakah bot dengan id ini milik pemilik apiKey tsb.
 * Dipakai endpoint bulk agar user tidak bisa spam chat bot milik orang lain.
 */
function isBotOwnedBy(botId, apiKey) {
    if (!botId || !apiKey) return false;
    const bot = loadBots().find(function (b) { return b.id === botId; });
    return !!(bot && bot.apiKey === apiKey);
}

/**
 * Ganti API Key semua bot milik username tertentu + restart runner-nya.
 * Dipanggil saat user me-reset / generate ulang API Key — bot harus otomatis
 * memakai key baru (bot.apiKey dipakai callLocalAPI -> header x-api-key),
 * jika tidak bot akan ditolak 403 karena key lama sudah dicabut.
 *
 * @param {string} oldKey  API Key lama (sebelum di-reset).
 * @param {string} newKey  API Key baru hasil generate.
 * @param {string} username Username website pemilik bot (deployedBy).
 * @returns {number} Jumlah bot yang diperbarui & di-restart.
 */
function rekeyBotsForUser(oldKey, newKey, username) {
    if (!oldKey || !newKey || oldKey === newKey) return 0;
    const bots = loadBots();
    let updated = 0;
    bots.forEach((b) => {
        if (b.apiKey === oldKey && b.deployedBy === username) {
            b.apiKey = newKey;
            // Restart runner agar loop polling memakai objek bot dengan key baru.
            const runner = registry.runners.get(b.id);
            if (runner) {
                runner.stop();
                registry.runners.delete(b.id);
            }
            if (b.status === 'online') {
                startBotRunner(b);
            }
            updated++;
        }
    });
    if (updated > 0) {
        saveBots(bots);
        console.log('[TELEGRAM] API Key otomatis diganti untuk ' + updated + ' bot milik @' + username + ' + runner di-restart.');
    }
    return updated;
}

/* -------- Kirim hasil batch (bulk) ke chat yang meminta -------- */

/**
 * Kirim laporan hasil batch ke chat Telegram yang memulai /bulk.
 * payload: { status, domain, count, error?, results: [{ email, status, codeorder, error }] }
 * Dipanggil dari am.js saat batch selesai/gagal/abort.
 */
async function notifyBulkResult(botId, chatId, payload) {
    if (!botId || !chatId) return false;
    const bot = loadBots().find(function (b) { return b.id === botId; });
    if (!bot) return false;
    let sentOk = true;

    const results = payload.results || [];
    const ok = results.filter(function (r) { return r.status === 'success'; }).length;

    let head = '';
    if (payload.status === 'failed') {
        head = '❌ <b>BATCH GENERATOR GAGAL</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    } else if (payload.status === 'aborted') {
        head = '⚠️ <b>BATCH GENERATOR DI-ABORT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    } else {
        head = '🎉 <b>BATCH GENERATOR SELESAI</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    }
    head += '📦 <b>Hasil:</b> <code>' + ok + '/' + results.length + '</code> akun sukses\n';
    head += '🌐 <b>Domain:</b> <code>' + escHtml(payload.domain || '-') + '</code>';
    if (payload.error) head += '\n💬 <b>Detail Error:</b> <code>' + escHtml(String(payload.error).slice(0, 200)) + '</code>';
    head += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━';

    const lines = results.map(function (r, i) {
        const email = r.email || '-';
        const line = (i + 1) + '. <code>' + escHtml(email) + '</code>';
        const inbox = '   └ 🔗 https://generator.email/' + escHtml(email);
        if (r.status === 'success') {
            return line + ' — ✅ <b>PREMIUM</b> (Code: <code>' + escHtml(String(r.codeorder || '-')) + '</code>)\n' + inbox;
        }
        return line + ' — ❌ <code>' + escHtml(String(r.error || 'gagal').slice(0, 80)) + '</code>\n' + inbox;
    });

    // Batasi pesan per kiriman (Telegram max ~4096 karakter).
    const CHUNK = 20;
    const messages = [];
    let current = head;
    for (let i = 0; i < lines.length; i++) {
        if (i > 0 && i % CHUNK === 0) {
            messages.push(current);
            current = '📦 <b>Lanjutan Hasil Batch...</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━';
        }
        current += '\n' + lines[i];
    }
    messages.push(current);

    for (const text of messages) {
        const ok = await sendText(bot.token, chatId, text);
        if (!ok) sentOk = false;
    }
    return sentOk;
}

function listBots(username, isOwner) {
    // Owner melihat semua bot; admin hanya melihat bot milik usernamenya sendiri.
    const bots = loadBots().filter((b) => {
        if (isOwner) return true;
        return b.deployedBy === username;
    });
    return bots.map((b) => ({
        id: b.id,
        name: b.name,
        tokenMasked: maskToken(b.token),
        ownerId: b.ownerId,
        deployedBy: b.deployedBy || '',
        me: b.me || null,
        status: b.status,
        error: b.error || null,
        createdAt: b.createdAt,
        startedAt: b.startedAt || null,
    }));
}

/**
 * Cek apakah user boleh mengelola bot (start/stop/restart/delete).
 * Owner bisa semua; admin hanya bot milik usernamenya sendiri.
 */
function canManageBot(botId, username, isOwner) {
    if (!botId) return false;
    const bot = loadBots().find((b) => b.id === botId);
    if (!bot) return false;
    if (isOwner) return true;
    return bot.deployedBy === username;
}

/**
 * Inisialisasi saat server start: jalankan semua bot berstatus online.
 * Idempotent — aman dipanggil ulang saat HMR reload.
 */
function initTelegramBots() {
    // Versi kode berubah (HMR reload dengan kode baru) -> restart semua runner
    // agar polling & handler pakai versi terbaru (mis. dukungan callback_query).
    // Deteksi berbasis signature file: SETIAP perubahan telegram.js otomatis
    // me-restart runner bot — tanpa perlu bump CODE_VERSION manual.
    const sig = fileSig();
    if (registry.codeVersion && registry.codeVersion !== sig) {
        console.log('[TELEGRAM] Deteksi kode berubah (' + registry.codeVersion + ' -> ' + sig + '), me-restart runner...');
        registry.runners.forEach((runner) => { runner.stop(); });
        registry.runners.clear();
        registry.inited = false;
    }
    registry.codeVersion = sig;
    if (registry.inited) return;
    registry.inited = true;
    const bots = loadBots();
    bots.forEach((b) => {
        if (b.status === 'online' && !registry.runners.has(b.id)) {
            startBotRunner(b);
        }
    });
    console.log('[TELEGRAM] Bot manager siap (' + bots.length + ' bot terdaftar, ' + bots.filter((b) => b.status === 'online').length + ' online).');
}

export {
    deployBot,
    stopBot,
    startBot,
    restartBot,
    removeBot,
    listBots,
    canManageBot,
    validateToken,
    initTelegramBots,
    notifyBulkResult,
    isBotOwnedBy,
    rekeyBotsForUser,
};

// State pengguna yang sedang menunggu input (email/link/voucher)
globalThis.__amUserStates = globalThis.__amUserStates || {};

// Registry pengguna Telegram (userId -> data)
globalThis.__amTelegramUsers = globalThis.__amTelegramUsers || {};

// Registry voucher
globalThis.__amVouchers = globalThis.__amVouchers || {};

function getMainKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '🚀 Mulai Generate Akun', callback_data: 'menu_generator' },
            ],
            [
                { text: '🎁 Redeem Voucher', callback_data: 'menu_voucher' },
                { text: '🛒 Sewa Bot', callback_data: 'menu_sewa_bot' },
            ],
            [
                { text: '🎬 Netflix Generator', callback_data: 'menu_netflixgen' },
            ],
            [
                { text: '⚙️ Fitur Owner', callback_data: 'menu_owner' },
            ]
        ]
    };

}

function getGeneratorKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '⚡ Auto Generator (Otomatis)', callback_data: 'gen_auto' },
            ],
            [
                { text: '📧 Manual Generate', callback_data: 'gen_manual' },
            ],
            [
                { text: '‹‹ Kembali', callback_data: 'back_to_main' },
            ]
        ]
    };
}

function getBackKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '‹‹ Kembali ke Menu Utama', callback_data: 'back_to_main' },
            ]
        ]
    };
}

function getGlobalStats() {
    const users = getUsers();
    const activations = readJSON('activations', []);
    const totalUsers = Object.keys(users).length;
    const totalSuccess = activations.filter(function (a) { return a.status === 'success'; }).length;
    return { totalUsers: totalUsers, totalSuccess: totalSuccess };
}

function getMenuMainText(bot, msg) {
    const from = msg?.from || {};
    const name = from.first_name || 'User';
    const uid = from.id || '-';
    const isOwner = String(uid) === String(bot.ownerId);
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const dateTimeStr = `${dateStr} pukul ${timeStr} WIB`;
    
    // Get user data
    const userId = String(uid);
    let userData = globalThis.__amTelegramUsers[userId] || {};
    const totalAccounts = userData.totalAccounts || 0;
    const username = from.username || 'Tanpa Username';
    
    // Determine user status
    let statusLicense = 'No License';
    if (userData.quota > 0) {
        statusLicense = 'Aktif';
    }
    
    // Build user info section
    let userInfoSection = '';
    if (String(uid) === String(bot.ownerId)) {
        userInfoSection = `
User Info
  └ ID: ${uid}
  └ Username: @${username}
  └ Total Akun Dibuat: ${totalAccounts}
  └ Status: ${statusLicense}`;
    } else {
        userInfoSection = `
User Info
  └ ID: ${uid}
  └ Username: @${username}
  └ Total Akun Dibuat: ${totalAccounts}
  └ Status: ${statusLicense}`;
    }
    
    // Build bot stats (sinkron dengan web: getUsers + activations)
    const gStats = getGlobalStats();
    const totalUsers = gStats.totalUsers;
    const totalAccountsAll = gStats.totalSuccess;

    const botStatsSection = `
BOT Stats
  └ Total Akun Terbuat: ${totalAccountsAll}
  └ Total Pengguna: ${totalUsers}`;

    return `𐌰𐌻𐍅𐌰𐍅𐍃  𐌲𐍉𐌳𐌴𐍇  👋
${dateTimeStr}

${userInfoSection}

${botStatsSection}`;
}

/* ============================== HANDLER /START ============================== */

async function handleStart(bot, chatId, fromId, text, isCallback = false, msg = null) {
    // Initialize user if not exists
    const userId = String(fromId);
    const from = msg?.from || {};
    if (!globalThis.__amTelegramUsers[userId]) {
        globalThis.__amTelegramUsers[userId] = {
            id: userId,
            username: from.username || '',
            first_name: from.first_name || '',
            quota: 1, // Free trial quota
            totalAccounts: 0,
            referredBy: null,
            referrals: []
        };
    } else {
        if (from.username) globalThis.__amTelegramUsers[userId].username = from.username;
        if (from.first_name) globalThis.__amTelegramUsers[userId].first_name = from.first_name;
    }
    
    // Handle referral parameter
    if (text.startsWith('/start ') || (isCallback && text === 'menu_start')) {
        const parts = text.trim().split(/\s+/);
        if (parts.length > 1 && parts[1].startsWith('ref_')) {
            const refCode = parts[1].substring(4);
            // Process referral
            if (globalThis.__amTelegramUsers[refCode] && refCode !== userId) {
                // Give referrer bonus
                globalThis.__amTelegramUsers[refCode].quota = (globalThis.__amTelegramUsers[refCode].quota || 0) + 10;
                // Set referral
                globalThis.__amTelegramUsers[userId].referredBy = refCode;
                // Add to referrer's list
                if (!globalThis.__amTelegramUsers[refCode].referrals) {
                    globalThis.__amTelegramUsers[refCode].referrals = [];
                }
                if (!globalThis.__amTelegramUsers[refCode].referrals.includes(userId)) {
                    globalThis.__amTelegramUsers[refCode].referrals.push(userId);
                }
            }
        }
    }
    
    const state = globalThis.__amUserStates?.[chatId];
    if (state) {
        // If there's an ongoing process, continue with it
        if (state.step === 'waiting_email') {
            await handleWaitingEmail(bot, chatId, state, text);
        } else if (state.step === 'waiting_link') {
            await handleWaitingLink(bot, chatId, state, text);
        } else if (state.step === 'waiting_voucher') {
            await handleWaitingVoucher(bot, chatId, state, text);
        } else if (state.step === 'waiting_autocount') {
            await handleWaitingAutoCount(bot, chatId, state, text);
        } else if (state.step === 'autogen_running') {
            // Bulk tetap berjalan di background — menu utama TETAP tampil.
            if (!autoGenPollers[chatId]) {
                // Safety net: poller sudah tidak ada -> state basi, bersihkan.
                delete globalThis.__amUserStates[chatId];
                sendText(bot.token, chatId, getMenuMainText(bot, { from: { id: fromId, first_name: from.first_name || '', username: from.username || '' } }), 'HTML', getMainKeyboard());
            } else {
                const note = '\n\n⚙️ <i>Bulk sedang berjalan di background — progress ada di pesan terpisah. Menu lain tetap bisa dipakai.</i>';
                sendText(bot.token, chatId, getMenuMainText(bot, { from: { id: fromId, first_name: from.first_name || '', username: from.username || '' } }) + note, 'HTML', getMainKeyboard());
            }
        }
    } else {
        // No ongoing process, show main menu
        sendText(bot.token, chatId, getMenuMainText(bot, { from: { id: fromId, first_name: from.first_name || '', username: from.username || '' } }), 'HTML', getMainKeyboard());
    }
}

/* ============================== HANDLER STATES ============================== */

/* ---------- Auto Generator (Otomatis) ---------- */

const autoGenPollers = globalThis.__amAutoGenPollers || (globalThis.__amAutoGenPollers = {});

function readBatchJSON() {
    try {
        const f = path.join(DATA_DIR, 'batch.json');
        if (!fs.existsSync(f)) return null;
        return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {
        return null;
    }
}

function fmtDur(ms) {
    ms = Math.max(0, ms | 0);
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return m + ':' + String(ss).padStart(2, '0');
}

function buildAutoProgress(batch) {
    const total = batch.count || 0;
    const done = batch.done || 0;
    const results = batch.results || [];
    const ok = results.filter(function (r) { return r.status === 'success'; }).length;
    const fail = done - ok;
    const currentIdx = Math.min(done + 1, total) || 1;
    const emails = batch.emails || [];
    const email = emails[Math.min(done, emails.length - 1)] || '-';
    const startedAt = batch.startedAt || Date.now();
    const elapsed = Date.now() - startedAt;
    let estRemain;
    if (done > 0 && total > 0) estRemain = (elapsed / done) * (total - done);
    else estRemain = (total > 0 ? total * 16000 : 0);
    // Ambil status dari log terakhir (abaikan baris [SYSTEM]).
    const logs = batch.logs || [];
    let status = 'Memproses...';
    for (let i = logs.length - 1; i >= 0; i--) {
        const l = logs[i] || '';
        if (l.indexOf('[SYSTEM]') === -1) {
            status = l.replace(/^\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\]\s*/, '').trim() || status;
            break;
        }
    }
    const barMax = 12;
    const barLen = Math.max(1, Math.min(total, barMax));
    const filled = total > 0 ? Math.round((done / total) * barLen) : 0;
    const bar = '▪️'.repeat(filled) + '◽'.repeat(Math.max(0, barLen - filled));
    return '⏳ Proses Pembuatan Otomatis [' + currentIdx + '/' + total + '] [ ' + bar + ' ]\n' +
        '📧 Email: ' + escHtml(email) + '\n' +
        '🤖 Status: ' + escHtml(status) + '\n' +
        '⏱️ Berjalan: ' + fmtDur(elapsed) + ' | ⏳ Estimasi Selesai: ~' + fmtDur(estRemain) + '\n' +
        '✅ Sukses: ' + ok + ' | ❌ Gagal: ' + fail;
}

function startAutoGenPoller(bot, chatId, state) {
    stopAutoGenPoller(chatId);
    const timer = setInterval(async function () {
        try {
            const batch = readBatchJSON();
            if (!batch || batch.id !== state.batchId) {
                // Data batch hilang/id beda — tunggu maks ~30 detik; bila
                // tetap hilang anggap sesi berakhir & bersihkan state anti-stuck.
                state.missing = (state.missing || 0) + 1;
                if (state.missing >= 10) {
                    stopAutoGenPoller(chatId);
                    delete globalThis.__amUserStates[chatId];
                    try { await editMessageText(bot.token, chatId, state.progressMsgId, '⚠️ Sesi bulk berakhir (data batch tidak ditemukan).'); } catch (e) {}
                }
                return;
            }
            state.missing = 0;
            const text = buildAutoProgress(batch);
            await editMessageText(bot.token, chatId, state.progressMsgId, text);
            if (batch.status === 'completed' || batch.status === 'failed' || batch.status === 'aborted') {
                stopAutoGenPoller(chatId);
                await finalizeAutoGen(bot, chatId, state, batch);
            } else if (batch.status === 'stalled') {
                await editMessageText(bot.token, chatId, state.progressMsgId, text + '\n\n⚠️ Worker tidak aktif (stalled). Proses mungkin terhenti — coba /start untuk memulai ulang.');
            }
        } catch (e) {
            console.error('[TELEGRAM] autoGen poller: ' + e.message);
        }
    }, 3000);
    autoGenPollers[chatId] = timer;
}

function stopAutoGenPoller(chatId) {
    if (autoGenPollers[chatId]) {
        clearInterval(autoGenPollers[chatId]);
        delete autoGenPollers[chatId];
    }
}

/* Rekap file teks — format SAMA dengan unduhan bulk di web (public/js/home.js). */
function buildRecapFile(results) {
    const lines = ['AM PREMIUM ACCOUNTS BATCH GENERATED - ' + new Date().toLocaleString()];
    results.forEach(function (r, i) {
        const isOk = r.status === 'success';
        const inbox = r.inboxUrl || ('https://generator.email/' + r.email);
        const line = (i + 1) + '. Email: ' + r.email +
            (r.password ? ' | Password: ' + r.password : '') +
            (isOk ? ' | PREMIUM AKTIF' : ' | GAGAL: ' + (r.error || 'unknown')) +
            (r.codeorder ? ' | Alwayscodex: ' + r.codeorder : '') +
            ' | Inbox: ' + inbox +
            ' | Login Link: ' + (r.verifyLink || '-');
        lines.push(line);
    });
    lines.push('Total Berhasil: ' + results.length + ' Akun');
    return lines.join('\n');
}

/* Kirim dokumen teks (.txt) ke chat via multipart/form-data (Node 22 punya
   global FormData + Blob). */
async function sendDocumentText(token, chatId, content, filename, caption, replyMarkup) {
    try {
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('caption', caption || '');
        form.append('parse_mode', 'HTML');
        if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
        form.append('document', new Blob([content], { type: 'text/plain' }), filename);
        const resp = await fetch(TELEGRAM_API + '/bot' + token + '/sendDocument', {
            method: 'POST',
            body: form,
        });
        const data = await resp.json().catch(function () { return {}; });
        if (!data || data.ok === false) {
            console.error('[TELEGRAM] sendDocument gagal: ' + String((data && data.description) || 'unknown'));
            return false;
        }
        return true;
    } catch (e) {
        console.error('[TELEGRAM] sendDocument error: ' + e.message);
        return false;
    }
}

async function finalizeAutoGen(bot, chatId, state, batch) {
    const results = batch.results || [];
    const ok = results.filter(function (r) { return r.status === 'success'; }).length;
    const fail = results.length - ok;
    const userId = String(chatId);
    if (!globalThis.__amTelegramUsers[userId]) globalThis.__amTelegramUsers[userId] = { id: userId, username: '', firstName: '', quota: 1, totalAccounts: 0, referredBy: null, referrals: [] };
    const u = globalThis.__amTelegramUsers[userId];
    u.quota = Math.max(0, (u.quota || 0) - ok);
    u.totalAccounts = (u.totalAccounts || 0) + ok;
    // Simpan segera agar kuota persisten & konsisten dengan file.
    saveTelegramData();

    const startedAt = batch.startedAt || Date.now();
    const totalTime = fmtDur(Date.now() - startedAt);

    let head;
    if (batch.status === 'completed') head = '🎉 PROSES PEMBUATAN SELESAI!';
    else if (batch.status === 'aborted') head = '⚠️ PROSES PEMBUATAN DI-ABORT';
    else head = '❌ PROSES PEMBUATAN GAGAL';

    const text = head + '\n\n' +
        '⏱️ Total Waktu: ' + totalTime + '\n' +
        '✅ Total Sukses: ' + ok + ' akun\n' +
        '❌ Total Gagal: ' + fail + ' akun\n\n' +
        '🔑 Sisa Kuota Anda: ' + u.quota;

    await editMessageText(bot.token, chatId, state.progressMsgId, text, getBackKeyboard());

    // Kirim file rekapan (format sama dengan unduhan bulk di web).
    if (results.length) {
        const caption = '📄 File Rekapan Akun Premium (' + ok + ' Akun)\nBerikut adalah file rekapan daftar akun yang berhasil dibuat otomatis pada sesi ini.';
        const filename = 'am-premium-batch-' + randomKey(6) + '.txt';
        const content = buildRecapFile(results);
        await sendDocumentText(bot.token, chatId, content, filename, caption);
    }

    stopAutoGenPoller(chatId);
    delete globalThis.__amUserStates[chatId];
}

/**
 * Mengambil sisa kuota user Telegram. Nilai diambil dari cache in-memory
 * DAN dari file telegram_users.json, lalu diambil yang TERKECIL.
 * Tujuannya defensif:
 *  - mencegah bypass bila file diedit manual jadi 0 (cache masih >0),
 *  - mencegah double-spend bila cache sudah dikurangi tapi file belum tersimpan.
 */
function getUserQuota(userId) {
    const cache = (globalThis.__amTelegramUsers[userId] && globalThis.__amTelegramUsers[userId].quota) || 0;
    let fileQ = 0;
    try {
        const usersFile = path.join(DATA_DIR, 'telegram_users.json');
        if (fs.existsSync(usersFile)) {
            const data = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
            fileQ = (data[userId] && data[userId].quota) || 0;
        }
    } catch (e) { /* abaikan, fallback ke cache */ }
    return Math.min(cache, fileQ);
}

// Pesan saat kuota 0. Owner boleh pakai voucher /addlicense; user biasa
// disuruh hubungi owner untuk minta lisensi.
function quotaZeroMessage(isOwner, bot) {
    if (isOwner) {
        return '❌ Sisa kuota Anda 0. Gunakan voucher atau perintah /addlicense untuk menambah kuota.';
    }
    let ownerName = '';
    try {
        const ow = globalThis.__amTelegramUsers[String(bot.ownerId)];
        if (ow && ow.username) ownerName = ' @' + ow.username;
        else ownerName = ' (ID: ' + String(bot.ownerId) + ')';
    } catch (e) { /* abaikan */ }
    return '❌ Sisa kuota Anda 0. Silakan hubungi owner' + ownerName + ' untuk meminta penambahan kuota/lisensi.';
}

async function handleWaitingAutoCount(bot, chatId, state, text) {
    if (text.toLowerCase() === '/cancel') {
        await editMessageText(bot.token, chatId, state.messageId, '❌ Proses dibatalkan.\nKirim /start untuk kembali ke menu utama.');
        delete globalThis.__amUserStates[chatId];
        return;
    }
    const userId = String(chatId);
    const isOwner = String(chatId) === String(bot.ownerId);
    const u = globalThis.__amTelegramUsers[userId] || {};
    const quota = isOwner ? 100 : getUserQuota(userId);
    let count = parseInt(text.trim(), 10);
    if (!count || count < 1) {
        await editMessageText(bot.token, chatId, state.messageId, '⚠️ Jumlah tidak valid. Kirim angka (contoh: 5).');
        return;
    }
    const maxAllowed = isOwner ? 100 : Math.min(100, quota);
    if (count > 100) {
        await editMessageText(bot.token, chatId, state.messageId, '⚠️ Maksimal 100 akun per permintaan. Kirim angka ≤ 100.');
        return;
    }
    if (!isOwner && quota <= 0) {
        delete globalThis.__amUserStates[chatId];
        await editMessageText(bot.token, chatId, state.messageId, quotaZeroMessage(isOwner, bot) + '\n\nKirim /start untuk kembali ke menu.', getBackKeyboard());
        return;
    }
    let capped = false;
    if (count > maxAllowed) {
        count = maxAllowed;
        capped = true;
    }

    // Mulai batch via API lokal (tanpa notify — kita yang edit pesan).
    let res;
    try {
        res = await callLocalAPI(bot, 'bulk', { count: count, domain: 'random' });
    } catch (e) {
        await editMessageText(bot.token, chatId, state.messageId, '❌ Gagal memanggil generator: ' + escHtml(e.message));
        delete globalThis.__amUserStates[chatId];
        return;
    }
    if (!res || !res.success) {
        const msg = (res && res.message) || 'Unknown';
        const busy = /batch yang berjalan/i.test(msg);
        await editMessageText(bot.token, chatId, state.messageId, '❌ Tidak bisa memulai: ' + escHtml(msg) + (busy ? '\nMasih ada batch berjalan — coba lagi nanti.' : ''));
        delete globalThis.__amUserStates[chatId];
        return;
    }

    // Kirim pesan "Memulai..." sebagai pesan BARU, lalu edit pesan itu menjadi
    // progress secara live (tidak mengirim pesan progress terpisah).
    const startMsg = await tgRequest(bot.token, 'sendMessage', {
        chat_id: chatId,
        text: '🚀 Memulai pembuatan ' + count + ' akun premium secara otomatis...\n\n> Mohon tunggu, proses sedang berjalan.' + (capped ? '\n\n(i) Jumlah disesuaikan dengan sisa kuota/kapasitas.' : ''),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
    });
    const progressMsgId = (startMsg && startMsg.ok) ? startMsg.result.message_id : state.messageId;
    state.step = 'autogen_running';
    state.batchId = (res.batch || {}).id;
    state.progressMsgId = progressMsgId;
    state.count = count;
    startAutoGenPoller(bot, chatId, state);
}

/* ---------- Menunggu Email Target ---------- */
async function handleWaitingEmail(bot, chatId, state, text) {
    if (text.toLowerCase() === '/cancel') {
        await editMessageText(bot.token, chatId, state.messageId, '❌ Proses dibatalkan.\nKirim /start untuk kembali ke menu utama.');
        delete globalThis.__amUserStates[chatId];
        return;
    }
    // Validate email format
    const email = text.trim().toLowerCase();
    if (!email || email.indexOf('@') === -1) {
        await editMessageText(bot.token, chatId, state.messageId, '⚠️ Format email tidak valid. Silakan masukkan email yang benar (contoh: nama@domain.com):');
        return;
    }
    
    // Save email
    globalThis.__amUserStates[chatId].email = email;
    
    // Kirim/update pesan status — kirim sekali, berikutnya cukup di-edit.
    if (globalThis.__amUserStates[chatId].statusMsg) {
        await editMessageText(bot.token, chatId, state.messageId, `⏳ Mengirim tautan verifikasi ke ${escHtml(email)}...`);
    } else {
        const sent = await tgRequest(bot.token, 'sendMessage', {
            chat_id: chatId,
            text: `⏳ Mengirim tautan verifikasi ke ${escHtml(email)}...`,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
        if (sent && sent.ok === true) {
            globalThis.__amUserStates[chatId].messageId = sent.result.message_id;
            globalThis.__amUserStates[chatId].statusMsg = true;
        }
    }
    
    // Send verification link via API
    const result = await callLocalAPI(bot, 'send-link', { email: email, domain: 'random' });
    
    if (result && result.success) {
        // Show success message with instructions
        await editMessageText(bot.token, chatId, globalThis.__amUserStates[chatId].messageId, `✅ Tautan verifikasi telah terkirim!\n\nBuka inbox email <code>${escHtml(email)}</code>, salin tautan verifikasi (Sign in to Alight Creative), lalu tempelkan di sini:\n\n(Tautan biasanya berformat: https://alightcreative.com/...oobCode=...)\n\nSetelah itu kirim link`);
        
        // Change state to waiting for link
        globalThis.__amUserStates[chatId].step = 'waiting_link';
    } else {
        // Show error
        await editMessageText(bot.token, chatId, globalThis.__amUserStates[chatId].messageId, `❌ Gagal mengirim tautan verifikasi: ${result && result.message ? result.message : 'Terjadi kesalahan'}\n\nSilakan coba lagi atau ketik /cancel untuk membatalkan.`);
        // Keep state as waiting_email so user can try again
    }
}

/* ---------- Menunggu Link Verifikasi ---------- */
async function handleWaitingLink(bot, chatId, state, text) {
    if (text.toLowerCase() === '/cancel') {
        await editMessageText(bot.token, chatId, state.messageId, '❌ Proses dibatalkan.\nKirim /start untuk kembali ke menu utama.');
        delete globalThis.__amUserStates[chatId];
        return;
    }
    const link = text.trim();
    
    // Cek kuota sebelum mengaktifkan lisensi (owner bebas).
    const userId = String(chatId);
    const isOwner = String(chatId) === String(bot.ownerId);
    if (!isOwner && getUserQuota(userId) <= 0) {
        delete globalThis.__amUserStates[chatId];
        await editMessageText(bot.token, chatId, state.messageId, quotaZeroMessage(isOwner, bot) + '\n\nKirim /start untuk kembali ke menu.', getBackKeyboard());
        return;
    }
    
    if (!link || !link.startsWith('http')) {
        await editMessageText(bot.token, chatId, state.messageId, '⚠️ Format link tidak valid. Silakan tempel tautan verifikasi yang lengkap (harus dimulai dengan https://):');
        return;
    }
    
    // Kirim pesan status BARU satu kali — berikutnya hanya di-edit pesan ini.
    const sent = await tgRequest(bot.token, 'sendMessage', {
        chat_id: chatId,
        text: '⚡ Memverifikasi link dan mengaktifkan lisensi premium...',
        parse_mode: 'HTML',
        disable_web_page_preview: true,
    });
    if (sent && sent.ok === true) {
        globalThis.__amUserStates[chatId].messageId = sent.result.message_id;
    }
    
    // Verify the link via API
    const email = globalThis.__amUserStates[chatId].email;
    const result = await callLocalAPI(bot, 'activate', { email: email, magicLink: link });
    
    if (result && result.success) {
        // Order ID dalam format GPA.XXXX-XXXX-XXXX-XXXXX (diteruskan dari hasil API am.js).
        const apiCode = result.orderId || result.codeorder || result.data?.orderId || result.data?.codeorder;
        const orderId = apiCode
            ? (String(apiCode).startsWith('GPA.') ? String(apiCode) : `GPA.${gpaSeg()}-${gpaSeg()}-${gpaSeg()}-${String(apiCode).replace(/^Alwayscodex-/i, '')}`)
            : generateOrderId();
        
        // Update user stats
        if (!globalThis.__amTelegramUsers[userId]) {
            globalThis.__amTelegramUsers[userId] = { id: userId, username: '', firstName: '', quota: 1, totalAccounts: 0, referredBy: null };
        }
        
        globalThis.__amTelegramUsers[userId].quota = Math.max(0, (globalThis.__amTelegramUsers[userId].quota || 1) - 1);
        globalThis.__amTelegramUsers[userId].totalAccounts = (globalThis.__amTelegramUsers[userId].totalAccounts || 0) + 1;
        saveTelegramData();
        
        // Show success message
        await editMessageText(bot.token, chatId, globalThis.__amUserStates[chatId].messageId, `🎉 ALIGHT MOTION PREMIUM BERHASIL DIAKTIFKAN!\n\n📧 Email: ${email}\n👑 Status: Premium Aktif\n🔖 Order ID: ${orderId}\n🔑 Sisa Kuota: ${globalThis.__amTelegramUsers[userId].quota}`);
        
        // Clear state
        delete globalThis.__amUserStates[chatId];
    } else {
        // Show error
        await editMessageText(bot.token, chatId, globalThis.__amUserStates[chatId].messageId, `❌ Verifikasi gagal: ${result && result.message ? result.message : 'Link tidak valid atau sudah digunakan'}\n\nSilakan coba lagi atau ketik /cancel untuk membatalkan.`);
        // Keep state as waiting_link so user can try again
    }
}

/* ---------- Menunggu Kode Voucher ---------- */
async function handleWaitingVoucher(bot, chatId, state, text) {
    if (text.toLowerCase() === '/cancel') {
        await editMessageText(bot.token, chatId, state.messageId, '❌ Proses dibatalkan.\nKirim /start untuk kembali ke menu utama.');
        delete globalThis.__amUserStates[chatId];
        return;
    }
    const code = text.trim();
    
    if (!code) {
        await editMessageText(bot.token, chatId, state.messageId, '⚠️ Silakan masukkan kode voucher:');
        return;
    }
    
    // Redeem voucher dari registry lokal (dibuat via /createvoucher).
    const voucher = globalThis.__amVouchers && globalThis.__amVouchers[code.toUpperCase()];
    const userId = String(chatId);
    
    if (voucher && voucher.quota > 0) {
        voucher.quota -= 1;
        if (!voucher.usedBy) voucher.usedBy = [];
        voucher.usedBy.push(userId);
        
        if (!globalThis.__amTelegramUsers[userId]) {
            globalThis.__amTelegramUsers[userId] = { id: userId, quota: 0, totalAccounts: 0, referredBy: null, referrals: [] };
        }
        globalThis.__amTelegramUsers[userId].quota = (globalThis.__amTelegramUsers[userId].quota || 0) + 1;
        saveTelegramData();
        
        const orderId = `VCH-${newId().slice(0, 8).toUpperCase()}`;
        const sisaKuota = globalThis.__amTelegramUsers[userId].quota;
        
        await editMessageText(bot.token, chatId, state.messageId, `🎁 Kuota berhasil diredeem!\n\n📧 Email: ${state.email || '-'}\n👑 Status: Premium Aktif\n🔖 Order ID: ${orderId}\n🔑 Sisa Kuota: ${sisaKuota}`);
    } else {
        await editMessageText(bot.token, chatId, state.messageId, `❌ Kode voucher tidak valid. Silakan coba lagi atau kirim /cancel untuk membatalkan.`);
    }
    
    delete globalThis.__amUserStates[chatId];
}

/* ---------- Kembali ke Menu Utama (Callback) ---------- */
async function goBackToMain(bot, chatId, messageId, fromUser = null) {
    const from = fromUser || { id: chatId, first_name: '', username: '' };
    await editMessageText(bot.token, chatId, messageId, getMenuMainText(bot, { from }), getMainKeyboard());
}

/* ============================== HANDLER PERINTAH OWNER ============================== */

async function handleCreateVoucher(bot, chatId, fromId, args) {
    // Check if owner
    if (String(fromId) !== String(bot.ownerId)) {
        await sendText(bot.token, chatId, '⛔ Hanya Owner yang boleh menggunakan perintah ini.');
        return;
    }
    
    const parts = (args || '').trim().split(/\s+/);
    const quota = parseInt(parts[0] || '1', 10);
    const count = parseInt(parts[1] || '1', 10);
    const baseCode = parts[2] || '';
    
    if (isNaN(quota) || isNaN(count) || quota <= 0 || count <= 0) {
        await sendText(bot.token, chatId, 'Gunakan: /createvoucher [kuota] [jumlah] [kode]\nContoh: /createvoucher 40 5 ABC');
        return;
    }
    
    const codes = [];
    for (let i = 0; i < count; i++) {
        const code = baseCode ? `${baseCode}${String(i + 1).padStart(3, '0')}` : `VCH-${newId().slice(0, 6).toUpperCase()}`;
        codes.push(code);
        
        // Store voucher
        if (!globalThis.__amVouchers[code]) {
            globalThis.__amVouchers[code] = { quota, usedBy: [] };
        }
    }
    
    const codeList = codes.join('\n');
    await sendText(bot.token, chatId, `🎁 ${count} kode voucher berhasil dibuat!\n\nKode:\n${codeList}\n\nSetiap kode memberikan <b>${quota}</b> kuota.`);
}

async function handleAddLicense(bot, chatId, fromId, args) {
    // Check if owner
    if (String(fromId) !== String(bot.ownerId)) {
        await sendText(bot.token, chatId, '⛔ Hanya Owner yang boleh menggunakan perintah ini.');
        return;
    }
    
    const parts = (args || '').trim().split(/\s+/);
    const targetChatId = parts[0];
    const kuota = parseInt(parts[1] || '0', 10);
    
    if (!targetChatId || isNaN(kuota) || kuota < 0) {
        await sendText(bot.token, chatId, 'Gunakan: /addlicense [chatId] [kuota]\nContoh: /addlicense 123456789 10');
        return;
    }
    
    // Initialize target user if not exists
    if (!globalThis.__amTelegramUsers[targetChatId]) {
        globalThis.__amTelegramUsers[targetChatId] = {
            id: targetChatId,
            username: '',
            first_name: '',
            quota: 0,
            totalAccounts: 0,
            referredBy: null
        };
    }
    
    globalThis.__amTelegramUsers[targetChatId].quota += kuota;
    saveTelegramData();
    await sendText(bot.token, chatId, `✅ <b>${kuota}</b> kuota berhasil ditambahkan ke user <b>${targetChatId}</b>.`);
}

async function handleBroadcast(bot, chatId, fromId, args) {
    // Check if owner
    if (String(fromId) !== String(bot.ownerId)) {
        await sendText(bot.token, chatId, '⛔ Hanya Owner yang boleh menggunakan perintah ini.');
        return;
    }
    
    const message = (args || '').trim();
    if (!message) {
        await sendText(bot.token, chatId, 'Gunakan: /broadcast [pesan]');
        return;
    }
    
    // Send to all users
    let sent = 0;
    const failed = [];
    for (const uid of Object.keys(globalThis.__amTelegramUsers || {})) {
        try {
            await sendText(bot.token, parseInt(uid), message, 'HTML');
            sent++;
        } catch (e) {
            failed.push(uid);
        }
    }
    
    const resultText = `✅ Broadcast terkirim ke <b>${sent}</b> user.`;
    if (failed.length > 0) {
        await sendText(bot.token, chatId, `${resultText}\n⚠️ Gagal mengirim ke ${failed.length} user (mungkin bot tidak aktif atau blokir).`);
    } else {
        await sendText(bot.token, chatId, resultText);
    }
}

async function handleStats(bot, chatId, fromId, args) {
    // Check if owner
    if (String(fromId) !== String(bot.ownerId)) {
        await sendText(bot.token, chatId, '⛔ Hanya Owner yang boleh menggunakan perintah ini.');
        return;
    }
    
    const gStats = getGlobalStats();
    const tgUsers = globalThis.__amTelegramUsers || {};
    let totalUsers = gStats.totalUsers;
    let totalAccounts = gStats.totalSuccess;
    let totalQuota = 0;
    let premiumUsers = 0;

    for (const uid of Object.keys(tgUsers)) {
        const user = tgUsers[uid] || {};
        totalQuota += user.quota || 0;
        if (user.quota > 0) premiumUsers++;
    }
    
    await sendText(bot.token, chatId, `📊 <b>Stats Bot</b>\n\nTotal User: <b>${totalUsers}</b>\nTotal Akun Terbuat: <b>${totalAccounts}</b>\nTotal Kuota Tersedia: <b>${totalQuota}</b>\nUser Premium Aktif: <b>${premiumUsers}</b>`);
}

/* ============================== HANDLER PESAN UMUM ============================== */

async function handleBulkExternal(bot, chatId, fromId, args) {
    if (String(fromId) !== String(bot.ownerId)) {
        return sendText(bot.token, chatId, '⛔ Hanya Owner yang boleh menggunakan perintah /bulk.');
    }
    // Batasi /bulk berdasarkan role website pemilik bot. Hanya role bulk-capable
    // (Autogen/VIP/Owner) yang boleh; role lain (termasuk Pro) tidak bisa bulk.
    const users = getUsers();
    const ownerUser = users[bot.deployedBy];
    const ownerRole = ownerUser && ownerUser.role;
    if (['autogen', 'vip', 'owner'].indexOf(ownerRole) === -1) {
        return sendText(bot.token, chatId, '⛔ Fitur /bulk hanya untuk role Autogen, VIP, dan Owner.');
    }
    const parts = String(args || '').trim().split(/\s+/);
    const count = Math.min(5, Math.max(1, parseInt(parts[0], 10) || 5));
    await sendText(bot.token, chatId, '⏳ <b>MEMULAI AUTO GENERATOR...</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔢 <b>Jumlah:</b> ' + count + '\n⚙️ Diproses oleh server eksternal (api.alwayscodex.eu.cc).');
    try {
        const resp = await fetch('https://api.alwayscodex.eu.cc/api/am/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count: count, apikey: 'adm' }),
            signal: AbortSignal.timeout(30000),
        });
        const res = await resp.json().catch(() => ({}));
        const ok = res && (res.success === true || res.status === 'ok');
        const msg = ok
            ? '✅ <b>BATCH GENERATOR DIMULAI!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔢 <b>Jumlah:</b> <b>' + count + '</b>\n💬 <b>Respon:</b> <code>' + escHtml(JSON.stringify(res).slice(0, 300)) + '</code>'
            : '❌ <b>GAGAL MEMULAI BATCH</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔢 <b>Jumlah:</b> <b>' + count + '</b>\n💬 <b>Respon:</b> <code>' + escHtml(String(res && res.message || 'Terjadi kesalahan').slice(0, 300)) + '</code>';
        await sendText(bot.token, chatId, msg);
    } catch (e) {
        await sendText(bot.token, chatId, '❌ <b>GAGAL MEMULAI BATCH</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💬 <b>Error:</b> <code>' + escHtml(e.message) + '</code>');
    }
}

async function handleUpdate(bot, msg) {
    const chatId = msg.chat.id;
    const from = msg.from || {};
    const text = msg.text || '';
    const fromId = from.id;
    const isOwner = String(fromId) === String(bot.ownerId);
    
    // Normalisasi perintah: hilangkan '@botusername' (chat grup) & slash awal,
    // sehingga perintah jalan baik di private maupun grup.
    const rawFirst = (text.split(/\s+/)[0] || '');
    const normCmd = '/' + rawFirst.replace(/^\//, '').split('@')[0];

    // /start (dengan atau tanpa referral) — selalu diproses duluan.
    if (normCmd === '/start') {
        await handleStart(bot, chatId, fromId, text, false, msg);
        return;
    }
    
    // Handle waiting states + guard bulk-running.
    const state = globalThis.__amUserStates?.[chatId];
    if (state && state.step !== 'autogen_running') {
        if (state.step === 'waiting_email') {
            await handleWaitingEmail(bot, chatId, state, text);
        } else if (state.step === 'waiting_link') {
            await handleWaitingLink(bot, chatId, state, text);
        } else if (state.step === 'waiting_voucher') {
            await handleWaitingVoucher(bot, chatId, state, text);
        } else if (state.step === 'waiting_autocount') {
            await handleWaitingAutoCount(bot, chatId, state, text);
        }
        // Step waiting sudah ditangani — jangan jatuh ke pemrosesan perintah.
        return;
    }
    // Saat bulk berjalan: /cancel = stop notifikasi (proses server tetap jalan),
    // selain itu SEMUA perintah/menu tetap diproses normal (tidak diblokir).
    if (state && state.step === 'autogen_running' && text.toLowerCase() === '/cancel') {
        stopAutoGenPoller(chatId);
        delete globalThis.__amUserStates[chatId];
        await sendText(bot.token, chatId, '⏹ Notifikasi bulk dihentikan.\nProses di server tetap berjalan di background.\nKirim /start untuk menu utama.');
        return;
    }
    // (autogen_running non-cancel / tanpa state) -> lanjut ke perintah normal.
    
    // Perintah lainnya — tiap perintah dipisah (mirip /start), dengan
    // normalisasi @botusername agar jalan di chat grup.
    if (text.startsWith('/')) {
        const sp = text.indexOf(' ');
        const arg = sp !== -1 ? text.slice(sp + 1).trim() : '';

        if (normCmd === '/createvoucher') {
            await handleCreateVoucher(bot, chatId, fromId, arg);
            return;
        }
        if (normCmd === '/addlicense') {
            await handleAddLicense(bot, chatId, fromId, arg);
            return;
        }
        if (normCmd === '/broadcast') {
            await handleBroadcast(bot, chatId, fromId, arg);
            return;
        }
        if (normCmd === '/stats') {
            await handleStats(bot, chatId, fromId, arg);
            return;
        }
        if (normCmd === '/bulk') {
            await handleBulkExternal(bot, chatId, fromId, arg);
            return;
        }
        if (normCmd === '/help') {
            await sendText(bot.token, chatId, '⚠️ <b>PERINTAH YANG DIPERBATAsan</b>\n\n/start - Menu utama\n/createvoucher [kuota] [jumlah] [kode] - Buat kode voucher\n/addlicense [chatId] [kuota] - Tambah kuota user\n/broadcast [pesan] - Kirim pengumuman\n/stats - Lihat statistik bot\n/id - Dapatkan ID chat\n/voucher - Redeem voucher kuota\n/cancel - Batalkan proses saat ini');
            return;
        }
        if (normCmd === '/id') {
            await sendText(bot.token, chatId, 'ID Chat: ' + chatId);
            return;
        }
        if (normCmd === '/cancel') {
            const st = globalThis.__amUserStates?.[chatId];
            if (st) {
                delete globalThis.__amUserStates[chatId];
                await sendText(bot.token, chatId, '❌ Proses dibatalkan.\nKirim /start untuk kembali ke menu utama.');
            } else {
                await sendText(bot.token, chatId, 'Tidak ada proses aktif yang dapat dibatalkan.');
            }
            return;
        }
        await sendText(bot.token, chatId, 'Perintah tidak dikenal. Ketik /help untuk bantuan.');
        return;
    }
    
    // If no state and not a command, show main menu
    if (!state && !text.startsWith('/')) {
        await handleStart(bot, chatId, fromId, text, false, msg);
    }
}

/* ============================== CALLBACK QUERY ============================== */

async function handleCallbackQuery(bot, callbackQuery) {
    const { id: callbackId, from: user, message, data } = callbackQuery;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const fromId = user.id;
    const isOwner = String(fromId) === String(bot.ownerId);
    
    // Answer callback query to stop loading animation
    try {
        await tgRequest(bot.token, 'answerCallbackQuery', { callback_query_id: callbackId });
    } catch (e) {
        // Ignore errors in answering callback
    }
    
    switch (data) {
        case 'menu_generator':
            await editMessageText(bot.token, chatId, messageId, '⚡ Pilih Metode Generator:\n\n1. Manual Generator: Masukkan email Anda sendiri, lalu tempel tautan verifikasi dari inbox.\n2. Auto Generator (Otomatis): Bot membuat email dan mengaktifkan lisensi otomatis 100% tanpa ribet.', getGeneratorKeyboard());
            break;
            
        case 'gen_auto':
        {
            const userId = String(chatId);
            const isOwner = String(chatId) === String(bot.ownerId);
            // Gate kuota di awal: jika 0, jangan masuk sesi waiting_autocount
            // (biar user tidak terjebak di sesi yang berhenti).
            if (!isOwner && getUserQuota(userId) <= 0) {
                delete globalThis.__amUserStates[chatId];
                await editMessageText(bot.token, chatId, messageId, quotaZeroMessage(isOwner, bot) + '\n\nTekan tombol di bawah untuk kembali ke menu.', getBackKeyboard());
                break;
            }
            const quota = isOwner ? 100 : getUserQuota(userId);
            globalThis.__amUserStates[chatId] = { step: 'waiting_autocount', messageId: messageId };
            await editMessageText(bot.token, chatId, messageId, '⚡ Auto Generator (Otomatis)\n\nBerapa banyak akun premium yang ingin Anda buat? (Maksimal 100 akun, sisa kuota Anda: ' + quota + '):\n\nKirim angka jumlah akun. Contoh: 5', getBackKeyboard());
            break;
        }
            
        case 'gen_manual':
        {
            const userId = String(chatId);
            const isOwner = String(chatId) === String(bot.ownerId);
            if (!isOwner && getUserQuota(userId) <= 0) {
                delete globalThis.__amUserStates[chatId];
                await editMessageText(bot.token, chatId, messageId, quotaZeroMessage(isOwner, bot) + '\n\nTekan tombol di bawah untuk kembali ke menu.', getBackKeyboard());
                break;
            }
            await editMessageText(bot.token, chatId, messageId, '📧 Metode Manual Generator\n\nSilakan ketik alamat email Alight Motion target Anda:\n(Contoh: namaemail@gmail.com)', getBackKeyboard());
            globalThis.__amUserStates[chatId] = { step: 'waiting_email', messageId: messageId };
            break;
        }
            
        case 'back_to_main':
            await goBackToMain(bot, chatId, messageId, user);
            break;
            
        case 'menu_voucher':
            await editMessageText(bot.token, chatId, messageId, '🎁 Redeem Voucher Kuota\n\nSilakan ketik atau tempel kode voucher yang Anda miliki di bawah ini:\n(Kirim /cancel untuk membatalkan)', getBackKeyboard());
            globalThis.__amUserStates[chatId] = { step: 'waiting_voucher', messageId: messageId, email: '' };
            break;
            
        case 'menu_referral':
            const refUser = globalThis.__amTelegramUsers[chatId] || {};
            const referralCount = (refUser.referrals || []).length;
            const botUsername = bot.username || 'ALIGHTMOTIONBOT';
            const referralLink = `https://t.me/${botUsername}?start=ref_${chatId}`;
            await editMessageText(bot.token, chatId, messageId, `
🤝 Program Referral (Undang Teman)

🎁 Bonus: +10 Kuota per teman yang bergabung
📈 Teman Diundang: ${referralCount}

🔗 Link Referral:
${referralLink}
`, getBackKeyboard());
            break;

        case 'menu_netflixgen':
        {
            // JANGAN await generate di sini — proses 1–3 menit. Dijalankan di
            // background agar loop polling tidak keblokir: /start & perintah lain
            // tetap responsif sementara token diproses (sama seperti fitur /bulk).
            await editMessageText(bot.token, chatId, messageId, '🎬 Netflix Generator\n\n⏳ Membuat token PREMIUM...\nMencari proxy + generate (1–3 menit), mohon tunggu.', null);
            (async function runNetflixGen() {
                try {
                    // Reuse the house generator (src/utils/am.js). Dynamic import to
                    // avoid circular dependency (am.js also imports from this file).
                    const { generateNFToken } = await import('./am.js');
                    const res = await generateNFToken('premium', 1);
                    const t = res && res.success && res.results && res.results[0];
                    const r = t
                        ? { success: true, url: t.url, quality: t.quality, country: t.country, expires: t.expires }
                        : { success: false, error: (res && res.message) || 'Gagal generate token' };
                    if (!r.success) {
                        await editMessageText(bot.token, chatId, messageId, '❌ Gagal: ' + r.error + '\n\nCoba lagi beberapa saat lagi.', getBackKeyboard());
                    } else {
                        await editMessageText(bot.token, chatId, messageId,
                            '✅ TOKEN NETFLIX PREMIUM BERHASIL DIBUAT\n\n' +
                            '📺 Kualitas : ' + (r.quality || '-') + '\n' +
                            '🌍 Negara   : ' + (r.country || '-') + '\n' +
                            '⏳ Expired  : ' + (r.expires || '-') + ' (~1 jam)\n\n' +
                            '🔗 LINK LOGIN:\n' + r.url + '\n\n' +
                            '⚠️ Wajib gunakan VPN saat membuka link!', getBackKeyboard());
                    }
                } catch (e) {
                    await editMessageText(bot.token, chatId, messageId, '❌ Error: ' + e.message, getBackKeyboard());
                }
            })();
            break;
        }

        case 'menu_owner':
            if (isOwner) {
                await editMessageText(bot.token, chatId, messageId, '⚙️ Fitur Owner\n\nDaftar Perintah:\n• /createvoucher [kuota] [jumlah] [kode] - Buat kode voucher\n• /addlicense [chatId] [kuota] - Tambah kuota ke user\n• /broadcast [pesan] - Kirim pengumuman ke seluruh user\n• /stats - Lihat statistik bot', getBackKeyboard());
            } else {
                await editMessageText(bot.token, chatId, messageId, '⛔ Hanya Owner yang boleh mengakses fitur ini.');
            }
            break;
            
        default:
            await editMessageText(bot.token, chatId, messageId, '⚠️ Tombol tidak dikenali.');
    }
}

/* ============================== INIT ============================== */

// Inisialisasi saat bot mulai - muat users yang sudah ada
function initTelegramUsers() {
    const usersFile = path.join(DATA_DIR, 'telegram_users.json');
    if (fs.existsSync(usersFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
            globalThis.__amTelegramUsers = data;
        } catch (e) {
            // If file is corrupted, start fresh
            globalThis.__amTelegramUsers = {};
        }
    }
    
    // Initialize vouchers
    const vouchersFile = path.join(DATA_DIR, 'telegram_vouchers.json');
    if (fs.existsSync(vouchersFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(vouchersFile, 'utf8'));
            globalThis.__amVouchers = data;
        } catch (e) {
            globalThis.__amVouchers = {};
        }
    }
}

// Simpan users dan vouchers ke file
function saveTelegramData() {
    try {
        const usersFile = path.join(DATA_DIR, 'telegram_users.json');
        fs.writeFileSync(usersFile, JSON.stringify(globalThis.__amTelegramUsers, null, 2));
    } catch (e) {
        console.error('[TELEGRAM] Gagal menyimpan data pengguna:', e.message);
    }
    
    try {
        const vouchersFile = path.join(DATA_DIR, 'telegram_vouchers.json');
        fs.writeFileSync(vouchersFile, JSON.stringify(globalThis.__amVouchers, null, 2));
    } catch (e) {
        console.error('[TELEGRAM] Gagal menyimpan data voucher:', e.message);
    }
}

// Auto-save every 5 minutes
setInterval(saveTelegramData, 300000);

// Initial load
initTelegramUsers();
