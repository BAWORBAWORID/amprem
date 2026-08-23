/**
 * services/bulk.js — Bulk Alight Motion Premium via mail.tm (child-worker)
 *
 * Akun dibuat oleh services/mailtm-worker.cjs — proses CHILD terpisah yang
 * mereplikasi persis tes.cjs yang TERBUKTI jalan (UI mail.tm + Puppeteer,
 * browser fresh per akun, ditutup sebelum kirim magic link).
 *
 * Kenapa child-process? Versi in-process dengan kode identik konsisten gagal
 * menerima email (inbox kosong selamanya), sedangkan jalur worker mandiri
 * sukses berulang kali. Isolasi penuh = perilaku byte-identik dgn tes.cjs.
 *
 * Kontrak publik dipertahankan (dipakai src/utils/am.js):
 *   buildEmailList(opts), runBulk(opts), closeBrowser()
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'mailtm-worker.cjs');

// Worker maksimal: akun ~25s + polling 20x5s + verifikasi ~10s ≈ 140s.
// Timeout 7 menit memberi margin luas untuk lambatnya Chrome/API.
const WORKER_TIMEOUT_MS = 7 * 60 * 1000;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function randomLocalPart(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

/* ---------- Generator email (placeholder daftar utk display instan) ---------- */

/**
 * Daftar email utk ditampilkan ke user sebelum worker jalan. Alamat ASLI
 * ditentukan mail.tm saat UI create akun — result.email tiap hasil selalu
 * mencatat alamat nyata (perilaku sama dgn versi generator.email lama).
 */
export function buildEmailList(opts) {
    const prefix = String(opts.name || '')
        .replace(/\{n\}/g, '').replace(/\{n2\}/g, '')
        .replace(/[^a-z0-9_.-]/gi, '')
        .slice(0, 12) || 'am';
    const count = Math.min(500, Math.max(1, parseInt(opts.count, 10) || 1));
    const startIndex = Math.max(1, parseInt(opts.startIndex, 10) || 1);
    const end = startIndex + count - 1;
    const list = [];
    const seen = new Set();
    for (let i = startIndex; i <= end; i++) {
        let email = '';
        for (let t = 0; t < 25; t++) {
            email = `${prefix}${randomLocalPart(7)}@mail.tm`;
            if (!seen.has(email)) break;
        }
        seen.add(email);
        list.push(email);
    }
    return list;
}

/* ---------- Proses satu akun (spawn worker) ---------- */

function parseWorkerStdout(stdout) {
    // Ambil baris RESULT terakhir (worker emit tepat sekali di semua jalur).
    const lines = String(stdout || '').split('\n').filter((l) => l.startsWith('###RESULT###'));
    if (!lines.length) return null;
    try {
        return JSON.parse(lines[lines.length - 1].slice('###RESULT###'.length));
    } catch (e) {
        return null;
    }
}

async function processOne(_placeholderEmail, opts) {
    const result = {
        email: _placeholderEmail,
        inboxUrl: 'https://mail.tm',
        status: 'failed',
        messages: [],
    };

    try {
        if (opts.onLog) opts.onLog('spawn worker mail.tm...');
        const { stdout } = await execFileAsync(process.execPath, [WORKER_PATH], {
            timeout: WORKER_TIMEOUT_MS,
            maxBuffer: 4 * 1024 * 1024,
            env: Object.assign({}, process.env), // CHROME_PATH dsb ikut
        });

        const r = parseWorkerStdout(stdout) || { status: 'error', error: 'worker tidak menghasilkan RESULT' };
        result.status = r.status === 'success' ? 'success' : r.status;
        if (r.email) result.email = r.email;
        if (r.password) result.password = r.password;
        if (r.codeorder) result.codeorder = r.codeorder;
        if (r.error) result.error = r.error;

        if (result.status === 'success') {
            if (opts.onLog) opts.onLog(`PREMIUM AKTIF (codeorder ${result.codeorder})`);
        } else {
            if (opts.onLog) opts.onLog(`gagal: ${String(result.error).slice(0, 90)}`);
        }
    } catch (err) {
        // execFile melempar bila exit code != 0 ATAU timeout — tetap coba parse stdout.
        const r = err && err.stdout ? parseWorkerStdout(err.stdout) : null;
        if (r) {
            result.status = r.status === 'success' ? 'success' : r.status;
            if (r.email) result.email = r.email;
            if (r.password) result.password = r.password;
            if (r.codeorder) result.codeorder = r.codeorder;
            if (r.error) result.error = r.error;
        } else {
            result.status = 'error';
            const timedOut = err.killed && /timed out/i.test(err.message || '');
            result.error = timedOut ? 'worker timeout (>7m)' : String(err.message).slice(0, 120);
        }
        if (opts.onLog) opts.onLog(`error: ${String(result.error).slice(0, 90)}`);
    }
    return result;
}

/* ---------- API ---------- */

/**
 * Jalankan bulk batch.
 * @param {object} opts { name, domains, count, maxTries, emails?, onLog, onResult, onDone }
 */
export async function runBulk(opts) {
    const emails = opts.emails && opts.emails.length ? opts.emails.slice() : buildEmailList(opts);
    const results = [];
    const started = Date.now();

    if (opts.onLog) opts.onLog(`Batch: ${emails.length} akun via mail.tm (child worker)`);

    for (let i = 0; i < emails.length; i++) {
        if (opts.onLog) opts.onLog(`[${i + 1}/${emails.length}] memproses akun baru...`);
        let r;
        try {
            r = await processOne(emails[i], opts);
        } catch (err) {
            // Satu akun error tidak boleh membunuh seluruh batch.
            r = { email: emails[i], inboxUrl: 'https://mail.tm', status: 'error', error: err.message, messages: [] };
            if (opts.onLog) opts.onLog(`error: ${err.message}`);
        }
        results.push(r);
        if (opts.onResult) opts.onResult(r, i + 1, emails.length);
        if ((i + 1) % 5 === 0 && opts.onLog) {
            opts.onLog(`Progress: ${i + 1}/${emails.length} selesai`);
            console.log('[BULK] Progress:', i + 1, '/', emails.length);
        }
        await sleep(1500);
    }

    if (opts.onDone) {
        opts.onDone(results);
        console.log('[BULK] Batch Selesai - Total:', emails.length, 'Success:', results.filter((r) => r.status === 'success').length, 'Failed:', results.filter((r) => r.status !== 'success').length);
    }
    return {
        status: true,
        total: emails.length,
        success: results.filter((r) => r.status === 'success').length,
        failed: results.filter((r) => r.status !== 'success').length,
        durationMs: Date.now() - started,
        results,
    };
}

/** Kompatibilitas: pemanggil lama memanggil closeBrowser() setelah batch. */
export async function closeBrowser() { /* no-op: browser hidup di child process */ }

export default {
    name: 'AM Bulk (mail.tm child worker)',
    description: 'Bulk AlightMotion premium — akun temp mail.tm via UI (Puppeteer di child process), send AM verification, auto detect + verify + activate',
    buildEmailList,
    runBulk,
    closeBrowser,
};
