/**
 * Layanan AM: kirim magic link, klaim premium, auto generator (bulk), & demo Netflix.
 * Pindahan verbatim dari server.js monolit — terpisah tapi terintegrasi.
 */
 
import net from 'net';
import tls from 'tls';
import zlib from 'zlib';
import crypto from 'crypto';
import { URL } from 'url';

import AMAuth from '../../services/auth.js';
import { runBulk, closeBrowser, buildEmailList } from '../../services/bulk.js';
import { getUsers, saveUsers, readJSON, writeJSON, newId, nowISO, fmtDateTime, randomKey, generateOrderId, addLog, addActivationLog } from './store.js';
import { canUseGenerator, ensureDailyUserCredits } from './auth.js';
import { notifyBulkResult } from './telegram.js';

async function sendLink(user, email) {
    const users = getUsers();
    // Reset kredit harian (lazy) sebelum pengecekan/penotongan.
    if (ensureDailyUserCredits(user)) {
        users[user.username] = user;
        saveUsers(users);
    }

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
    const orderId = premiumResult.orderId || generateOrderId();
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

    addActivationLog({ operator: user.username, email: email, status: 'success', note: 'Licence Active', createdAt: fmtDateTime() });
    addLog('[' + user.username + '] Aktivasi premium sukses untuk ' + email + ' (codeorder: ' + premiumResult.codeorder + ')');

    return { success: true, message: 'Premium berhasil diaktifkan! Code order: ' + premiumResult.codeorder, codeorder: premiumResult.codeorder, orderId: orderId };
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

/* Domain yang TERBUKTI berhasil di generator.email (dari data aktivasi sukses
   nyata: softbank.id 36x, 1win.life 12x, dst). Mode domain 'random' memakai
   daftar ini — bukan 154 domain penuh yang banyak sudah mati (memicu
   Navigation timeout di inbox). Daftar sengaja dijaga hanya yang terbukti. */
const GENEMAIL_VERIFIED_DOMAINS = [
    'softbank.id', '1win.life', 'jagomail.com', 'gmail-xsniper.site',
    'bwmyga.com', 'mfeva.com', 'kedaiqq.com', 'gocoiny.com',
    'lnovic.com', 'gmeenramy.com',
];

/* Domain "jagoan" — paling sering sukses dari data aktivasi nyata
   (softbank.id 36x, 1win.life 12x). Mode domain 'random' memakai HANYA
   daftar ini agar batch tidak gagal di domain yang fluktuatif (mis. lnovic.com). */
const GENEMAIL_JAGOAN_DOMAINS = [
    'softbank.id', '1win.life', 'jagoanmail.com',
];

/* ---- Pelacakan worker batch ----------------
 * Disimpan di globalThis agar tetap akurat saat HMR reload (modul am.js
 * dibuat ulang, tapi worker lama masih berjalan di background).
 * - markWorkerActive  : dipanggil saat worker mulai
 * - markWorkerPing    : dipanggil tiap ada progress (log/hasil) = heartbeat
 * - workerAliveFor    : true bila worker benar-benar hidup (id sama + heartbeat < 3 menit)
 * - markWorkerInactive: hanya membersihkan bila id cocok — mencegah worker lama
 *   (yang selesai belakangan) menghapus registry milik batch baru.
 */
function markWorkerActive(batchId) {
    globalThis.__amBatchWorker = { id: batchId, aliveAt: Date.now() };
}
function markWorkerPing() {
    if (globalThis.__amBatchWorker) globalThis.__amBatchWorker.aliveAt = Date.now();
}
function markWorkerInactive(batchId) {
    const w = globalThis.__amBatchWorker;
    if (!batchId || (w && w.id === batchId)) globalThis.__amBatchWorker = null;
}
function workerAliveFor(batchId) {
    const w = globalThis.__amBatchWorker;
    if (!w || w.id !== batchId) return false;
    return Date.now() - w.aliveAt < 3 * 60 * 1000;
}

function getActiveBatch() {
    return readJSON('batch', null);
}

function updateBatch(mutator) {
    const batch = readJSON('batch', null);
    if (!batch) return;
    try { mutator(batch); } catch (e) { /* abaikan */ }
    writeJSON('batch', batch);
}

function startBatch(user, domain, count, prefix, notify) {
    const batch = getActiveBatch();
    if (batch && (batch.status === 'running' || batch.status === 'stalled')) {
        // Worker masih benar-benar hidup -> tolak (perilaku normal).
        if (workerAliveFor(batch.id)) {
            return { success: false, message: 'Masih ada batch yang berjalan. Selesaikan batch sebelumnya terlebih dahulu.' };
        }
        // Worker mati (crash/restart/kill) -> abort batch lama agar tidak
        // menggantung selamanya dan memblokir semua batch berikutnya.
        batch.status = 'aborted';
        batch.logs.push('[SYSTEM] Batch lama di-abort otomatis: worker tidak aktif saat batch baru diminta.');
        if (batch.results && batch.results.length) {
            const history = readJSON('history', []);
            batch.results.forEach(function (r) {
                history.push({
                    id: newId(), username: batch.operator, email: r.email,
                    orderId: generateOrderId(), status: r.status === 'success' ? 'success' : 'failed',
                    note: 'Auto generator (di-abort)', magicLink: r.verifyLink || '', createdAt: fmtDateTime(),
                });
            });
            writeJSON('history', history);
        }
        writeJSON('batch', batch);
        addLog('[' + (batch.operator || user.username) + '] Batch lama (' + batch.id + ') di-abort otomatis (worker mati, sisa ' + (batch.count - batch.done) + ' akun)');
        // Beri tahu chat Telegram yang meminta batch lama, bila ada.
        if (batch.notify && batch.notify.tgBotId) {
            notifyBulkResult(batch.notify.tgBotId, batch.notify.tgChatId, {
                status: 'aborted', domain: batch.domain, results: batch.results || [],
            }).catch(function (e) { console.error('[TELEGRAM] Gagal kirim notifikasi abort: ' + e.message); });
        }
        // Abort path tidak di-await karena startBatch harus sinkron (pembuatan batch baru).
    }
    count = Math.min(500, Math.max(1, parseInt(count, 10) || 5));
    // Domain: bila tidak dispesifikasi (kosong/random) → pilih acak dari daftar
    // domain TERVERIFIKASI aktif di generator.email (bukan 154 domain penuh
    // yang banyak mati) agar batch tidak gagal Navigation timeout.
    const reqDomain = String(domain || '').trim().toLowerCase();
    const isRandom = !reqDomain || reqDomain === 'random' || reqDomain === 'acak';
    // Mode random: pakai HANYA domain jagoan (softbank.id & 1win.life) yang
    // terbukti paling sering sukses. softbank.id diberi bobot lebih tinggi.
    const randomPool = [];
    GENEMAIL_JAGOAN_DOMAINS.forEach(function (d) {
        randomPool.push(d);
        if (d === 'softbank.id') randomPool.push(d);
    });
    const batchDomains = isRandom ? randomPool : [reqDomain];
    const newBatch = {
        id: newId(),
        operator: user.username,
        domain: isRandom ? 'random' : reqDomain,
        domains: batchDomains,
        count: count,
        prefix: prefix || '',
        done: 0,
        status: 'running',
        results: [],
        logs: ['[SYSTEM] Logger diinisialisasi...', '[SYSTEM] Batch dimulai oleh ' + user.username, '[SYSTEM] Target: ' + count + ' akun' + (isRandom ? ' (domain random)' : ' @' + reqDomain)],
        createdAt: nowISO(),
        startedAt: Date.now(),
        notify: (notify && notify.tgBotId) ? { tgBotId: String(notify.tgBotId), tgChatId: String(notify.tgChatId || '') } : null,
    };
    // Bangun daftar email SEKARANG supaya API bisa langsung mengembalikannya
    // ke user (response instan, gaya apiku) — worker akan memakai daftar ini.
    const emails = buildEmailList({ name: prefix, domains: batchDomains, count: count });
    newBatch.emails = emails;
    writeJSON('batch', newBatch);
    addLog('[' + user.username + '] Auto generator batch dimulai (' + count + ' akun @' + domain + ')');
    startBatchWorker(newBatch);
    return { success: true, message: 'Batch dimulai. Worker generator.email berjalan di background.', batch: newBatch, emails: emails };
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
    markWorkerActive(batch.id);
    runBulk({
        name: batch.prefix || 'am',
        domains: (batch.domains && batch.domains.length ? batch.domains : [batch.domain]),
        // Hanya kirim email yang BELUM diproses: saat resume (done > 0) jangan
        // mengulang email yang sudah selesai (runBulk mengiterasi semua opts.emails).
        emails: batch.emails && batch.emails.length ? batch.emails.slice(batch.done) : undefined,
        count: opts.count || remaining,
        startIndex: opts.startIndex || batch.done + 1,
        maxTries: 20,
        onLog: function (msg) {
            markWorkerPing();
            updateBatch(function (b) {
                if (b.id !== batch.id) return;
                b.logs.push('[' + fmtDateTime() + '] ' + msg);
                if (b.logs.length > 300) b.logs.splice(0, b.logs.length - 300);
            });
        },
        onResult: function (r, idx) {
            markWorkerPing();
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
        onDone: async function (results) {
            const ok = results.filter(function (r) { return r.status === 'success'; }).length;
            let notifyTarget = null;
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
                if (b.notify && b.notify.tgBotId) {
                    notifyTarget = { tgBotId: b.notify.tgBotId, tgChatId: b.notify.tgChatId, results: b.results || [], domain: b.domain, count: b.count };
                }
            });
            let tgNote = '';
            if (notifyTarget) {
                try {
                    const sent = await notifyBulkResult(notifyTarget.tgBotId, notifyTarget.tgChatId, {
                        status: 'completed', domain: notifyTarget.domain, count: notifyTarget.count, results: notifyTarget.results,
                    });
                    tgNote = sent ? ' — hasil dikirim ke Telegram' : ' — GAGAL kirim hasil ke Telegram';
                } catch (e) {
                    tgNote = ' — GAGAL kirim hasil ke Telegram (' + e.message + ')';
                }
            }
            addLog('[' + batch.operator + '] Auto generator batch selesai (' + ok + ' akun)' + tgNote);
            markWorkerInactive(batch.id);
        },
    }).catch(async function (e) {
        let notifyTarget = null;
        updateBatch(function (b) {
            if (b.id !== batch.id) return;
            b.status = 'failed';
            b.logs.push('[SYSTEM] Batch gagal: ' + e.message);
            if (b.notify && b.notify.tgBotId) {
                notifyTarget = { tgBotId: b.notify.tgBotId, tgChatId: b.notify.tgChatId, results: b.results || [], domain: b.domain };
            }
        });
        let tgNote = '';
        if (notifyTarget) {
            try {
                const sent = await notifyBulkResult(notifyTarget.tgBotId, notifyTarget.tgChatId, {
                    status: 'failed', domain: notifyTarget.domain, error: e.message, results: notifyTarget.results,
                });
                tgNote = sent ? ' (notifikasi gagal terkirim)' : ' (notifikasi gagal gagal terkirim)';
            } catch (e2) {
                tgNote = ' (notifikasi gagal terkirim: ' + e2.message + ')';
            }
        }
        addLog('[' + batch.operator + '] Auto generator batch gagal: ' + e.message + tgNote);
        markWorkerInactive(batch.id);
        closeBrowser().catch(function () { /* abaikan */ });
    });
}

function progressBatch() {
    const batch = getActiveBatch();
    if (!batch || batch.status === 'completed' || batch.status === 'failed') return;
    if (batch.status === 'running' && !workerAliveFor(batch.id)) {
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
        emails: batch.emails || [],
    };
}


/* ============================== NFTOKEN GENERATOR ============================== */

const NFT_SITE = process.env.NFT_SITE || 'http://nftools.aroshi.my.id';
const TARGET_HOST = new URL(NFT_SITE).hostname;
const TARGET_PORT = Number(new URL(NFT_SITE).port || 80);
const PROXY_SOURCES = [
    'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=2000&count=100',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
];

class HttpError extends Error {
    constructor(status, data) {
        super(`HTTP ${status}`);
        this.status = status; this.data = data;
    }
}
class RotateError extends Error {}

function parseProxyLine(line) {
    line = line.trim();
    if (!line) return null;
    if (line.startsWith('http://') || line.startsWith('https://')) {
        try {
            const u = new URL(line);
            const p = { host: u.hostname, port: Number(u.port || 80), https: u.protocol === 'https:' };
            if (u.username) p.auth = Buffer.from(`${u.username}:${u.password}`).toString('base64');
            return p;
        } catch (e) { return null; }
    }
    const m = line.match(/^([^:]+):(\d+)(?::([^:]+):([^:]+))?$/);
    if (!m) return null;
    const p = { host: m[1], port: Number(m[2]) };
    if (m[3]) p.auth = Buffer.from(`${m[3]}:${m[4]}`).toString('base64');
    return p;
}

async function fetchProxyLines() {
    let lines = [];
    for (const src of PROXY_SOURCES) {
        try {
            const r = await fetch(src, { signal: AbortSignal.timeout(10000) });
            lines.push(...(await r.text()).split(/\r?\n/));
        } catch (e) { /* skip */ }
    }
    return lines;
}

class ProxyPool {
    constructor(list) {
        this.list = list; this.idx = 0;
        this.valid = []; this.validIdx = 0;
        this.fails = new Map();
    }
    nextRaw() {
        for (let i = 0; i < this.list.length; i++) {
            const p = this.list[this.idx % this.list.length];
            this.idx++;
            if (!this.dead(p)) return p;
        }
        return null;
    }
    nextValid() {
        for (let i = 0; i < this.valid.length; i++) {
            const v = this.valid[this.validIdx % this.valid.length];
            this.validIdx++;
            if (!v.used) return v;
        }
        return null;
    }
    dead(p) { return (this.fails.get(p.host + ':' + p.port) || 0) >= 2; }
    fail(p) {
        const k = p.host + ':' + p.port;
        this.fails.set(k, (this.fails.get(k) || 0) + 1);
    }
    reuse(p) { this.fails.set(p.host + ':' + p.port, 0); }
    addValid(p, session) { this.valid.push({ proxy: p, session, used: false }); }
    aliveValid() { return this.valid.filter(v => !v.used).length; }
}

function tunnel(proxy, host, port, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        let sock = proxy.https 
            ? tls.connect({ host: proxy.host, port: proxy.port, servername: proxy.host, rejectUnauthorized: false })
            : net.connect({ host: proxy.host, port: proxy.port });
        
        const timer = setTimeout(() => { sock.destroy(); reject(new RotateError('tunnel timeout')); }, timeoutMs);
        let buf = ''; let settled = false;
        
        const fail = (e) => { if (settled) return; settled = true; clearTimeout(timer); sock.destroy(); reject(e); };
        sock.on('data', d => {
            buf += d.toString('latin1');
            const i = buf.indexOf('\r\n\r\n');
            if (i === -1) { if (buf.length > 8192) fail(new RotateError('bad response')); return; }
            const status = parseInt(buf.split('\r\n')[0].split(' ')[1], 10);
            if (status === 200) {
                if (settled) return; settled = true;
                clearTimeout(timer); sock.removeAllListeners('data'); resolve(sock);
            } else fail(new RotateError(`CONNECT ${status}`));
        });
        sock.on('error', e => fail(new RotateError(e.message)));
        const auth = proxy.auth ? `Proxy-Authorization: Basic ${proxy.auth}\r\n` : '';
        sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
    });
}

function solvePow(challenge, prefix = '0000') {
    for (let n = 0; n < 1000000; n++) {
        if (crypto.createHash('sha256').update(challenge + n).digest('hex').startsWith(prefix)) return `${challenge}:${n}`;
    }
    return null;
}

async function requestAPI({ proxy, method, path, body, sessionToken, powProof, timeoutMs = 15000 }) {
    const sock = await tunnel(proxy, TARGET_HOST, TARGET_PORT);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { sock.destroy(); reject(new RotateError('request timeout')); }, timeoutMs);
        let buf = Buffer.alloc(0); let headDone = false, status = 0, remain = 0, finished = false;
        
        const fail = e => { if (finished) return; finished = true; clearTimeout(timer); sock.destroy(); reject(e); };
        sock.on('data', d => {
            buf = Buffer.concat([buf, d]);
            if (!headDone) {
                const i = buf.indexOf('\r\n\r\n');
                if (i === -1) return;
                headDone = true;
                const headText = buf.slice(0, i).toString('latin1');
                status = parseInt(headText.split('\r\n')[0].split(' ')[1], 10);
                const lenMatch = headText.match(/content-length:\s*(\d+)/i);
                remain = lenMatch ? parseInt(lenMatch[1], 10) : 0;
                buf = buf.slice(i + 4);
            }
            if (headDone && buf.length >= remain) {
                if (finished) return; finished = true; clearTimeout(timer); sock.destroy();
                try {
                    const text = buf.slice(0, remain).toString('utf8');
                    const parsed = JSON.parse(text);
                    if (status >= 400) reject(new HttpError(status, parsed));
                    else resolve(parsed);
                } catch (e) { reject(e); }
            }
        });
        sock.on('error', fail);
        sock.on('close', () => fail(new RotateError('conn closed')));
        
        let req = `${method} ${path} HTTP/1.1\r\nHost: ${TARGET_HOST}:${TARGET_PORT}\r\nConnection: close\r\nContent-Type: application/json\r\n`;
        if (sessionToken) req += `X-NFToken-Session: ${sessionToken}\r\n`;
        if (powProof) req += `X-PoW-Proof: ${powProof}\r\n`;
        const payload = body ? Buffer.from(JSON.stringify(body)) : null;
        if (payload) req += `Content-Length: ${payload.length}\r\n`;
        sock.write(req + '\r\n');
        if (payload) sock.write(payload);
    });
}

async function prepareProxyPool() {
    if (!globalThis.__nftPool) {
        const lines = await fetchProxyLines();
        const list = [...new Set(lines.map(parseProxyLine).filter(Boolean))];
        globalThis.__nftPool = new ProxyPool(list);
    }
    return globalThis.__nftPool;
}

/**
 * Service API terintegrasi untuk generate NFToken
 * @param {string} plan 'premium', 'standard', atau 'basic'
 * @param {number} count Jumlah token
 */
async function generateNFToken(plan = 'premium', count = 1) {
    try {
        const pool = await prepareProxyPool();
        const results = [];
        let attempts = 0;

        while (results.length < count && attempts < count * 5) {
            attempts++;
            
            // Validasi & isi pool valid jika kurang
            if (pool.aliveValid() < 1) {
                const workers = Array.from({ length: 15 }, async () => {
                    const p = pool.nextRaw();
                    if (!p || pool.aliveValid() >= 2) return;
                    try {
                        const s = await tunnel(p, TARGET_HOST, TARGET_PORT, 5000);
                        s.destroy();
                        const d = await requestAPI({ proxy: p, method: 'POST', path: '/api/session', body: {} });
                        if (d.success && d.token) pool.addValid(p, d);
                    } catch (e) { pool.fail(p); }
                });
                await Promise.all(workers);
            }

            const v = pool.nextValid();
            if (!v) {
                globalThis.__nftPool = null; // Reset pool jika macet
                continue;
            }

            try {
                let d;
                try {
                    d = await requestAPI({ proxy: v.proxy, method: 'POST', path: '/api/random', body: { plan }, sessionToken: v.session.token });
                } catch (e) {
                    if (e instanceof HttpError && e.status === 403 && e.data && e.data.powChallenge) {
                        const proof = solvePow(e.data.powChallenge);
                        if (!proof) throw new Error('PoW gagal');
                        d = await requestAPI({ proxy: v.proxy, method: 'POST', path: '/api/random', body: { plan }, sessionToken: v.session.token, powProof: proof });
                    } else throw e;
                }

                if (d.success && d.url) {
                    results.push(d);
                    pool.reuse(v.proxy);
                } else if (d.error && /Limit harian/i.test(d.error)) {
                    break; // Limit server
                }
            } catch (e) {
                if (e instanceof RotateError || /Session/i.test(String(e.data))) pool.fail(v.proxy);
                v.used = true;
            }
        }

        if (results.length === 0) {
            return { success: false, message: 'Gagal generate token. Proxy limit/habis, silakan coba lagi.' };
        }

        addLog(`[SYSTEM] Generate NFToken sukses: ${results.length} token plan ${plan}`);
        return { success: true, count: results.length, results };

    } catch (error) {
        addLog(`[SYSTEM] NFToken Generator Error: ${error.message}`);
        return { success: false, message: error.message };
    }
}


export { 
    sendLink, 
    claimPremium, 
    GENEMAIL_DOMAINS,
    GENEMAIL_VERIFIED_DOMAINS,
    GENEMAIL_JAGOAN_DOMAINS,
    getActiveBatch, 
    updateBatch, 
    startBatch, 
    startBatchWorker, 
    progressBatch, 
    serializeBatch, 
    generateNFToken // <--- Terupdate
};

//export { sendLink, claimPremium, GENEMAIL_DOMAINS, GENEMAIL_VERIFIED_DOMAINS, getActiveBatch, updateBatch, startBatch, startBatchWorker, progressBatch, serializeBatch, generateNetflixDemoToken };
