/**
 * security.js
 * ===========
 * Script proteksi anti-devtools / anti-scraper untuk situs AlwaysCodex.
 * (hasil deobfuscate dari script proteksi sejenis)
 *
 * Fungsi script ini: PROTEKSI ANTI-SCRAPER / ANTI-DEVTOOLS untuk situs.
 * Isi (setelah di-deobfuscate, logika asli tidak diubah):
 *
 * 1. Skip jika dibuka dari localhost/127.0.0.1 (agar developer bebas debug)
 * 2. Tampilkan peringatan konsol ("STOP RIGHT THERE", UU ITE, dll)
 * 3. Blokir: klik kanan, F12, Ctrl+Shift+I/J/C/K, Ctrl+U, Ctrl+S, Ctrl+A
 * 4. Blokir seleksi teks (selectstart) & drag (dragstart)
 * 5. Deteksi DevTools terbuka:
 *    - ukuran jendela (outerWidth-outerHeight) menyimpang > 160px
 *    - timing "debugger" (delay > 100ms)
 *    → jika terdeteksi, ganti seluruh halaman dengan "Akses Ditolak"
 * 6. Override console.* menjadi no-op
 * 7. Jebakan objek Image (getter id → panggil blok halaman)
 */

(function () {
    'use strict';

    /* 1. Skip proteksi jika dibuka dari localhost (developer) */
    var host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return;
    }

    /* 2. Peringatan di konsol browser */
    var cRed = 'color:#ff4444;font-size:28px;font-weight:bold;text-shadow:0 0 10px #ff0000;';
    var cOrange = 'color:#ffaa00;font-size:13px;font-weight:bold;';
    var cGreen = 'color:#00ff88;font-size:12px;';
    var cGray = 'color:#888;font-size:11px;font-style:italic;';
    var cDarkRed = 'color:#ff4444;font-size:14px;font-weight:bold;';
    console.log('%c⛔ STOP RIGHT THERE!', cRed);
    console.log('%c════════════════════════════════════════════════════════', 'color:#ff4444');
    console.log('%c██████╗ ██╗   ██╗███████╗███████╗███████╗███╗   ██╗\n██╔══██╗╚██╗ ██╔╝╚════██║██╔════╝██╔════╝████╗  ██║\n██████╔╝ ╚████╔╝     ██╔╝█████╗  █████╗  ██╔██╗ ██║\n██╔══██╗  ╚██╔╝     ██╔╝ ██╔══╝  ██╔══╝  ██║╚██╗██║\n██║  ██║   ██║      ██║  ███████╗███████╗██║ ╚████║\n╚═╝  ╚═╝   ╚═╝      ╚═╝  ╚══════╝╚══════╝╚═╝  ╚═══╝', 'color:#ff4444;font-size:10px;font-family:monospace;line-height:1.4;');
    console.log('%c════════════════════════════════════════════════════════', 'color:#ff4444');
    console.log('%c🔍 Hei, pencuri kode! Lagi nyari apa? 😏', cOrange);
    console.log('%c📌 IP kamu sudah tercatat oleh sistem kami.', cDarkRed);
    console.log('%c🚨 Aktivitas ini dilaporkan ke: security@alwayscodex.my.id', cOrange);
    console.log('%c════════════════════════════════════════════════════════', 'color:#ff4444');
    console.log('%c💡 Fun fact: Semua kode di sini sudah dienkripsi & diobfuscate.', cGreen);
    console.log('%c   Bahkan kalau kamu bisa baca, kamu tidak akan mengerti apa-apa. 😂', cGreen);
    console.log('%c════════════════════════════════════════════════════════', 'color:#ff4444');
    console.log('%c⚠️  Penggunaan tidak sah dapat dikenakan sanksi hukum.\n    Pasal 30 UU ITE No.19/2016 tentang Akses Ilegal.', cOrange);
    console.log('%c════════════════════════════════════════════════════════', 'color:#ff4444');
    console.log('%c😈 Selamat menikmati halaman kosong ini. Sampai jumpa!', cGray);
    console.log('%c════════════════════════════════════════════════════════', 'color:#ff4444');

    /* 3. Blokir klik kanan */
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        return false;
    });

    /* 3b. Blokir shortcut devtools / view-source / save / select-all */
    document.addEventListener('keydown', function (e) {
        var blocked = false;
        if (e.keyCode === 123) blocked = true;                 // F12
        if (e.ctrlKey && e.shiftKey && e.keyCode === 73) blocked = true; // Ctrl+Shift+I
        if (e.ctrlKey && e.shiftKey && e.keyCode === 74) blocked = true; // Ctrl+Shift+J
        if (e.ctrlKey && e.shiftKey && e.keyCode === 67) blocked = true; // Ctrl+Shift+C
        if (e.ctrlKey && e.shiftKey && e.keyCode === 75) blocked = true; // Ctrl+Shift+K
        if (e.ctrlKey && e.keyCode === 85) blocked = true;     // Ctrl+U (view source)
        if (e.ctrlKey && e.keyCode === 83) blocked = true;     // Ctrl+S (save)
        if (e.ctrlKey && e.keyCode === 65) blocked = true;     // Ctrl+A (select all)
        if (blocked) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, true);

    /* 4. Blokir seleksi teks & drag */
    document.addEventListener('selectstart', function (e) {
        e.preventDefault();
        return false;
    });
    document.addEventListener('dragstart', function (e) {
        e.preventDefault();
        return false;
    });

    /* 5. Deteksi DevTools terbuka → ganti halaman jadi "Akses Ditolak" */
    var DEVTOOLS_GAP = 160; // toleransi selisih ukuran jendela (px)
    var blockedAlready = false;
    // Perangkat sentuh: address bar mobile bisa menyusut/mengembang sehingga
    // selisih ukuran jendela melebihi ambang tanpa DevTools terbuka → skip
    // deteksi berbasis ukuran di perangkat touch agar user tidak terkunci.
    var isTouchDevice = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

    function isDevToolsOpenBySize() {
        if (isTouchDevice) return false;
        var w = window.outerWidth - window.innerWidth;
        var h = window.outerHeight - window.innerHeight;
        return w > DEVTOOLS_GAP || h > DEVTOOLS_GAP;
    }

    function showAccessDenied() {
        if (blockedAlready) return;
        blockedAlready = true;
        document.documentElement.innerHTML = '<html><head><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f172a;display:flex;justify-content:center;align-items:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#f8fafc;flex-direction:column;gap:16px}.icon{font-size:4rem}.title{font-size:1.8rem;font-weight:700}.sub{font-size:1rem;color:#94a3b8;text-align:center;max-width:380px;line-height:1.6}</style></head><body><div class="icon">&#128274;</div><div class="title">Akses Ditolak</div><div class="sub">Developer Tools terdeteksi aktif.<br>Silakan tutup dan muat ulang halaman untuk melanjutkan.</div></body></html>';
    }

    /* Cek berkala: selisih ukuran jendela (indikasi devtools docked) */
    setInterval(function () {
        if (isDevToolsOpenBySize()) showAccessDenied();
    }, 800);

    /* Cek berkala: timing debugger (devtools open memperlambat eksekusi) */
    function checkDebuggerTiming() {
        var t0 = new Date();
        debugger; // jika devtools terbuka, baris ini berhenti → delay besar
        var elapsed = new Date() - t0;
        if (elapsed > 100) showAccessDenied();
    }
    setInterval(checkDebuggerTiming, 1000);

    /* 6. Matikan semua console.* agar tidak bisa dibaca pencuri kode */
    try {
        function noop() {}
        var methods = ['log', 'warn', 'error', 'info', 'debug', 'table', 'dir', 'dirxml', 'trace', 'group', 'groupCollapsed', 'groupEnd', 'count', 'assert', 'profile', 'profileEnd', 'time', 'timeEnd'];
        methods.forEach(function (m) {
            try { console[m] = noop; } catch (err) {}
        });
    } catch (err) {}

    /* 7. Jebakan: mengakses properti id pada Image → blok halaman */
    var trapImg = new Image();
    Object.defineProperty(trapImg, 'id', {
        get: function () {
            showAccessDenied();
        }
    });
    setInterval(function () {
        console.log(trapImg);
    }, 1000);
})();
