/**
 * SHIM — server.js lama (monolit 1.556 baris) sudah dipecah menjadi modul:
 *
 *   index.js              → entry point (HTTP server + HMR)
 *   src/app/index.js      → perangkai middleware + rute
 *   src/middleware/index.js → file statis + keamanan
 *   src/routes/api.js     → semua endpoint /api/*
 *   src/utils/*           → store, session, auth, am, chat, security, logger
 *
 * File ini hanya meneruskan ke index.js supaya `npm start` / `node server.js`
 * tetap bekerja tanpa mengubah package.json.
 * Kode asli tersimpan di server.js.monolith.bak
 */
import './index.js';
