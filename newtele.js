/** * TELEGRAM BOT DEPLOY MANAGER (multi-bot) * 
 --------------------------------------------------------------- * Sistem deploy bot 
 Telegram untuk role Admin/Owner. * - Konfigurasi bot tersimpan di data/telegram_bots.json 
 * - Bot dijalankan IN-PROCESS via long-polling API Telegram (fetch native, * TANPA 
 dependency eksternal — tidak perlu node-telegram-bot-api/axios). * - Perintah bot: * 
 /start | /help -> menu bantuan * /create <email> -> kirim tautan verifikasi AM 
 (send-link) * /verify <email> <link> -> verifikasi & aktifkan premium (alias /verif) * 
 /bulk <jumlah> [domain] -> auto generator massal (KHUSUS Owner ID) * /id -> cek ID chat 
 (membantu mencari Owner ID) * * Registry disimpan di globalThis agar reload HMR 
 (hot-reload) tidak * men-duplikat polling bot yang sedang berjalan. */
import fs from 'fs'; import path from 'path'; import { DATA_DIR, PORT, newId, nowISO } 
from './store.js'; const TELEGRAM_BOTS_FILE = path.join(DATA_DIR, 'telegram_bots.json'); 
const TELEGRAM_API = 'https://api.telegram.org'; const MAX_BOTS = 500; const BULK_MAX = 5;
// Registry global lintas reload (HMR). Menyimpan runner polling aktif.
const registry = globalThis.__amTelegramBots || (globalThis.__amTelegramBots = { inited: 
false, runners: new Map() }); /* ============================== PERSISTENSI 
============================== */ function loadBots() {
    try { if (!fs.existsSync(TELEGRAM_BOTS_FILE)) { fs.writeFileSync(TELEGRAM_BOTS_FILE, 
            JSON.stringify([]));
        }
        const list = JSON.parse(fs.readFileSync(TELEGRAM_BOTS_FILE, 'utf8')); return 
        Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}
function saveBots(list) { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { 
    recursive: true }); fs.writeFileSync(TELEGRAM_BOTS_FILE, JSON.stringify(list, null, 
    2));
}
function updateBotStatus(id, status, error) { const bots = loadBots(); const b = 
    bots.find((x) => x.id === id); if (!b) return; b.status = status; if (error !== 
    undefined) b.error = error || null; if (status === 'online') b.startedAt = nowISO(); 
    saveBots(bots);
}
/* ============================== TELEGRAM API ============================== */ async 
function tgRequest(token, method, params) {
    const resp = await fetch(TELEGRAM_API + '/bot' + token + '/' + method, { method: 
        'POST', headers: { 'Content-Type': 'application/json' }, body: 
        JSON.stringify(params || {}), signal: AbortSignal.timeout(45000),
    });
    return resp.json().catch(() => ({}));
}
/** * Validasi token via getMe. Melempar Error bila token tidak valid. */ async function 
validateToken(token) {
    const data = await tgRequest(token, 'getMe', {}); if (!data.ok) { const desc = 
        String(data.description || 'token tidak valid').slice(0, 120); throw new 
        Error('Token tidak valid: ' + desc);
    }
    return data.result; // { id, username, first_name }
}
/* ============================== BOT RUNNER ============================== */ function 
escHtml(s) {
    return String(s == null ? '' : s) .replace(/&/g, '&amp;').replace(/</g, 
        '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
async function callLocalAPI(bot, endpoint, payload) { const resp = await 
    fetch('http://127.0.0.1:' + PORT + '/api/v1/bot-premium/' + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 
        bot.apiKey || '' }, body: JSON.stringify(payload || {}), signal: 
        AbortSignal.timeout(120000),
    });
    return resp.json().catch(() => ({}));
}
function apiResultText(res) { if (!res) return 'Tidak ada respon dari server.'; if 
    (res.success) return res.message || 'Berhasil.'; return res.message || 'Gagal.';
}
// FITUR BARU MULAI DI SINI: DUKUNGAN INLINE KEYBOARD & EDIT MESSAGE TERSTRUKTUR (GAYA 
// FOTO 1)
async function sendText(token, chatId, text, parseMode, replyMarkup) { try { const params 
        = {
            chat_id: chatId, text: text, parse_mode: parseMode || 'HTML', 
            disable_web_page_preview: true,
        };
        if (replyMarkup) params.reply_markup = replyMarkup; const data = await 
        tgRequest(token, 'sendMessage', params); if (!data || data.ok === false) {
            console.error('[TELEGRAM] Gagal kirim pesan: ' + String(data && 
            data.description || 'unknown')); return false;
        }
        return true;
    } catch (e) {
        console.error('[TELEGRAM] Gagal kirim pesan: ' + e.message); return false;
    }
}
async function answerCallbackQuery(token, callbackQueryId, text) { try { await 
        tgRequest(token, 'answerCallbackQuery', {
            callback_query_id: callbackQueryId, text: text || ''
        });
    } catch (e) {}
}
async function editMessageText(token, chatId, messageId, text, replyMarkup) { try { const 
        params = {
            chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML', 
            disable_web_page_preview: true
        };
        if (replyMarkup) params.reply_markup = replyMarkup; const data = await 
        tgRequest(token, 'editMessageText', params); if (!data || data.ok === false) {
            return sendText(token, chatId, text, 'HTML', replyMarkup);
        }
        return true;
    } catch (e) {
        return sendText(token, chatId, text, 'HTML', replyMarkup);
    }
}
/* -------- TEMPLATE TAMPILAN KATEGORI & STATISTIK -------- */ function 
getMenuMainText(bot, msg) {
    const from = msg?.from || {}; const name = from.first_name || 'User'; const uid = 
    from.id || '-'; const isOwner = String(uid) === String(bot.ownerId); const roleBadge = 
    isOwner ? 'Owner Bot' : 'Reseller / User'; const now = new Date(); const dateStr = 
    now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', 
    year: 'numeric', timeZone: 'Asia/Jakarta' }); const timeStr = 
    now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 
    'Asia/Jakarta' }); return `Halo <b>${escHtml(name)}</b> 👋\n` +
           `<code>${dateStr} pukul ${timeStr} WIB</code>\n\n` + `<b>User Info</b>\n` + ` └ 
           <b>ID:</b> <code>${uid}</code>\n` + ` └ <b>Status:</b> 
           <code>${roleBadge}</code>\n` + ` └ <b>Owner ID:</b> 
           <code>${escHtml(bot.ownerId)}</code>\n\n` + `<b>Bot Stats</b>\n` + ` └ <b>Nama 
           Bot:</b> <code>${escHtml(bot.name)}</code>\n` + ` └ <b>Status System:</b> 🟢 
           Online 24/7\n\n` + `Silakan pilih menu di bawah ini untuk melihat daftar 
           perintah:`;
}
function getMenuMainKeyboard(bot, uid) { const isOwner = String(uid) === 
    String(bot.ownerId); const buttons = [
        [{ text: '🚀 Fitur Activator AM', callback_data: 'menu_activator' }] ]; if 
    (isOwner) {
        buttons.push([{ text: '📦 Bulk Auto Generator', callback_data: 'menu_bulk' }]);
    }
    buttons.push([{ text: 'ℹ️ Informasi Chat & ID', callback_data: 'menu_info' }]); return 
    { inline_keyboard: buttons };
}
function getMenuActivatorText() { return `🚀 <b>FITUR ACTIVATOR ALIGHT MOTION</b>\n` + 
           `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` + `📌 <b>Daftar Perintah Aktivasi:</b>\n` + 
           `• <code>/create &lt;email&gt;</code>\n` + ` └ Kirim tautan verifikasi magic 
           link ke email\n\n` + `• <code>/verify &lt;email&gt; &lt;link&gt;</code>\n` + ` 
           └ Verifikasi magic link & aktifkan status Premium\n\n` + `• <code>/verif 
           &lt;email&gt; &lt;link&gt;</code>\n` + ` └ Alias singkat untuk /verify\n\n` + 
           `💡 <i>Ketik perintah di atas di kolom chat untuk memproses akun target.</i>`;
}
function getMenuBulkText() { return `📦 <b>BULK AUTO GENERATOR</b>\n` + 
           `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` + `📌 <b>Daftar Perintah Massal (Khusus 
           Owner):</b>\n` + `• <code>/bulk &lt;jumlah&gt; [domain]</code>\n` + ` └ Auto 
           generator akun massal (maksimal ${BULK_MAX} akun)\n\n` + `💡 <i>Contoh: 
           <code>/bulk 5 gmail.com</code></i>`;
}
function getMenuInfoText(bot, msg) { const chatId = msg?.chat?.id || '-'; const fromId = 
    msg?.from?.id || '-'; return `ℹ️ <b>INFORMASI CHAT & ID</b>\n` +
           `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` + `• <b>ID Chat / Grup Ini:</b> 
           <code>${chatId}</code>\n` + `• <b>ID Telegram Anda:</b> 
           <code>${fromId}</code>\n` + `• <b>Owner Bot ID:</b> 
           <code>${escHtml(bot.ownerId)}</code>\n` + `• <b>Bot Username:</b> 
           @${escHtml(bot.me?.username || 'bot')}`;
}
function getBackKeyboard() { return { inline_keyboard: [ [{ text: '🔙 Kembali ke Menu 
            Utama', callback_data: 'menu_main' }]
        ]
    };
}
// FITUR BARU SELESAI DI SINI
/* Rate limit ringan per chat untuk /create & /verify (anti-abuse). Bot dipakai reseller; 
   batasi 20 permintaan/menit & 300/hari per chat. */
function checkRateLimit(chatId) { const now = Date.now(); registry.usage = registry.usage 
    || { minute: new Map(), day: new Map() };
    const m = registry.usage.minute.get(chatId) || { t: now, n: 0 }; const d = 
    registry.usage.day.get(chatId) || { t: now, n: 0 }; if (now - m.t >= 60000) { m.t = 
    now; m.n = 0; } if (now - d.t >= 86400000) { d.t = now; d.n = 0; } if (m.n >= 20 || 
    d.n >= 300) return false; m.n += 1; d.n += 1; registry.usage.minute.set(chatId, m); 
    registry.usage.day.set(chatId, d); return true;
}
// FITUR BARU MULAI DI SINI: FORMAT PESAN STATUS DAN HANDLER TERSTRUKTUR
async function handleCreate(bot, chatId, args) { if (!checkRateLimit(chatId)) { return 
        sendText(bot.token, chatId, '⏳ <b>TERLALU BANYAK 
        PERMINTAAN</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nMohon tunggu beberapa saat sebelum 
        mencoba lagi.');
    }
    const email = String(args || '').trim().toLowerCase(); if (!email || 
    email.indexOf('@') === -1) {
        return sendText(bot.token, chatId, '⚠️ <b>FORMAT 
        SALAH</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGunakan: <code>/create 
        email@domain.com</code>');
    }
    await sendText(bot.token, chatId, '⏳ <b>MEMPROSES TAUTAN 
    VERIFIKASI...</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📧 <b>Email Target:</b> <code>' + 
    escHtml(email) + '</code>'); const res = await callLocalAPI(bot, 'send-link', { email: 
    email }); const ok = res && res.success; let text = ok
        ? '✅ <b>TAUTAN VERIFIKASI TERKIRIM!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
        : '❌ <b>GAGAL MENGIRIM TAUTAN</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '📧 <b>Email:</b> <code>' + escHtml(email) + '</code>\n'; text += '💬 
    <b>Respon:</b> <code>' + escHtml(apiResultText(res)) + '</code>'; await 
    sendText(bot.token, chatId, text);
}
async function handleVerify(bot, chatId, args) { if (!checkRateLimit(chatId)) { return 
        sendText(bot.token, chatId, '⏳ <b>TERLALU BANYAK 
        PERMINTAAN</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nMohon tunggu beberapa saat sebelum 
        mencoba lagi.');
    }
    const parts = String(args || '').trim().split(/\s+/); const email = (parts.shift() || 
    '').trim().toLowerCase(); const link = parts.join(' ').trim(); if (!email || !link) {
        return sendText(bot.token, chatId, '⚠️ <b>FORMAT 
        SALAH</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGunakan: <code>/verify email@domain.com 
        https://link-verifikasi...</code>');
    }
    await sendText(bot.token, chatId, '⏳ <b>MEMVERIFIKASI 
    AKUN...</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📧 <b>Email Target:</b> <code>' + 
    escHtml(email) + '</code>'); const res = await callLocalAPI(bot, 'activate', { email: 
    email, magicLink: link }); const ok = res && res.success; let text = ok
        ? '🎉 <b>VERIFIKASI & PREMIUM BERHASIL!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
        : '❌ <b>VERIFIKASI GAGAL</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '📧 <b>Email:</b> <code>' + escHtml(email) + '</code>\n'; text += '💬 
    <b>Respon:</b> <code>' + escHtml(apiResultText(res)) + '</code>'; await 
    sendText(bot.token, chatId, text);
}
async function handleBulk(bot, chatId, fromId, args) { if (String(fromId) !== 
    String(bot.ownerId)) {
        return sendText(bot.token, chatId, '⛔ <b>AKSES 
        DITOLAK</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPerintah <code>/bulk</code> khusus untuk 
        Owner ID bot ini.');
    }
    const parts = String(args || '').trim().split(/\s+/); const count = parseInt(parts[0], 
    10); const domain = (parts[1] || '').trim() || 'random'; if (!count || count < 1 || 
    count > BULK_MAX) {
        return sendText(bot.token, chatId, '⚠️ <b>FORMAT 
        SALAH</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGunakan: <code>/bulk ' + BULK_MAX + 
        '</code> (Maksimal ' + BULK_MAX + ' akun)');
    }
    await sendText(bot.token, chatId, '⏳ <b>MEMULAI AUTO 
    GENERATOR...</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔢 <b>Jumlah:</b> ' + count + '\n🌐 
    <b>Domain:</b> ' + (domain === 'random' ? 'Random' : '@' + escHtml(domain)));
    
    // Sertakan identitas bot + chat agar hasil batch otomatis dikirim balik ke sini.
    const res = await callLocalAPI(bot, 'bulk', { count: count, domain: domain, tgBotId: 
    bot.id, tgChatId: chatId }); const ok = res && res.success; let text = ok
        ? '✅ <b>BATCH GENERATOR DIMULAI!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
        : '❌ <b>GAGAL MEMULAI BATCH</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '🔢 <b>Jumlah:</b> <b>' + count + '</b>\n'; text += '🌐 <b>Domain:</b> <code>' 
    + escHtml(domain) + '</code>\n'; text += '💬 <b>Respon:</b> <code>' + 
    escHtml(apiResultText(res)) + '</code>'; await sendText(bot.token, chatId, text);
}
async function handleCallbackQuery(bot, cq) { const chatId = cq.message?.chat?.id; const 
    messageId = cq.message?.message_id; const data = cq.data; const uid = cq.from?.id; if 
    (!chatId || !messageId) return; await answerCallbackQuery(bot.token, cq.id); if (data 
    === 'menu_main') {
        const text = getMenuMainText(bot, cq); const kb = getMenuMainKeyboard(bot, uid); 
        await editMessageText(bot.token, chatId, messageId, text, kb);
    } else if (data === 'menu_activator') {
        const text = getMenuActivatorText(); const kb = getBackKeyboard(); await 
        editMessageText(bot.token, chatId, messageId, text, kb);
    } else if (data === 'menu_bulk') {
        const text = getMenuBulkText(); const kb = getBackKeyboard(); await 
        editMessageText(bot.token, chatId, messageId, text, kb);
    } else if (data === 'menu_info') {
        const text = getMenuInfoText(bot, cq); const kb = getBackKeyboard(); await 
        editMessageText(bot.token, chatId, messageId, text, kb);
    }
}
// FITUR BARU SELESAI DI SINI
async function handleMessage(bot, msg) { const chatId = msg.chat && msg.chat.id; const 
    fromId = msg.from && msg.from.id; if (!chatId || !msg.text) return; const raw = 
    String(msg.text).trim(); const parts = raw.split(/\s+/); const cmd = (parts.shift() || 
    '').split('@')[0].toLowerCase(); // dukung /cmd@BotUsername const args = parts.join(' 
    ').trim(); if (cmd === '/start' || cmd === '/help') {
        const text = getMenuMainText(bot, msg); const kb = getMenuMainKeyboard(bot, 
        fromId); await sendText(bot.token, chatId, text, 'HTML', kb);
    } else if (cmd === '/id') {
        const text = getMenuInfoText(bot, msg); const kb = getBackKeyboard(); await 
        sendText(bot.token, chatId, text, 'HTML', kb);
    } else if (cmd === '/create') {
        await handleCreate(bot, chatId, args);
    } else if (cmd === '/verify' || cmd === '/verif') {
        await handleVerify(bot, chatId, args);
    } else if (cmd === '/bulk') {
        await handleBulk(bot, chatId, fromId, args);
    }
}
async function runPollLoop(bot, runner) { while (!runner.stopped) { try { const data = 
            await tgRequest(bot.token, 'getUpdates', {
                timeout: 30, limit: 100, offset: runner.offset, allowed_updates: 
                ['message', 'callback_query'],
            });
            if (runner.stopped) break; if (!data.ok) { if (data.error_code === 409) { 
                    console.error('[TELEGRAM] Bot ' + bot.name + ' konflik (409): token 
                    dipakai instance lain.'); updateBotStatus(bot.id, 'error', 'Token 
                    sedang dipakai instance/bot lain (409). Stop bot lain dengan token 
                    ini.'); runner.stop(); break;
                }
                if (data.error_code === 401) { console.error('[TELEGRAM] Bot ' + bot.name 
                    + ' token tidak valid (401).'); updateBotStatus(bot.id, 'error', 
                    'Token tidak valid (401). Deploy ulang dengan token baru dari 
                    @BotFather.'); runner.stop(); break;
                }
                throw new Error(String(data.description || 'unknown error'));
            }
            runner.failCount = 0; const updates = data.result || []; for (const u of 
            updates) {
                runner.offset = Math.max(runner.offset, u.update_id + 1); if (u.message) { 
                    try {
                        await handleMessage(bot, u.message);
                    } catch (e) {
                        console.error('[TELEGRAM] Bot ' + bot.name + ' handler error: ' + 
                        e.message);
                    }
                } else if (u.callback_query) {
                    try { await handleCallbackQuery(bot, u.callback_query);
                    } catch (e) {
                        console.error('[TELEGRAM] Bot ' + bot.name + ' callback error: ' + 
                        e.message);
                    }
                }
            }
        } catch (e) {
            runner.failCount++; console.error('[TELEGRAM] Bot ' + bot.name + ' polling 
            error: ' + e.message); if (runner.stopped) break; await new Promise((r) => 
            setTimeout(r, Math.min(30000, 2500 * runner.failCount)));
        }
    }
    // Hanya hapus runner ini dari registry bila masih menunjuk ke dirinya sendiri 
    // (hindari menghapus runner baru yang terdaftar saat bot di-start ulang).
    if (registry.runners.get(bot.id) === runner) registry.runners.delete(bot.id);
}
function startBotRunner(bot) { const existing = registry.runners.get(bot.id); if (existing 
    && !existing.stopped) return existing; if (existing) registry.runners.delete(bot.id); 
    const runner = { botId: bot.id, stopped: false, offset: 0, failCount: 0, loop: null }; 
    runner.stop = function () { this.stopped = true; }; registry.runners.set(bot.id, 
    runner); runner.loop = runPollLoop(bot, runner); return runner;
}
/* ============================== MANAJEMEN BOT ============================== */ /** * 
 Deploy bot baru (atau ganti token lama yang sama). * input: { name, token, ownerId, 
 apiKey } */
async function deployBot(input) { let name = String(input.name || '').trim().slice(0, 40); 
    const token = String(input.token || '').trim(); const ownerId = String(input.ownerId 
    || '').trim();
    const apiKey = String(input.apiKey || '').trim(); if 
    (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('Format Bot Token tidak 
    valid. Ambil token dari @BotFather.'); if (!/^-?\d+$/.test(ownerId)) throw new 
    Error('Owner ID harus berupa angka (dapatkan dari @userinfobot atau perintah /id di 
    bot).'); if (!apiKey) throw new Error('API Key akun Anda kosong. Generate API Key di 
    menu Profil terlebih dahulu.'); const me = await validateToken(token); if (!name) name 
    = String(me.username || me.first_name || 'Telegram Bot').slice(0, 40); let bots = 
    loadBots(); if (bots.length >= MAX_BOTS) throw new Error('Maksimal ' + MAX_BOTS + ' 
    bot terdeploy.');
    // Token sama dengan bot lain -> stop & hapus dulu agar tidak konflik 409.
    const dup = bots.find((b) => b.token === token); if (dup) { const runner = 
        registry.runners.get(dup.id); if (runner) runner.stop(); bots = bots.filter((b) => 
        b.id !== dup.id);
    }
    const id = newId(); const bot = { id: id, name: name, token: token, ownerId: ownerId, 
        apiKey: apiKey, me: { id: me.id, username: me.username, first_name: me.first_name 
        },
        status: 'online', error: null, createdAt: nowISO(), startedAt: nowISO(),
    };
    bots.push(bot); saveBots(bots); startBotRunner(bot); console.log('[TELEGRAM] Bot "' + 
    name + '" deployed (@' + (me.username || me.id) + ').'); return bot;
}
function stopBot(id) { const runner = registry.runners.get(id); if (runner) runner.stop(); 
    const bots = loadBots(); const b = bots.find((x) => x.id === id); if (b) {
        b.status = 'offline'; b.error = null; saveBots(bots);
    }
}
async function startBot(id) { const bots = loadBots(); const b = bots.find((x) => x.id === 
    id); if (!b) throw new Error('Bot tidak ditemukan.'); await validateToken(b.token); 
    const runner = registry.runners.get(id); if (runner) {
        runner.stop(); registry.runners.delete(id);
    }
    b.status = 'online'; b.error = null; b.startedAt = nowISO(); saveBots(bots); 
    startBotRunner(b); return b;
}
async function restartBot(id) { stopBot(id); await new Promise((r) => setTimeout(r, 600)); 
    return startBot(id);
}
function removeBot(id) { const runner = registry.runners.get(id); if (runner) 
    runner.stop(); const bots = loadBots().filter((b) => b.id !== id); saveBots(bots);
}
function maskToken(token) { if (!token || token.length < 12) return '****'; return 
    token.slice(0, 8) + '****' + token.slice(-4);
}
/** * Validasi kepemilikan bot: apakah bot dengan id ini milik pemilik apiKey tsb. * 
 Dipakai endpoint bulk agar user tidak bisa spam chat bot milik orang lain. */
function isBotOwnedBy(botId, apiKey) { if (!botId || !apiKey) return false; const bot = 
    loadBots().find(function (b) { return b.id === botId; }); return !!(bot && bot.apiKey 
    === apiKey);
}
/* -------- Kirim hasil batch (bulk) ke chat yang meminta -------- */
// FITUR BARU MULAI DI SINI: TAMPILAN LAPORAN BATCH/BULK SANGAT RAPI (GAYA FOTO 1)
async function notifyBulkResult(botId, chatId, payload) { if (!botId || !chatId) return 
    false; const bot = loadBots().find(function (b) { return b.id === botId; }); if (!bot) 
    return false; let sentOk = true; const results = payload.results || []; const ok = 
    results.filter(function (r) { return r.status === 'success'; }).length; let head = ''; 
    if (payload.status === 'failed') {
        head = '❌ <b>BATCH GENERATOR GAGAL</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    } else if (payload.status === 'aborted') {
        head = '⚠️ <b>BATCH GENERATOR DI-ABORT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    } else {
        head = '🎉 <b>BATCH GENERATOR SELESAI</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    }
    head += '📦 <b>Hasil:</b> <code>' + ok + '/' + results.length + '</code> akun 
    sukses\n'; head += '🌐 <b>Domain:</b> <code>' + escHtml(payload.domain || '-') + 
    '</code>'; if (payload.error) head += '\n💬 <b>Detail Error:</b> <code>' + 
    escHtml(String(payload.error).slice(0, 200)) + '</code>'; head += 
    '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━'; const lines = results.map(function (r, i) {
        const email = r.email || '-'; const line = (i + 1) + '. <code>' + escHtml(email) + 
        '</code>'; const inbox = ' └ 🔗 https://generator.email/' + escHtml(email); if 
        (r.status === 'success') {
            return line + ' — ✅ <b>PREMIUM</b> (Code: <code>' + 
            escHtml(String(r.codeorder || '-')) + '</code>)\n' + inbox;
        }
        return line + ' — ❌ <code>' + escHtml(String(r.error || 'gagal').slice(0, 80)) + 
        '</code>\n' + inbox;
    });
    // Batasi pesan per kiriman (Telegram max ~4096 karakter).
    const CHUNK = 20; const messages = []; let current = head; for (let i = 0; i < 
    lines.length; i++) {
        if (i > 0 && i % CHUNK === 0) { messages.push(current); current = '📦 <b>Lanjutan 
            Hasil Batch...</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━';
        }
        current += '\n' + lines[i];
    }
    messages.push(current); for (const text of messages) { const ok = await 
        sendText(bot.token, chatId, text); if (!ok) sentOk = false;
    }
    return sentOk;
}
// FITUR BARU SELESAI DI SINI
function listBots() { return loadBots().map((b) => ({ id: b.id, name: b.name, tokenMasked: 
        maskToken(b.token), ownerId: b.ownerId, me: b.me || null, status: b.status, error: 
        b.error || null, createdAt: b.createdAt, startedAt: b.startedAt || null,
    }));
}
/** * Inisialisasi saat server start: jalankan semua bot berstatus online. * Idempotent — 
 aman dipanggil ulang saat HMR reload. */
function initTelegramBots() { if (registry.inited) return; registry.inited = true; const 
    bots = loadBots(); bots.forEach((b) => {
        if (b.status === 'online' && !registry.runners.has(b.id)) { startBotRunner(b);
        }
    });
    console.log('[TELEGRAM] Bot manager siap (' + bots.length + ' bot terdaftar, ' + 
    bots.filter((b) => b.status === 'online').length + ' online).');
}
export { deployBot, stopBot, startBot, restartBot, removeBot, listBots, validateToken, 
    initTelegramBots, notifyBulkResult, isBotOwnedBy,
};
