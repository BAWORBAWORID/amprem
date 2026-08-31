/* services/netflix-auth-check.js — Check cookie via nftools.aroshi.my.id/nftoken checker (Puppeteer, no proxy)
 * Memanfaatkan fungsi browser asli halaman (getSession -> PoW SHA-256) lalu isi form checker.
 *
 * CLI:
 *   node services/netflix-auth-check.js '<cookie>' [--headed] [--timeout-ms <ms>]
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BASE = process.env.NFT_AUTH_BASE || 'http://nftools.aroshi.my.id';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let xvfbProc = null;
async function ensureDisplay() {
    if (process.env.DISPLAY || xvfbProc) return;
    try {
        xvfbProc = spawn('Xvfb', [':99', '-screen', '0', '1280x800x24'], { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 1000));
        process.env.DISPLAY = ':99';
    } catch (e) {}
}
process.on('exit', () => { if (xvfbProc) try { xvfbProc.kill(); } catch (e) {} });

async function stealth(page) {
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = window.chrome || { runtime: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        const getParam = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (p) {
            if (p === 37445) return 'Google Inc. (Intel)';
            if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            return getParam.apply(this, [p]);
        };
    });
}

export async function checkCookie(cookie, opts = {}) {
    const timeoutMs = opts.timeoutMs || 120000;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfck-' + Date.now().toString(36) + '-'));
    let browser;
    try {
        await ensureDisplay();
        browser = await puppeteer.launch({ headless: false, executablePath: CHROME_PATH,
            args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--window-size=1280,900'],
            userDataDir: tmpDir });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        await stealth(page);

        await page.goto(`${BASE}/nftoken`, { waitUntil: 'load', timeout: 60000 });
        // tunggu CF challenge (jika ada) selesai & elemen form muncul
        await page.waitForSelector('#checkInput', { timeout: 30000 }).catch(() => {});

        const deadline = Date.now() + timeoutMs;
        const log = (m) => console.log('[...]', m);

        // set cookie di input
        const setResult = await page.evaluate((c) => {
            const el = document.getElementById('checkInput');
            if (!el) return 'NO_INPUT';
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(el, c);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return 'SET';
        }, cookie);
        log('checkInput: ' + setResult);

        // ambil + jalankan session (PoW browser asli) via evaluate
        let sessionInfo = null;
        try {
            sessionInfo = await page.evaluate(async () => {
                async function waitForSession() {
                    // panggil getSession global bila tersedia
                    if (typeof window.getSession === 'function') {
                        const prevTok = window.sessionToken || null;
                        await window.getSession();
                        return { hasSession: !!window.sessionToken, prevTok: prevTok || null, nonce: null };
                    }
                    return { hasSession: false, reason: 'no getSession' };
                }
                return await waitForSession();
            });
        } catch (e) { log('session eval error: ' + e.message); }
        log('session: ' + JSON.stringify(sessionInfo));

        let detail = null;
        let done = false;
        while (Date.now() < deadline && !done) {
            await new Promise(r => setTimeout(r, 1500));
            try {
                const r = await page.evaluate(async () => {
                    // Tunggu session terbentuk (PoW diselesaikan oleh kode asli halaman
                    // saat getSession dipanggil; flag sessionToken ada di closure, jadi
                    // kita deteksi via hasil fetch saja).
                    // Coba panggil getSession bila belum ada session (idempotent di halaman).
                    if (typeof window.getSession === 'function') {
                        const t0 = Date.now();
                        const btn = document.querySelector('#panel-check .btn-generate');
                        const before = btn ? btn.textContent : '';
                        await window.getSession();
                        const after = btn ? btn.textContent : '';
                        // hanya lakukan check bila tombol belum dalam state CHECKING
                        if (typeof window.checkCookie === 'function' && !/CHECKING/i.test(after)) {
                            await window.checkCookie();
                        }
                        void t0;
                    } else if (typeof window.checkCookie === 'function') {
                        await window.checkCookie();
                    }
                    const el = document.getElementById('checkResult');
                    const vis = el ? getComputedStyle(el).display : '';
                    const bubble = document.getElementById('checkStatus') ? document.getElementById('checkStatus').textContent : '';
                    const badge = document.getElementById('checkBadge') ? document.getElementById('checkBadge').textContent : '';
                    // hasil dianggap ada bila badge LIVE/DEAD muncul
                    const hasBadge = /LIVE|DEAD/i.test(badge);
                    return {
                        status: bubble,
                        badge,
                        plan: document.getElementById('checkPlan') ? document.getElementById('checkPlan').textContent : '',
                        quality: document.getElementById('checkQuality') ? document.getElementById('checkQuality').textContent : '',
                        visible: vis !== 'none',
                        started: !!window.sessionToken || hasBadge || bubble !== '...',
                    };
                }).catch(() => null);
                if (r && r.visible && /LIVE|DEAD/i.test(r.badge)) {
                    detail = r; done = true;
                }
            } catch (e) { log('loop err: ' + e.message); }
        }

        if (detail && detail.visible) {
            return { ok: true, status: detail.status, plan: detail.plan, expires: detail.quality, country: detail.country, badge: detail.badge };
        }
        if (detail && !detail.visible) {
            return { ok: false, error: 'form memuat tapi belum ada hasil — blokir/belum selesai', detail };
        }
        return { ok: false, error: 'timeout: session/check tidak selesai (CF bot-management kemungkinan tetap memblokir)' };
    } catch (e) {
        return { ok: false, error: (e && e.message) ? e.message : String(e) };
    } finally {
        if (browser) { try { await browser.close(); } catch (e) {} }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
}

const isMain = process.argv[1] && process.argv[1].endsWith('netflix-auth-check.js');
if (isMain) {
    const a = process.argv.slice(2);
    const args = { timeoutMs: 120000 };
    const cookieArgs = [];
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        if (x === '--headed') args.headed = true;
        else if (x === '--timeout-ms') args.timeoutMs = parseInt(a[++i], 10) || 120000;
        else cookieArgs.push(x);
    }
    const cookie = cookieArgs.join(' ').trim();
    if (!cookie) { console.log('Usage: node services/netflix-auth-check.js "<cookie>" [--headed] [--timeout-ms ms]'); process.exit(1); }
    checkCookie(cookie, args).then(r => {
        console.log('\n=== HASIL ===');
        console.log(JSON.stringify(r, null, 2));
        process.exit(r.ok ? 0 : 1);
    }).catch(e => { console.error('[!]', e.message); process.exit(1); });
}