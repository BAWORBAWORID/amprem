/**
 * Keamanan: header, deteksi bot/curl, dan halaman umpan.
 * Dipisah dari server agar bisa dipakai ulang oleh middleware & store.
 */

export const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-XSS-Protection': '1; mode=block',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// Pola User-Agent alat/script otomatis (bukan browser asli)
export const BOT_UA_PATTERN = /(curl\/|wget\/|python-requests|python-urllib|python-http|go-http-client|java\/[0-9]|okhttp|libwww-perl|httpie|powershell|scrapy|php\/[0-9]|axios|node-fetch|postmanruntime|insomnia|ruby\/|perl\/)/i;

// Halaman umpan untuk bot — terlihat seperti interstitial "cek browser"
// (meniru Cloudflare), tidak mengandung konten asli sama sekali.
export const DECOY_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Just a moment...</title><meta name="robots" content="noindex"></head><body style="margin:0;background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center;max-width:380px"><div style="font-size:2.5rem;margin-bottom:16px">&#128274;</div><h1 style="font-size:1.4rem;margin:0 0 8px">Checking your browser...</h1><p style="color:#94a3b8;font-size:0.9rem;line-height:1.6;margin:0">Please enable JavaScript and cookies to continue loading the page.</p></div></body></html>';

export function isBotRequest(req) {
    const ua = String(req.headers['user-agent'] || '').trim();
    const accept = String(req.headers['accept'] || '');
    const via = String(req.headers['via'] || '');

    // 1) User-Agent jelas dari alat/script otomatis
    if (BOT_UA_PATTERN.test(ua)) return true;

    // 2) Tidak ada User-Agent sama sekali (script nakal tanpa identitas)
    if (!ua && !via) return true;

    // 3) Accept tidak menyebut text/html (browser asli selalu kirim ini)
    if (accept && !/text\/html|application\/xhtml\+xml|\*\//i.test(accept)) return true;

    return false;
}
