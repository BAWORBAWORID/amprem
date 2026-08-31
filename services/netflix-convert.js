/* services/netflix-convert.js — Convert cookie -> NFToken link via nftools.live/tools/convert
 * Turnstile memblokir IP DC, jadi pakai proxy rotasi + browser (Puppeteer).
 *
 * CLI:
 *   node services/netflix-convert.js '<cookie>' [opsi]
 * Opsi: --proxy-file <file> | --proxy "h:p,h:p" | --no-proxy | --headed | --timeout-ms <ms>
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import net from 'net';
import tls from 'tls';
import { URL } from 'url';

const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BASE = process.env.NFTV2_BASE || 'https://nftools.live';
const UA_DEFAULT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let xvfbProc = null;
async function ensureDisplay() {
    if (process.env.DISPLAY || xvfbProc) return;
    try {
        xvfbProc = spawn('Xvfb', [':99', '-screen', '0', '1280x800x24'], { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 1000));
        process.env.DISPLAY = ':99';
    } catch (e) { /* fallback */ }
}
process.on('exit', () => { if (xvfbProc) try { xvfbProc.kill(); } catch (e) {} });

const PROXY_SOURCES = [
    'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&count=80',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
];

function parseProxyLine(line) {
    line = String(line || '').trim();
    if (!line) return null;
    let u;
    try { u = new URL(/^https?:\/\//.test(line) ? line : 'http://' + line); } catch (e) { return null; }
    if (!u.hostname || !u.port) return null;
    const p = { server: 'http://' + u.hostname + ':' + u.port, host: u.hostname, port: Number(u.port) };
    if (u.username) p.auth = { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password || '') };
    return p;
}

async function fetchProxyLines() {
    const lines = [];
    for (const src of PROXY_SOURCES) {
        try {
            const r = await fetch(src, { signal: AbortSignal.timeout(20000) });
            lines.push(...(await r.text()).split(/\r?\n/));
        } catch (e) {}
    }
    const seen = new Set(); const out = [];
    for (const l of lines) { const p = parseProxyLine(l); if (p && !seen.has(p.server)) { seen.add(p.server); out.push(p); } }
    return out;
}

function proxyHealthy(proxy, timeoutMs = 8000) {
    return new Promise(resolve => {
        const u = new URL(BASE);
        const host = u.hostname, port = Number(u.port || 443);
        let sock, settled = false;
        const done = ok => { if (settled) return; settled = true; try { sock.destroy(); } catch (e) {} resolve(ok); };
        const timer = setTimeout(() => done(false), timeoutMs);
        sock = net.connect({ host: proxy.host, port: proxy.port });
        sock.on('error', () => { clearTimeout(timer); done(false); });
        sock.on('connect', () => { sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`); });
        let buf = '';
        sock.on('data', function onData(d) {
            buf += d.toString('latin1');
            if (buf.indexOf('\r\n\r\n') === -1) return;
            sock.removeListener('data', onData);
            if (!/^HTTP\/1\.[01] 200/.test(buf)) { clearTimeout(timer); return done(false); }
            const t = tls.connect({ socket: sock, servername: host, rejectUnauthorized: true }, () => { clearTimeout(timer); done(true); });
            t.on('error', () => { clearTimeout(timer); done(false); });
        });
    });
}

async function pickHealthyProxies(pool, want, conc = 10) {
    const healthy = [];
    const start = Date.now();
    const workers = Array.from({ length: Math.min(conc, pool.length) }, async () => {
        while (healthy.length < want && Date.now() - start < 90000 && pool.length) {
            const p = pool.shift(); if (!p) return;
            if (await proxyHealthy(p)) healthy.push(p);
        }
    });
    await Promise.all(workers);
    return healthy;
}

async function stealth(page) {
    await page.setUserAgent(UA_DEFAULT);
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

async function resolveResultLinks(page) {
    return page.evaluate(() => {
        const out = {};
        // cari data dari sessionStorage (pola nf_result_*)
        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k && k.indexOf('nf_result_') === 0) {
                    const v = JSON.parse(sessionStorage.getItem(k) || 'null');
                    if (v) out.storage = v;
                }
            }
        } catch (e) {}
        // cek elemen copy/link
        const body = document.body ? document.body.innerText : '';
        const links = Array.from(document.querySelectorAll('a[href], input[value], code'))
            .map(el => {
                const h = el.getAttribute('href') || el.getAttribute('value') || (el.textContent || '').trim();
                return h;
            })
            .filter(h => h && h.length > 40 && /(token|nf\d|auth|l\.netflix|login)/i.test(String(h)));
        out.links = links;
        out.body = body.slice(0, 400);
        return out;
    }).catch(() => ({}));
}

/**
 * Convert 1 cookie -> NFToken link via nftools.live.
 * @returns {Promise<{ok:true, links:any[], raw:any}|{ok:false,error:string}>}
 */
export async function convertOne(cookie, opts = {}) {
    const timeoutMs = opts.timeoutMs || 150000;
    const proxy = opts.proxy || null;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfcvt-' + crypto.randomBytes(4).toString('hex') + '-'));
    const launchArgs = ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--window-size=1280,900'];
    if (proxy && proxy.server && !opts.noProxy) launchArgs.push('--proxy-server=' + proxy.server);

    let browser;
    try {
        await ensureDisplay();
        browser = await puppeteer.launch({ headless: false, executablePath: CHROME_PATH, args: launchArgs, userDataDir: tmpDir });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        if (proxy && proxy.auth) await page.authenticate({ username: proxy.auth.username, password: proxy.auth.password }).catch(() => {});
        await stealth(page);

        await page.goto(`${BASE}/tools/convert`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('textarea', { timeout: 30000 });
        // set cookie via native setter agar React state ter-update
        await page.evaluate((c) => {
            const el = document.querySelector('textarea');
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(el, c);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, cookie);
        await new Promise(r => setTimeout(r, 1500));

        const deadline = Date.now() + timeoutMs;
        let clicked = false;
        let lastReset = Date.now();
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 1500));
            const probe = await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const gen = btns.find(b => /generate link/i.test(b.textContent || '') && !b.disabled);
                const reset = btns.find(b => /reset & try again/i.test(b.textContent || ''));
                const t = document.body ? document.body.innerText : '';
                const err = t.match(/(couldn't generate link|invalid cookie|unauthorized|oops[^.\n]*|expired)/i);
                const ok = /link generated successfully|successfully/i.test(t);
                return { hasGen: !!gen, hasReset: !!reset, err: err ? err[0] : '', ok, text: t.slice(0, 300) };
            }).catch(() => ({ hasGen: false, hasReset: false, err: '', ok: false, text: '' }));

            const res = await resolveResultLinks(page);
            if (probe.ok || (res.storage && (res.storage.browserLink || res.storage.mobileLink || res.storage.tvLink)) || res.links && res.links.length) {
                return { ok: true, links: res.links || [], raw: res.storage || null, body: probe.text };
            }
            if (probe.err && clicked) return { ok: false, error: probe.err };

            if (probe.hasGen && !clicked) {
                await page.evaluate(() => {
                    const b = Array.from(document.querySelectorAll('button')).find(x => /generate link/i.test(x.textContent || '') && !x.disabled);
                    if (b) b.click();
                }).catch(() => {});
                clicked = true;
            } else if (!probe.hasGen && clicked) clicked = false;

            if (probe.hasReset && Date.now() - lastReset > 30000) {
                await page.evaluate(() => {
                    const b = Array.from(document.querySelectorAll('button')).find(x => /reset & try again/i.test(x.textContent || ''));
                    if (b) b.click();
                }).catch(() => {});
                lastReset = Date.now();
            }
        }
        return { ok: false, error: 'Timeout: Turnstile tidak kunjung lolos pada proxy/IP ini.' };
    } catch (e) {
        return { ok: false, error: (e && e.message) ? e.message : String(e) };
    } finally {
        if (browser) { try { await browser.close(); } catch (e) {} }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
}

export async function convertBatch(cookie, opts = {}) {
    const attempts = opts.attempts || 1;
    let proxies = [];
    if (!opts.noProxy) {
        if (opts.proxyFile) proxies = fs.readFileSync(opts.proxyFile, 'utf8').split(/\r?\n/).map(parseProxyLine).filter(Boolean);
        else if (opts.proxy) proxies = String(opts.proxy).split(',').map(parseProxyLine).filter(Boolean);
        else { console.log('[+] fetch proxy publik...'); proxies = await fetchProxyLines(); }
        console.log(`[+] total proxy: ${proxies.length}`);
        console.log('[+] pra-validasi proxy (CONNECT+TLS)...');
        proxies = await pickHealthyProxies(proxies, Math.max(attempts * 2, 3));
        console.log(`[+] proxy sehat: ${proxies.length}`);
    }
    const results = [];
    let idx = 0;
    for (let i = 0; i < attempts; i++) {
        const proxy = opts.noProxy ? null : proxies[idx % Math.max(1, proxies.length)] || null; idx++;
        const label = proxy ? proxy.server : 'direct';
        console.log(`[${i + 1}/${attempts}] via ${label}...`);
        const r = await convertOne(cookie, Object.assign({}, opts, { proxy }));
        if (r.ok) { results.push(r); console.log('    OK:', JSON.stringify(r.raw || r.links).slice(0, 400)); break; }
        console.log('    GAGAL:', r.error);
    }
    return results;
}

function usage() {
    console.log(`\nConvert Netflix cookie -> NFToken link via nftools.live/tools/convert (Puppeteer + proxy).

Perintah:
  node services/netflix-convert.js '<cookie>' [opsi]

Opsi:
  -a, --attempts <n>    jumlah percobaan / rotasi proxy (default 1)
  --proxy-file <file>   file proxy per baris host:port
  --proxy "h:p,h:p"     daftar proxy langsung
  --no-proxy            tanpa proxy (IP server)
  --headed              tampilkan browser
  --timeout-ms <ms>     timeout per percobaan (default 150000)
`);
    process.exit(0);
}

const isMain = process.argv[1] && process.argv[1].endsWith('netflix-convert.js');
if (isMain) {
    const a = process.argv.slice(2);
    if (!a.length || a[0] === '-h' || a[0] === '--help') usage();
    const args = { attempts: 1, timeoutMs: 150000 };
    const cookieArgs = [];
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        if (x === '-a' || x === '--attempts') args.attempts = parseInt(a[++i], 10) || 1;
        else if (x === '--proxy-file') args.proxyFile = a[++i];
        else if (x === '--proxy') args.proxy = a[++i];
        else if (x === '--no-proxy') args.noProxy = true;
        else if (x === '--headed') args.headed = true;
        else if (x === '--timeout-ms') args.timeoutMs = parseInt(a[++i], 10) || 150000;
        else cookieArgs.push(x);
    }
    const cookie = cookieArgs.join(' ').trim();
    if (!cookie) { usage(); process.exit(1); }
    convertBatch(cookie, args).then(results => {
        if (results.length) {
            const r = results[0];
            console.log('\n[+] SELESAI — link berhasil:');
            if (r.raw) {
                for (const k of ['mobileLink','browserLink','tvLink']) if (r.raw[k]) console.log(`  ${k}: ${r.raw[k]}`);
            }
            if (r.links && r.links.length) console.log('  links:', JSON.stringify(r.links, null, 2));
            process.exit(0);
        } else { console.log('\n[!] gagal — tidak ada link.'); process.exit(1); }
    }).catch(e => { console.error('[!]', e.message); process.exit(1); });
}