/**
 * ENTRY POINT — meniru arsitektur apiku/index.js:
 * 1. Load app engine dari src/app/index.js (hot-swap via dynamic import).
 * 2. Server http meneruskan semua request ke engine aktif.
 * 3. Startup log + graceful shutdown + global error handlers.
 *
 * HMR (auto-reload saat file di src/ berubah) aktif bila AM_HMR=1 —
 * memakai fs.watch bawaan Node (tanpa dependency chokidar).
 */
import http from 'http';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import logger from './src/utils/logger.js';
import { PORT } from './src/utils/store.js';
import { bump } from './src/hooks/hot-reload.js';

let currentHandler = null;
let isLoading = false;

async function loadAppEngine() {
    if (isLoading) return;
    isLoading = true;
    try {
        logger.info('[HMR] Memuat app engine...');
        const appPath = path.resolve('./src/app/index.js');
        // Hook hot-reload.js menyisipkan ?amts=<stamp> ke semua modul src/+services/,
        // sehingga SELURUH graph ikut dimuat ulang (bukan hanya entry).
        const mod = await import(pathToFileURL(appPath).href);
        currentHandler = mod.default();
        logger.ready('[HMR] App engine siap.');
    } catch (err) {
        logger.error('[HMR] Gagal memuat app engine: ' + (err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n') : err));
        // Handler lama tetap dipakai — runtime online, kode lama bertahan.
    } finally {
        isLoading = false;
    }
}

await loadAppEngine();

const server = http.createServer(async (req, res) => {
    if (!currentHandler) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Server sedang memuat, coba lagi dalam beberapa detik.');
    }
    try {
        await currentHandler(req, res);
    } catch (e) {
        logger.error('[SERVER] ' + e.message);
    }
});

// HMR — reload app engine saat ada perubahan di src/ atau services/ (AM_HMR=1).
// Runtime tetap online: hanya handler yang diganti, proses tidak di-restart.
if (process.env.AM_HMR === '1') {
    const watchPaths = [path.resolve('./src'), path.resolve('./services')];
    watchPaths.forEach((watchPath) => {
        try {
            const watcher = fs.watch(watchPath, { recursive: true }, (event, filename) => {
                if (!filename) return;
                if (filename.endsWith('.js') || filename.endsWith('.mjs') || filename.endsWith('.cjs') || filename.endsWith('.json')) {
                    logger.info('[HMR] Perubahan: ' + filename + ' — reload app engine...');
                    bump();
                    loadAppEngine();
                }
            });
            watcher.on('error', () => { /* abaikan */ });
            logger.info('[HMR] Watch aktif: ' + watchPath + ' (AM_HMR=1)');
        } catch (e) {
            logger.warn('[HMR] fs.watch tidak tersedia untuk ' + watchPath + ': ' + e.message);
        }
    });

    // public/ ikut auto-update: file statis (html/js/css) SELALU dibaca dari
    // disk tiap request + diserve dengan Cache-Control: no-cache, jadi begitu
    // file berubah, versi terbaru langsung terpakai tanpa restart. Watch di sini
    // hanya memberi tahu di log — tidak perlu reload engine (backend tak berubah).
    try {
        const pubWatch = fs.watch(path.resolve('./public'), { recursive: true }, (event, filename) => {
            if (!filename) return;
            if (filename.endsWith('.html') || filename.endsWith('.js') || filename.endsWith('.css')) {
                logger.info('[HMR] Public updated: ' + filename + ' — browser akan ambil versi baru (no-cache).');
            }
        });
        pubWatch.on('error', () => { /* abaikan */ });
        logger.info('[HMR] Watch aktif: public/ (html/js/css auto-update tanpa restart)');
    } catch (e) {
        logger.warn('[HMR] fs.watch tidak tersedia untuk public/: ' + e.message);
    }
}

server.listen(PORT, '0.0.0.0', () => {
    logger.ready('AM Premium Creator berjalan di http://0.0.0.0:' + PORT);
    logger.info('Owner login: alwayscodex');
    logger.info('Local: http://localhost:' + PORT);
});

// Global error handlers — JANGAN exit proses: update telegram via HMR harus
// hot-swap tanpa kill/restart. Error dicatat, runtime tetap online.
// (Bot polling punya try/catch + AbortController sendiri; error struktural
// muncul di log dan bisa diperbaiki via reload berikutnya.)
process.on('uncaughtException', (err) => {
    logger.error('[CRITICAL] Uncaught Exception (proses tetap jalan): ' + (err && err.stack ? err.stack : err));
});

process.on('unhandledRejection', (reason) => {
    logger.error('[CRITICAL] Unhandled Rejection (proses tetap jalan): ' + String(reason && reason.stack ? reason.stack : reason));
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        logger.warn('Port ' + PORT + ' sudah dipakai. Matikan proses lama lalu start ulang.');
        process.exit(1);
    }
    logger.error('Server error: ' + err.message);
});
