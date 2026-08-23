/**
 * mailtm-worker.cjs
 *
 * Child worker untuk services/bulk.js — replika persis tes.cjs yang TERBUKTI
 * jalan: akun mail.tm dibuat lewat UI (Puppeteer), browser ditutup SEBELUM
 * magic link dikirim, polling inbox via api.mail.tm, verifikasi + aktivasi
 * premium via API alwayscodex.
 *
 * Output mesin: baris "###RESULT### {...json}" di stdout untuk diparsing parent.
 * Env opsional: MAILTM_NAME (saat ini hanya informasional — alamat ditentukan UI).
 */

const puppeteer = require('puppeteer-core');

const MAILTM_URL = 'https://mail.tm/id/';
const AM_SEND_URL = 'https://api.alwayscodex.eu.cc/api/am/send';
const AM_VERIFY_URL = 'https://api.alwayscodex.eu.cc/api/am/verify';

function emit(result) {
  console.log('###RESULT###' + JSON.stringify(result));
}

async function createTempEmail() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  let accountData = null;
  let tokenData = null;

  page.on('response', async (resp) => {
    try {
      if (resp.request().method() !== 'POST') return;
      const url = resp.url();
      if (url.endsWith('/accounts') && resp.status() === 201) accountData = await resp.json();
      if (url.endsWith('/token') && resp.ok()) tokenData = await resp.json();
    } catch (e) {}
  });

  await page.goto(MAILTM_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 15000));
  await page.evaluate(() => {
    const span = document.querySelector('.inline-flex.items-center.justify-center.shrink-0.select-none.rounded-full');
    if (span) span.click();
  });
  await new Promise(r => setTimeout(r, 3000));

  const password = await page.evaluate(() => {
    const m = document.body.innerText.match(/Kata sandi:\s*(.+)/);
    return m ? m[1].trim() : null;
  });

  await browser.close();

  if (!accountData?.address || !tokenData?.token || !password) {
    throw new Error(`gagal create akun (email=${!!accountData?.address}, token=${!!tokenData?.token}, pass=${!!password})`);
  }
  return { email: accountData.address, password, token: tokenData.token };
}

async function sendMagicLink(email) {
  const url = `${AM_SEND_URL}?email=${encodeURIComponent(email)}&apikey=adm`;
  const res = await fetch(url);
  return res.json();
}

async function getMessageList(token) {
  // PENTING: tanpa ?page=1 — endpoint ter-pagination ter-cache kosong.
  const res = await fetch('https://api.mail.tm/messages', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data['hydra:member'] || [];
}

async function getMessageDetail(token, id) {
  const res = await fetch(`https://api.mail.tm/messages/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

function extractVerifyLink(html, text) {
  const match = (html.match(/href=['"](https?:\/\/[^'"]*alight[^'"]*)['"]/i)
    || html.match(/href=['"](https?:\/\/[^'"]*auth_action[^'"]*)['"]/i)
    || html.match(/href=['"](https?:\/\/[^'"]*oobCode[^'"]*)['"]/i)
    || html.match(/href=['"](https?:\/\/[^'"]+)['"]/i)
    || text.match(/(https?:\/\/\S*oobCode\S*)/i)
    || text.match(/(https?:\/\/\S*firebaseapp\S*)/i));
  return match ? match[1].replace(/&amp;/g, '&') : null;
}

async function pollInbox(token, maxRetries = 20, interval = 5000) {
  for (let i = 1; i <= maxRetries; i++) {
    await new Promise(r => setTimeout(r, interval));
    try {
      console.log(`[poll ${i}/${maxRetries}] ...`);
      const messages = await getMessageList(token);
      for (const msg of messages) {
        const detail = await getMessageDetail(token, msg.id);
        const html = detail.html?.[0] || '';
        const text = detail.text || '';
        const link = extractVerifyLink(html, text);
        if (link) return link;
      }
    } catch (e) {
      console.log(`[poll] error: ${e.message}`);
    }
  }
  return null;
}

async function verifyEmail(email, link) {
  const url = `${AM_VERIFY_URL}?email=${encodeURIComponent(email)}&link=${encodeURIComponent(link)}&apikey=adm`;
  const res = await fetch(url);
  return res.json();
}

(async () => {
  if (process.env.MAILTM_NAME) console.log(`[note] MAILTM_NAME=${process.env.MAILTM_NAME} (alamat final ditentukan UI mail.tm)`);

  // [1] Akun mail.tm via UI (browser ditutup sebelum kirim)
  const acct = await createTempEmail();
  console.log(`[acct] ${acct.email}`);

  // [2] Kirim magic link
  const sent = await sendMagicLink(acct.email);
  console.log(`[send] ${JSON.stringify(sent).slice(0, 120)}`);
  if (!sent.success) return emit({ status: 'failed', email: acct.email, password: acct.password, error: 'send: ' + (sent.error || sent.message || 'gagal') });

  // [3] Polling inbox sampai link verifikasi ada
  const link = await pollInbox(acct.token);
  if (!link) return emit({ status: 'failed', email: acct.email, password: acct.password, error: 'verify: link tidak ditemukan' });
  console.log('[link] ditemukan');

  // [4] Verifikasi + aktivasi premium
  const v = await verifyEmail(acct.email, link);
  if (!v.success) return emit({ status: 'failed', email: acct.email, password: acct.password, error: 'verify: ' + (v.error || 'gagal').toString().slice(0, 120), verifyLink: link });
  console.log('[done] PREMIUM AKTIF');
  emit({ status: 'success', email: acct.email, password: acct.password, codeorder: v.code_order, verifyLink: link });
})().catch(err => {
  emit({ status: 'error', error: err.message });
  process.exit(1);
});
