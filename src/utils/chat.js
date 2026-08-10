/**
 * Chat global (SSE), sensor kata kasar, rating & ulasan, dan transaksi.
 * Pindahan verbatim dari server.js monolit.
 */
import { readJSON, writeJSON, newId, fmtDateTime } from './store.js';

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


export { CHAT_CLIENTS, getChatMessages, broadcastChatEvent, broadcastChat, containsBadword, reviewStats, createTransaction };
