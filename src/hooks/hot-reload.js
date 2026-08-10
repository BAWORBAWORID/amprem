/**
 * HMR (Hot Module Replacement) — ESM-aware.
 *
 * Masalah: cache-busting `import('app/index.js?update=N')` hanya memuat ulang
 * entry; static imports (routes/api.js, utils/*) TETAP di-cache Node.
 *
 * Solusi: `module.registerHooks` (Node >= 22.10) dengan resolve hook yang
 * menyisipkan query `?amts=<stamp>` ke SEMUA modul di src/ dan services/.
 * Setiap kali stamp di-bump, seluruh graph app engine dimuat ulang — tanpa
 * me-restart proses, runtime tetap online.
 */
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const HOT_PREFIXES = [
    path.join(ROOT, 'src') + path.sep,
    path.join(ROOT, 'services') + path.sep,
];

let stamp = Date.now();

/** Panggil sebelum reload app engine agar seluruh graph dapat stamp baru. */
export function bump() {
    stamp = Date.now();
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        const res = nextResolve(specifier, context);
        if (!res || typeof res.url !== 'string' || !res.url.startsWith('file:')) {
            return res;
        }
        let filePath = '';
        try {
            filePath = decodeURIComponent(new URL(res.url).pathname);
        } catch (e) {
            return res;
        }
        if (HOT_PREFIXES.some((p) => filePath.startsWith(p))) {
            const u = new URL(res.url);
            u.searchParams.set('amts', stamp);
            u.hash = '';
            return { url: u.href, shortCircuit: true };
        }
        return res;
    },
});
