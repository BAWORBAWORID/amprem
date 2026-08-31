/**
 * Middleware native-http: pelayanan file statis + keamanan (anti-bot, traversal).
 * Meniru peran setupMiddleware pada apiku/src/middleware.
 */
import fs from 'fs';
import path from 'path';
import { PUBLIC_DIR, MIME } from '../utils/store.js';
import { SECURITY_HEADERS, isBotRequest, DECOY_HTML } from '../utils/security.js';

/**
 * Melayani file statis dari public/ dengan proteksi:
 * - cegah path traversal
 * - bot/curl diberi halaman umpan (kecuali /api/* yang ditangani terpisah)
 * - injeksi <script src="/security.js"> ke halaman HTML
 */
export function serveStatic(req, res, url) {
    // /invite?code=xxx → sajikan home.html (SPA membaca ?code= untuk isi kode referal)
    const invitePath = url.pathname === '/invite' || url.pathname === '/invite/';
    const requestedPath = (url.pathname === '/' || invitePath) ? '/home.html' : url.pathname;
    const publicRoot = path.resolve(PUBLIC_DIR);
    let filePath = path.resolve(publicRoot, '.' + requestedPath);
    const relativePath = path.relative(publicRoot, filePath);
    if (relativePath.startsWith('..' + path.sep) || relativePath === '..' || path.isAbsolute(relativePath)) {
        res.writeHead(403, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS));
        return res.end('Forbidden');
    }

    fs.stat(filePath, (err, stat) => {
        if (!err && stat.isDirectory()) {
            filePath = path.join(filePath, 'home.html');
        }
        fs.readFile(filePath, (readErr, data) => {
            if (readErr) {
                res.writeHead(404, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, SECURITY_HEADERS));
                return res.end('<h1>404 - Halaman tidak ditemukan</h1>');
            }
            const ext = path.extname(filePath);

            // Gambar (logo/favicon/ikon) disajikan utuh untuk SEMUA request — termasuk
            // scraper preview (WhatsApp, Telegram, Discord, Facebook, Google) yang
            // biasanya tidak memakai User-Agent browser. Tanpa ini og:image/twitter:image
            // tidak akan tampil di link preview karena mereka menerima halaman umpan.
            // SVG sengaja TIDAK masuk daftar ini (bisa membawa <script> → risiko XSS),
            // dan MIME untuk ekstensi lain sudah lengkap di store.js.
            const isImage = /^\.(jpe?g|png|webp|gif|ico|avif|bmp)$/i.test(ext);

            // Anti-bot / anti-curl: SEMUA file statis (HTML, JS, CSS, gambar, APK,
            // dll) hanya untuk browser asli. Alat otomatis (curl, wget, python, dll)
            // diberi halaman umpan. Endpoint /api/* TIDAK terpengaruh.
            if (isBotRequest(req) && !isImage) {
                res.writeHead(200, Object.assign({
                    'Content-Type': MIME[ext] || 'application/octet-stream',
                    'Cache-Control': 'no-store',
                }, SECURITY_HEADERS));
                return res.end(DECOY_HTML);
            }

            // Tanpa cache untuk SEMUA file agar update HTML/JS/CSS langsung terlihat
            // (no-cache = browser selalu revalidate ke server; HTML SPA + injeksi
            // security.js juga tetap segar).
            const cacheControl = 'no-cache';

            res.writeHead(200, Object.assign({
                'Content-Type': MIME[ext] || 'application/octet-stream',
                'Cache-Control': cacheControl,
            }, SECURITY_HEADERS));

            // Injeksi script proteksi anti-devtools ke setiap halaman HTML.
            // Cek dengan awalan "src=\"/security.js" agar referensi dengan cache-buster
            // (mis. /security.js?v=xxx) TIDAK diinjeksi dua kali.
            let payload = data;
            if (ext === '.html') {
                const html = payload.toString('utf8');
                if (html.indexOf('src="/security.js') === -1) {
                    payload = Buffer.from(html.replace('</head>', '<script src="/security.js"></script>' + '</head>'));
                }
            }
            res.end(payload);
        });
    });
}

/**
 * Melayani file hasil generate (mis. gambar QRIS dari data/qris) di bawah
 * /files/* dengan proteksi traversal. Gambar disajikan utuh untuk semua
 * request agar QR bisa discan dari aplikasi kamera/scanner.
 */
export function serveFromDir(req, res, url, dir) {
    const root = path.resolve(dir);
    const requested = decodeURIComponent(url.pathname.replace(/^\/files/, ''));
    let filePath = path.resolve(root, '.' + requested);
    const relativePath = path.relative(root, filePath);
    if (relativePath.startsWith('..' + path.sep) || relativePath === '..' || path.isAbsolute(relativePath)) {
        res.writeHead(403, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS));
        return res.end('Forbidden');
    }
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, SECURITY_HEADERS));
            return res.end('<h1>404 - Halaman tidak ditemukan</h1>');
        }
        const ext = path.extname(filePath);
        res.writeHead(200, Object.assign({
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        }, SECURITY_HEADERS));
        res.end(data);
    });
}
