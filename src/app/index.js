/**
 * Inti aplikasi (mirip apiku/src/app/index.js):
 * merangkai middleware + rute API + file statis menjadi satu request handler.
 * Di-hot-swap oleh index.js (entry).
 */
import { sendJSON } from '../utils/store.js';
import { seedOwner } from '../utils/auth.js';
import { cleanupExpiredSessions } from '../utils/session.js';
import { initTelegramBots } from '../utils/telegram.js';
import { serveStatic, serveFromDir } from '../middleware/index.js';
import handleAPI from '../routes/api.js';
import { QRIS_IMAGE_DIR, ensureStaticQRIS } from '../utils/qris.js';
import { startAutoCleanupScheduler } from '../utils/autocleanup.js';

// Startup task (dulu berjalan di module-scope server.js)
seedOwner().catch((e) => console.error('[SEED] Gagal membuat owner: ' + (e && e.message)));
cleanupExpiredSessions();
// Auto-start semua bot telegram yang berstatus online (aman saat HMR reload).
initTelegramBots();
// Pastikan gambar QRIS statis merchant untuk card bawah #purchase tersedia.
ensureStaticQRIS().catch(() => {});
// Scheduler Auto-Cleanup akun nonaktif (jalan tiap 60 menit, hormati enabled).
startAutoCleanupScheduler();

export default function createRequestHandler() {
    return async function requestHandler(req, res) {
        const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

        if (url.pathname.startsWith('/api/')) {
            try {
                await handleAPI(req, res, url);
            } catch (e) {
                console.error('[API ERROR]', e.message);
                // Jangan menimpa respons yang sudah terkirim (mis. SSE /api/chat/stream).
                if (!res.headersSent) {
                    sendJSON(res, 500, { success: false, message: 'Terjadi kesalahan pada sistem. Silakan coba beberapa saat lagi.' });
                }
            }
            return;
        }

        // File hasil generate (gambar QRIS pembayaran) disajikan dari data/qris.
        if (url.pathname.startsWith('/files/')) {
            try {
                serveFromDir(req, res, url, QRIS_IMAGE_DIR);
            } catch (e) {
                console.error('[FILES ERROR]', e.message);
                if (!res.headersSent) sendJSON(res, 500, { success: false, message: 'Terjadi kesalahan pada sistem.' });
            }
            return;
        }

        serveStatic(req, res, url);
    };
}
