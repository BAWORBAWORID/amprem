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

async function getBrowser() {
    if (browserInstance) return browserInstance;
    browserInstance = await puppeteer.launch({
        executablePath: resolveChrome(),
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    return browserInstance;
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

function renderName(template, i) {
    const s = String(i);
    return String(template).replace(/\{n\}/g, s).replace(/\{n2\}/g, s.padStart(2, '0'));
}

function normalizeTemplate(template) {
    const t = String(template || '');
    return t.includes('{n}') ? t : (t || 'am') + '{n}';
}

export function buildEmailList(opts) {
    const template = normalizeTemplate(opts.name || 'am{n}');
    const domains = (opts.domains && opts.domains.length ? opts.domains : DEFAULT_DOMAINS)
        .map((d) => String(d).trim().toLowerCase())
        .filter(Boolean);
    const count = Math.min(500, Math.max(1, parseInt(opts.count, 10) || 1));
    const startIndex = Math.max(1, parseInt(opts.startIndex, 10) || 1);
    const end = startIndex + count - 1;
    const list = [];
    for (let i = startIndex; i <= end; i++) {
        const dom = domains[(i - 1) % domains.length];
        list.push(renderName(template, i) + '@' + dom);
    }
    return list;
}

/* ---------- Inbox ---------- */

async function openInbox(page, email) {
    const [user, dom] = email.split('@');
    const url = `https://generator.email/${dom}/${user}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
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

/** Polling reload inbox sampai link verifikasi Alight Motion muncul. */
async function findVerifyLink(page, email, maxTries, onLog) {
    for (let i = 0; i < maxTries; i++) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3500);
        const link = await page.evaluate(() => {
            const a = document.querySelector("a[href*='alight-creative.firebaseapp.com']");
            if (a) return a.href;
            const a2 = document.querySelector("a[href*='firebaseapp.com']");
            if (a2) return a2.href;
            const a3 = document.querySelector("a[href*='alight']");
            if (a3) return a3.href;
            const allText = document.body.innerText || '';
            const m = allText.match(/https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s]+/);
            if (m) return m[0];
            return null;
        });
        if (link) return link;
        if (onLog) onLog(`waiting link ${i + 1}/${maxTries}...`);
        await sleep(5000);
    }
    return null;
}

/* ---------- Proses satu akun ---------- */

async function processOne(email, opts) {
    const auth = new AMAuth();
    const page = await (await getBrowser()).newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    const result = {
        email,
        inboxUrl: `https://generator.email/${email}`,
        status: 'failed',
        messages: [],
    };

    try {
        await openInbox(page, email);
        if (opts.onLog) opts.onLog(`inbox opened`);

        const sendRes = await auth.sendMagicLink(email);
        if (!sendRes.success) {
            result.error = 'send: ' + (sendRes.error || 'gagal kirim');
            if (opts.onLog) opts.onLog(`send failed: ${result.error}`);
            return result;
        }
        if (opts.onLog) opts.onLog('magic link terkirim');

        const link = await findVerifyLink(page, email, opts.maxTries || 20, opts.onLog);
        if (!link) {
            result.error = 'link verifikasi tidak ditemukan';
            if (opts.onLog) opts.onLog(result.error);
            return result;
        }
        result.verifyLink = link;
        if (opts.onLog) opts.onLog('link verifikasi DITEMUKAN');

        const verifyRes = await auth.verifyAndFetchProfile(email, link);
        if (!verifyRes.success) {
            result.error = 'verify: ' + (verifyRes.error || 'gagal verifikasi');
            if (opts.onLog) opts.onLog(`verify failed: ${result.error}`);
            return result;
        }
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
    } finally {
        try { await page.close(); } catch (e) { /* abaikan */ }
    }
    return result;
}

/* ---------- API ---------- */

/**
 * Jalankan bulk batch.
 * @param {object} opts { name, domains, count, maxTries, onLog, onResult, onDone }
 */
export async function runBulk(opts) {
    const emails = buildEmailList(opts);
    const results = [];
    const started = Date.now();

    if (opts.onLog) opts.onLog(`Batch: ${emails.length} email (${emails[0] || ''} ...)`);

    for (let i = 0; i < emails.length; i++) {
        if (opts.onLog) opts.onLog(`[${i + 1}/${emails.length}] ${emails[i]}`);
        const r = await processOne(emails[i], opts);
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
