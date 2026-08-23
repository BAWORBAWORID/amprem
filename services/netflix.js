/**
 * services/netflix.js
 *
 * Netflix Generator — PORT PENUH dari tes.cjs yang TERBUKTI jalan:
 * rotasi proxy publik + tunnel CONNECT + header browser (UA pool) +
 * parsing chunked/gzip + session NFToken + PoW solver.
 *
 * (Versi lama membungkus generateNFToken() dari src/utils/am.js yang
 *  konsisten gagal "Proxy limit/habis" karena requestAPI-nya minim
 *  header dan tidak menangani chunked/gzip.)
 *
 * Output service:
 *   generateNetflixToken({ plan })  -> { success, plan, url, expires, quality, country }
 */

import net from 'net';
import tls from 'tls';
import zlib from 'zlib';
import crypto from 'crypto';
import fs from 'fs';

const SITE = process.env.NFT_SITE || 'http://nftools.aroshi.my.id';
const TARGET_HOST = new URL(SITE).hostname;
const TARGET_PORT = Number(new URL(SITE).port || 80);

const PLANS = ['premium', 'standard', 'basic'];
const PROXY_SOURCES = [
    'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=2000&count=100',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
];

const UA_POOL = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
];

function pickUA() {
    return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

class HttpError extends Error {
    constructor(status, data) {
        super(`HTTP ${status}`);
        this.status = status; this.data = data;
    }
}
class RotateError extends Error {}

/* ---------- Proxy ---------- */

function parseProxyLine(line) {
    line = line.trim();
    if (!line) return null;
    if (/^https?:\/\//i.test(line)) {
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
            const r = await fetch(src, { signal: AbortSignal.timeout(20000) });
            lines.push(...(await r.text()).split(/\r?\n/));
        } catch (e) { /* skip */ }
    }
    return lines;
}

function tunnel(proxy, host, port, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const sock = proxy.https
            ? tls.connect({ host: proxy.host, port: proxy.port, servername: proxy.host, rejectUnauthorized: false })
            : net.connect({ host: proxy.host, port: proxy.port });
        const timer = setTimeout(() => { sock.destroy(); reject(new RotateError('tunnel timeout')); }, timeoutMs);
        let buf = ''; let settled = false;
        const fail = (e) => { if (settled) return; settled = true; clearTimeout(timer); sock.destroy(); reject(e); };
        sock.on('data', (d) => {
            buf += d.toString('latin1');
            const i = buf.indexOf('\r\n\r\n');
            if (i === -1) { if (buf.length > 8192) fail(new RotateError('tunnel bad response')); return; }
            const status = parseInt(buf.split('\r\n')[0].split(' ')[1], 10);
            if (status === 200) {
                if (settled) return; settled = true;
                clearTimeout(timer); sock.removeAllListeners('data'); resolve(sock);
            } else fail(new RotateError(`CONNECT ${status}`));
        });
        sock.on('error', (e) => fail(new RotateError(`proxy: ${e.code || e.message}`)));
        const auth = proxy.auth ? `Proxy-Authorization: Basic ${proxy.auth}\r\n` : '';
        sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
    });
}

function inflate(buf, enc) {
    return new Promise((resolve, reject) => {
        if (!enc) return resolve(buf);
        if (enc === 'gzip') return zlib.gunzip(buf, (e, d) => e ? reject(e) : resolve(d));
        if (enc === 'deflate') return zlib.inflate(buf, (e, d) => e ? reject(e) : resolve(d));
        if (enc === 'br') return zlib.brotliDecompress(buf, (e, d) => e ? reject(e) : resolve(d));
        resolve(buf);
    });
}

function dechunk(buf) {
    const out = []; let i = 0;
    while (i < buf.length) {
        const j = buf.indexOf('\r\n', i);
        if (j === -1) break;
        const size = parseInt(buf.slice(i, j).toString(), 16);
        if (!size) break;
        out.push(buf.slice(j + 2, j + 2 + size));
        i = j + 2 + size + 2;
    }
    return Buffer.concat(out);
}

function browserHeaders(extra = {}) {
    return Object.assign({
        'User-Agent': pickUA(),
        'Accept': '*/*',
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': SITE,
        'Referer': SITE + '/nftoken',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
    }, extra);
}

async function request({ proxy, method, path, body, sessionToken, powProof, timeoutMs = 15000 }) {
    const h = browserHeaders();
    if (sessionToken) h['X-NFToken-Session'] = sessionToken;
    if (powProof) h['X-PoW-Proof'] = powProof;
    h['Connection'] = 'close';
    h['Host'] = TARGET_HOST + ':' + TARGET_PORT;
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    if (payload) h['Content-Length'] = payload.length;

    const sock = await tunnel(proxy, TARGET_HOST, TARGET_PORT);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { sock.destroy(); reject(new RotateError('request timeout')); }, timeoutMs);
        let buf = Buffer.alloc(0);
        let headDone = false, status = 0, outHeaders = {}, chunked = false, remain = 0, finished = false;
        const fail = (e) => { if (finished) return; finished = true; clearTimeout(timer); sock.destroy(); reject(e); };
        const collect = (d) => {
            buf = Buffer.concat([buf, d]);
            if (!headDone) {
                const i = buf.indexOf('\r\n\r\n');
                if (i === -1) { if (buf.length > 65536) fail(new Error('header too big')); return; }
                headDone = true;
                const lines = buf.slice(0, i).toString('latin1').split('\r\n');
                status = parseInt(lines[0].split(' ')[1], 10);
                for (const l of lines.slice(1)) {
                    const c = l.indexOf(':');
                    if (c > 0) outHeaders[l.slice(0, c).trim().toLowerCase()] = l.slice(c + 1).trim();
                }
                chunked = outHeaders['transfer-encoding'] === 'chunked';
                remain = parseInt(outHeaders['content-length'] || '0', 10);
                buf = buf.slice(i + 4);
            }
            if (headDone && !chunked && buf.length >= remain) { sock.destroy(); clearTimeout(timer); finish(); }
        };
        const finish = async () => {
            if (finished) return; finished = true;
            try {
                let data = chunked ? dechunk(buf) : buf.slice(0, remain);
                data = await inflate(data, outHeaders['content-encoding']);
                const text = data.toString('utf8');
                let parsed = text;
                try { parsed = JSON.parse(text); } catch (e) { /* keep */ }
                if (status >= 400) reject(new HttpError(status, parsed));
                else resolve(parsed);
            } catch (e) { reject(e); }
        };
        sock.on('data', collect);
        sock.on('error', fail);
        sock.on('close', () => {
            if (finished) return;
            if (headDone && (chunked || buf.length >= remain)) finish();
            else fail(new RotateError('conn closed'));
        });
        let reqLine = `${method} ${path} HTTP/1.1\r\n`;
        for (const [k, v] of Object.entries(h)) reqLine += `${k}: ${v}\r\n`;
        sock.write(Buffer.from(reqLine + '\r\n', 'latin1'));
        if (payload) sock.write(payload);
    });
}

async function newSession(proxy) {
    const d = await request({ proxy, method: 'POST', path: '/api/session', body: {} });
    if (!d.success || !d.token) throw new HttpError(403, d);
    return d;
}

function solvePow(challenge, prefix = '0000') {
    for (let n = 0; n < 1000000; n++) {
        if (crypto.createHash('sha256').update(challenge + n).digest('hex').startsWith(prefix)) {
            return `${challenge}:${n}`;
        }
    }
    return null;
}

async function genToken(proxy, sessionToken, plan) {
    try {
        return await request({ proxy, method: 'POST', path: '/api/random', body: { plan }, sessionToken });
    } catch (e) {
        if (e instanceof HttpError && e.status === 403 && e.data && e.data.powChallenge) {
            const proof = solvePow(e.data.powChallenge);
            if (!proof) throw new Error('PoW gagal diselesaikan');
            return await request({ proxy, method: 'POST', path: '/api/random', body: { plan }, sessionToken, powProof: proof });
        }
        throw e;
    }
}

/* ---------- Pool cache lintas pemanggilan (globalThis, HMR-safe) ---------- */

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
            if ((this.fails.get(p.host + ':' + p.port) || 0) < 2) return p;
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
    fail(p) { this.fails.set(p.host + ':' + p.port, (this.fails.get(p.host + ':' + p.port) || 0) + 1); }
    reuse(p) { this.fails.set(p.host + ':' + p.port, 0); }
    addValid(p, session) { this.valid.push({ proxy: p, session, used: false }); }
    aliveValid() { return this.valid.filter((v) => !v.used).length; }
    mergeRaw(lines) {
        const seen = new Set(this.list.map((p) => p.host + ':' + p.port));
        for (const l of lines) {
            const p = parseProxyLine(l);
            if (p && !seen.has(p.host + ':' + p.port)) { seen.add(p.host + ':' + p.port); this.list.push(p); }
        }
    }
}

async function getPool() {
    if (globalThis.__nfPoolSvc) return globalThis.__nfPoolSvc;
    const lines = await fetchProxyLines();
    const seen = new Set();
    const list = [];
    for (const l of lines) {
        const p = parseProxyLine(l);
        if (p && !seen.has(p.host + ':' + p.port)) { seen.add(p.host + ':' + p.port); list.push(p); }
    }
    console.log(`[netflix] proxy mentah: ${list.length}`);
    globalThis.__nfPoolSvc = new ProxyPool(list);
    return globalThis.__nfPoolSvc;
}

async function validateAndSession(pool, want, concurrency = 30, deadlineMs = 70000) {
    const found = [];
    const start = Date.now();
    const workers = Array.from({ length: concurrency }, async () => {
        while (Date.now() - start < deadlineMs) {
            const p = pool.nextRaw();
            if (!p || found.length >= want) return;
            try {
                const s = await tunnel(p, TARGET_HOST, TARGET_PORT, 6000);
                s.destroy();
                const session = await newSession(p);
                pool.addValid(p, session);
                found.push(p);
            } catch (e) {
                if (!(e instanceof RotateError)) pool.fail(p);
            }
        }
    });
    await Promise.all(workers);
    return found;
}

async function ensureValid(pool, want) {
    if (pool.aliveValid() >= want) return;
    await validateAndSession(pool, want - pool.aliveValid());
    if (pool.aliveValid() === 0) {
        pool.mergeRaw(await fetchProxyLines());
        await validateAndSession(pool, want);
    }
}

/* ---------- Service API ---------- */

/**
 * Generate 1 token Netflix.
 * @param {object} [opts] { plan: 'premium'|'standard'|'basic' }
 */
export async function generateNetflixToken(opts = {}) {
    let plan = String(opts.plan || 'premium').toLowerCase();
    if (!PLANS.includes(plan)) plan = 'premium';

    const pool = await getPool();
    const results = [];
    let refetches = 0;

    while (results.length < 1 && refetches <= 4) {
        await ensureValid(pool, Math.min(3, 2 + refetches));
        const v = pool.nextValid();
        if (!v) {
            refetches++;
            continue;
        }

        try {
            let d = null;
            let roundErrors = 0;
            // Satu proxy bisa menghasilkan >1 token selama belum kena limit.
            while (results.length < 1 && roundErrors < 3) {
                try {
                    d = await genToken(v.proxy, v.session.token, plan);
                    if (d.error) {
                        if (/Limit harian/i.test(d.error)) break;
                        if (/Session/i.test(d.error)) { pool.fail(v.proxy); break; }
                        break;
                    }
                    if (d.success && d.url) {
                        results.push({
                            plan,
                            url: d.url,
                            expires: d.expires,
                            quality: d.quality,
                            country: d.country,
                            at: new Date().toISOString(),
                        });
                        pool.reuse(v.proxy);
                    } else break;
                } catch (e) {
                    if (e instanceof RotateError) { pool.fail(v.proxy); break; }
                    if (e instanceof HttpError && e.status === 429) { console.log('[netflix] 429, rotasi'); break; }
                    if (e instanceof HttpError && e.status === 403 && /Session/i.test(String(e.data))) { pool.fail(v.proxy); break; }
                    roundErrors++;
                    if (roundErrors >= 3) { pool.fail(v.proxy); break; }
                }
            }
            v.used = true;
        } catch (e) { /* lanjut ke proxy berikutnya */ }

        if (!results.length) {
            refetches++;
            pool.mergeRaw(refetches <= 2 ? await fetchProxyLines() : []);
        }
    }

    if (!results.length) {
        return { success: false, error: 'Gagal generate token. Proxy limit/habis, silakan coba lagi.' };
    }

    const t = results[0];
    return {
        success: true,
        plan,
        url: t.url,
        expires: t.expires,
        quality: t.quality,
        country: t.country,
    };
}

/** Generate beberapa token sekaligus. */
export async function generateNetflixTokens(count = 1, plan = null) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const p = plan && PLANS.includes(plan) ? plan : PLANS[i % PLANS.length];
        // eslint-disable-next-line no-await-in-loop
        out.push(await generateNetflixToken({ plan: p }));
    }
    return out;
}

export default {
    name: 'Netflix Generator',
    description: 'Generate token login Netflix Premium via NFToken (proxy rotasi, engine tes.cjs)',
    category: 'Netflix',
    generateNetflixToken,
    generateNetflixTokens,
};
