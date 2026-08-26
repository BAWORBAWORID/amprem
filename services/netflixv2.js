#!/usr/bin/env node
/* services/netflixv2.js — NFToken generator via https://nftools.live
 *
 * Situs v2 dilindungi Cloudflare Turnstile + Bot Management (__cf_bm),
 * jadi TIDAK bisa lewat HTTP murni seperti netflix.js (PoW SHA-256).
 * Solusi: Puppeteer per-token dengan:
 *   - proxy rotasi (--proxy-server) -> IP baru tiap token (kuota 3 link/hari/IP)
 *   - userDataDir segar per run     -> deviceId + fingerprint baru
 * Alur halaman: /tools/nftoken-link/<negara> -> tombol "Get Link" ->
 * hasil disimpan di sessionStorage["nf_result_<NEGARA>"]:
 *   { mobileLink, browserLink, tvLink, expires, accountInfo }
 *
 * CLI:
 *   node services/netflixv2.js -n 1 -c us
 *   node services/netflixv2.js -n 3 -c us --proxy-file proxies.txt
 *   node services/netflixv2.js -n 2 -c id --proxy "h:p,h:p"
 * Opsi: -n jumlah | -c negara | -o out | --proxy-file | --proxy | --conc |
 *       --headed | --timeout-ms | --no-proxy
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

/* Turnstile Cloudflare sering menolak Chrome headless murni. Trik standar:
 * jalankan Chrome HEADED di dalam Xvfb (display virtual). Fungsi ini
 * menyiapkan display :99 otomatis bila environment belum punya DISPLAY. */
let xvfbProc = null;
async function ensureDisplay() {
    if (process.env.DISPLAY || xvfbProc) return;
    try {
        xvfbProc = spawn('Xvfb', [':99', '-screen', '0', '1280x800x24'], { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 1000));
        process.env.DISPLAY = ':99';
        console.log('[+] Xvfb display :99 siap (mode headed virtual)');
    } catch (e) {
        console.log('[!] Xvfb tidak tersedia, fallback headless:', e.message);
    }
}
process.on('exit', () => { if (xvfbProc) try { xvfbProc.kill(); } catch (e) {} });

const BASE = process.env.NFTV2_BASE || 'https://nftools.live';
const UA_DEFAULT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
        } catch (e) { /* sumber gagal -> lanjut sumber berikut */ }
    }
    const seen = new Set();
    const out = [];
    for (const l of lines) {
        const p = parseProxyLine(l);
        if (p && !seen.has(p.server)) { seen.add(p.server); out.push(p); }
    }
    return out;
}

/* Pra-validasi: CONNECT ke nftools.live:443 + handshake TLS.
 * Menyaring proxy mati/MITM sebelum browser dilaunch (hemat puluhan detik). */
function proxyHealthy(proxy, timeoutMs = 8000) {
    return new Promise(resolve => {
        const u = new URL(BASE);
        const host = u.hostname, port = Number(u.port || 443);
        let sock, settled = false;
        const done = ok => { if (settled) return; settled = true; try { sock.destroy(); } catch (e) {} resolve(ok); };
        const timer = setTimeout(() => done(false), timeoutMs);
        sock = net.connect({ host: proxy.host || new URL(proxy.server).hostname, port: Number(new URL(proxy.server).port) });
        sock.on('error', () => { clearTimeout(timer); done(false); });
        sock.on('connect', () => {
            sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
        });
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
            const p = pool.shift();
            if (!p) return;
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
        // Spoof WebGL agar tidak terdeteksi SwiftShader/llvmpipe (Xvfb)
        const getParam = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (p) {
            if (p === 37445) return 'Google Inc. (Intel)';
            if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            return getParam.apply(this, [p]);
        };
    });
}

function randDeviceId() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate 1 token via nftools.live.
 * @returns {Promise<{ok:true, country:string, mobileLink:string, browserLink:string, tvLink:string, expires:any, accountInfo:any}|{ok:false,error:string}>}
 */
export async function generateOne(opts = {}) {
    const country = String(opts.country || 'us').toLowerCase();
    const resultKeyPrefix = 'nf_result_';
    const timeoutMs = opts.timeoutMs || 120000;
    const proxy = opts.proxy || null; // { server, auth? } | null
    const headed = !!opts.headed;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfv2-' + randDeviceId().slice(0, 8) + '-'));
    const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,800',
    ];
    if (proxy && proxy.server && !opts.noProxy) launchArgs.push('--proxy-server=' + proxy.server);

    let browser;
    try {
        await ensureDisplay(); // headed di Xvfb -> Turnstile lebih mudah lolos
        browser = await puppeteer.launch({
            headless: false, // selalu headed; tanpa display asli memakai Xvfb
            executablePath: CHROME_PATH,
            args: launchArgs,
            userDataDir: tmpDir,
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        if (proxy && proxy.auth) {
            await page.authenticate({ username: proxy.auth.username, password: proxy.auth.password }).catch(() => {});
        }
        await stealth(page);

        await page.goto(`${BASE}/tools/nftoken-link/${encodeURIComponent(country)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });

        // Loop utama: klik Get Link saat aktif, auto-klik "Reset & try again"
        // untuk memberi Turnstile ronde challenge baru, baca hasil sessionStorage.
        const deadline = Date.now() + timeoutMs;
        let clicked = false;
        let lastReset = Date.now();
        let sawUnlocked = false; // gate Turnstile pernah terbuka -> teks "limit" baru valid
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 1500));

            const probe = await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const get = btns.find(b => /get link/i.test(b.textContent || '') && !b.disabled);
                const reset = btns.find(b => /reset & try again/i.test(b.textContent || ''));
                const t = document.body ? document.body.innerText : '';
                let result = null;
                try {
                    for (let i = 0; i < sessionStorage.length; i++) {
                        const k = sessionStorage.key(i);
                        if (k && k.indexOf('nf_result_') === 0) {
                            const v = JSON.parse(sessionStorage.getItem(k) || 'null');
                            if (v && (v.browserLink || v.mobileLink || v.tvLink)) { result = v; break; }
                        }
                    }
                } catch (e) {}
                // Panel "limit" juga tampil prematur selama gate belum selesai,
                // jadi hanya dipercaya bila tombol Get Link aktif/halaman terbuka.
                const limitText = /you've used all your free links|daily limit reached/i.test(t);
                const noHealthy = /couldn't find a healthy account/i.test(t);
                const underUpdate = /under update|temporarily unavailable/i.test(t);
                return { hasGet: !!get, hasReset: !!reset, result, limitText, noHealthy, underUpdate };
            }).catch(() => ({ hasGet: false, hasReset: false, result: null, limitText: false, noHealthy: false, underUpdate: false }));

            if (probe.hasGet) sawUnlocked = true;

            // Error hanya dipercaya setelah gate terbuka (teks "limit" bisa
            // tampil prematur selama Turnstile belum selesai).
            if (sawUnlocked) {
                if (probe.result === null && probe.limitText) return { ok: false, error: 'Kuota harian habis untuk IP/fingerprint ini.' };
                if (probe.noHealthy && clicked) return { ok: false, error: 'Tidak ada akun sehat tersedia saat ini.' };
                if (probe.underUpdate) return { ok: false, error: 'Tool sedang under update.' };
            }

            if (probe.result) {
                return {
                    ok: true,
                    country,
                    mobileLink: probe.result.mobileLink || '',
                    browserLink: probe.result.browserLink || '',
                    tvLink: probe.result.tvLink || '',
                    expires: probe.result.expires || null,
                    accountInfo: probe.result.accountInfo || null,
                    at: new Date().toISOString(),
                };
            }

            if (probe.hasGet && !clicked) {
                await page.evaluate(() => {
                    const b = Array.from(document.querySelectorAll('button'))
                        .find(x => /get link/i.test(x.textContent || '') && !x.disabled);
                    if (b) b.click();
                }).catch(() => {});
                clicked = true;
            } else if (!probe.hasGet && clicked) {
                clicked = false; // halaman kembali ke gate -> izinkan klik ulang nanti
            }

            // Turnstile gagal ronde ini -> reset supaya coba ronde baru.
            if (probe.hasReset && Date.now() - lastReset > 30000) {
                await page.evaluate(() => {
                    const b = Array.from(document.querySelectorAll('button'))
                        .find(x => /reset & try again/i.test(x.textContent || ''));
                    if (b) b.click();
                }).catch(() => {});
                lastReset = Date.now();
            }
        }
        return { ok: false, error: 'Timeout: Turnstile tidak kunjung lolos (reputasi IP/proxy rendah).' };
    } catch (e) {
        return { ok: false, error: (e && e.message) ? e.message : String(e) };
    } finally {
        if (browser) { try { await browser.close(); } catch (e) {} }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
}

/**
 * Batch generate dengan rotasi proxy publik (atau daftar proxy sendiri).
 */
export async function generateBatch(opts = {}) {
    const count = Math.max(1, parseInt(opts.count, 10) || 1);
    const results = [];
    let proxies = [];

    if (!opts.noProxy) {
        if (opts.proxyFile) {
            proxies = fs.readFileSync(opts.proxyFile, 'utf8').split(/\r?\n/).map(parseProxyLine).filter(Boolean);
        } else if (opts.proxy) {
            proxies = String(opts.proxy).split(',').map(parseProxyLine).filter(Boolean);
        } else {
            console.log('[+] fetch daftar proxy publik...');
            proxies = await fetchProxyLines();
        }
        console.log(`[+] total proxy mentah: ${proxies.length}`);
        console.log('[+] pra-validasi proxy (CONNECT+TLS ke target)...');
        const healthy = await pickHealthyProxies(proxies, Math.max(count * 3, 5));
        console.log(`[+] proxy sehat: ${healthy.length}`);
        if (!healthy.length) {
            return [];
        }
        proxies = healthy;
    }

    let idx = 0;
    for (let i = 0; i < count; i++) {
        let attempt = 0;
        const maxAttempt = opts.noProxy ? 1 : 3;
        while (attempt < maxAttempt) {
            attempt++;
            const proxy = opts.noProxy ? null : proxies[idx % Math.max(1, proxies.length)] || null;
            idx++;
            const label = proxy ? proxy.server : 'direct';
            console.log(`[${i + 1}/${count}] coba via ${label} (attempt ${attempt}/${maxAttempt})...`);
            const r = await generateOne(Object.assign({}, opts, { proxy }));
            if (r.ok) {
                results.push(r);
                console.log(`    OK [${r.country}] exp=${r.expires}`);
                console.log(`    browser: ${(r.browserLink || '').slice(0, 90)}`);
                break;
            }
            console.log(`    GAGAL: ${r.error}`);
            // Proxy mati/blocked -> coba proxy berikutnya pada attempt berikutnya.
        }
    }
    return results;
}

/* ============================== CLI ============================== */
function usage() {
    console.log(`
NFToken v2 (nftools.live) — Puppeteer + proxy rotasi

Perintah:
  node services/netflixv2.js -n <jumlah> [opsi]

Opsi:
  -n, --count <n>       jumlah token (default 1)
  -c, --country <kode>  kode negara (default us)
  -o, --out <file>      output file (default tokens-v2.txt)
  --proxy-file <file>   file proxy per baris host:port / http://user:pass@host:port
  --proxy "h:p,h:p"     daftar proxy langsung
  --no-proxy            tanpa proxy (IP server langsung)
  --headed              tampilkan browser (debug)
  --timeout-ms <ms>     timeout per token (default 120000)
`);
    process.exit(0);
}

const isMain = process.argv[1] && (
    process.argv[1].endsWith('netflixv2.js')
);

if (isMain) {
    const a = process.argv.slice(2);
    if (!a.length || a[0] === '-h' || a[0] === '--help') usage();
    const args = { count: 1, country: 'us', out: 'tokens-v2.txt', timeoutMs: 120000 };
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        if (x === '-n' || x === '--count') args.count = parseInt(a[++i], 10) || 1;
        else if (x === '-c' || x === '--country') args.country = a[++i];
        else if (x === '-o' || x === '--out') args.out = a[++i];
        else if (x === '--proxy-file') args.proxyFile = a[++i];
        else if (x === '--proxy') args.proxy = a[++i];
        else if (x === '--no-proxy') args.noProxy = true;
        else if (x === '--headed') args.headed = true;
        else if (x === '--timeout-ms') args.timeoutMs = parseInt(a[++i], 10) || 120000;
    }

    generateBatch(args).then(results => {
        if (results.length) {
            const txt = results.map(r =>
                `[v2][${r.country}] browser=${r.browserLink} | mobile=${r.mobileLink} | tv=${r.tvLink} | exp=${r.expires} | @${r.at}`
            ).join('\n') + '\n';
            fs.writeFileSync(args.out, txt);
            console.log(`\n[+] selesai: ${results.length}/${args.count} token -> ${args.out}`);
        } else {
            console.log('\n[!] 0 token — semua percobaan gagal.');
            process.exit(1);
        }
    }).catch(e => { console.error(`[!] ${e.message}`); process.exit(1); });
}
