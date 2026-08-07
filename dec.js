#!/usr/bin/env node
/**
 * dec.js — Dekripsi konten halaman ryezenstore.online (dilindungi security.min.js)
 *
 * Cara kerja:
 *  1. Fetch HTML halaman + script proteksi security.min.js
 *  2. Render ulang halaman di sandbox Node (shim DOM minimal) — persis seperti
 *     browser membuka halaman, jadi script proteksi menuliskan konten aslinya
 *  3. Konten hasil render berisi payload base64 (HTML terenkripsi)
 *  4. Decode base64 -> HTML final, simpan ke file + grep metode pembayaran
 *
 * Pemakaian:
 *  node dec.js [url] [output.html]
 *    url    : halaman target (default https://www.ryezenstore.online/api)
 *    output : file hasil akhir (default ryezen-decoded.html)
 *
 * Contoh:
 *  node dec.js
 *  node dec.js https://www.ryezenstore.online/api#purchase hasil.html
 */

import fs from 'fs';
import vm from 'vm';

const TARGET = process.argv[2] || 'https://www.ryezenstore.online/api';
const OUT = process.argv[3] || 'ryezen-decoded.html';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const PAYMENT_KEYWORDS = /DANA|GoPay|OVO|Shopee|QRIS|qris|Metode|metode|Pembayaran|pembayaran|Transfer|Bank|BCA|Mandiri|BNI|E-Wallet|ewallet|PAYMENT|Payment|payment/;

async function fetchText(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': '*/*' },
        redirect: 'follow'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' untuk ' + url);
    return res.text();
}

/** Render halaman: jalankan security.min.js + script inline dalam sandbox, tangkap output DOM */
function renderPage(html, secJs) {
    const inlineScripts = [];
    const re = /<script>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) inlineScripts.push(m[1]);

    let captured = '';
    const capture = (v) => { if (v) captured += String(v); };

    function makeEl() {
        const el = {
            style: {}, dataset: {}, children: [], _ih: '', _tc: '',
            setAttribute() {}, removeAttribute() {}, appendChild() {}, insertBefore() {},
            addEventListener() {}, removeEventListener() {},
            set innerText(v) { capture(v); },
            classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
            querySelector() { return null; }, querySelectorAll() { return []; },
            getElementsByTagName() { return []; },
            setAttributeNS() {}, getAttribute() { return null; }, cloneNode() { return makeEl(); },
        };
        Object.defineProperty(el, 'innerHTML', { set(v) { capture(v); el._ih = v; }, get() { return el._ih; } });
        Object.defineProperty(el, 'textContent', { set(v) { capture(v); el._tc = v; }, get() { return el._tc; } });
        return el;
    }

    const fakeDocument = {
        write: capture, writeln: capture,
        getElementById() { return makeEl(); }, createElement() { return makeEl(); },
        querySelector() { return makeEl(); }, querySelectorAll() { return []; },
        body: makeEl(), head: makeEl(), documentElement: makeEl(),
        addEventListener() {}, cookie: '', title: '', readyState: 'complete',
        getElementsByTagName() { return []; }, createTextNode(t) { return { textContent: t }; },
        location: { href: TARGET, pathname: new URL(TARGET).pathname, hash: new URL(TARGET).hash || '#purchase', search: '' },
    };
    const fakeWindow = {
        document: fakeDocument, location: fakeDocument.location,
        addEventListener() {}, removeEventListener() {},
        setInterval() { return 1; }, setTimeout() { return 1; },
        navigator: { userAgent: UA },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        fetch: () => new Promise(() => {}),
        XMLHttpRequest: function () {},
    };
    fakeWindow.window = fakeWindow; fakeWindow.self = fakeWindow;
    fakeWindow.top = fakeWindow; fakeWindow.parent = fakeWindow;

    // PENTING: jangan berikan objek apa pun milik host yang bisa dimutasi
    // oleh script proteksi. Khususnya jangan berikan `console` asli (script
    // bisa menimpa console.log untuk menyembunyikan jejaknya) dan jangan
    // berikan Function/Buffer/process host (script bisa memanggil
    // `Function('return process')()` lalu process.exit()).
    const sandboxConsole = {
        log() {}, info() {}, warn() {}, error() {}, debug() {}, trace() {}, clear() {},
    };
    const sandbox = {
        window: fakeWindow, document: fakeDocument,
        navigator: fakeWindow.navigator, location: fakeDocument.location,
        console: sandboxConsole,
        // Timer no-op: script proteksi sering memanggil setInterval/setTimeout
        // langsung (bukan via window). Diberikan no-op agar tidak menahan
        // event loop — jangan pernah berikan timer asli ke sandbox.
        setInterval() { return 1; }, clearInterval() {},
        setTimeout() { return 1; }, clearTimeout() {},
        // Image no-op: beberapa script proteksi membuat objek Image untuk
        // deteksi bot/headless. Beri stub agar tidak error.
        Image: function () { return {}; },
        decodeURIComponent, encodeURIComponent, atob, btoa,
        TextDecoder, TextEncoder, URL, URLSearchParams,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    try { vm.runInContext(secJs, sandbox, { timeout: 5000 }); }
    catch (e) { console.error('[dec] sandbox warn (security.min.js):', e.message); }
    for (const s of inlineScripts) {
        try { vm.runInContext(s, sandbox, { timeout: 5000 }); }
        catch (e) { console.error('[dec] sandbox warn (inline script):', e.message); }
    }
    return captured;
}

/** Cari payload base64 di hasil render, decode jadi HTML final */
function extractHtml(rendered) {
    // Pola 1: const payload="..." (hasil render normal)
    const m = rendered.match(/const payload="([^"]+)"/);
    if (m) {
        const dec = Buffer.from(m[1], 'base64').toString('utf8');
        if (dec.includes('<') && dec.length > 500) return dec;
    }
    // Pola 2: blok base64 panjang lain
    const b64s = rendered.match(/[A-Za-z0-9+/=]{500,}/g) || [];
    for (const s of b64s) {
        try {
            const d = Buffer.from(s, 'base64').toString('utf8');
            if (d.includes('<') && d.includes('>') && d.length > 500) return d;
        } catch (e) { /* lanjut */ }
    }
    return null;
}

async function main() {
    console.log('[dec] target :', TARGET);
    console.log('[dec] fetch halaman + security.min.js...');

    let html, secJs;
    try {
        html = await fetchText(TARGET);
    } catch (e) {
        console.error('[dec] GAGAL fetch halaman:', e.message);
        process.exitCode = 1;
        return;
    }
    try {
        const secMatch = html.match(/src="([^"]*security[^"]*\.js[^"]*)"/);
        const secUrl = secMatch ? new URL(secMatch[1], TARGET).href : new URL('/security.min.js', TARGET).href;
        console.log('[dec] script proteksi:', secUrl);
        secJs = await fetchText(secUrl);
    } catch (e) {
        console.error('[dec] GAGAL fetch security.min.js:', e.message);
        process.exitCode = 1;
        return;
    }

    console.log('[dec] render ulang halaman di sandbox (simulasi browser)...');
    const rendered = renderPage(html, secJs);
    console.log('[dec] hasil render:', rendered.length, 'karakter');

    const finalHtml = extractHtml(rendered);
    if (!finalHtml) {
        console.error('[dec] TIDAK menemukan payload base64 di hasil render. Halaman mungkin berubah.');
        fs.writeFileSync('ryezen-render-raw.html', rendered);
        console.error('[dec] hasil render mentah disimpan ke ryezen-render-raw.html untuk inspeksi.');
        process.exitCode = 1;
        return;
    }

    fs.writeFileSync(OUT, finalHtml);
    console.log('[dec] OK! HTML final disimpan ke:', OUT, '(' + finalHtml.length + ' karakter)');

    // Tampilkan metode pembayaran yang ditemukan
    const hits = finalHtml.match(new RegExp('.{0,150}(' + PAYMENT_KEYWORDS.source + ').{0,150}', 'g'));
    if (hits) {
        console.log('\n[dec] ==== KONTEKS METODE PEMBAYARAN ====');
        hits.slice(0, 25).forEach((h) => console.log(h + '\n---'));
    } else {
        console.log('\n[dec] Tidak ada keyword pembayaran di halaman (mungkin bukan halaman #purchase).');
    }
    process.exitCode = 0;
}

// Fallback: jika ada timer nakal dari sandbox yang menahan event loop,
// paksa keluar setelah 15 detik. Timer ini di-unref agar tidak menahan proses
// kalau proses sudah selesai secara alami.
const fallbackExit = setTimeout(() => process.exit(process.exitCode || 0), 15000);
fallbackExit.unref();

main().finally(() => clearTimeout(fallbackExit));
