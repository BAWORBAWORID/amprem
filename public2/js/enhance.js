(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var progressBar = document.getElementById('scroll-progress');
    var btnBackTop = document.getElementById('btn-back-top');
    var ticking = false;

    function updateScrollUI() {
        var doc = document.documentElement;
        var max = doc.scrollHeight - window.innerHeight;
        var y = window.scrollY || doc.scrollTop;
        if (progressBar) {
            progressBar.style.width = max > 0 ? ((y / max) * 100).toFixed(2) + '%' : '0%';
        }
        if (btnBackTop) {
            btnBackTop.classList.toggle('show', y > 420);
        }
        ticking = false;
    }

    function onScroll() {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(updateScrollUI);
        }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    updateScrollUI();

    if (btnBackTop) {
        btnBackTop.addEventListener('click', function () {
            if (reduceMotion) {
                window.scrollTo(0, 0);
            } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }

    document.addEventListener('pointerdown', function (e) {
        var btn = e.target.closest('.btn-primary');
        if (!btn) return;
        var rect = btn.getBoundingClientRect();
        btn.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
        btn.style.setProperty('--my', (e.clientY - rect.top) + 'px');
    }, true);
})();

/* ============================== HARDENING (perketat) ============================== */
(function () {
    'use strict';

    // Blocker dipisah sebagai referensi fungsi tetap agar bisa di-add berulang.
    // Browser mengabaikan listener duplikat yang identik, jadi re-ikat berkala
    // (self-healing) aman — proteksi tidak bisa dicabut oleh script lain.
    var ctxBlocker = function (e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    };
    var dragBlocker = function (e) {
        if (e.target && e.target.tagName === 'IMG') e.preventDefault();
    };
    var downBlocker = function (e) {
        if (e.target && e.target.tagName === 'IMG') e.preventDefault();
    };

    function bindBlockers() {
        document.addEventListener('contextmenu', ctxBlocker, true);
        document.addEventListener('dragstart', dragBlocker, true);
        document.addEventListener('mousedown', downBlocker, true);
    }

    bindBlockers();
    setInterval(bindBlockers, 5000);
})();
