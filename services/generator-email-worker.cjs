/**
 * generator-email-worker.cjs
 *
 * Child worker untuk bulk.js CLI — engine GENERATOR.EMAIL (bukan mail.tm):
 *   1. Buka inbox publik https://generator.email/{domain}/{user}
 *      (nama & domain bebas — mendukung custom name/domain)
 *   2. Kirim magic link verifikasi via API alwayscodex
 *   3. Polling reload inbox sampai link Firebase AM (oobCode) muncul;
 *      coba semua link satu per satu (link basi -> INVALID_OOB dilewati)
 *   4. Verifikasi + aktivasi premium via /api/am/verify
 *
 * Env:
 *   GEN_NAME    -> prefix nama email (opsional, default "am")
 *   GEN_DOMAIN  -> domain spesifik (opsional, default acak DEFAULT_DOMAINS)
 *
 * Output mesin: baris "###RESULT### {...json}" di stdout untuk parent.
 */

const puppeteer = require('puppeteer-core');
const { existsSync } = require('fs');

const AM_SEND_URL = 'https://api.alwayscodex.eu.cc/api/am/send';
const AM_VERIFY_URL = 'https://api.alwayscodex.eu.cc/api/am/verify';

const DEFAULT_DOMAINS = ['softbank.id', '1win.life'];
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function emit(result) {
  console.log('###RESULT###' + JSON.stringify(result));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomLocalPart(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/* ---------- Browser ---------- */

function resolveChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome',
    '/root/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome',
    '/root/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome',
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (p && existsSync(p)) return p; } catch (e) { /* lanjut */ }
  }
  throw new Error('Chrome tidak ditemukan. Set env CHROME_PATH=<path chrome>.');
}

/* ---------- Inbox generator.email ---------- */

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

/** Kumpulkan SEMUA link verifikasi Firebase AM di halaman inbox. */
async function findAllVerifyLinks(page) {
  return page.evaluate(() => {
    const out = [];
    const push = (href) => {
      if (href && href.indexOf('oobCode') !== -1 && out.indexOf(href) === -1) out.push(href);
    };
    document.querySelectorAll("a[href*='firebaseapp.com']").forEach((a) => push(a.href));
    document.querySelectorAll("a[href*='alight']").forEach((a) => push(a.href));
    const allText = document.body.innerText || '';
    const re = /https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s"<]+/g;
    let m;
    while ((m = re.exec(allText)) !== null) push(m[0]);
    return out;
  });
}

/* ---------- API alwayscodex ---------- */

async function sendMagicLink(email) {
  const res = await fetch(`${AM_SEND_URL}?email=${encodeURIComponent(email)}&apikey=adm`, {
    signal: AbortSignal.timeout(30000),
  });
  return res.json();
}

async function verifyEmail(email, link) {
  const res = await fetch(`${AM_VERIFY_URL}?email=${encodeURIComponent(email)}&link=${encodeURIComponent(link)}&apikey=adm`, {
    signal: AbortSignal.timeout(45000),
  });
  return res.json();
}

/* ---------- Main ---------- */

(async () => {
  const namePrefix = String(process.env.GEN_NAME || '')
    .replace(/\{n\}/g, '').replace(/\{n2\}/g, '')
    .replace(/[^a-z0-9_.-]/gi, '')
    .slice(0, 12) || 'am';
  const domainPool = process.env.GEN_DOMAIN ? [process.env.GEN_DOMAIN.toLowerCase()] : DEFAULT_DOMAINS;

  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: resolveChrome(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  let email = null;
  try {
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_UA);

    /* [1] Buka inbox: kandidat utama = name+random@GEN_DOMAIN (atau acak pool).
     * Bila gagal dibuka, coba maks 3 kandidat (domain lain). */
    const candidates = [];
    for (let k = 0; k < 3; k++) {
      const dom = k === 0 ? domainPool[Math.floor(Math.random() * domainPool.length)]
                          : DEFAULT_DOMAINS[Math.floor(Math.random() * DEFAULT_DOMAINS.length)];
      candidates.push(namePrefix + randomLocalPart(7) + '@' + dom);
    }
    let opened = null;
    let lastErr = '';
    for (const cand of candidates) {
      try {
        await openInbox(page, cand);
        opened = cand;
        break;
      } catch (e) {
        lastErr = e.message;
        console.log(`[inbox] gagal ${cand}: ${String(e.message).slice(0, 60)}`);
      }
    }
    if (!opened) throw new Error('inbox: semua domain tidak bisa dibuka (' + lastErr.slice(0, 60) + ')');
    email = opened;
    console.log('[inbox] ' + email);

    /* [2] Kirim magic link */
    const sendRes = await sendMagicLink(email);
    console.log('[send] ' + JSON.stringify(sendRes).slice(0, 120));
    if (!sendRes.success) {
      return emit({ status: 'failed', email, error: 'send: ' + (sendRes.error || sendRes.message || 'gagal') });
    }

    /* [3] Polling reload inbox — coba semua link, lewati yang basi */
    const maxTries = parseInt(process.env.GEN_MAX_TRIES || '20', 10);
    const resendEvery = 4;
    const tried = new Set();
    let verified = null; // { email, code_order }
    let roundsSinceSend = 0;
    let sendsDone = 1;
    for (let i = 0; i < maxTries; i++) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3500);
      const links = await findAllVerifyLinks(page);
      if (links.length) console.log(`[poll ${i + 1}/${maxTries}] ${links.length} link ditemukan`);
      for (const link of links) {
        if (tried.has(link)) continue;
        tried.add(link);
        const v = await verifyEmail(email, link);
        if (v.success) { verified = v; break; }
        console.log(`[link #${tried.size}] gagal: ${String(v.error || '').slice(0, 70)}`);
        if (tried.size >= 15) break;
      }
      if (verified) break;
      console.log(`[poll ${i + 1}/${maxTries}] belum ada link valid`);

      roundsSinceSend++;
      if (roundsSinceSend >= resendEvery) {
        roundsSinceSend = 0;
        sendsDone++;
        try {
          const r2 = await sendMagicLink(email);
          console.log(`[resend #${sendsDone}] ${r2.success ? 'OK' : 'gagal'}`);
        } catch (e) { /* abaikan */ }
        await sleep(2000);
      }
      await sleep(5000);
    }
    if (!verified) {
      return emit({ status: 'failed', email, error: 'verify: link tidak ditemukan' });
    }

    /* [4] Selesai — /verify sekaligus mengaktifkan premium */
    console.log('[done] PREMIUM AKTIF');
    emit({ status: 'success', email, codeorder: verified.code_order, verifyLink: tried.values().next().value || null });
  } catch (err) {
    emit({ status: 'error', email, error: err.message });
    process.exitCode = 1;
  } finally {
    try { await browser.close(); } catch (e) { /* abaikan */ }
  }
})();
