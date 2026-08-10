/**
 * Layanan AM: kirim magic link, klaim premium, auto generator (bulk), & demo Netflix.
 * Pindahan verbatim dari server.js monolit — terpisah tapi terintegrasi.
 */
import AMAuth from '../../services/auth.js';
import { runBulk, closeBrowser, buildEmailList } from '../../services/bulk.js';
import { getUsers, saveUsers, readJSON, writeJSON, newId, nowISO, fmtDateTime, randomKey, generateOrderId, addLog, addActivationLog } from './store.js';
import { canUseGenerator } from './auth.js';
import { notifyBulkResult } from './telegram.js';

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

/* Domain yang TERBUKTI berhasil di generator.email (dari data aktivasi sukses
   nyata: softbank.id 36x, 1win.life 12x, dst). Mode domain 'random' memakai
   daftar ini — bukan 154 domain penuh yang banyak sudah mati (memicu
   Navigation timeout di inbox). Daftar sengaja dijaga hanya yang terbukti. */
const GENEMAIL_VERIFIED_DOMAINS = [
    'softbank.id', '1win.life', 'jagomail.com', 'gmail-xsniper.site',
    'bwmyga.com', 'copawoke.com', 'mfeva.com', 'kedaiqq.com', 'gocoiny.com',
    'lnovic.com', 'gmeenramy.com',
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
    // Weighted: softbank.id & 1win.life paling sering sukses (36x & 12x) —
    // muncul 2x di pool agar probabilitasnya lebih tinggi saat random.
    const randomPool = [];
    GENEMAIL_VERIFIED_DOMAINS.forEach(function (d) {
        randomPool.push(d);
        if (d === 'softbank.id' || d === '1win.life') randomPool.push(d);
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


export { sendLink, claimPremium, GENEMAIL_DOMAINS, GENEMAIL_VERIFIED_DOMAINS, getActiveBatch, updateBatch, startBatch, startBatchWorker, progressBatch, serializeBatch, generateNetflixDemoToken };
