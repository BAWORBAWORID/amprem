/**
 * services/bulk.js — Bulk Alight Motion Premium via generator.email
 *
 * Adaptasi dari /root/apiku/api/am/bulk.js untuk proyek ini:
 *  - Puppeteer-core (Chrome dari cache /root/.cache/puppeteer)
 *  - AMAuth lokal (services/auth.js) untuk kirim magic link + verifikasi + aktivasi
 *  - Custom name (prefix) + list domain + baca inbox generator.email
 *
 * Alur per akun:
 *  1. Buka inbox generator.email untuk email yang dibuat
 *  2. Kirim magic link verifikasi (sendMagicLink)
 *  3. Polling reload inbox sampai link verifikasi muncul (findVerifyLink)
 *  4. Verifikasi + aktivasi premium (verifyAndFetchProfile + applyPremium)
 */

import puppeteer from 'puppeteer-core';
import { existsSync } from 'fs';
import AMAuth from './auth.js';

/* ---------- Konfigurasi ---------- */

const DEFAULT_DOMAINS = ['jagomail.com', 'softbank.id'];

const CHROME_CANDIDATES = [
    process.env.CHROME_PATH,
    '/root/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome',
    '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome',
    '/root/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome',
].filter(Boolean);

function resolveChrome() {
    for (const p of CHROME_CANDIDATES) {
        try {
            if (p && existsSync(p)) return p;
        } catch (e) { /* lanjut */ }
    }
    throw new Error('Chrome tidak ditemukan. Set env CHROME_PATH=<path chrome>.');
}

let browserInstance = null;
let browserPromise = null;

async function getBrowser() {
    // Chrome bisa mati/stale (mis. setelah batch sebelumnya atau proses di-kill).
    // Selalu cek koneksi — kalau putus, relaunch agar batch berikutnya tidak gagal
    // dengan 'Connection closed'. Single-flight: panggilan paralel memakai 1 instance.
    if (browserPromise) return browserPromise;
    browserPromise = (async () => {
        if (browserInstance && browserInstance.isConnected && browserInstance.isConnected()) return browserInstance;
        if (browserInstance) {
            try { await browserInstance.close(); } catch (e) { /* abaikan */ }
            browserInstance = null;
        }
        browserInstance = await puppeteer.launch({
            executablePath: resolveChrome(),
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
        });
        return browserInstance;
    })();
    try {
        return await browserPromise;
    } finally {
        browserPromise = null;
    }
}

export async function closeBrowser() {
    if (browserInstance) {
        try { await browserInstance.close(); } catch (e) { /* abaikan */ }
        browserInstance = null;
    }
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/* ---------- Generator email ---------- */

function randomLocalPart(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

/**
 * Bangun daftar email untuk batch.
 * Nama (local-part) & domain dipilih ACAK agar tidak bertabrakan dengan
 * email lama di inbox publik generator.email (inbox persistent antar batch).
 *
 * opts:
 *   name     -> prefix custom (misal "codex"), opsional. {n}/{n2} dibuang.
 *   domains  -> daftar domain; dipilih acak per email. Default DEFAULT_DOMAINS.
 *   count    -> jumlah email
 *   startIndex -> index awal (dipakai untuk hitung jumlah, bukan untuk nama)
 */
export function buildEmailList(opts) {
    // Prefix custom (buang placeholder nomor), bersihkan karakter aneh, max 12.
    const prefix = String(opts.name || '')
        .replace(/\{n\}/g, '').replace(/\{n2\}/g, '')
        .replace(/[^a-z0-9_.-]/gi, '')
        .slice(0, 12) || 'am';
    const domains = (opts.domains && opts.domains.length ? opts.domains : DEFAULT_DOMAINS)
        .map((d) => String(d).trim().toLowerCase())
        .filter(Boolean);
    const count = Math.min(500, Math.max(1, parseInt(opts.count, 10) || 1));
    const startIndex = Math.max(1, parseInt(opts.startIndex, 10) || 1);
    const end = startIndex + count - 1;
    const list = [];
    const seen = new Set();
    for (let i = startIndex; i <= end; i++) {
        let email = '';
        // Loop sampai dapat kombinasi nama+domain unik (anti-duplikat).
        for (let t = 0; t < 25; t++) {
            const name = prefix + randomLocalPart(7);
            const dom = domains[Math.floor(Math.random() * domains.length)];
            email = name + '@' + dom;
            if (!seen.has(email)) break;
        }
        seen.add(email);
        list.push(email);
    }
    return list;
}

/* ---------- Inbox ---------- */

async function openInbox(page, email) {
    const [user, dom] = email.split('@');
    const url = `https://generator.email/${dom}/${user}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // tunggu data email aktif ter-load (client-side render)
    for (let i = 0; i < 12; i++) {
        const ready = await page.evaluate(() => {
            const u = document.getElementById('userName');
            const d = document.getElementById('domainName2');
            return u && u.value && d && d.value;
        });
        if (ready) break;
        await sleep(1500);
    }
    await sleep(2000);
}

async function readInboxMessages(page) {
    return page.evaluate(() => {
        const items = [];
        const rows = document.querySelectorAll('#email-table .list-group-item');
        rows.forEach((row) => {
            const fromEl = row.querySelector('[class*="from_"]');
            const subjEl = row.querySelector('[class*="subject_"]');
            const timeEl = row.querySelector('[class*="time_"]');
            items.push({
                from: (fromEl && fromEl.textContent.trim()) || '',
                subject: (subjEl && subjEl.textContent.trim()) || '',
                time: (timeEl && timeEl.textContent.trim()) || '',
                text: row.textContent.trim().slice(0, 200),
            });
        });
        return items;
    });
}

/**
 * Kumpulkan SEMUA link verifikasi Alight Motion di inbox (bukan hanya yang pertama).
 * Inbox generator.email bersifat publik & persistent: email lama dengan oobCode yang
 * sudah terpakai/kadaluarsa masih tersimpan. Dengan mengumpulkan semua link, kita bisa
 * mencoba satu per satu sampai menemukan yang valid (baru dari kiriman terakhir).
 */
async function findAllVerifyLinks(page) {
    return page.evaluate(() => {
        const out = [];
        const isVerifyLink = (href) => {
            // Hanya link verifikasi Firebase AM (mengandung oobCode / firebaseapp.com) —
            // hindari link footer biasa (mis. alightcreative.com) yang sia-sia dicoba.
            return href && (href.indexOf('oobCode') !== -1 || href.indexOf('firebaseapp.com') !== -1) && out.indexOf(href) === -1;
        };
        const push = (href) => { if (isVerifyLink(href)) out.push(href); };
        document.querySelectorAll("a[href*='firebaseapp.com']").forEach((a) => push(a.href));
        document.querySelectorAll("a[href*='alight']").forEach((a) => push(a.href));
        const allText = document.body.innerText || '';
        const re = /https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s"<]+/g;
        let m;
        while ((m = re.exec(allText)) !== null) push(m[0]);
        return out;
    });
}

/* ---------- Proses satu akun ---------- */

async function processOne(email, opts) {
    const auth = new AMAuth();
    const result = {
        email,
        inboxUrl: `https://generator.email/${email}`,
        status: 'failed',
        messages: [],
    };

    let page = null;
    try {
        page = await (await getBrowser()).newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        // Retry anti-timeout: bila inbox domain awal gagal dibuka (domain mati /
        // generator.email fluktuatif), coba email alternatif dgn domain lain
        // dari daftar hingga ada yang berhasil (maks 3 kandidat).
        const prefix = String(opts.name || '').replace(/\{n\}/g, '').replace(/\{n2\}/g, '');
        const altDomains = (opts.domains && opts.domains.length ? opts.domains : DEFAULT_DOMAINS);
        const candidates = [email];
        for (let k = 0; k < 2; k++) {
            const dom = altDomains[Math.floor(Math.random() * altDomains.length)];
            candidates.push((prefix || 'am') + randomLocalPart(7) + '@' + dom);
        }
        let opened = null;
        for (const cand of candidates) {
            try {
                await openInbox(page, cand);
                opened = cand;
                break;
            } catch (e) {
                if (opts.onLog) opts.onLog(`inbox gagal ${cand}: ${String(e.message || e).slice(0, 60)}`);
            }
        }
        if (!opened) {
            result.error = 'inbox: semua domain tidak bisa dibuka';
            if (opts.onLog) opts.onLog(result.error);
            return result;
        }
        // Pakai email yang inbox-nya benar-benar terbuka.
        email = opened;
        result.email = opened;
        result.inboxUrl = `https://generator.email/${opened}`;
        if (opts.onLog) opts.onLog(`inbox opened: ${opened}`);

        const sendRes = await auth.sendMagicLink(email);
        if (!sendRes.success) {
            result.error = 'send: ' + (sendRes.error || 'gagal kirim');
            if (opts.onLog) opts.onLog(`send failed: ${result.error}`);
            return result;
        }
        if (opts.onLog) opts.onLog('magic link terkirim');

        // Polling inbox: kumpulkan semua link, coba verifikasi satu per satu.
        // Link lama/basi di inbox publik akan gagal (INVALID_OOB_CODE) — lewati,
        // lanjut ke link lain sampai ada yang valid (kiriman terbaru).
        const maxTries = opts.maxTries || 20;
        const tried = new Set();
        let verifyRes = null;
        for (let i = 0; i < maxTries; i++) {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(3500);
            const links = await findAllVerifyLinks(page);
            if (links.length && opts.onLog) opts.onLog(`ditemukan ${links.length} link, mencoba verifikasi...`);
            for (const link of links) {
                if (tried.has(link)) continue;
                tried.add(link);
                result.verifyLink = link;
                verifyRes = await auth.verifyAndFetchProfile(email, link);
                if (verifyRes.success) break;
                if (opts.onLog) opts.onLog(`link #${tried.size} gagal: ${String(verifyRes.error || '').slice(0, 70)}`);
                // Batasi total percobaan unik agar tidak memicu rate-limit Firebase
                // (TOO_MANY_ATTEMPTS) saat inbox publik penuh link basi.
                if (tried.size >= 15) break;
            }
            if (verifyRes && verifyRes.success) break;
            if (opts.onLog) opts.onLog(`belum ada link valid (putaran ${i + 1}/${maxTries}), reload inbox...`);
            await sleep(5000);
        }
        if (!verifyRes || !verifyRes.success) {
            result.error = 'verify: ' + (verifyRes ? (verifyRes.error || 'gagal verifikasi') : 'link verifikasi tidak ditemukan');
            if (opts.onLog) opts.onLog(`verify failed: ${result.error}`);
            return result;
        }
        result.verifyLink = verifyRes.link || result.verifyLink;
        if (opts.onLog) opts.onLog('verifikasi OK');

        const premiumRes = await auth.applyPremium(verifyRes.idToken);
        if (!premiumRes.success) {
            result.error = 'premium: ' + (premiumRes.error || 'gagal aktivasi');
            if (opts.onLog) opts.onLog(`premium failed: ${result.error}`);
            return result;
        }
        result.status = 'success';
        result.codeorder = premiumRes.codeorder;
        if (opts.onLog) opts.onLog(`PREMIUM AKTIF (codeorder ${premiumRes.codeorder})`);
    } catch (err) {
        result.status = 'error';
        result.error = err.message;
        if (opts.onLog) opts.onLog(`error: ${err.message}`);
        // Koneksi browser putus -> tutup instance agar batch berikutnya relaunch.
        // Cek langsung status koneksi (bukan substring pesan) karena pesan error
        // puppeteer bisa 'Protocol error ... Target closed' tanpa kata 'connection'.
        if (browserInstance && browserInstance.isConnected && !browserInstance.isConnected()) {
            try { await closeBrowser(); } catch (e) { /* abaikan */ }
        }
    } finally {
        if (page) { try { await page.close(); } catch (e) { /* abaikan */ } }
    }
    return result;
}

/* ---------- API ---------- */

/**
 * Jalankan bulk batch.
 * @param {object} opts { name, domains, count, maxTries, onLog, onResult, onDone }
 */
export async function runBulk(opts) {
    // Bila daftar email sudah dibuat saat batch dimulai (agar API bisa langsung
    // mengembalikan daftarnya ke user), pakai itu — jangan buat ulang supaya
    // email yang diproses sama persis dengan yang ditampilkan.
    const emails = opts.emails && opts.emails.length ? opts.emails : buildEmailList(opts);
    const results = [];
    const started = Date.now();

    if (opts.onLog) opts.onLog(`Batch: ${emails.length} email (${emails[0] || ''} ...)`);

    for (let i = 0; i < emails.length; i++) {
        if (opts.onLog) opts.onLog(`[${i + 1}/${emails.length}] ${emails[i]}`);
        let r;
        try {
            r = await processOne(emails[i], opts);
        } catch (err) {
            // Satu akun error tidak boleh membunuh seluruh batch.
            r = { email: emails[i], inboxUrl: `https://generator.email/${emails[i]}`, status: 'error', error: err.message, messages: [] };
            if (opts.onLog) opts.onLog(`error: ${err.message}`);
            try { await closeBrowser(); } catch (e) { /* abaikan */ }
        }
        results.push(r);
        if (opts.onResult) opts.onResult(r, i + 1, emails.length);
        await sleep(3000);
    }

    if (opts.onDone) opts.onDone(results);
    await closeBrowser();
    return {
        status: true,
        total: emails.length,
        success: results.filter((r) => r.status === 'success').length,
        failed: results.filter((r) => r.status !== 'success').length,
        durationMs: Date.now() - started,
        results,
    };
}

export default {
    name: 'AM Bulk (generator.email)',
    description: 'Bulk AlightMotion premium — auto generate email via generator.email, send AM verification, auto inbox detect + verify + activate',
    buildEmailList,
    runBulk,
    closeBrowser,
};
