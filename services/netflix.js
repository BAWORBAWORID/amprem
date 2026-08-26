#!/usr/bin/env node
/* NFTOKEN scraper Node.js — rotasi proxy otomatis + validasi pool */

import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import zlib from 'zlib';
import crypto from 'crypto';
import fs from 'fs';
import { URL, fileURLToPath } from 'url';

const SITE = process.env.NFT_SITE || 'http://nftools.aroshi.my.id';
const TARGET_HOST = new URL(SITE).hostname;
const TARGET_PORT = Number(new URL(SITE).port || 80);
const UA_DEFAULT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Redmi Note 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];
const PLANS = ['premium', 'standard', 'basic'];

const PROXY_SOURCES = [
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=2000&count=100',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
];

let FORCED_UA = null;
function pickUA() {
  if (FORCED_UA) return FORCED_UA;
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
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

class HttpError extends Error {
  constructor(status, data) {
    const s = typeof data === 'string' ? data : JSON.stringify(data);
    super(`HTTP ${status}: ${String(s).slice(0, 150)}`);
    this.status = status; this.data = data;
  }
}
class RotateError extends Error {}

/* ============ PROXY ============ */
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
      const r = await fetch(src, { signal: AbortSignal.timeout(20000) });
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
  static async load(args) {
    let lines = [];
    if (args.proxyFile) {
      try { lines = fs.readFileSync(args.proxyFile, 'utf8').split(/\r?\n/); }
      catch (e) { console.error(`[!] tidak bisa baca ${args.proxyFile}: ${e.message}`); process.exit(1); }
    }
    if (args.proxy) lines.push(...args.proxy.split(','));
    if (!lines.length) lines = await fetchProxyLines();
    const seen = new Set();
    const list = [];
    for (const l of lines) {
      const p = parseProxyLine(l);
      if (p && !seen.has(p.host + ':' + p.port)) { seen.add(p.host + ':' + p.port); list.push(p); }
    }
    console.log(`[+] total proxy mentah: ${list.length}`);
    if (!list.length) { console.error('[!] tidak ada proxy'); process.exit(1); }
    return new ProxyPool(list);
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
      if (v.used) continue;
      return v;
    }
    return null;
  }
  dead(p) { const k = p.host + ':' + p.port; return (this.fails.get(k) || 0) >= 2; }
  fail(p) {
    const k = p.host + ':' + p.port;
    this.fails.set(k, (this.fails.get(k) || 0) + 1);
    if (this.fails.get(k) >= 2) console.log(`[!] ${k} dikeluarkan`);
  }
  reuse(p) { const k = p.host + ':' + p.port; this.fails.set(k, 0); }
  addValid(p, session) { this.valid.push({ proxy: p, session, used: false }); }
  aliveValid() { return this.valid.filter(v => !v.used).length; }
}

/* ============ TUNNEL + REQUEST ============ */
function tunnel(proxy, host, port, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let sock;
    if (proxy.https) {
      sock = tls.connect({ host: proxy.host, port: proxy.port, servername: proxy.host, rejectUnauthorized: false });
    } else {
      sock = net.connect({ host: proxy.host, port: proxy.port });
    }
    const timer = setTimeout(() => { sock.destroy(); reject(new RotateError('tunnel timeout')); }, timeoutMs);
    let buf = '';
    let settled = false;
    const fail = (e) => { if (settled) return; settled = true; clearTimeout(timer); sock.destroy(); reject(e); };
    const onData = d => {
      buf += d.toString('latin1');
      const i = buf.indexOf('\r\n\r\n');
      if (i === -1) { if (buf.length > 8192) fail(new RotateError('tunnel bad response')); return; }
      const status = parseInt(buf.split('\r\n')[0].split(' ')[1], 10);
      if (status === 200) {
        if (settled) return; settled = true;
        clearTimeout(timer);
        sock.removeAllListeners('data');
        resolve(sock);
      } else {
        fail(new RotateError(`CONNECT ${status}`));
      }
    };
    sock.on('data', onData);
    sock.on('error', e => fail(new RotateError(`proxy: ${e.code || e.message}`)));
    const reqLine = `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n`;
    const auth = proxy.auth ? `Proxy-Authorization: Basic ${proxy.auth}\r\n` : '';
    sock.write(reqLine + auth + '\r\n');
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

async function request({ proxy, method, path, body, headers = {}, sessionToken, powProof, timeoutMs = 15000 }) {
  const h = browserHeaders();
  Object.assign(h, headers);
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
    let headDone = false, status = 0, outHeaders = {}, chunked = false, remain = 0;
    let finished = false;
    const fail = e => { if (finished) return; finished = true; clearTimeout(timer); sock.destroy(); reject(e); };
    const collect = d => {
      buf = Buffer.concat([buf, d]);
      if (!headDone) {
        const i = buf.indexOf('\r\n\r\n');
        if (i === -1) { if (buf.length > 65536) fail(new Error('header too big')); return; }
        headDone = true;
        const headText = buf.slice(0, i).toString('latin1');
        const lines = headText.split('\r\n');
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

/* ============ API ============ */
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

function isDailyLimit(e) {
  return /Limit harian|Terlalu/i.test(String(e && e.data ? e.data : e));
}

/* ============ VALIDASI PROXY ============ */
async function validateProxy(p) {
  const s = await tunnel(p, TARGET_HOST, TARGET_PORT, 6000);
  s.destroy();
  return p;
}

async function scanPool(pool, want, concurrency = 30, deadlineMs = 70000) {
  const found = [];
  const start = Date.now();
  const workers = Array.from({ length: concurrency }, async () => {
    while (Date.now() - start < deadlineMs) {
      const p = pool.nextRaw();
      if (!p || found.length >= want) return;
      try {
        await validateProxy(p);
        const session = await newSession(p);
        pool.addValid(p, session);
        found.push(p);
        console.log(`[+] ${p.host}:${p.port} VALID (${pool.aliveValid()} valid)`);
      } catch (e) {
        if (!(e instanceof RotateError)) pool.fail(p);
      }
    }
  });
  await Promise.all(workers);
  console.log(`[=] scan selesai: ${found.length} valid`);
  return found;
}

async function ensureValidPool(pool, want, args) {
  if (pool.aliveValid() >= want) return;
  console.log(`[+] memvalidasi proxy (butuh ${want} hidup)...`);
  await scanPool(pool, want - pool.aliveValid(), args.scanConcurrency || 25);
  if (pool.aliveValid() === 0) {
    console.log('[+] refetch daftar proxy baru...');
    const fresh = await fetchProxyLines();
    const seen = new Set(pool.list.map(p => p.host + ':' + p.port));
    for (const l of fresh) {
      const p = parseProxyLine(l);
      if (p && !seen.has(p.host + ':' + p.port)) { seen.add(p.host + ':' + p.port); pool.list.push(p); }
    }
    console.log(`[+] total proxy sekarang: ${pool.list.length}`);
    await scanPool(pool, want, args.scanConcurrency || 25);
  }
}

/* ============ AUTO ============ */
async function runAuto(args, pool) {
  const want = args.count;
  const results = [];
  const limits = { premium: 0, standard: 0, basic: 0 };
  let refetches = 0;

  while (results.length < want) {
    await ensureValidPool(pool, Math.min(5, want - results.length + 2), args);
    const v = pool.nextValid();
    if (!v) {
      refetches++;
      if (refetches > 4) { console.error(`[!] kehabisan proxy valid setelah ${refetches}x refetch`); break; }
      console.log(`[+] refetch round ${refetches}/4...`);
      const fresh = await fetchProxyLines();
      const seen = new Set(pool.list.map(p => p.host + ':' + p.port));
      for (const l of fresh) {
        const p = parseProxyLine(l);
        if (p && !seen.has(p.host + ':' + p.port)) { seen.add(p.host + ':' + p.port); pool.list.push(p); }
      }
      await scanPool(pool, Math.min(5, want - results.length + 2), args.scanConcurrency || 30, 40000);
      const v2 = pool.nextValid();
      if (!v2) break;
      continue;
    }
    const { proxy, session } = v;
    try {
      while (results.length < want) {
        const plan = args.plan || PLANS[results.length % PLANS.length];
        try {
          const d = await genToken(proxy, session.token, plan);
          if (d.error) {
            if (/Limit harian/i.test(d.error)) { limits[plan]++; break; }
            if (/Session/i.test(d.error)) { pool.fail(proxy); break; }
            console.log(`[!] ${plan}: ${d.error}`); break;
          }
          if (d.success && d.url) {
            results.push({ plan, url: d.url, expires: d.expires, quality: d.quality, country: d.country, at: new Date().toISOString() });
            const left = d.pool && d.pool.available;
            console.log(`[${new Date().toISOString().slice(11, 19)}] ${plan.toUpperCase().padEnd(9)} | ${String(d.country).padEnd(5)} | ${String(d.quality).padEnd(10)} | sisa ${left} | exp ${d.expires}`);
            console.log(`    ${d.url}`);
            pool.reuse(proxy);
          } else break;
        } catch (e) {
          if (e instanceof RotateError) { pool.fail(proxy); break; }
          if (e instanceof HttpError && e.status === 403 && isDailyLimit(e)) { limits[plan]++; break; }
          if (e instanceof HttpError && e.status === 429) { console.log(`[!] 429 rate-limit di ${proxy.host}:${proxy.port}, rotasi...`); break; }
          if (e instanceof HttpError && e.status === 403 && /Session/i.test(String(e.data))) { pool.fail(proxy); break; }
          console.log(`[!] ${plan} via ${proxy.host}:${proxy.port}: ${e.message}`); break;
        }
      }
      v.used = true;
      console.log(`[+] ${proxy.host}:${proxy.port} selesai -> rotasi (${results.length} total, ${pool.aliveValid()} proxy valid tersisa)`);
    } catch (e) { console.log(`[!] ${proxy.host}:${proxy.port}: ${e.message}`); }
  }

  fs.writeFileSync(args.out, results.map(r =>
    `[${r.plan}] ${r.url} | exp ${r.expires} | ${r.quality} | ${r.country} | @${r.at}`).join('\n') + '\n');
  console.log(`\n[+] selesai: ${results.length} token -> ${args.out}`);
  console.log(`[+] kena limit harian per plan: ${JSON.stringify(limits)}`);
  return results.length;
}

/* ============ LAIN-LAIN ============ */
function parseCookie(text) {
  text = text.trim();
  if (text.startsWith('[')) return JSON.parse(text).map(c => `${c.name}=${c.value}`).join('; ');
  if (text.startsWith('{')) return Object.entries(JSON.parse(text)).map(([k, v]) => `${k}=${v}`).join('; ');
  return text;
}

function usage() {
  console.log(`
NFTOKEN scraper Node.js — rotasi proxy otomatis (${SITE})

Perintah:
  node nfscraper.js test [opsi]            # tes koneksi: cari 1 proxy hidup + cek session
  node nfscraper.js stats [opsi]
  node nfscraper.js auto -n <jumlah> [opsi]
  node nfscraper.js <jumlah>               # shortcut ke auto (contoh: node net.js 10)
  node nfscraper.js convert '<cookie>' [opsi]
  node nfscraper.js check '<cookie>' [opsi]

Opsi:
  --proxy-file <file>   file proxy (per baris: host:port atau http://user:pass@host:port)
  --proxy "h:p,h:p"     daftar proxy langsung (dipisah koma)
  --ua "<string>"       paksa satu User-Agent tertentu (default: acak dari 16 daftar tiap request)
  -n, --count <n>       jumlah token (default 5)
  -p, --plan <plan>     premium | standard | basic (default acak bergantian)
  -o, --out <file>      output (default tokens.txt)
  -c, --conc <n>        konkuransi scan proxy (default 25)
  Tanpa --proxy-file/--proxy: auto-fetch proxy publik + validasi + rotasi otomatis
`);
  process.exit(0);
}

async function main() {
  const a = process.argv.slice(2);
  if (!a.length || a[0] === '-h' || a[0] === '--help') return usage();
  let cmd = a.shift();
  
  // Shortcut: Jika argumen pertama adalah angka murni (cth: node net.js 10)
  if (/^\d+$/.test(cmd)) {
    a.unshift(cmd);    // kembalikan angka ke dalam argumen
    a.unshift('-n');   // tambahkan flag -n otomatis
    cmd = 'auto';      // tetapkan mode sebagai 'auto'
  }

  const args = { count: 5, plan: null, out: 'tokens.txt', proxyFile: null, proxy: null, scanConcurrency: 25 };
  const cookieArgs = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '-n' || x === '--count') args.count = parseInt(a[++i], 10);
    else if (x === '-p' || x === '--plan') args.plan = a[++i];
    else if (x === '-o' || x === '--out') args.out = a[++i];
    else if (x === '-c' || x === '--conc') args.scanConcurrency = parseInt(a[++i], 10) || 25;
    else if (x === '--proxy-file') args.proxyFile = a[++i];
    else if (x === '--proxy') args.proxy = a[++i];
    else if (x === '--ua') FORCED_UA = a[++i];
    else cookieArgs.push(x);
  }
  if (args.count < 1) args.count = 1;
  if (!['premium', 'standard', 'basic'].includes(args.plan)) args.plan = null;

  const pool = await ProxyPool.load(args);

  if (cmd === 'test') {
    console.log('[+] mode test: cari 1 proxy hidup...');
    await ensureValidPool(pool, 1, args);
    const v = pool.nextValid();
    if (!v) throw new Error('tidak ada proxy hidup');
    console.log(`[+] proxy terpakai: ${v.proxy.host}:${v.proxy.port} (UA: ${process.env.NFT_SITE ? '' : ''}${(FORCED_UA || 'acak').slice(0, 30)}...)`);
    console.log(`[+] session token: ${v.session.token.slice(0, 40)}... (exp ${v.session.expires}s)`);
    try {
      const d = await request({ proxy: v.proxy, method: 'GET', path: '/api/stats', sessionToken: v.session.token });
      console.log(`[+] stats OK: ${JSON.stringify(d.pool)}`);
    } catch (e) { console.log(`[!] stats gagal tapi session OK: ${e.message}`); }
    console.log('[+] KONEKSI OK — jalankan: node nfscraper.js auto -n 10');
  } else if (cmd === 'stats') {
    await ensureValidPool(pool, 1, args);
    let d = null;
    for (let i = 0; i < 8 && !d; i++) {
      const v = pool.nextValid();
      if (!v) break;
      try {
        d = await request({ proxy: v.proxy, method: 'GET', path: '/api/stats', sessionToken: v.session.token });
      } catch (e) {
        if (e instanceof RotateError) pool.fail(v.proxy);
        else { v.used = true; console.log(`[!] ${v.proxy.host}:${v.proxy.port}: ${e.message}, rotasi...`); }
      }
    }
    if (!d) throw new Error('tidak ada proxy yang berhasil untuk stats');
    console.log(JSON.stringify(d, null, 2));
  } else if (cmd === 'auto') {
    const n = await runAuto(args, pool);
    if (!n) console.log('[!] 0 token — semua proxy kena limit harian/mati. coba lagi besok atau tambah proxy.');
  } else if (cmd === 'convert' || cmd === 'check') {
    const cookie = parseCookie(cookieArgs.join(' '));
    await ensureValidPool(pool, 1, args);
    let done = false;
    for (let tries = 0; tries < 8 && !done; tries++) {
      const v = pool.nextValid();
      if (!v) break;
      try {
        const d = await request({ proxy: v.proxy, method: 'POST', path: '/api/' + (cmd === 'convert' ? 'generate' : 'check'), body: { cookie }, sessionToken: v.session.token });
        if (cmd === 'convert') {
          if (d.success && d.url) console.log(`[+] URL: ${d.url}`);
          else console.log(`[!] ${JSON.stringify(d)}`);
        } else console.log(JSON.stringify(d, null, 2));
        done = true;
      } catch (e) {
        if (e instanceof RotateError) pool.fail(v.proxy);
        else if (e instanceof HttpError && isDailyLimit(e)) { console.log(`[!] IP proxy ${v.proxy.host} kena limit harian, rotasi...`); v.used = true; }
        else if (e instanceof HttpError && e.status === 403 && /Session/i.test(String(e.data))) pool.fail(v.proxy);
        else { console.log(`[!] ${v.proxy.host}:${v.proxy.port}: ${e.message}`); v.used = true; }
      }
    }
    if (!done) console.log('[!] gagal — semua proxy gagal');
  } else return usage();
}

// Cek apakah dieksekusi secara langsung di CLI (sebagai pengganti require.main === module)
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(e => { console.error(`[!] ${e.message}`); process.exit(1); });
}

export { tunnel, request, newSession, genToken, ProxyPool, parseProxyLine, solvePow };
