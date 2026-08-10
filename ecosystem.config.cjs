/**
 * Konfigurasi PM2 untuk server AM Premium Creator.
 *
 * AM_HMR=1  -> HMR aktif: perubahan file di src/ atau services/ otomatis
 *              memuat ulang app engine TANPA restart proses (runtime online).
 *
 * Pemakaian:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save        # simpan config + env agar bertahan saat reboot (pm2 resurrect)
 */
module.exports = {
    apps: [
        {
            name: 'am',
            script: './server.js',
            cwd: __dirname,
            instances: 1,
            autorestart: true,
            max_restarts: 20,
            min_uptime: 5000,
            kill_timeout: 5000,
            env: {
                NODE_ENV: 'production',
                PORT: '5000',
                AM_HMR: '1',
            },
        },
    ],
};
