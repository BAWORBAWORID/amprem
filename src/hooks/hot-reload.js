/**
 * HMR (Hot Module Replacement) — ESM-aware.
 * 
 * Sistem cache buster (?amts=<stamp>) telah dihapus/disable.
 * Modul masih bisa di-hot-swap via fs.watch, tetapi tidak akan otomatis 
 * menambahkan query parameter ke setiap import.
 * 
 * Untuk cache buster manual, gunakan ?amts=<timestamp> di URL browser.
 */

import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// Hilangkan HOT_PREFIXes - systematisasi cache buster dinonaktifkan
// prefix tetap ada untuk referensi, tetapi resolve hook tidak akan menyisipkan ?amts

let stamp = Date.now();

/** Tidak digunakan untuk cache buster (dihapus). Fungsi tersisa untuk referensi. */
export function bump() {
    stamp = Date.now();
    // Catatan: stamp diupdate, tetapi tidak lagi disuntikkan ke modul via resolve hook
    // Gunakan ?amts=<stamp> manual di browser jika perlu.
}

/** 
 * resolve hook - cache buster DINONAKTIFIKAN.
 * Sebelum: menyisipkan ?amts=${stamp} ke semua modul src/ dan services/
 * Sesudah: tidak menyisipkan query parameter apa-apa (melainkan melewati nextResolve)
 */
registerHooks({
    resolve(specifier, context, nextResolve) {
        const res = nextResolve(specifier, context);
        if (!res || typeof res.url !== 'string' || !res.url.startsWith('file:')) {
            return res;
        }
        // Cache buster (?)amts=<stamp> telah dihapus dari sini.
        // Modul di-load tanpa query parameter stamp otomatis.
        return res;
    },
});
