require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- LOAD ENV VARIABLES ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const API_BASE_URL = process.env.API_BASE_URL;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];
const DB_PATH = path.join(__dirname, 'users_db.json');

// FITUR BARU MULAI DI SINI: Konfigurasi API Key & Header Request serta OWNER_IDS
const API_KEY = process.env.API_KEY;
const apiHeaders = { 'x-api-key': API_KEY };
const OWNER_IDS = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(',').map(id => parseInt(id.trim())) : ADMIN_IDS;
// FITUR BARU SELESAI DI SINI

if (!BOT_TOKEN) {
    console.error("❌ ERROR: BOT_TOKEN belum diatur di file .env!");
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- DATABASE FUNCTIONS ---
function loadDB() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            fs.writeFileSync(DB_PATH, JSON.stringify({}, null, 4));
        }
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (err) {
        console.error("Gagal membaca database:", err);
        return {};
    }
}

function saveDB(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 4));
    } catch (err) {
        console.error("Gagal menyimpan database:", err);
    }
}

// FITUR BARU MULAI DI SINI: Database & Fungsi Whitelist Grup
const GROUPS_DB_PATH = path.join(__dirname, 'groups_db.json');

function loadGroupsDB() {
    try {
        if (!fs.existsSync(GROUPS_DB_PATH)) {
            fs.writeFileSync(GROUPS_DB_PATH, JSON.stringify([], null, 4));
        }
        return JSON.parse(fs.readFileSync(GROUPS_DB_PATH, 'utf8'));
    } catch (err) {
        console.error("Gagal membaca database grup:", err);
        return [];
    }
}

function saveGroupsDB(data) {
    try {
        fs.writeFileSync(GROUPS_DB_PATH, JSON.stringify(data, null, 4));
    } catch (err) {
        console.error("Gagal menyimpan database grup:", err);
    }
}

function isGroupAllowed(chatId) {
    const groups = loadGroupsDB();
    return groups.includes(String(chatId));
}
// FITUR BARU SELESAI DI SINI

function getUserData(userId) {
    const db = loadDB();
    const id = String(userId);

    if (!db[id]) {
        db[id] = {
            role: ADMIN_IDS.includes(userId) ? 'ADMIN' : 'USER',
            credits: 20,
            exp: null
        };
        // FITUR BARU MULAI DI SINI: Inisialisasi Role OWNER jika ID terdaftar di OWNER_IDS
        if (OWNER_IDS.includes(userId)) {
            db[id].role = 'OWNER';
        }
        // FITUR BARU SELESAI DI SINI
        saveDB(db);
    }

    // FITUR BARU MULAI DI SINI: Deteksi otomatis penyesuaian Role OWNER
    if (OWNER_IDS.includes(userId) && db[id].role !== 'OWNER') {
        db[id].role = 'OWNER';
        saveDB(db);
    }
    // FITUR BARU SELESAI DI SINI

    const user = db[id];

    // FITUR BARU MULAI DI SINI: Buka Akses Role untuk Semua Pengguna (Semua Member Memiliki Akses Full)
    if (!OWNER_IDS.includes(userId) && !ADMIN_IDS.includes(userId)) {
        user.role = 'ADMIN';
    }
    // FITUR BARU SELESAI DI SINI

    // FITUR BARU MULAI DI SINI: Penyesuaian Role Khusus Owner Saja (Menghapus Peran Admin Terpisah)
    if (!OWNER_IDS.includes(userId)) {
        user.role = 'MEMBER';
    }
    // FITUR BARU SELESAI DI SINI

    // Auto Reset jika masa aktif role berakhir
    if (user.exp) {
        const today = new Date().toISOString().split('T')[0];
        if (today > user.exp) {
            user.role = 'USER';
            user.exp = null;
            user.credits = 20;
            saveDB(db);
        }
    }

    return user;
}

// --- COMMAND HANDLERS ---

// /start & /help
bot.onText(/\/(start|help)/, (msg) => {
    const chatId = msg.chat.id;

    // FITUR BARU MULAI DI SINI: Validasi Khusus Grup & Whitelist Grup
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        return bot.sendMessage(chatId, '❌ Bot ini **HANYA** dapat digunakan di dalam **Grup**!', { parse_mode: 'Markdown' });
    }
    if (!isGroupAllowed(chatId)) {
        return bot.sendMessage(chatId, '❌ Grup ini belum diizinkan menggunakan bot. Hubungi Owner untuk pendaftaran!', { parse_mode: 'Markdown' });
    }
    // FITUR BARU SELESAI DI SINI

    const user = getUserData(msg.from.id);

    const expText = user.exp ? `\n⏳ Expired: <code>${user.exp}</code>` : '';
    const creditText = user.role === 'USER' ? `\n💳 Kredit: <code>${user.credits}/50</code>` : '\n💳 Kredit: <code>Unlimited</code>';

    let text = `<b>=== STATUS AKUN ===</b>\n` +
               `🆔 ID: <code>${msg.from.id}</code>\n` +
               `👤 Role: <b>${user.role}</b>${creditText}${expText}\n\n` +
               `<b>=== FITUR PERINTAH ===</b>\n` +
               `• <code>/create &lt;email&gt;</code> - Single Create AM\n` +
               `• <code>/verif &lt;email&gt; &lt;link&gt;</code> - Verifikasi Link AM\n` +
               `• <code>/bulk &lt;jumlah&gt;</code> - Bulk Auto Generator (Max 500)\n`;

    if (user.role === 'ADMIN') {
        text += `\n<b>=== MENU ADMIN ===</b>\n` +
                `• <code>/addprem &lt;id&gt; &lt;hari&gt;</code> - Set Role Premium\n` +
                `• <code>/delprem &lt;id&gt;</code> - Reset User ke Free\n` +
                `• <code>/setrole &lt;id&gt; &lt;role&gt; [hari]</code> - Custom Role\n`;
    }

    // FITUR BARU MULAI DI SINI: Menu Navigasi Tambahan untuk Role OWNER serta Manajemen Grup
    if (user.role === 'OWNER' || OWNER_IDS.includes(msg.from.id)) {
        text += `\n<b>=== MENU MANAJEMEN OWNER ===</b>\n` +
                `• <code>/id</code> - Cek ID Grup\n` +
                `• <code>/addgroup &lt;chat_id&gt;</code> - Izinkan Grup\n` +
                `• <code>/delgroup &lt;chat_id&gt;</code> - Hapus Izin Grup\n` +
                `• <code>/listgroup</code> - Lihat Daftar Grup Whitelist\n`;
    }
    // FITUR BARU SELESAI DI SINI

    bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
});

// /create <email>
bot.onText(/\/create(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    // FITUR BARU MULAI DI SINI: Validasi Khusus Grup & Whitelist Grup
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        return bot.sendMessage(chatId, '❌ Bot ini **HANYA** dapat digunakan di dalam **Grup**!', { parse_mode: 'Markdown' });
    }
    if (!isGroupAllowed(chatId)) {
        return bot.sendMessage(chatId, '❌ Grup ini belum diizinkan menggunakan bot. Hubungi Owner!', { parse_mode: 'Markdown' });
    }
    // FITUR BARU SELESAI DI SINI

    const userId = msg.from.id;
    const user = getUserData(userId);
    const email = match[1]?.trim();

    if (!email) {
        return bot.sendMessage(chatId, '⚠️ Format salah!\nGunakan: <code>/create email@domain.com</code>', { parse_mode: 'HTML' });
    }

    if (user.role === 'USER' && user.credits <= 0) {
        return bot.sendMessage(chatId, '❌ Kredit harian/manual Anda telah habis (0/50). Silakan hubungi Owner untuk upgrade!');
    }

    bot.sendMessage(chatId, `⏳ Memproses pendaftaran email: <code>${email}</code>...`, { parse_mode: 'HTML' });

    try {
        // FITUR BARU MULAI DI SINI: Integrasi Endpoint /send-link dengan x-api-key
        const response = await axios.post(
            `${API_BASE_URL}/send-link`,
            { email: email },
            { headers: apiHeaders }
        );
        // FITUR BARU SELESAI DI SINI
        
        if (user.role === 'USER') {
            const db = loadDB();
            db[String(userId)].credits -= 1;
            saveDB(db);
        }

        const remaining = user.role === 'USER' ? loadDB()[String(userId)].credits : 'Unlimited';
        
        // FITUR BARU MULAI DI SINI: Menampilkan respon data dari API send-link
        const resMessage = response.data?.message || JSON.stringify(response.data);
        bot.sendMessage(chatId, `✅ <b>Berhasil Send Link AM!</b>\n✉️ Email: <code>${email}</code>\n📊 Sisa Kredit: <b>${remaining}</b>\n💬 Respon: <code>${resMessage}</code>`, { parse_mode: 'HTML' });
        // FITUR BARU SELESAI DI SINI
    } catch (error) {
        const errMessage = error.response?.data?.message || error.response?.data || error.message;
        bot.sendMessage(chatId, `❌ Gagal Create AM: ${typeof errMessage === 'object' ? JSON.stringify(errMessage) : errMessage}`);
    }
});

// /verif <email> <link>
bot.onText(/\/verif(?:\s+(\S+)\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    // FITUR BARU MULAI DI SINI: Validasi Khusus Grup & Whitelist Grup
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        return bot.sendMessage(chatId, '❌ Bot ini **HANYA** dapat digunakan di dalam **Grup**!', { parse_mode: 'Markdown' });
    }
    if (!isGroupAllowed(chatId)) {
        return bot.sendMessage(chatId, '❌ Grup ini belum diizinkan menggunakan bot. Hubungi Owner!', { parse_mode: 'Markdown' });
    }
    // FITUR BARU SELESAI DI SINI

    const user = getUserData(msg.from.id);

    // FITUR BARU MULAI DI SINI: Menambahkan Validasi Akses Role PREM, OWNER
    const allowedVerifRoles = ['PREM', 'PREMIUM', 'AUTOGEN', 'ADMIN', 'OWNER'];
    // FITUR BARU MULAI DI SINI: Membuka Akses Verif untuk Semua Member/Pengguna Grup
    allowedVerifRoles.push('MEMBER', 'USER');
    // FITUR BARU SELESAI DI SINI
    if (!allowedVerifRoles.includes(user.role) && !['PREMIUM', 'AUTOGEN', 'ADMIN'].includes(user.role)) {
        return bot.sendMessage(chatId, '❌ Fitur API Single Verif hanya untuk role <b>PREM</b>, <b>ADMIN</b>, atau <b>OWNER</b>.', { parse_mode: 'HTML' });
    }
    // FITUR BARU SELESAI DI SINI

    const email = match[1]?.trim();
    const link = match[2]?.trim();

    if (!email || !link) {
        return bot.sendMessage(chatId, '⚠️ Format salah!\nGunakan: <code>/verif email@domain.com https://link-verifikasi...</code>', { parse_mode: 'HTML' });
    }

    bot.sendMessage(chatId, `⏳ Memverifikasi email: <code>${email}</code>...`, { parse_mode: 'HTML' });

    try {
        // FITUR BARU MULAI DI SINI: Integrasi Endpoint /activate dengan payload magicLink & x-api-key
        const response = await axios.post(
            `${API_BASE_URL}/activate`,
            {
                email: email,
                magicLink: link
            },
            { headers: apiHeaders }
        );
        
        const resMessage = response.data?.message || JSON.stringify(response.data);
        bot.sendMessage(chatId, `✅ <b>Akun Berhasil Diverifikasi/Aktivasi!</b>\n✉️ Email: <code>${email}</code>\n💬 Respon: <code>${resMessage}</code>`, { parse_mode: 'HTML' });
        // FITUR BARU SELESAI DI SINI
    } catch (error) {
        const errMessage = error.response?.data?.message || error.response?.data || error.message;
        bot.sendMessage(chatId, `❌ Gagal Verifikasi: ${typeof errMessage === 'object' ? JSON.stringify(errMessage) : errMessage}`);
    }
});

// /bulk <jumlah>
bot.onText(/\/bulk(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    // FITUR BARU MULAI DI SINI: Validasi Khusus Grup & Whitelist Grup
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        return bot.sendMessage(chatId, '❌ Bot ini **HANYA** dapat digunakan di dalam **Grup**!', { parse_mode: 'Markdown' });
    }
    if (!isGroupAllowed(chatId)) {
        return bot.sendMessage(chatId, '❌ Grup ini belum diizinkan menggunakan bot. Hubungi Owner!', { parse_mode: 'Markdown' });
    }
    // FITUR BARU SELESAI DI SINI

    const user = getUserData(msg.from.id);

    // FITUR BARU MULAI DI SINI: Menambahkan Validasi Akses Bulk untuk Role PREM, ADMIN, OWNER
    const allowedBulkRoles = ['PREM', 'PREMIUM', 'AUTOGEN', 'ADMIN', 'OWNER'];
    // FITUR BARU MULAI DI SINI: Membuka Akses Bulk untuk Semua Member/Pengguna Grup
    allowedBulkRoles.push('MEMBER', 'USER');
    // FITUR BARU SELESAI DI SINI
    if (!allowedBulkRoles.includes(user.role) && !['AUTOGEN', 'ADMIN'].includes(user.role)) {
        return bot.sendMessage(chatId, '❌ Fitur Bulk Auto Generator hanya untuk role <b>PREM</b>, <b>ADMIN</b>, atau <b>OWNER</b>.', { parse_mode: 'HTML' });
    }
    // FITUR BARU SELESAI DI SINI

    const amount = parseInt(match[1]);

    if (isNaN(amount) || amount < 1 || amount > 500) {
        return bot.sendMessage(chatId, '⚠️ Format salah!\nGunakan: <code>/bulk 100</code> (Maksimal 500)', { parse_mode: 'HTML' });
    }

    bot.sendMessage(chatId, `⏳ Memproses bulk auto-generator sebanyak <b>${amount}</b> akun...`, { parse_mode: 'HTML' });

    try {
        // FITUR BARU MULAI DI SINI: Menyertakan header apiHeaders pada request bulk
        const response = await axios.post(`${API_BASE_URL}/bulk`, { count: amount }, { headers: apiHeaders });
        // FITUR BARU SELESAI DI SINI
        const resultText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);

        bot.sendMessage(chatId, `✅ <b>Berhasil Generate Bulk ${amount} Akun!</b>\n\n📄 Hasil:\n<code>${resultText.slice(0, 3500)}</code>`, { parse_mode: 'HTML' });
    } catch (error) {
        const errMessage = error.response?.data?.message || error.response?.data || error.message;
        bot.sendMessage(chatId, `❌ Gagal Generate Bulk: ${typeof errMessage === 'object' ? JSON.stringify(errMessage) : errMessage}`);
    }
});

// --- ADMIN / OWNER COMMANDS ---

// /addprem <id> <hari>
bot.onText(/\/addprem(?:\s+(\S+)\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;

    // FITUR BARU MULAI DI SINI: Validasi Khusus Owner Saja
    if (!OWNER_IDS.includes(msg.from.id)) return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus OWNER.');
    // FITUR BARU SELESAI DI SINI

    const user = getUserData(msg.from.id);

    // FITUR BARU MULAI DI SINI: Izin Eksekusi untuk Role OWNER dan ADMIN
    if (user.role !== 'ADMIN' && user.role !== 'OWNER' && !ADMIN_IDS.includes(msg.from.id) && !OWNER_IDS.includes(msg.from.id)) return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus Admin / Owner.');
    // FITUR BARU SELESAI DI SINI

    const targetId = match[1];
    const days = parseInt(match[2]);

    if (!targetId || isNaN(days)) {
        return bot.sendMessage(chatId, '⚠️ Format salah!\nGunakan: <code>/addprem <user_id> <jumlah_hari></code>', { parse_mode: 'HTML' });
    }

    const expDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const db = loadDB();

    // FITUR BARU MULAI DI SINI: Menyimpan Role sebagai PREM
    db[targetId] = { role: 'PREM', credits: 0, exp: expDate };
    // FITUR BARU SELESAI DI SINI
    saveDB(db);

    bot.sendMessage(chatId, `✅ Sukses menambahkan Role <b>PREM</b> ke ID <code>${targetId}</code> selama ${days} hari (Exp: ${expDate}).`, { parse_mode: 'HTML' });
});

// /delprem <id>
bot.onText(/\/delprem(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;

    // FITUR BARU MULAI DI SINI: Validasi Khusus Owner Saja
    if (!OWNER_IDS.includes(msg.from.id)) return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus OWNER.');
    // FITUR BARU SELESAI DI SINI

    const user = getUserData(msg.from.id);

    // FITUR BARU MULAI DI SINI: Izin Eksekusi untuk Role OWNER dan ADMIN
    if (user.role !== 'ADMIN' && user.role !== 'OWNER' && !ADMIN_IDS.includes(msg.from.id) && !OWNER_IDS.includes(msg.from.id)) return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus Admin / Owner.');
    // FITUR BARU SELESAI DI SINI

    const targetId = match[1]?.trim();
    if (!targetId) return bot.sendMessage(chatId, '⚠️ Format salah!\nGunakan: <code>/delprem <user_id></code>', { parse_mode: 'HTML' });

    const db = loadDB();
    if (db[targetId]) {
        db[targetId] = { role: 'USER', credits: 20, exp: null };
        saveDB(db);
        bot.sendMessage(chatId, `✅ User ID <code>${targetId}</code> berhasil di-reset ke Role <b>USER</b> (20 Kredit).`, { parse_mode: 'HTML' });
    } else {
        bot.sendMessage(chatId, '❌ ID User tidak ditemukan di database.');
    }
});

// /setrole <id> <role> [hari]
bot.onText(/\/setrole(?:\s+(\S+)\s+(\S+)(?:\s+(\d+))?)?/, (msg, match) => {
    const chatId = msg.chat.id;

    // FITUR BARU MULAI DI SINI: Validasi Khusus Owner Saja
    if (!OWNER_IDS.includes(msg.from.id)) return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus OWNER.');
    // FITUR BARU SELESAI DI SINI

    const user = getUserData(msg.from.id);

    // FITUR BARU MULAI DI SINI: Izin Eksekusi untuk Role OWNER dan ADMIN
    if (user.role !== 'ADMIN' && user.role !== 'OWNER' && !ADMIN_IDS.includes(msg.from.id) && !OWNER_IDS.includes(msg.from.id)) return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus Admin / Owner.');
    // FITUR BARU SELESAI DI SINI

    const targetId = match[1];
    const role = match[2]?.toUpperCase();
    const days = match[3] ? parseInt(match[3]) : null;

    // FITUR BARU MULAI DI SINI: Penambahan Pilihan Role PREM & OWNER
    const validRoles = ['USER', 'RESELLER', 'PREMIUM', 'AUTOGEN', 'ADMIN', 'PREM', 'OWNER'];
    if (!targetId || !validRoles.includes(role)) {
        return bot.sendMessage(chatId, '⚠️ Format salah!\nGunakan: <code>/setrole <user_id> <PREM|OWNER> [hari]</code>', { parse_mode: 'HTML' });
    }
    // FITUR BARU SELESAI DI SINI

    const expDate = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null;
    const db = loadDB();

    db[targetId] = {
        role: role,
        credits: role === 'USER' ? 50 : 0,
        exp: expDate
    };
    saveDB(db);

    bot.sendMessage(chatId, `✅ Role ID <code>${targetId}</code> berhasil diubah ke <b>${role}</b>${days ? ` selama ${days} hari.` : '.'}`, { parse_mode: 'HTML' });
});

// FITUR BARU MULAI DI SINI: Command Cek ID & Manajemen Whitelist Grup Khusus Owner

// 1. /id - Cek ID Chat / Grup Saat Ini
bot.onText(/\/id/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🆔 <b>ID Chat/Grup Ini:</b> <code>${chatId}</code>`, { parse_mode: 'HTML' });
});

// 2. /addgroup <chat_id> - Tambahkan Grup ke Whitelist
bot.onText(/\/addgroup(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;

    // FITUR BARU MULAI DI SINI: Validasi Khusus Owner Saja
    if (!OWNER_IDS.includes(msg.from.id)) return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus OWNER.');
    // FITUR BARU SELESAI DI SINI

    if (!ADMIN_IDS.includes(msg.from.id) && !OWNER_IDS.includes(msg.from.id)) {
        return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus Admin / Owner.');
    }

    const targetGroupId = match[1]?.trim();
    if (!targetGroupId) {
        return bot.sendMessage(chatId, '⚠️ Format salah!\nGunakan: <code>/addgroup <chat_id></code>', { parse_mode: 'HTML' });
    }

    const groups = loadGroupsDB();
    if (!groups.includes(targetGroupId)) {
        groups.push(targetGroupId);
        saveGroupsDB(groups);
        bot.sendMessage(chatId, `✅ Sukses menambahkan Grup ID <code>${targetGroupId}</code> ke Whitelist!`, { parse_mode: 'HTML' });
    } else {
        bot.sendMessage(chatId, `⚠️ Grup ID <code>${targetGroupId}</code> sudah terdaftar di Whitelist.`, { parse_mode: 'HTML' });
    }
});

// 3. /delgroup <chat_id> - Hapus Grup dari Whitelist
bot.onText(/\/delgroup(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;

    // FITUR BARU MULAI DI SINI: Validasi Khusus Owner Saja
    if (!OWNER_IDS.includes(msg.from.id)) return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus OWNER.');
    // FITUR BARU SELESAI DI SINI

    if (!ADMIN_IDS.includes(msg.from.id) && !OWNER_IDS.includes(msg.from.id)) {
        return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus Admin / Owner.');
    }

    const targetGroupId = match[1]?.trim();
    if (!targetGroupId) {
        return bot.sendMessage(chatId, '⚠️ Format salah!\nGunakan: <code>/delgroup <chat_id></code>', { parse_mode: 'HTML' });
    }

    let groups = loadGroupsDB();
    if (groups.includes(targetGroupId)) {
        groups = groups.filter(id => id !== targetGroupId);
        saveGroupsDB(groups);
        bot.sendMessage(chatId, `✅ Sukses menghapus Grup ID <code>${targetGroupId}</code> dari Whitelist!`, { parse_mode: 'HTML' });
    } else {
        bot.sendMessage(chatId, `❌ Grup ID <code>${targetGroupId}</code> tidak ditemukan di Whitelist.`, { parse_mode: 'HTML' });
    }
});

// 4. /listgroup - Tampilkan Seluruh Grup Whitelist
bot.onText(/\/listgroup/, (msg) => {
    const chatId = msg.chat.id;

    // FITUR BARU MULAI DI SINI: Validasi Khusus Owner Saja
    if (!OWNER_IDS.includes(msg.from.id)) return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus OWNER.');
    // FITUR BARU SELESAI DI SINI

    if (!ADMIN_IDS.includes(msg.from.id) && !OWNER_IDS.includes(msg.from.id)) {
        return bot.sendMessage(chatId, '❌ Akses Ditolak! Khusus Admin / Owner.');
    }

    const groups = loadGroupsDB();
    if (groups.length === 0) {
        return bot.sendMessage(chatId, 'ℹ️ Belum ada grup yang terdaftar di Whitelist.');
    }

    let text = '📋 <b>DAFTAR GRUP WHITELIST:</b>\n\n';
    groups.forEach((gId, index) => {
        text += `${index + 1}. <code>${gId}</code>\n`;
    });

    bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
});
// FITUR BARU SELESAI DI SINI

console.log('🚀 Bot Telegram AM Pro sedang berjalan...');