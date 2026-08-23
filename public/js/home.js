(function () {
    'use strict';

    var API_BASE = window.API_BASE_URL || '';

    function api(path, options) {
        var opts = options || {};
        opts.headers = Object.assign({}, opts.headers || {});
        if (opts.body && typeof opts.body !== 'string') {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(opts.body);
        }
        return fetch(API_BASE + path, opts).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
                if (!res.ok && !(data && data.success)) {
                    var err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
                    err.status = res.status;
                    throw err;
                }
                return data;
            });
        });
    }

    // Pesan error dari api() yang bisa dibaca user; fallback ke teks generik
    // bila koneksi gagal (Failed to fetch) atau tidak ada pesan jelas.
    function errMsg(err) {
        var m = err && err.message;
        if (m && m !== 'Failed to fetch' && m.indexOf('Load failed') === -1) return m;
        return 'Gagal terhubung ke server.';
    }

    // ==== Validasi kode referal (banner atas + status inline di bawah field) ====
    // state: idle | checking | valid | invalid | error
    function setReferralUI(state, opts) {
        opts = opts || {};
        var banner = $('invite-banner');
        var status = $('referral-status');
        var icon = state === 'checking' ? '<i class="fa-solid fa-spinner fa-spin icon"></i>'
            : state === 'valid' ? '<i class="fa-solid fa-circle-check icon"></i>'
            : state === 'invalid' ? '<i class="fa-solid fa-circle-xmark icon"></i>'
            : state === 'error' ? '<i class="fa-solid fa-circle-exclamation icon"></i>'
            : '<i class="fa-solid fa-gift icon" style="opacity:.55"></i>';
        var text = opts.text || '';
        if (status) {
            if (state === 'idle') {
                status.className = 'referral-status idle';
                status.innerHTML = icon + '<span>Kode referral opsional</span>';
            } else {
                status.className = 'referral-status ' + state;
                status.innerHTML = icon + '<span>' + text + '</span>';
            }
        }
        if (banner) {
            if (state === 'idle') {
                banner.classList.add('hidden');
            } else {
                banner.classList.remove('hidden');
                banner.className = 'invite-banner ' + (state === 'error' ? 'error' : state);
                banner.innerHTML = icon + '<div>' + text + '</div>';
            }
        }
    }
    // Ambil kode referal dari URL: /invite?code= / ?ref= / #referal?ref= / #register?ref=
    function getReferralFromUrl() {
        try {
            var code = '';
            var hash = window.location.hash || '';
            var hi = hash.indexOf('?');
            if (hi !== -1) {
                var hq = new URLSearchParams(hash.substring(hi + 1));
                code = hq.get('ref') || hq.get('referral') || hq.get('invite') || hq.get('code') || '';
            }
            if (code) return code;
            var q = new URLSearchParams(window.location.search);
            return q.get('code') || q.get('ref') || q.get('referral') || q.get('invite') || '';
        } catch (e) { return ''; }
    }
    // Check kode ke backend. Bedakan NETWORK ERROR (⚠) vs INVALID (✕).
    function checkReferral(code) {
        code = String(code || '').trim();
        if (!code) { setReferralUI('idle'); return; }
        setReferralUI('checking', { text: 'Mengecek kode referral <b>' + esc(code) + '</b>...' });
        api('/api/invite/check?code=' + encodeURIComponent(code))
            .then(function (data) {
                // Anti race condition: abaikan respons lama bila field sudah berubah
                var now = $('register-referral');
                if (!now || now.value.trim() !== code) return;
                if (data && data.valid) {
                    setReferralUI('valid', { text: '<b>Kode referral valid</b>' + (data.username ? ' — dari <b>@' + esc(data.username) + '</b>' : '') + '. Daftar dengan kode ini dan dapatkan <b>10 kredit gratis</b>.' });
                } else {
                    setReferralUI('invalid', { text: '<b>Kode referral tidak valid</b>. Kamu tetap bisa daftar, tapi tanpa bonus kredit.' });
                }
            })
            .catch(function () {
                var now = $('register-referral');
                if (!now || now.value.trim() !== code) return;
                // Jangan bilang "kode salah" — server tidak memberi jawaban.
                setReferralUI('error', { text: '<b>Tidak dapat memeriksa kode referral.</b> Silakan coba lagi. Register tetap bisa dilanjutkan.' });
            });
    }

    var currentScreen = null;

    // Alias hash kanonik: #referal (canonical) ≡ #referral (compat)
    var SCREEN_ALIASES = { referal: 'referral' };
    function normalizeScreen(name) { return SCREEN_ALIASES[name] || name; }

    // api() dapat melempar untuk error HTTP asli (401/500/dll). Tangani di satu
    // tempat agar tidak jadi unhandled rejection yang berisik di konsol.
    window.addEventListener('unhandledrejection', function (e) {
        try { e.preventDefault(); } catch (err) {}
    });

    var currentUser = null;
    // Status maintenance fitur yang perlu diketahui sisi klien (misal: bolehkan
    // role 'user' pakai API Key). Diisi oleh loadMaintenance().
    var APP_MAINT = {};
    var chatPollTimer = null;
    var chatEventSource = null;
    var batchPollTimer = null;
    var currentBatch = null;
    var historyCache = [];
    var adminUsersCache = [];
    var adminLogsCache = [];
    var adminIpsCache = [];
    var adminBannedIpsCache = [];

    var ROLE_BADGE = {
        owner: 'badge-owner', vip: 'badge-admin', premium: 'badge-premium',
        autogen: 'badge-autogen', reseller: 'badge-reseller', user: 'badge-normal'
    };
    var ROLE_LABEL = { owner: 'Owner', vip: 'VIP', premium: 'Premium', autogen: 'Auto Gen', reseller: 'Reseller', user: 'User' };
    var PROFILE_ROLE = { owner: 'Owner', vip: 'VIP', premium: 'Premium', autogen: 'Auto Gen', reseller: 'Reseller', pro: 'Pro', user: 'Anggota' };

    var VALID_SCREENS = ['dashboard', 'generator', 'lifetime', 'netflix', 'purchase', 'chat', 'apiguide', 'profile', 'referral', 'admin', 'contributors', 'history', 'settings', 'reviews', ];

    function setLastScreenCookie(name) {
        try { document.cookie = 'last_page=' + encodeURIComponent(name) + '; Path=/; Max-Age=2592000; SameSite=Lax'; } catch (e) {}
    }
    function getLastScreenCookie() {
        try {
            var m = document.cookie.match(/(?:^|;\s*)last_page=([^;]+)/);
            return m ? decodeURIComponent(m[1]) : '';
        } catch (e) { return ''; }
    }

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function isUnlimitedRole(role) {
        return ['reseller', 'premium', 'autogen', 'vip', 'owner'].indexOf(role) !== -1;
    }
    function hasApiRole(role) {
        return ['premium', 'autogen', 'vip', 'owner', 'pro'].indexOf(role) !== -1;
    }
    function hasBulkRole(role) {
        return ['autogen', 'vip', 'owner'].indexOf(role) !== -1;
    }
    function isPrivileged() {
        return currentUser && isUnlimitedRole(currentUser.role);
    }
    function isAdminOrOwner() {
        return currentUser && ['owner'].indexOf(currentUser.role) !== -1;
    }
    function isOwner() { return currentUser && currentUser.role === 'owner'; }
    function creditsDisplay() { return isPrivileged() ? 'Unlimited' : (currentUser ? currentUser.credits : 0); }

    /* ============================== SIDEBAR & ROUTING ============================== */

    function updateNavbar() {
        if (!currentUser) {
            $('app-sidebar').classList.add('hidden');
            $('mobile-top-bar').classList.add('hidden');
            $('app-layout').classList.remove('sidebar-active');
            return;
        }
        $('app-sidebar').classList.remove('hidden');
        $('mobile-top-bar').classList.remove('hidden');
        $('app-layout').classList.add('sidebar-active');

        var navUsername = $('nav-username'), navCredits = $('nav-credits'), navRoleBadge = $('nav-role-badge');
        if (navUsername) navUsername.textContent = currentUser.username;
        if (navCredits) navCredits.textContent = creditsDisplay() + ' Credits';
        if (navRoleBadge) {
            navRoleBadge.textContent = ROLE_LABEL[currentUser.role] || 'User';
            navRoleBadge.className = 'badge ' + (ROLE_BADGE[currentUser.role] || 'badge-normal');
        }

        var isAdmin = isAdminOrOwner();
        $('sidebar-admin-category').classList.toggle('hidden', !isAdmin);
        $('btn-admin-view').classList.toggle('hidden', !isAdmin);
        $('btn-settings-view').classList.toggle('hidden', !isAdmin);

        buildMobileMenu();
        syncMobileActive(currentScreen);
    }

    function showScreen(name) {
        name = normalizeScreen(name);
        if (name === 'auth') {
            currentScreen = 'auth';
            // Hapus hash agar URL bersih; simpan niat (intended) agar direct-access #referal/#lifetime
            // tetap pulih setelah login (lihat handler login).
            if (!window.location.hash) setLastScreenCookie('');
            document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); });
            $('screen-auth').classList.remove('hidden');
            $('app-sidebar').classList.add('hidden');
            $('mobile-top-bar').classList.add('hidden');
            $('app-layout').classList.remove('sidebar-active');
            $('main-content').classList.remove('profile-screen-active');
            closeSidebar();
            return;
        }
        if (VALID_SCREENS.indexOf(name) === -1) name = 'dashboard';
        if ((name === 'admin' || name === 'settings') && !isAdminOrOwner()) name = 'dashboard';
        if (name === 'apiguide' && (!currentUser || !hasApiRole(currentUser.role)) && !(currentUser && currentUser.role === 'user' && APP_MAINT && !APP_MAINT.apikeyUserDisabled)) name = 'dashboard';
        $('main-content').classList.toggle('profile-screen-active', name === 'profile');
        if (name !== 'chat') closeChatStream();

        if (name !== 'auth') setLastScreenCookie(name);
        // Hash kanonik: referral → #referal (tetap terima #referral saat masuk)
        window.location.hash = (name === 'referral') ? 'referal' : name;
        document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); });
        $('screen-' + name).classList.remove('hidden');
        document.querySelectorAll('.sidebar-link').forEach(function (b) { b.classList.remove('active'); });
        var btn = $('btn-' + name + '-view');
        if (btn) {
            btn.classList.add('active');
            // Pastikan item menu aktif selalu terlihat (anti-tertutup footer di layar pendek)
            try { btn.scrollIntoView({ block: 'nearest' }); } catch (e) { btn.scrollIntoView(); }
        }
        syncMobileActive(name);
        currentScreen = name;
        closeSidebar();

        var loader = {
            dashboard: loadDashboard, generator: loadGenerator, lifetime: loadLifetimeScreen, netflix: loadNetflix,
            purchase: loadAPIPanel, chat: loadChatPanel, apiguide: loadAPIGuide,
            profile: loadProfile, referral: loadReferralScreen, admin: loadAdminPanel, history: loadHistoryScreen,
            settings: loadAdminSettings, reviews: loadReviewsScreen
        }[name];
        if (loader) loader();
    }

    function closeSidebar() {
        $('app-sidebar').classList.remove('active');
        $('sidebar-overlay').classList.remove('active');
        closeMobileMenu();
    }

    /* ============================== MOBILE MENU (⋮ DRAWER) ============================== */
    // Drawer mobile di-render dari DATA MENU EXISTING (#nav-menu) — satu sumber
    // kebenaran, bukan menu kedua yang hardcoded. Grup mengikuti struktur update.md.
    var MOBILE_MENU_GROUPS = [
        { label: 'Statistik Live', leaf: 'dashboard' },
        { label: 'AM Generator', children: ['generator', 'netflix', 'history'] },
        { label: 'Layanan & API', children: ['purchase', 'apiguide', 'chat'] },
        { label: 'Akun & Aplikasi', children: ['profile', 'referral', 'lifetime', 'reviews', 'contributors'] },
        { label: 'Support & APK', children: ['whatsapp', 'apk'] },
        { label: 'Pengaturan Admin', children: ['admin', 'settings'] }
    ];

    function openMobileMenu() {
        var drawer = $('mobile-drawer'), overlay = $('mobile-drawer-overlay'), trigger = $('btn-mobile-menu-trigger');
        if (!drawer) return;
        drawer.classList.add('active');
        drawer.setAttribute('aria-hidden', 'false');
        if (overlay) overlay.classList.add('active');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
    }

    function closeMobileMenu() {
        var drawer = $('mobile-drawer'), overlay = $('mobile-drawer-overlay'), trigger = $('btn-mobile-menu-trigger');
        if (drawer) { drawer.classList.remove('active'); drawer.setAttribute('aria-hidden', 'true'); }
        if (overlay) overlay.classList.remove('active');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    }

    // Ikon kategori diambil dari icon item pertama grup (reuse icon existing).
    function mobileGroupIcon(itemHtml) {
        var m = /<i[^>]*>.*?<\/i>/.exec(itemHtml || '');
        return m ? m[0] : '<i class="fa-solid fa-bars"></i>';
    }

    function buildMobileMenu() {
        var menu = $('mobile-drawer-menu');
        if (!menu) return;
        if (!menu.dataset.bound) {
            menu.dataset.bound = '1';
            // Delegasi: kategori (accordion), item screen (router existing), link eksternal.
            menu.addEventListener('click', function (ev) {
                var cat = ev.target.closest('.mobile-nav-cat');
                if (cat) {
                    var group = cat.parentElement;
                    var wasOpen = group.classList.contains('open');
                    menu.querySelectorAll('.mobile-nav-group.open').forEach(function (g) { g.classList.remove('open'); g.querySelector('.mobile-nav-cat').setAttribute('aria-expanded', 'false'); });
                    if (!wasOpen) { group.classList.add('open'); group.querySelector('.mobile-nav-cat').setAttribute('aria-expanded', 'true'); }
                    return;
                }
                var authTab = ev.target.closest('.mobile-drawer-item[data-auth-tab]');
                if (authTab) {
                    showScreen('auth');
                    var toReg = $('link-to-register'), toLog = $('link-to-login');
                    if (authTab.getAttribute('data-auth-tab') === 'register' && toReg) toReg.click();
                    else if (toLog) toLog.click();
                    return;
                }
                var item = ev.target.closest('.mobile-drawer-item[data-screen]');
                if (item) {
                    showScreen(item.getAttribute('data-screen'));
                    return; // showScreen → closeSidebar → drawer tertutup
                }
                var link = ev.target.closest('.mobile-drawer-item[href]');
                if (link) closeMobileMenu(); // browser meneruskan link (tab baru/download)
            });
        }
        menu.innerHTML = '';

        // Kumpulkan item dari sidebar existing.
        var screens = {};
        var links = [];
        document.querySelectorAll('#nav-menu .sidebar-link').forEach(function (el) {
            if (el.tagName === 'A') {
                links.push({ html: el.innerHTML, href: el.getAttribute('href') || '#', download: el.getAttribute('download'), target: el.getAttribute('target') || '' });
                return;
            }
            var m = /^btn-(.+)-view$/.exec(el.id);
            if (m) screens[m[1]] = { html: el.innerHTML, hidden: el.classList.contains('hidden') };
        });
        function findLink(kind) {
            for (var i = 0; i < links.length; i++) {
                if (kind === 'whatsapp' && /whatsapp\.com\/channel|wa\.me|whatsapp/i.test(links[i].href)) return links[i];
                if (kind === 'apk' && /\.apk($|\?)/i.test(links[i].href)) return links[i];
            }
            return null;
        }

        var isAdmin = isAdminOrOwner();
        var sectionLabel = document.querySelector('.mobile-drawer-section-label');
        if (!currentUser) {
            // Menu tamu TERPISAH dari menu home: hanya akses (login/register + link publik).
            if (sectionLabel) sectionLabel.textContent = 'AKSES';
            var guestHtml =
                '<button type="button" class="mobile-drawer-item mobile-drawer-login-btn" data-auth-tab="login"><i class="fa-solid fa-right-to-bracket"></i> Login</button>' +
                '<button type="button" class="mobile-drawer-item" data-auth-tab="register"><i class="fa-solid fa-user-plus"></i> Register</button>';
            var waLink = findLink('whatsapp'), apkLink = findLink('apk');
            if (waLink) guestHtml += '<a class="mobile-drawer-item" href="' + esc(waLink.href) + '" target="_blank">' + waLink.html + '</a>';
            if (apkLink) guestHtml += '<a class="mobile-drawer-item" href="' + esc(apkLink.href) + '"' + (apkLink.download ? ' download="' + esc(apkLink.download) + '"' : '') + ' target="_blank">' + apkLink.html + '</a>';
            menu.insertAdjacentHTML('beforeend', guestHtml);
        } else {
            if (sectionLabel) sectionLabel.textContent = 'MENU';
            MOBILE_MENU_GROUPS.forEach(function (group) {
            var html = '';
            if (group.leaf) {
                var leafItem = screens[group.leaf];
                if (!leafItem || leafItem.hidden) return;
                html += '<button type="button" class="mobile-drawer-item" data-screen="' + group.leaf + '">' + leafItem.html + '</button>';
                menu.insertAdjacentHTML('beforeend', html);
                return;
            }
            // Grup admin: validasi logika (bukan sekadar CSS).
            if (group.label === 'Pengaturan Admin' && !isAdmin) return;
            var firstIcon = null;
            group.children.forEach(function (name) {
                var itemHtml = null, href = null, download = null, target = null;
                if (name === 'whatsapp' || name === 'apk') {
                    var link = findLink(name);
                    if (link) { itemHtml = link.html; href = link.href; download = link.download; target = link.target || '_blank'; }
                } else {
                    var item = screens[name];
                    if (!item || item.hidden) return;
                    itemHtml = item.html;
                }
                if (!itemHtml) return;
                if (!firstIcon) firstIcon = mobileGroupIcon(itemHtml);
                if (href !== null) {
                    html += '<a class="mobile-drawer-item" href="' + esc(href) + '"' + (download ? ' download="' + esc(download) + '"' : '') + ' target="' + esc(target) + '">' + itemHtml + '</a>';
                } else {
                    html += '<button type="button" class="mobile-drawer-item" data-screen="' + name + '">' + itemHtml + '</button>';
                }
            });
            if (!html) return;
            menu.insertAdjacentHTML('beforeend',
                '<div class="mobile-nav-group">' +
                '<button type="button" class="mobile-nav-cat" aria-expanded="false">' + firstIcon + '<span class="mobile-nav-cat-label">' + esc(group.label) + '</span><i class="fa-solid fa-chevron-down mobile-nav-chevron"></i></button>' +
                '<div class="mobile-nav-sub">' + html + '</div>' +
                '</div>');
        });
        }
        var mobileLogoutBtn = $('btn-mobile-drawer-logout');
        if (mobileLogoutBtn) mobileLogoutBtn.classList.toggle('hidden', !currentUser);
    }

    function syncMobileActive(name) {
        document.querySelectorAll('#mobile-drawer-menu [data-screen]').forEach(function (el) {
            el.classList.toggle('active', el.getAttribute('data-screen') === name);
        });
    }

    function bindNav() {
        document.querySelectorAll('[id^="btn-"][id$="-view"]').forEach(function (btn) {
            var name = btn.id.replace(/^btn-/, '').replace(/-view$/, '');
            btn.addEventListener('click', function () { showScreen(name); });
        });
        var menuTrigger = $('btn-mobile-menu-trigger');
        if (menuTrigger) menuTrigger.addEventListener('click', function () {
            var drawer = $('mobile-drawer');
            if (drawer && drawer.classList.contains('active')) closeMobileMenu();
            else openMobileMenu();
        });
        var drawerCloseBtn = $('btn-mobile-drawer-close');
        if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeMobileMenu);
        var drawerOverlay = $('mobile-drawer-overlay');
        if (drawerOverlay) drawerOverlay.addEventListener('click', closeMobileMenu);
        var mobileLogout = $('btn-mobile-drawer-logout');
        if (mobileLogout && !mobileLogout.dataset.bound) {
            mobileLogout.dataset.bound = '1';
            mobileLogout.addEventListener('click', handleLogout);
        }
        document.addEventListener('keydown', function (e) {
            var drawer = $('mobile-drawer');
            if (e.key === 'Escape' && drawer && drawer.classList.contains('active')) closeMobileMenu();
        });
        window.addEventListener('hashchange', function () {
            var drawer = $('mobile-drawer');
            if (drawer && drawer.classList.contains('active')) closeMobileMenu();
        });
        buildMobileMenu();
        $('btn-profile-logout').addEventListener('click', handleLogout);
        var sidebarLogout = $('btn-logout');
        if (sidebarLogout && !sidebarLogout.dataset.bound) {
            sidebarLogout.dataset.bound = '1';
            sidebarLogout.addEventListener('click', handleLogout);
        }
        $('btn-topbar-chat').addEventListener('click', function () { showScreen('chat'); });
        $('btn-topbar-profile').addEventListener('click', function () { showScreen('profile'); });
    }

    // Ambil status maintenance ringan (tanpa auth) untuk keperluan UI sisi klien,
    // misalnya menentukan apakah role 'user' diizinkan pakai API Key.
    function loadMaintenance() {
        api('/api/auth/system/settings').then(function (d) {
            if (d && d.maintenance) APP_MAINT = d.maintenance;
        }).catch(function () { /* biarkan APP_MAINT tetap kosong */ });
    }

    /* ============================== AUTH ============================== */

    function checkSession() {
        var attempts = 0;
        themeGateTimer = setTimeout(revealThemePage, 9000);
        function tryFetch() {
            api('/api/auth/profile').then(function (data) {
                if (data.user) {
                    currentUser = data.user;
                    loadMaintenance();
                    applyThemePreference(readThemePreference());
                    revealThemePage();
                    updateNavbar();
                    var hash = normalizeScreen(window.location.hash.replace('#', ''));
                    var last = hash || normalizeScreen(getLastScreenCookie());
                    showScreen(last && VALID_SCREENS.indexOf(last) !== -1 ? last : 'dashboard');
                } else {
                    revealThemePage();
                    showScreen('auth');
                }
            }).catch(function () {
                attempts++;
                if (attempts < 3) setTimeout(tryFetch, 2000);
                else {
                    revealThemePage();
                    showScreen('auth');
                }
            });
            var editBtn = $('btn-change-username');
            if (editBtn && !editBtn.dataset.bound) {
                editBtn.dataset.bound = '1';
                editBtn.addEventListener('click', function () {
                    Swal.fire({
                        title: 'Ubah Username',
                        input: 'text', inputValue: currentUser ? currentUser.username : '',
                        inputLabel: 'Username baru',
                        inputValidator: function (v) { if (!v || v.trim().length < 3) return 'Username minimal 3 karakter'; }
                    }).then(function (r) {
                        if (!r.isConfirmed || !r.value) return;
                        var newName = r.value.trim();
                        if (newName === (currentUser ? currentUser.username : null)) return;
                        api('/api/auth/change-username', { method: 'POST', body: { newUsername: newName } }).then(function (data) {
                            if (data.success) {
                                if (currentUser) currentUser.username = newName;
                                Swal.fire({ icon: 'success', title: 'BERHASIL!', text: 'Username berhasil diubah.', timer: 1500, showConfirmButton: false });
                                updateNavbar();
                                if (currentUser) {
                                    loadProfile();
                                }
                            } else {
                                Swal.fire({ icon: 'error', title: 'KESALAHAN', text: data.message || 'Username sudah dipakai.' });
                            }
                        });
                    });
                });
            }
        }
        tryFetch();
    }

    function setAuthLoading(form, loading) {
        var btn = form.querySelector('button[type="submit"]');
        btn.disabled = loading;
        btn.classList.toggle('btn-loading', loading);
    }

    // ==== Persistensi halaman auth (refresh tetap di view login/register + draft form) ====
    function saveAuthDraft() {
        try {
            var un = $('register-username').value, pw = $('register-password').value, rf = $('register-referral').value;
            if (un || pw || rf) sessionStorage.setItem('am_reg_draft', JSON.stringify({ username: un || '', password: pw || '', referral: rf || '' }));
            var lu = $('login-username').value, lp = $('login-password').value;
            if (lu || lp) sessionStorage.setItem('am_login_draft', JSON.stringify({ username: lu || '', password: lp || '' }));
        } catch (e) {}
    }
    function clearAuthDrafts() {
        try { sessionStorage.removeItem('am_reg_draft'); sessionStorage.removeItem('am_login_draft'); } catch (e) {}
    }
    function setAuthView(v) {
        try { localStorage.setItem('am_auth_view', v === 'register' ? 'register' : 'login'); } catch (e) {}
    }
    function restoreAuthView() {
        try {
            var regView = $('auth-register-view'), logView = $('auth-login-view');
            if (!regView || !logView) return;
            var av = localStorage.getItem('am_auth_view') || 'login';
            if (av === 'register') {
                logView.classList.add('hidden');
                regView.classList.remove('hidden');
                var d = JSON.parse(sessionStorage.getItem('am_reg_draft') || '{}');
                if (d.username) $('register-username').value = d.username;
                if (d.password) $('register-password').value = d.password;
                // CATATAN: referral TIDAK di-restore dari draft. Field referral murni
                // diisi dari URL ?invite= (lihat init di bawah). Ini mencegah referral
                // basi (mis. @alwayscodex) muncul kembali saat buka website tanpa invite.
            } else {
                regView.classList.add('hidden');
                logView.classList.remove('hidden');
                var ld = JSON.parse(sessionStorage.getItem('am_login_draft') || '{}');
                if (ld.username) $('login-username').value = ld.username;
                if (ld.password) $('login-password').value = ld.password;
            }
        } catch (e) {}
    }

    function bindAuth() {
        $('link-to-register').addEventListener('click', function () {
            $('auth-login-view').classList.add('hidden');
            $('auth-register-view').classList.remove('hidden');
            setAuthView('register');
        });
        $('link-to-login').addEventListener('click', function () {
            $('auth-register-view').classList.add('hidden');
            $('auth-login-view').classList.remove('hidden');
            setAuthView('login');
        });
        // Simpan draft isian saat mengetik agar tidak hilang saat refresh
        ['register-username', 'register-password', 'register-referral', 'login-username', 'login-password'].forEach(function (id) {
            var el = $(id);
            if (el) el.addEventListener('input', saveAuthDraft);
        });

        $('form-login').addEventListener('submit', function (e) {
            e.preventDefault();
            setAuthLoading(e.target, true);
            api('/api/auth/login', { method: 'POST', body: { username: $('login-username').value.trim(), password: $('login-password').value } })
                .then(function (data) {
                    if (data.success) {
                        clearAuthDrafts();
                        setAuthView('login');
                        Swal.fire({ icon: 'success', title: 'BERHASIL!', text: 'Login berhasil.', timer: 1500, showConfirmButton: false });
                        document.documentElement.classList.add('theme-pending');
                        themeGateTimer = setTimeout(revealThemePage, 5000);
                        currentUser = data.user;
                        loadMaintenance();
                        applyThemePreference(readThemePreference());
                        revealThemePage();
                        updateNavbar();
                        // Restore halaman yang dituju (mis. #referal / #lifetime) setelah login
                        var intended = normalizeScreen(window.location.hash.replace('#', '').split('?')[0]);
                        showScreen(intended && VALID_SCREENS.indexOf(intended) !== -1 ? intended : 'dashboard');
                    } else {
                        Swal.fire({ icon: 'error', title: 'KESALAHAN', text: data.message || 'Username atau password salah.' });
                    }
                })
                .catch(function (err) { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: errMsg(err) }); })
                .finally(function () { setAuthLoading(e.target, false); });
        });

        $('form-register').addEventListener('submit', function (e) {
            e.preventDefault();
            setAuthLoading(e.target, true);
            var refField = $('register-referral');
            var refCode = (refField && refField.value.trim()) || '';
            if (!refCode) { try { refCode = localStorage.getItem('pendingReferral') || ''; } catch (err) {} }
            var regBody = { username: $('register-username').value.trim(), password: $('register-password').value };
            if (refCode) regBody.referralCode = refCode;
            api('/api/auth/register', { method: 'POST', body: regBody })
                .then(function (data) {
                    if (data.success) {
                        try { localStorage.removeItem('pendingReferral'); } catch (err) {}
                        clearAuthDrafts();
                        setAuthView('login');
                        setReferralUI('idle');
                        Swal.fire({ icon: 'success', title: 'REGISTRASI SUKSES!', text: 'Silakan login dengan akun baru Anda.', timer: 1800, showConfirmButton: false });
                        e.target.reset();
                        setTimeout(function () {
                            $('auth-register-view').classList.add('hidden');
                            $('auth-login-view').classList.remove('hidden');
                        }, 1800);
                    } else {
                        Swal.fire({ icon: 'error', title: 'KESALAHAN', text: data.message || 'Registrasi gagal.' });
                    }
                })
                .catch(function (err) { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: errMsg(err) }); })
                .finally(function () { setAuthLoading(e.target, false); });
        });
    }

    function handleLogout() {
        api('/api/auth/logout', { method: 'POST' }).then(function () {
            Swal.fire({ icon: 'success', title: 'LOGGED OUT', text: 'Sampai jumpa lagi!', timer: 1200, showConfirmButton: false });
            currentUser = null;
            applyThemePreference(readThemePreference());
            showScreen('auth');
        });
    }

    /* ============================== DASHBOARD ============================== */

    function loadDashboard() {
        loadPublicStats();
        loadBattery();
        loadClock();
        loadYourIP();
        loadRuntime();
        loadCreditsCountdown();
    }

    function loadPublicStats() {
        api('/api/public/stats').then(function (data) {
            if (data.totalUsers != null) $('stat-total-users').textContent = data.totalUsers;
            if (data.totalSuccess != null) $('stat-total-requests').textContent = data.totalSuccess;
        });
        if ($('stat-your-credits')) $('stat-your-credits').textContent = creditsDisplay();
    }

    function loadBattery() {
        var icon = $('stat-battery-icon'), status = $('stat-battery-status'), val = $('stat-battery');
        var ua = navigator.userAgent || '';
        var os = 'Perangkat';
        if (/Android/i.test(ua)) os = 'Android';
        else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
        else if (/Windows/i.test(ua)) os = 'Windows';
        else if (/Mac/i.test(ua)) os = 'macOS';
        else if (/Linux/i.test(ua)) os = 'Linux';

        var fallback = function () {
            if (val) val.textContent = os;
            if (status) status.textContent = 'Baterai tidak tersedia (butuh HTTPS)';
            if (icon) {
                icon.className = 'fa-solid fa-mobile-screen-button';
                icon.style.color = '';
            }
        };

        if (!navigator.getBattery) return fallback();
        navigator.getBattery().then(function (battery) {
            function update() {
                var level = Math.round(battery.level * 100);
                if (val) val.textContent = level + '%';
                if (status) status.textContent = battery.charging ? 'Mengisi daya' : 'Tidak mengisi';
                if (icon) {
                    var cls = 'fa-battery-empty';
                    if (level > 75) cls = 'fa-battery-full';
                    else if (level > 50) cls = 'fa-battery-three-quarters';
                    else if (level > 25) cls = 'fa-battery-half';
                    else if (level > 5) cls = 'fa-battery-quarter';
                    icon.className = 'fa-solid ' + cls;
                    icon.style.color = level <= 20 ? 'var(--error)' : '';
                }
            }
            update();
            battery.addEventListener('levelchange', update);
            battery.addEventListener('chargingchange', update);
        }).catch(fallback);
    }

    function loadClock() {
        function tick() {
            var now = new Date();
            var days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
            var months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
            $('stat-day').textContent = days[now.getDay()];
            $('stat-date').textContent = now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
        }
        tick();
        setInterval(tick, 60000);
    }

    function loadYourIP() {
        $('stat-your-ip').textContent = 'Loading...';
        fetch('https://api.ipify.org?format=json').then(function (r) { return r.json(); })
            .then(function (d) { $('stat-your-ip').textContent = d.ip; })
            .catch(function () { $('stat-your-ip').textContent = 'Gagal membaca IP'; });
    }

    var runtimeStart = Date.now();
    function loadRuntime() {
        function tick() {
            var s = Math.floor((Date.now() - runtimeStart) / 1000);
            var h = String(Math.floor(s / 3600)).padStart(2, '0');
            var m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
            var sec = String(s % 60).padStart(2, '0');
            $('stat-runtime').textContent = h + ':' + m + ':' + sec;
        }
        tick();
        setInterval(tick, 1000);
    }

    function loadCreditsCountdown() {
        var el = $('stat-credits-reset-countdown');
        if (!el || isPrivileged()) { if (el) el.textContent = ''; return; }
        function tick() {
            var now = new Date();
            var reset = new Date(now);
            reset.setUTCHours(22, 0, 0, 0);
            if (now > reset) reset.setUTCDate(reset.getUTCDate() + 1);
            var diff = Math.max(0, Math.floor((reset - now) / 1000));
            el.textContent = 'Reset: ' + Math.floor(diff / 3600) + 'j ' + Math.floor((diff % 3600) / 60) + 'm ' + (diff % 60) + 'd';
        }
        tick();
        setInterval(tick, 1000);
    }

    /* ============================== GENERATOR ============================== */

    function loadGenerator() {
        loadUserHistory();
        bindGeneratorTabs();
        setupAutoGenerator();
    }

    function bindGeneratorTabs() {
        $('tab-btn-manual').addEventListener('click', function () {
            $('tab-btn-manual').classList.add('active');
            $('tab-btn-auto').classList.remove('active');
            $('tab-manual-content').classList.remove('hidden');
            $('tab-auto-content').classList.add('hidden');
        });
        $('tab-btn-auto').addEventListener('click', function () {
            $('tab-btn-auto').classList.add('active');
            $('tab-btn-manual').classList.remove('active');
            $('tab-auto-content').classList.remove('hidden');
            $('tab-manual-content').classList.add('hidden');
        });
    }

    function bindGeneratorManual() {
        var btn = $('btn-send-link');
        if (!btn || btn.dataset.bound) return;
        btn.dataset.bound = '1';
        $('form-send-link').addEventListener('submit', function (e) {
            e.preventDefault();
            var email = $('send-email').value.trim();
            if (!email) return Swal.fire({ icon: 'warning', title: 'Perhatian', text: 'Masukkan email target terlebih dahulu.' });
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Memproses...';
            api('/api/am/send-link', { method: 'POST', body: { email: email } })
                .then(function (data) {
                    if (data.success) {
                        $('stage-activate-container').classList.remove('hidden');
                        $('activate-email').value = email;
                        Swal.fire({ icon: 'success', title: 'Tautan Terkirim!', text: 'Cek email target (termasuk folder spam).', timer: 2500, showConfirmButton: false });
                    } else {
                        Swal.fire({ icon: 'error', title: 'KESALAHAN', text: data.message || 'Gagal mengirim tautan.' });
                    }
                })
                .catch(function (err) { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: errMsg(err) }); })
                .finally(function () {
                    btn.disabled = false;
                    btn.innerHTML = 'Lanjutkan <i class="fa-solid fa-arrow-right"></i>';
                });
        });
        $('form-activate').addEventListener('submit', function (e) {
            e.preventDefault();
            var link = $('activate-link').value.trim();
            if (!link) return Swal.fire({ icon: 'warning', title: 'Perhatian', text: 'Tempel tautan verifikasi terlebih dahulu.' });
            var abtn = $('btn-activate');
            abtn.disabled = true;
            abtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Memverifikasi...';
            api('/api/am/claim-premium', { method: 'POST', body: { email: $('activate-email').value, magicLink: link } })
                .then(function (data) {
                    if (data.success) {
                        if (data.creditsRemaining != null && currentUser && !isPrivileged()) {
                            currentUser.credits = data.creditsRemaining;
                        }
                        Swal.fire({ icon: 'success', title: 'PREMIUM AKTIF!', text: 'Lisensi premium berhasil diterapkan. Selamat menikmati!', timer: 2500, showConfirmButton: false });
                        $('form-activate').reset();
                        $('stage-activate-container').classList.add('hidden');
                        loadUserHistory();
                    } else {
                        Swal.fire({ icon: 'error', title: 'GAGAL', text: data.message || 'Tautan verifikasi tidak valid.' });
                    }
                })
                .catch(function (err) { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: errMsg(err) }); })
                .finally(function () {
                    abtn.disabled = false;
                    abtn.innerHTML = 'Terapkan Lisensi Premium <i class="fa-solid fa-bolt"></i>';
                });
        });
    }
        function setupAutoGenerator() {
        bindGeneratorManual();
        if (!currentUser) return;
        var unlocked = currentUser && hasBulkRole(currentUser.role);
        $('autogen-locked-container').classList.toggle('hidden', unlocked);
        $('autogen-unlocked-container').classList.toggle('hidden', !unlocked);
        if (!unlocked) {
            $('btn-buy-autogen-shortcut').addEventListener('click', function () { showScreen('purchase'); });
            return;
        }
        var sel = $('autogen-domain-select');
        if (sel && !sel.dataset.loaded) {
            sel.dataset.loaded = '1';
            var fillDomains = function (list) {
                sel.innerHTML = '';
                list.forEach(function (d) {
                    var opt = document.createElement('option');
                    opt.value = d; opt.textContent = d;
                    sel.appendChild(opt);
                });
            };
            api('/api/am/domains').then(function (data) {
                fillDomains(data.domains && data.domains.length ? data.domains : ['jagomail.com', 'softbank.id', 'premiummail.id']);
            }).catch(function () {
                fillDomains(['jagomail.com', 'softbank.id', 'premiummail.id']);
            });
        }
        if (!$('autogen-custom-toggle').dataset.bound) {
            $('autogen-custom-toggle').dataset.bound = '1';
            $('autogen-custom-toggle').addEventListener('change', function () {
                $('autogen-prefix-container').classList.toggle('hidden', !this.checked);
            });
            $('btn-autogen-run').addEventListener('click', function () {
                var domain = $('autogen-domain-select').value;
                var count = Math.min(500, Math.max(1, parseInt($('autogen-count-input').value, 10) || 5));
                var prefix = $('autogen-custom-toggle').checked ? $('autogen-prefix-input').value.trim() : '';
                var runBtn = this;
                runBtn.disabled = true;
                runBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Menghubungkan...';
                api('/api/am/autogen/start-batch', { method: 'POST', body: { domain: domain, count: count, prefix: prefix } })
                    .then(function (data) {
                        if (data.success) {
                            currentBatch = data.batch;
                            $('autogen-hud').classList.remove('hidden');
                            $('autogen-log-container').classList.remove('hidden');
                            $('autogen-download-area').classList.add('hidden');
                            $('autogen-log-container').innerHTML = '';
                            pollActiveBatch();
                        } else {
                            Swal.fire({ icon: 'error', title: 'GAGAL', text: data.message || 'Gagal memulai batch.' });
                        }
                    })
                    .catch(function (err) { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: errMsg(err) }); })
                    .finally(function () {
                        runBtn.disabled = false;
                        runBtn.innerHTML = '<i class="fa-solid fa-play"></i> Mulai Generate';
                    });
            });
        }
        var downloadBtn = $('btn-autogen-download');
        if (downloadBtn && !downloadBtn.dataset.bound) {
            downloadBtn.dataset.bound = '1';
            downloadBtn.addEventListener('click', function () {
                if (!currentBatch || !currentBatch.results.length) return;
                var lines = ['AM PREMIUM ACCOUNTS BATCH GENERATED - ' + new Date().toLocaleString()];
                currentBatch.results.forEach(function (r, i) {
                    var ok = r.status === 'success';
                    var inbox = r.inboxUrl || ('https://generator.email/' + r.email);
                    lines.push((i + 1) + '. Email: ' + r.email + (r.password ? ' | Password: ' + r.password : '') + (ok ? ' | PREMIUM AKTIF' : ' | GAGAL: ' + (r.error || 'unknown')) + (r.codeorder ? ' | Alwayscodex: ' + r.codeorder : '') + ' | Inbox: ' + inbox + ' | Login Link: ' + (r.verifyLink || '-'));
                });
                lines.push('Total Berhasil: ' + currentBatch.results.length + ' Akun');
                downloadText(lines.join('\n'), 'am-premium-batch.txt');
            });
        }
    }

    function pollActiveBatch() {
        clearInterval(batchPollTimer);
        function poll() {
            api('/api/am/autogen/active-batch').then(function (data) {
                if (data.success && data.batch) {
                    currentBatch = data.batch;
                    $('autogen-hud-remaining').textContent = data.batch.remaining;
                    $('autogen-hud-total').textContent = data.batch.total;
                    var eta = Math.ceil(data.batch.remaining * 7);
                    $('autogen-hud-eta').textContent = Math.floor(eta / 60) + 'm ' + (eta % 60) + 's';
                    var log = $('autogen-log-container');
                    data.batch.logs.forEach(function (line) {
                        if (!log.dataset.lastLine || log.dataset.lastLine !== line) {
                            log.dataset.lastLine = line;
                            var div = document.createElement('div');
                            div.textContent = line;
                            log.appendChild(div);
                            log.scrollTop = log.scrollHeight;
                        }
                    });
                    if (data.batch.status === 'completed') {
                        clearInterval(batchPollTimer);
                        $('autogen-hud-remaining').textContent = '0';
                        $('autogen-download-area').classList.remove('hidden');
                        Swal.fire({ icon: 'success', title: 'SELESAI!', text: 'Batch selesai. ' + data.batch.results.length + ' akun berhasil dibuat.', timer: 2500, showConfirmButton: false });
                    }
                } else if (data.isStalled) {
                    api('/api/am/autogen/resume-batch', { method: 'POST' });
                } else if (!data.batch) {
                    clearInterval(batchPollTimer);
                    $('autogen-hud').classList.add('hidden');
                }
            }).catch(function () {});
        }
        poll();
        batchPollTimer = setInterval(poll, 3000);
    }

    /* ============================== NETFLIX ============================== */

    function loadNetflix() {
        // Cek status maintenance fitur Netflix (tampilkan halaman maintenance jika aktif)
        api('/api/auth/system/settings').then(function (data) {
            var maint = (data && data.maintenance) || {};
            var isDown = !!maint.netflix;
            var content = $('netflix-content-container');
            var maintBox = $('netflix-maintenance-container');
            if (content) content.classList.toggle('hidden', isDown);
            if (maintBox) maintBox.classList.toggle('hidden', !isDown);
        }).catch(function () { /* server offline: biarkan konten normal */ });

        var btn = $('btn-netflix-generate');
        if (btn && !btn.dataset.bound) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', function () {
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processing...';
                api('/api/am/netflix/token')
                    .then(function (data) {
                        if (data.success && data.result) {
                            $('netflix-result-container').classList.remove('hidden');
                            $('netflix-email').textContent = data.result.details.Email || '-';
                            $('netflix-plan').textContent = data.result.details.Plan || '-';
                            $('netflix-billing').textContent = data.result.details['Billing Date'] || '-';
                            $('netflix-expires').textContent = data.result.expires || '-';
                            $('netflix-link-pc').href = data.result.links.pc || '#';
                            $('netflix-link-android').href = data.result.links.android || '#';
                            $('netflix-link-tv').href = data.result.links.tv || '#';
                            Swal.fire({ icon: 'success', title: 'TOKEN DIBUAT!', text: 'Akun Netflix token berhasil digenerate.', timer: 2000, showConfirmButton: false });
                        } else {
                            Swal.fire({ icon: 'error', title: 'KESALAHAN', text: data.message || 'Gagal mengambil token Netflix.' });
                        }
                    })
                    .catch(function (err) { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: errMsg(err) }); })
                    .finally(function () {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fa-solid fa-play"></i> Generate Token Netflix';
                    });
            });
        }
    }

    /* ============================== HISTORY ============================== */

    function loadHistoryScreen() {
        loadUserHistory();
        bindHistoryDownload();
    }

    function loadUserHistory() {
        api('/api/am/history').then(function (data) {
            historyCache = data.history || [];
            renderHistory();
        }).catch(function () { historyCache = []; renderHistory(); });
    }

    function renderHistory() {
        var tbody = $('history-table-body');
        if (!tbody) return;
        if (!historyCache.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px;">Belum ada riwayat aktivasi. Buat akun premium Anda sekarang!</td></tr>';
            return;
        }
        tbody.innerHTML = historyCache.slice().reverse().map(function (h) {
            var status = h.status === 'success' ? '<span class="status-success">Aktif</span>'
                : h.status === 'failed' ? '<span class="status-failed">Gagal</span>'
                : '<span class="status-pending">Memproses</span>';
            return '<tr><td>' + esc(h.createdAt) + '</td><td>' + esc(h.email) + '</td><td>' + esc(h.orderId) + '</td><td>' + status + '</td><td>' + esc(h.note || '-') + '</td></tr>';
        }).join('');
    }

    function bindHistoryDownload() {
        var btn = $('btn-download-history-txt');
        if (!btn || btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', function () {
            if (!historyCache.length) return Swal.fire({ icon: 'info', title: 'Kosong', text: 'Belum ada riwayat akun untuk diunduh.' });
            var lines = historyCache.slice().reverse().map(function (h) { return h.email + '|' + h.orderId; });
            downloadText(lines.join('\n'), 'riwayat-akun.txt');
            Swal.fire({ icon: 'success', title: 'BERHASIL!', text: 'List akun berhasil diunduh.', timer: 1500, showConfirmButton: false });
        });
    }

    function downloadText(content, filename) {
        var blob = new Blob([content], { type: 'text/plain' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    /* ============================== PURCHASE ============================== */

    function paymentMethodBtn(method, icon, color, extraStyle) {
        return '<button type="button" class="swal-payment-btn" data-method="' + method + '" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px 12px;border-radius:10px;border:1px solid var(--border-color);background:rgba(255,255,255,0.03);color:var(--text-primary);cursor:pointer;transition:all 0.2s ease;' + (extraStyle || '') + '">' +
            '<i class="fa-solid ' + icon + '" style="color:' + color + ';font-size:1.8rem;margin-bottom:8px;"></i>' +
            '<span style="font-weight:600;font-size:0.9rem;">' + method + '</span></button>';
    }

    var PLAN_PRICES = {
        reseller: { 3: 7000, 7: 12000, 14: 18000, 30: 25000 },
        premium: { 3: 9000, 7: 15000, 14: 20000, 30: 28000 },
        autogen: { 3: 12000, 7: 20000, 14: 28000, 30: 38000 },
        vip: { 3: 18000, 7: 30000, 14: 42000, 30: 55000 },
        pro: { 30: 15000 }
    };

    // Satu sumber harga di frontend; harus cocok dengan backend.
    // Normalisasi: plan -> lower-case, days -> angka. Return null kalau tidak ditemukan.
    function getPackagePrice(plan, duration) {
        var planKey = String(plan == null ? '' : plan).toLowerCase();
        var days = Number(duration);
        if (!PLAN_PRICES[planKey]) return null;
        var price = PLAN_PRICES[planKey][days];
        return (price == null) ? null : Number(price);
    }

    /* ============================== PEMBAYARAN QRIS (STATIC) ============================== */

    // Membuat order QRIS di backend lalu menampilkan modal pembayaran:
    // QR image, total nominal, countdown dari expiresAt, Cek Status & Batal.
    function startQRISPayment(role, days, name) {
        api('/api/payment/qris', { method: 'POST', body: { role: role, days: days } }).then(function (data) {
            if (!data.success) throw new Error((data && data.message) || 'Gagal membuat pembayaran.');
            var order = data.order;
            var qrUrl = data.payment && data.payment.qr && data.payment.qr.url;
            var amountText = 'Rp ' + Number(order.amount || 0).toLocaleString('id-ID');
            var base = Number(order.baseAmount != null ? order.baseAmount : 0);
            var fee = Number(order.fee != null ? order.fee : 0);
            var fmtRp = function (n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); };
            var waMessage = 'Halo Admin, saya sudah melakukan pembayaran *Upgrade Role*.\n' +
                '*Transaction ID:* ' + order.transaction_id + '\n' +
                '*Username:* ' + (currentUser ? currentUser.username : '-') + '\n' +
                '*Paket:* ' + name + ' - ' + days + ' Hari\n' +
                '*Harga Paket:* ' + fmtRp(base) + '\n' +
                '*Kode Verifikasi (Fee):* ' + fmtRp(fee) + '\n' +
                '*Total Dibayar:* ' + fmtRp(Number(order.amount || 0)) + '\n' +
                '\nMohon dicek dan role diaktifkan ya. Terima kasih!';
            var waHref = 'https://wa.me/6288297563383?text=' + encodeURIComponent(waMessage);
            var endTime = new Date(order.expiresAt).getTime();
            var timer = null;

            function fmtTime(ms) {
                var total = Math.max(0, Math.floor(ms / 1000));
                var h = Math.floor(total / 3600);
                var m = Math.floor((total % 3600) / 60);
                var s = total % 60;
                var pad = function (n) { return String(n).padStart(2, '0'); };
                return (h > 0 ? pad(h) + ':' : '') + pad(m) + ':' + pad(s);
            }
            function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
            function setExpired() {
                var el = document.getElementById('qris-countdown');
                if (el) el.textContent = '00:00';
                var btn = document.getElementById('qris-check-btn');
                if (btn) { btn.disabled = true; btn.textContent = 'Pembayaran Kedaluwarsa'; }
                var hint = document.getElementById('qris-hint');
                if (hint) hint.textContent = 'Pembayaran telah kedaluwarsa. Silakan buat pembayaran baru.';
            }
            function refreshProfile() {
                api('/api/auth/profile').then(function (p) {
                    if (p && p.user) { currentUser = p.user; loadMaintenance(); updateNavbar(); loadProfile(); }
                }).catch(function () {});
            }
            function checkStatus() {
                var btn = document.getElementById('qris-check-btn');
                if (btn) btn.disabled = true;
                api('/api/payment/status/' + encodeURIComponent(order.transaction_id)).then(function (d) {
                    var st = (d && d.status) || '';
                    if (st === 'success') {
                        stopTimer();
                        Swal.close();
                        Swal.fire({ icon: 'success', title: 'Pembayaran Berhasil', text: 'Pembayaran Anda telah dikonfirmasi. Paket sedang diterapkan.', confirmButtonText: 'OK' }).then(function () {
                            refreshProfile();
                        });
                    } else if (st === 'expired') {
                        stopTimer();
                        setExpired();
                        Swal.fire({ icon: 'warning', title: 'Kedaluwarsa', text: 'Pembayaran telah kedaluwarsa. Silakan buat pembayaran baru.' });
                    } else if (st === 'failed') {
                        stopTimer();
                        Swal.close();
                        Swal.fire({ icon: 'error', title: 'Pembayaran Dibatalkan', text: 'Pembayaran ini telah dibatalkan.', confirmButtonText: 'OK' });
                    } else {
                        if (btn) btn.disabled = false;
                        Swal.fire({ icon: 'info', title: 'Belum Terbayar', text: 'Pembayaran belum terkonfirmasi. Selesaikan transfer lalu cek kembali.', confirmButtonText: 'OK' });
                    }
                }).catch(function (err) {
                    if (btn) btn.disabled = false;
                    Swal.fire({ icon: 'error', title: 'Gagal Memeriksa', text: errMsg(err), confirmButtonText: 'OK' });
                });
            }
            function cancelPayment() {
                var btn = document.getElementById('qris-cancel-btn');
                if (btn) btn.disabled = true;
                api('/api/payment/cancel', { method: 'POST', body: { transaction_id: order.transaction_id } }).then(function () {
                    stopTimer();
                    Swal.close();
                }).catch(function () {
                    stopTimer();
                    Swal.close();
                });
            }

            Swal.fire({
                title: '<span style="font-weight:700;color:var(--text-primary);">Pembayaran QRIS Otomatis</span>',
                html:
                    '<div class="payment-qris-wrap">' +
                    '<p style="color:var(--text-secondary);margin-bottom:6px;font-size:0.9rem;">Scan QRIS berikut untuk membayar paket:</p>' +
                    '<p style="color:var(--accent-primary);font-weight:700;font-size:1.05rem;margin-bottom:12px;">' + esc(name) + ' &middot; ' + days + ' Hari</p>' +
                    '<div class="payment-qris-box"><img class="payment-qris-image" src="' + esc(qrUrl) + '" alt="QRIS ' + amountText + '" loading="lazy"></div>' +
                    '<div class="payment-qris-breakdown">' +
                    '<div class="row"><span>Harga Paket</span><span>' + fmtRp(base) + '</span></div>' +
                    '<div class="row fee"><span>Kode Verifikasi (Fee Acak)</span><span>' + fmtRp(fee) + '</span></div>' +
                    '<div class="row total"><span>Total QRIS</span><span>' + fmtRp(Number(order.amount || 0)) + '</span></div>' +
                    '</div>' +
                    '<a class="payment-qris-wa" href="' + waHref + '" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> Konfirmasi Pembayaran ke WhatsApp</a>' +
                    '<p class="payment-qris-timer"><i class="fa-regular fa-clock"></i> Sisa waktu: <strong id="qris-countdown">--:--</strong></p>' +
                    '<p id="qris-hint" class="payment-qris-hint">Pembayaran kedaluwarsa otomatis bila tidak diselesaikan tepat waktu.</p>' +
                    '<div class="payment-qris-actions">' +
                    '<button id="qris-check-btn" class="btn btn-success">Cek Status Pembayaran</button>' +
                    '<button id="qris-cancel-btn" class="btn btn-danger">Batal</button>' +
                    '</div>' +
                    '</div>',
                showConfirmButton: false,
                showCloseButton: false,
                allowOutsideClick: false,
                didOpen: function () {
                    var container = Swal.getHtmlContainer();
                    var checkBtn = container.querySelector('#qris-check-btn');
                    var cancelBtn = container.querySelector('#qris-cancel-btn');
                    if (checkBtn) checkBtn.addEventListener('click', checkStatus);
                    if (cancelBtn) cancelBtn.addEventListener('click', cancelPayment);
                },
                didClose: function () { stopTimer(); }
            });

            function tick() {
                var remain = endTime - Date.now();
                var el = document.getElementById('qris-countdown');
                if (remain <= 0) {
                    stopTimer();
                    setExpired();
                    if (el) el.textContent = '00:00';
                    return;
                }
                if (el) el.textContent = fmtTime(remain);
            }
            timer = setInterval(tick, 1000);
            tick();
        }).catch(function (err) {
            Swal.fire({ icon: 'error', title: 'Pembayaran Gagal Dibuat', text: errMsg(err), confirmButtonText: 'OK' });
        });
    }



    function loadAPIPanel() {
        Object.keys(PLAN_PRICES).forEach(function (role) {
            var activeBtn = document.querySelector('.plan-duration-options[data-role="' + role + '"] .duration-btn.active');
            var days = activeBtn ? parseInt(activeBtn.dataset.days, 10) : 30;
            var priceEl = document.getElementById('price-' + role);
            var price = getPackagePrice(role, days);
            if (priceEl) {
                priceEl.innerHTML = (price == null)
                    ? 'Harga tidak tersedia'
                    : 'Rp ' + price.toLocaleString('id-ID') + '<span class="plan-duration">/' + days + ' hari</span>';
            }
            document.querySelectorAll('.plan-duration-options[data-role="' + role + '"] .duration-btn').forEach(function (b) {
                b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false');
            });
        });
        document.querySelectorAll('.plan-duration-options .duration-btn').forEach(function (btn) {
            if (btn.dataset.bound) return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', function () {
                var role = btn.closest('.plan-duration-options').dataset.role;
                document.querySelectorAll('.plan-duration-options[data-role="' + role + '"] .duration-btn').forEach(function (b) {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                var days = parseInt(btn.dataset.days, 10);
                var price = getPackagePrice(role, days);
                var priceEl = document.getElementById('price-' + role);
                if (priceEl) {
                    priceEl.innerHTML = (price == null)
                        ? 'Harga tidak tersedia'
                        : 'Rp ' + price.toLocaleString('id-ID') + '<span class="plan-duration">/' + days + ' hari</span>';
                }
            });
        });
        document.querySelectorAll('.btn-purchase-plan').forEach(function (btn) {
            if (btn.dataset.bound) return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', function () {
                var role = btn.dataset.role;
                var name = btn.dataset.name || 'Paket';
                var activeBtn = document.querySelector('.plan-duration-options[data-role="' + role + '"] .duration-btn.active');
                var days = activeBtn ? parseInt(activeBtn.dataset.days, 10) : 30;
                var price = getPackagePrice(role, days);
                if (price == null) {
                    Swal.fire({ icon: 'warning', title: 'Harga Tidak Tersedia', text: 'Harga paket untuk durasi terpilih tidak ditemukan.', confirmButtonText: 'OK' });
                    return;
                }
                startQRISPayment(role, days, name);
            });
        });
    }

    /* ============================== CHAT ============================== */

    function loadChatPanel() {
        closeChatStream();
        fetchChatMessages();
        if (window.EventSource) {
            chatEventSource = new EventSource('/api/chat/stream');
            chatEventSource.onmessage = function (e) {
                try {
                    var data = JSON.parse(e.data);
                    if (data.message) appendChatMessage(data.message);
                } catch (err) {}
            };
            chatEventSource.onerror = function () {
                closeChatStream();
                chatPollTimer = setInterval(fetchChatMessages, 4000);
            };
        } else {
            chatPollTimer = setInterval(fetchChatMessages, 4000);
        }
        var form = $('form-chat-send');
        if (form && !form.dataset.bound) {
            form.dataset.bound = '1';
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                var text = $('chat-input-text').value.trim();
                if (!text) return;
                api('/api/chat/send', { method: 'POST', body: { text: text } }).then(function (data) {
                    if (data.success) {
                        $('chat-input-text').value = '';
                    } else {
                        Swal.fire({ icon: 'error', title: 'KESALAHAN', text: data.message || 'Gagal mengirim pesan.' });
                    }
                });
            });
        }
    }

    function closeChatStream() {
        if (chatEventSource) {
            chatEventSource.close();
            chatEventSource = null;
        }
        if (chatPollTimer) {
            clearInterval(chatPollTimer);
            chatPollTimer = null;
        }
    }

    function chatBubbleHtml(m, me) {
        var self = m.username === me ? 'chat-msg-self' : 'chat-msg-other';
        var badge = '';
        if (m.role === 'owner') badge = '<span class="chat-role-badge" style="background:#8b5cf6;">Owner</span>';
        else if (m.role === 'vip') badge = '<span class="chat-role-badge" style="background:#f59e0b;">VIP</span>';
        return '<div class="chat-message-bubble ' + self + '" data-mid="' + esc(m.id) + '">' +
            '<div class="chat-message-meta"><strong>' + esc(m.username) + '</strong> ' + badge + ' <span style="color:var(--text-muted);font-size:0.7rem;">' + esc(m.createdAt) + '</span></div>' +
            '<div class="chat-message-text">' + esc(m.text) + '</div></div>';
    }

    function appendChatMessage(m) {
        if (!m || !m.id) return;
        var area = $('chat-messages-area');
        if (!area) return;
        if (area.querySelector('[data-mid="' + m.id + '"]')) return;
        var empty = area.querySelector('.chat-empty-state');
        if (empty) empty.remove();
        var me = currentUser ? currentUser.username : '';
        area.insertAdjacentHTML('beforeend', chatBubbleHtml(m, me));
        area.scrollTop = area.scrollHeight;
    }

    function fetchChatMessages() {
        api('/api/chat/messages').then(function (data) {
            var area = $('chat-messages-area');
            var messages = data.messages || [];
            if (!messages.length) {
                area.innerHTML = '<div class="chat-empty-state" style="text-align:center;color:var(--text-muted);padding:20px;">Belum ada pesan. Jadilah yang pertama berbicara!</div>';
                return;
            }
            var me = currentUser ? currentUser.username : '';
            var html = messages.map(function (m) { return chatBubbleHtml(m, me); }).join('');
            area.innerHTML = html;
            area.scrollTop = area.scrollHeight;
        }).catch(function () {});
    }
        /* ============================== API GUIDE ============================== */

    function loadAPIGuide() {
        var key = currentUser ? (currentUser.apiKey || 'API_KEY_ANDA') : 'API_KEY_ANDA';
        var origin = window.location.origin;
        var docs = $('screen-apiguide');
        if (!docs) return;
        var hydrateCodeExamples = function () {
            var baseEl = $('docs-base-url');
            if (baseEl) baseEl.textContent = origin + '/api/v1/bot-premium?apikey=' + key;
            ['curl', 'nodejs', 'python', 'php', 'settings', 'index'].forEach(function (lang) {
                var el = $('code-' + lang + '-content');
                if (!el) return;
                if (!el.dataset.template) el.dataset.template = el.textContent;
                el.textContent = el.dataset.template.replace(/__API_KEY__/g, key).replace(/__BASE_URL__/g, origin);
            });
        };
        if (docs.dataset.bound) {
            hydrateCodeExamples();
            return;
        }
        docs.dataset.bound = '1';

        var copyText = function (text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(text);
            }
            return new Promise(function (resolve, reject) {
                var area = document.createElement('textarea');
                area.value = text;
                area.setAttribute('readonly', '');
                area.style.position = 'fixed';
                area.style.opacity = '0';
                document.body.appendChild(area);
                area.select();
                try {
                    if (!document.execCommand('copy')) throw new Error('Copy command failed');
                    resolve();
                } catch (error) {
                    reject(error);
                } finally {
                    document.body.removeChild(area);
                }
            });
        };

        var setActiveDoc = function (docId) {
            var target = $(docId);
            if (!target) return;
            document.querySelectorAll('#screen-apiguide .doc-section').forEach(function (section) {
                section.classList.toggle('active', section.id === docId);
                section.classList.toggle('hidden', section.id !== docId);
            });
            document.querySelectorAll('#screen-apiguide .docs-nav-link').forEach(function (link) {
                var active = link.dataset.doc === docId;
                link.classList.toggle('active', active);
                link.setAttribute('aria-current', active ? 'page' : 'false');
            });
            var content = document.querySelector('#screen-apiguide .docs-content');
            if (content) content.scrollTo({ top: 0, behavior: 'smooth' });
            var menu = $('docs-sidebar-menu');
            if (menu && window.innerWidth <= 1024) menu.classList.remove('show');
        };

        document.querySelectorAll('#screen-apiguide .docs-nav-link').forEach(function (link) {
            link.addEventListener('click', function () { setActiveDoc(link.dataset.doc); });
        });

        document.querySelectorAll('#screen-apiguide .code-tab-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('#screen-apiguide .code-tab-btn').forEach(function (tab) {
                    tab.classList.toggle('active', tab === btn);
                    tab.setAttribute('aria-selected', tab === btn ? 'true' : 'false');
                });
                document.querySelectorAll('#screen-apiguide .code-block-item').forEach(function (block) {
                    var active = block.id === 'code-' + btn.dataset.lang;
                    block.classList.toggle('active', active);
                    block.classList.toggle('hidden', !active);
                });
            });
        });

        hydrateCodeExamples();
        var baseEl = $('docs-base-url');

        document.querySelectorAll('#screen-apiguide .btn-copy-code').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var target = $(btn.dataset.target);
                if (!target) return;
                copyText(target.textContent).then(function () {
                    Swal.fire({ icon: 'success', title: 'Tersalin!', text: 'Kode berhasil disalin ke clipboard.', timer: 1200, showConfirmButton: false });
                }).catch(function () {
                    Swal.fire({ icon: 'info', title: 'Salin manual', text: 'Clipboard browser tidak tersedia. Pilih dan salin kode secara manual.' });
                });
            });
        });
        if ($('btn-copy-base-url') && baseEl) {
            $('btn-copy-base-url').addEventListener('click', function () {
                copyText(baseEl.textContent).then(function () {
                    Swal.fire({ icon: 'success', title: 'Tersalin!', timer: 1200, showConfirmButton: false });
                }).catch(function () {
                    Swal.fire({ icon: 'info', title: 'Salin manual', text: 'Clipboard browser tidak tersedia. Salin Base URL secara manual.' });
                });
            });
        }
        if ($('btn-docs-toggle')) {
            $('btn-docs-toggle').addEventListener('click', function () {
                var menu = $('docs-sidebar-menu');
                if (!menu) return;
                var open = menu.classList.toggle('show');
                menu.classList.remove('hidden');
                $('btn-docs-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        }
        setActiveDoc(document.querySelector('#screen-apiguide .docs-nav-link.active')?.dataset.doc || 'doc-intro');
    }

    /* ============================== PROFILE ============================== */

    function loadProfile() {
        if (!currentUser) return;
        var u = currentUser;
        $('profile-username').textContent = u.username;
        var avatarEl = $('profile-avatar-circle');
        if (avatarEl) avatarEl.textContent = (u.username || 'U').charAt(0).toUpperCase();

        // Verified Badge ala Meta AI (rosette) — hanya untuk role terverifikasi
        var profileCheckBadge = document.querySelector('#profile-avatar-circle + div span.profile-verified-badge');
        if (profileCheckBadge) {
            var isVerifiedRole = ['owner', 'vip', 'premium', 'autogen', 'reseller', 'pro'].indexOf(u.role) !== -1;
            profileCheckBadge.style.display = isVerifiedRole ? 'inline-flex' : 'none';
        }

        $('profile-role-label').textContent = PROFILE_ROLE[u.role] || 'Anggota';
        $('profile-join-date-label').textContent = u.createdAt ? 'Since: ' + new Date(u.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Since: -';

        // Populate Personal Info (pinfo) section
        if ($('pinfo-name')) $('pinfo-name').textContent = u.username;
        if ($('pinfo-role')) $('pinfo-role').textContent = PROFILE_ROLE[u.role] || 'Anggota';
        if ($('pinfo-credits')) $('pinfo-credits').textContent = creditsDisplay() + ' Credits';
        if ($('pinfo-apikey')) $('pinfo-apikey').textContent = u.apiKey || '-';
        if ($('pinfo-expired')) {
            if (u.apiPlan === 'lifetime') {
                $('pinfo-expired').textContent = 'Lifetime';
            } else if (u.apiExpiresAt) {
                $('pinfo-expired').textContent = new Date(u.apiExpiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
            } else {
                $('pinfo-expired').textContent = '-';
            }
        }
        if ($('pinfo-admin')) $('pinfo-admin').textContent = (u.role === 'owner') ? 'True' : 'False';
        if ($('pinfo-limit')) {
            var roleLimits = {
                user: '50 credits / harian',
                reseller: 'Unlimited Web',
                premium: 'Unlimited Web + API single',
                autogen: 'Unlimited Web + API bulk',
                vip: 'Unlimited + VIP Feature',
                pro: '200 Credits + 1 Bot',
                owner: 'Unlimited + Superuser'
            };
            $('pinfo-limit').textContent = roleLimits[u.role] || '0';
        }

        // Account Overview cards + header badges (UI redesign)
        if ($('ov-role')) $('ov-role').textContent = PROFILE_ROLE[u.role] || 'Anggota';
        if ($('ov-masa-aktif')) {
            var masaText = '-';
            if (u.apiPlan === 'lifetime') masaText = 'Lifetime';
            else if (u.apiExpiresAt) masaText = new Date(u.apiExpiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
            $('ov-masa-aktif').textContent = masaText;
        }
        if ($('ov-kredit')) $('ov-kredit').textContent = creditsDisplay() + ' Credits';
        if ($('ov-limit')) $('ov-limit').textContent = (roleLimits[u.role] || '0');
        if ($('ov-bot')) {
            var botRole = u.role;
            $('ov-bot').textContent = (botRole === 'owner') ? 'Unlimited' : (botRole === 'vip' ? '3 Bot' : (botRole === 'pro' ? '1 Bot' : 'Tidak tersedia'));
            if (botRole === 'owner' || botRole === 'vip' || botRole === 'pro') {
                api('/api/telegram/bots').then(function (d) {
                    if (d && d.success && Array.isArray(d.bots)) {
                        var n = d.bots.length;
                        var el = $('ov-bot');
                        if (el) el.textContent = (botRole === 'owner') ? (n + ' (Unlimited)') : (botRole === 'vip' ? (n + ' / 3') : (n + ' / 1'));
                    }
                }).catch(function () {});
            }
        }
        var rolePill = $('pc-badge-role');
        if (rolePill) rolePill.textContent = (PROFILE_ROLE[u.role] || 'Anggota').toUpperCase();
        var masaPill = $('pc-badge-masa');
        if (masaPill) {
            var isLife = u.apiPlan === 'lifetime';
            masaPill.textContent = isLife ? 'LIFETIME' : 'AKTIF';
            masaPill.className = 'pc-pill ' + (isLife ? 'pc-pill-lifetime' : 'pc-pill-active');
        }

        $('api-key-input').value = u.apiKey || 'Belum ada API Key. Silahkan beli di menu Beli API Key.';

        var apiSection = $('profile-apikey-section');
        // Role premium/autogen/vip/owner selalu boleh. 'user' boleh bila toggle
        // "Nonaktifkan Apikey Untuk User" dalam posisi OFF (APP_MAINT.apikeyUserDisabled false).
        var canManageApiKey = hasApiRole(u.role) || (u.role === 'user' && APP_MAINT && !APP_MAINT.apikeyUserDisabled);
        if (apiSection) apiSection.classList.toggle('hidden', !canManageApiKey);

        var apiKeyInput = $('api-key-input');
        var copyBtn = $('btn-copy-api');
        var resetBtn = $('btn-reset-api');
        var statusEl = $('profile-api-status');
        var hasApiKey = !!u.apiKey;
        var apiIsActive = hasApiKey && u.apiActive !== false;

        if (apiKeyInput) {
            apiKeyInput.value = u.apiKey || 'Belum ada API Key. Silahkan beli di menu Beli API Key.';
            apiKeyInput.classList.toggle('is-empty', !hasApiKey);
        }
        if (statusEl) {
            statusEl.classList.toggle('is-inactive', !apiIsActive);
            statusEl.innerHTML = apiIsActive
                ? '<i class="fa-solid fa-circle-check"></i> Aktif'
                : '<i class="fa-solid fa-circle-exclamation"></i> Belum tersedia';
        }
        if (copyBtn) {
            copyBtn.disabled = !hasApiKey;
            copyBtn.setAttribute('aria-disabled', hasApiKey ? 'false' : 'true');
        }

        var copyApiKey = function (text) {
            var fallbackCopy = function () {
                return new Promise(function (resolve, reject) {
                    var area = document.createElement('textarea');
                    area.value = text;
                    area.setAttribute('readonly', '');
                    area.style.position = 'fixed';
                    area.style.opacity = '0';
                    document.body.appendChild(area);
                    area.select();
                    try {
                        if (!document.execCommand('copy')) throw new Error('Copy command failed');
                        resolve();
                    } catch (error) {
                        reject(error);
                    } finally {
                        document.body.removeChild(area);
                    }
                });
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(text).catch(fallbackCopy);
            }
            return fallbackCopy();
        };

        if (copyBtn && !copyBtn.dataset.bound) {
            copyBtn.dataset.bound = '1';
            copyBtn.addEventListener('click', function () {
                var value = apiKeyInput ? apiKeyInput.value : '';
                if (!value || value.indexOf('Belum ada') === 0) {
                    return Swal.fire({ icon: 'info', title: 'API Key belum tersedia', text: 'Upgrade paket terlebih dahulu untuk mendapatkan API Key.' });
                }
                copyBtn.disabled = true;
                copyApiKey(value).then(function () {
                    Swal.fire({ icon: 'success', title: 'API Key tersalin', text: 'Key siap digunakan di bot Anda.', timer: 1400, showConfirmButton: false });
                }).catch(function () {
                    Swal.fire({ icon: 'info', title: 'Salin manual', text: 'Clipboard browser tidak tersedia. Pilih dan salin API Key secara manual.' });
                }).finally(function () {
                    copyBtn.disabled = false;
                });
            });
        }

        if (resetBtn && !resetBtn.dataset.bound) {
            resetBtn.dataset.bound = '1';
            resetBtn.addEventListener('click', function () {
                Swal.fire({
                    title: 'Reset API Key?',
                    text: 'API Key lama Anda tidak akan bisa digunakan lagi setelah di-reset!',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Ya, Reset!',
                    cancelButtonText: 'Batal',
                    confirmButtonColor: getComputedStyle(document.documentElement).getPropertyValue('--ds-danger').trim()
                }).then(function (result) {
                    if (!result.isConfirmed) return;
                    resetBtn.disabled = true;
                    resetBtn.setAttribute('aria-busy', 'true');
                    resetBtn.classList.add('is-loading');
                    resetBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Membuat key baru...</span>';
                    api('/api/auth/reset-key', { method: 'POST' }).then(function (data) {
                        if (!data.success) {
                            throw new Error(data.message || 'Gagal membuat API Key baru.');
                        }
                        currentUser.apiKey = data.apiKey;
                        currentUser.apiActive = true;
                        Swal.fire({ icon: 'success', title: 'API Key berhasil diperbarui', text: 'Key lama sudah dicabut. Simpan atau copy key baru Anda.', confirmButtonText: 'OK' });
                        loadProfile();
                    }).catch(function (error) {
                        Swal.fire({ icon: 'error', title: 'KESALAHAN', text: error.message || 'Gagal terhubung ke server.', confirmButtonText: 'OK' });
                    }).finally(function () {
                        resetBtn.disabled = false;
                        resetBtn.removeAttribute('aria-busy');
                        resetBtn.classList.remove('is-loading');
                        resetBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i><span>Revoke &amp; Generate New Key</span>';
                    });
                });
            });
        }

        var resetPwBtn = $('btn-reset-password');
        if (resetPwBtn && !resetPwBtn.dataset.bound) {
            resetPwBtn.dataset.bound = '1';
            resetPwBtn.addEventListener('click', function () {
                var np = $('new-password'), cp = $('confirm-password');
                var newPassword = np ? np.value : '', confirmPassword = cp ? cp.value : '';
                if (!newPassword) return Swal.fire({ icon: 'warning', title: 'Password baru wajib diisi.', confirmButtonText: 'OK' });
                if (!confirmPassword) return Swal.fire({ icon: 'warning', title: 'Confirm password wajib diisi.', confirmButtonText: 'OK' });
                if (newPassword.length < 6) return Swal.fire({ icon: 'warning', title: 'Password minimal 6 karakter.', confirmButtonText: 'OK' });
                if (newPassword !== confirmPassword) return Swal.fire({ icon: 'warning', title: 'Password dan confirm password tidak sama.', confirmButtonText: 'OK' });
                resetPwBtn.disabled = true;
                var orig = resetPwBtn.innerHTML;
                resetPwBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>MENGUBAH PASSWORD...</span>';
                api('/api/auth/change-password', { method: 'POST', body: { newPassword: newPassword } }).then(function (d) {
                    if (!d.success) throw new Error(d.message || 'Gagal mengubah password.');
                    if (np) np.value = ''; if (cp) cp.value = '';
                    Swal.fire({ icon: 'success', title: 'Password berhasil diubah.', confirmButtonText: 'OK' });
                }).catch(function (err) {
                    Swal.fire({ icon: 'error', title: 'GAGAL', text: (err && err.message) || 'Terjadi kesalahan koneksi.', confirmButtonText: 'OK' });
                }).finally(function () {
                    resetPwBtn.disabled = false; resetPwBtn.innerHTML = orig;
                });
            });
        }

    }

    /* ============================== LIFETIME (Layanan Lifetime) ============================== */

    function loadLifetimeScreen() {
        if (!currentUser) return;
        var st = $('lifetime-plan-status');
        if (st) {
            if (currentUser.apiPlan === 'lifetime' || currentUser.role === 'owner') {
                st.textContent = 'Lifetime';
            } else if (currentUser.apiPlan) {
                st.textContent = String(currentUser.apiPlan).charAt(0).toUpperCase() + String(currentUser.apiPlan).slice(1);
            } else {
                st.textContent = '-'; // belum punya paket
            }
        }
        // ===== Telegram Bot Deploy (khusus Admin/Owner) =====
        var tgSection = $('telegram-deploy-section');
        if (tgSection) {
            var canDeploy = isAdminOrOwner();
            tgSection.classList.toggle('hidden', !canDeploy);
            if (canDeploy) {
                bindTelegramDeploy();
                loadTelegramBots();
            }
        }
    }

    /* ============================== PROGRAM REFERAL ============================== */

    var refData = null;
    var refClaiming = false;

    function copyTextHelper(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            try {
                if (!document.execCommand('copy')) throw new Error('Copy command failed');
                resolve();
            } catch (err) {
                reject(err);
            } finally {
                document.body.removeChild(area);
            }
        });
    }

    function refToast(icon, title, text) {
        return Swal.fire({ icon: icon, title: title, text: text || '', timer: 2000, showConfirmButton: false, toast: true, position: 'top-end', timerProgressBar: true });
    }

    function renderRefList(status) {
        var key = status === 'claimed' ? 'claimed' : 'pending';
        var listEl = $('ref-' + key + '-list');
        var emptyEl = $('ref-' + key + '-empty');
        if (!listEl) return;
        var items = (refData && refData.referrals || []).filter(function (r) {
            return (r.status === 'claimed') === (status === 'claimed');
        });
        if (!items.length) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');
        listEl.innerHTML = items.map(function (r) {
            var date = r.joinedAt ? new Date(r.joinedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
            return '<div class="ref-acc-item"><span style="display:flex;align-items:center;gap:8px;min-width:0;"><i class="fa-solid fa-user" style="color: var(--accent-primary);"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.username) + '</span></span><span style="display:flex;align-items:center;gap:8px;flex-shrink:0;"><span style="font-size:.72rem;color:var(--text-muted);">' + date + '</span><span class="ref-badge">+' + esc(r.reward) + '</span></span></div>';
        }).join('');
    }

    function refUpdateClaimButton() {
        var btn = $('btn-claim-reward');
        if (!btn) return;
        var reward = refData ? (parseInt(refData.pendingReward, 10) || 0) : 0;
        var textEl = btn.querySelector('.ref-claim-btn-text');
        if (reward <= 0) {
            btn.disabled = true;
            if (textEl) textEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> TIDAK ADA REWARD UNTUK DIKLAIM';
        } else {
            btn.disabled = false;
            if (textEl) textEl.innerHTML = '<i class="fa-solid fa-bolt"></i> KLAIM KREDIT SEKARANG';
        }
    }

    function renderReferral(payload) {
        var d = payload && payload.data ? payload.data : payload;
        if (!d) return;
        refData = d;
        var link = $('ref-url-input');
        if (link) link.value = d.referralUrl || '';
        var invited = $('ref-stat-invited');
        if (invited) invited.textContent = d.totalInvited != null ? d.totalInvited : 0;
        var pending = $('ref-stat-pending');
        if (pending) pending.textContent = d.pendingReward != null ? d.pendingReward : 0;
        var pc = $('ref-pending-count');
        if (pc) pc.textContent = (d.referrals || []).filter(function (r) { return r.status !== 'claimed'; }).length;
        var cc = $('ref-claimed-count');
        if (cc) cc.textContent = (d.referrals || []).filter(function (r) { return r.status === 'claimed'; }).length;
        var badge = $('ref-reward-badge');
        if (badge && d.rewardPerReferral) badge.textContent = '+' + d.rewardPerReferral + ' KREDIT / REFERRAL';
        renderRefList('pending');
        renderRefList('claimed');
        refUpdateClaimButton();
    }

    function bindReferralActions() {
        var copyBtn = $('btn-copy-ref-link');
        if (copyBtn && !copyBtn.dataset.bound) {
            copyBtn.dataset.bound = '1';
            copyBtn.addEventListener('click', function () {
                var link = $('ref-url-input');
                copyTextHelper(link ? link.value : '').then(function () {
                    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i><span>TERSALIN</span>';
                    setTimeout(function () { copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i><span>Salin</span>'; }, 2000);
                    refToast('success', 'Berhasil', 'Link referral berhasil disalin.');
                }).catch(function () {
                    refToast('error', 'Gagal', 'Tidak dapat menyalin link.');
                });
            });
        }
        var shareCopy = $('btn-share-copy');
        if (shareCopy && !shareCopy.dataset.bound) {
            shareCopy.dataset.bound = '1';
            shareCopy.addEventListener('click', function () {
                var link = $('ref-url-input');
                copyTextHelper(link ? link.value : '').then(function () {
                    refToast('success', 'Berhasil', 'Link referral berhasil disalin.');
                }).catch(function () {
                    refToast('error', 'Gagal', 'Tidak dapat menyalin link.');
                });
            });
        }
        var shareNative = $('btn-share-native');
        if (shareNative && !shareNative.dataset.bound) {
            shareNative.dataset.bound = '1';
            shareNative.addEventListener('click', function () {
                var link = $('ref-url-input');
                var url = link ? link.value : '';
                if (navigator.share) {
                    navigator.share({ title: 'Program Referal', text: 'Gabung dan dapatkan kredit gratis! Pakai kode referral saya.', url: url }).catch(function () { });
                } else {
                    copyTextHelper(url).then(function () {
                        refToast('success', 'Berhasil', 'Link referral berhasil disalin.');
                    });
                }
            });
        }
        var claimBtn = $('btn-claim-reward');
        if (claimBtn && !claimBtn.dataset.bound) {
            claimBtn.dataset.bound = '1';
            claimBtn.addEventListener('click', function () {
                if (refClaiming) return;
                var reward = refData ? (parseInt(refData.pendingReward, 10) || 0) : 0;
                if (reward <= 0) return refUpdateClaimButton();
                refClaiming = true;
                claimBtn.disabled = true;
                var spinner = claimBtn.querySelector('.ref-claim-btn-spinner');
                var text = claimBtn.querySelector('.ref-claim-btn-text');
                if (spinner) spinner.classList.remove('hidden');
                if (text) text.classList.add('hidden');
                api('/api/referral/claim', { method: 'POST' }).then(function (data) {
                    if (data && data.success) {
                        if (currentUser && data.credits != null) currentUser.credits = data.credits;
                        var pc = $('pinfo-credits');
                        if (pc) pc.textContent = creditsDisplay() + ' Credits';
                        refData.pendingReward = 0;
                        (refData.referrals || []).forEach(function (r) { if (r.status === 'pending') r.status = 'claimed'; });
                        renderReferral(refData);
                        refToast('success', 'Referral berhasil diklaim!', '+' + data.claimedReward + ' kredit telah ditambahkan.');
                    } else {
                        refToast('error', 'Terjadi kesalahan', (data && data.message) || 'Silakan coba lagi.');
                        refUpdateClaimButton();
                    }
                }).catch(function () {
                    refToast('error', 'Terjadi kesalahan', 'Silakan coba lagi.');
                    refUpdateClaimButton();
                }).finally(function () {
                    refClaiming = false;
                    claimBtn.disabled = false;
                    if (spinner) spinner.classList.add('hidden');
                    if (text) text.classList.remove('hidden');
                    refUpdateClaimButton();
                });
            });
        }
        var retry = $('btn-ref-retry');
        if (retry && !retry.dataset.bound) {
            retry.dataset.bound = '1';
            retry.addEventListener('click', loadReferralScreen);
        }
        ['pending', 'claimed'].forEach(function (k) {
            var head = $('ref-acc-head-' + k);
            if (head && !head.dataset.bound) {
                head.dataset.bound = '1';
                head.addEventListener('click', function () {
                    var open = head.getAttribute('aria-expanded') === 'true';
                    head.setAttribute('aria-expanded', String(!open));
                    head.parentElement.setAttribute('data-open', open ? '0' : '1');
                    var body = $('ref-' + k + '-body');
                    if (body) body.classList.toggle('hidden', open);
                });
            }
        });
    }

    function loadReferralScreen() {
        var loading = $('ref-loading');
        var errorEl = $('ref-error');
        var contentEl = $('ref-content');
        if (loading) loading.classList.remove('hidden');
        if (errorEl) errorEl.classList.add('hidden');
        if (contentEl) contentEl.classList.add('hidden');
        api('/api/referral').then(function (data) {
            if (!data || !data.success || !data.data) throw new Error((data && data.message) || 'Gagal memuat data referral');
            renderReferral(data);
            if (loading) loading.classList.add('hidden');
            if (contentEl) contentEl.classList.remove('hidden');
            bindReferralActions();
        }).catch(function (err) {
            if (loading) loading.classList.add('hidden');
            if (errorEl) errorEl.classList.remove('hidden');
            var t = $('ref-error-text');
            if (t) t.textContent = (err && err.message) || 'Silakan coba lagi.';
        });
    }

    /* ============================== TELEGRAM BOT DEPLOY ============================== */

    function telegramStatusBadge(status) {
        if (status === 'online') return '<span class="badge badge-normal" style="background: rgba(16,185,129,.15); color: #10b981; border: 1px solid rgba(16,185,129,.35);"><i class="fa-solid fa-circle"></i> Online</span>';
        if (status === 'error') return '<span class="badge badge-normal" style="background: rgba(239,68,68,.12); color: #ef4444; border: 1px solid rgba(239,68,68,.35);"><i class="fa-solid fa-triangle-exclamation"></i> Error</span>';
        return '<span class="badge badge-normal" style="background: rgba(148,163,184,.15); color: #94a3b8; border: 1px solid rgba(148,163,184,.3);"><i class="fa-solid fa-circle"></i> Offline</span>';
    }

    function renderTelegramBots(bots) {
        var listEl = $('telegram-bots-list');
        if (!listEl) return;
        if (!bots.length) {
            listEl.innerHTML = '<div style="padding: 16px; border: 1px dashed var(--border-color); border-radius: var(--radius-sm); text-align: center; color: var(--text-muted); font-size: .88rem;"><i class="fa-brands fa-telegram"></i> Belum ada bot ter-deploy. Isi form di atas lalu klik Deploy Bot.</div>';
            return;
        }
        listEl.innerHTML = bots.map(function (b) {
            var username = b.me && b.me.username ? '@' + esc(b.me.username) : 'belum tersedia';
            var err = b.error ? '<div style="font-size: .78rem; color: #ef4444; margin-top: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(b.error) + '</div>' : '';
            var actions = '';
            if (b.status === 'online') {
                actions += '<button class="btn btn-secondary tg-action" data-action="stop" data-id="' + esc(b.id) + '" style="padding: 8px 14px; font-size: .8rem;"><i class="fa-solid fa-stop"></i> Stop</button>';
            } else {
                actions += '<button class="btn btn-secondary tg-action" data-action="start" data-id="' + esc(b.id) + '" style="padding: 8px 14px; font-size: .8rem; color: #10b981; border-color: rgba(16,185,129,.4);"><i class="fa-solid fa-play"></i> Start</button>';
            }
            actions += '<button class="btn btn-secondary tg-action" data-action="restart" data-id="' + esc(b.id) + '" style="padding: 8px 14px; font-size: .8rem;"><i class="fa-solid fa-rotate-right"></i> Restart</button>';
            actions += '<button class="btn btn-secondary tg-action" data-action="delete" data-id="' + esc(b.id) + '" style="padding: 8px 14px; font-size: .8rem; color: var(--ds-danger); border-color: var(--ds-danger); background: transparent;"><i class="fa-solid fa-trash-can"></i> Hapus</button>';
            return '<div class="tg-bot-item" style="border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 14px 16px; margin-bottom: 10px; background: var(--surface-2);">' +
                '<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px;">' +
                '<i class="fa-brands fa-telegram" style="color: #229ED9; font-size: 1.2rem;"></i>' +
                '<strong style="font-size: .95rem;">' + esc(b.name) + '</strong>' +
                '<span style="font-size: .78rem; color: var(--text-muted);">' + username + '</span>' +
                telegramStatusBadge(b.status) +
                '</div>' +
                '<div style="display: flex; gap: 16px; flex-wrap: wrap; font-size: .82rem; color: var(--text-secondary); margin-bottom: 10px;">' +
                '<span><i class="fa-solid fa-user-gear"></i> Owner ID: <code>' + esc(b.ownerId) + '</code></span>' +
                '<span><i class="fa-solid fa-key"></i> Token: <code>' + esc(b.tokenMasked) + '</code></span>' +
                '</div>' + err +
                '<div style="display: flex; gap: 8px; flex-wrap: wrap;">' + actions + '</div>' +
                '</div>';
        }).join('');

        listEl.querySelectorAll('.tg-action').forEach(function (btn) {
            if (btn.dataset.bound) return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', function () { telegramAction(btn.dataset.action, btn.dataset.id); });
        });
    }

    function updateTelegramBotStatus(bots) {
        var badge = $('telegram-bot-status-badge');
        var pm2 = $('telegram-bot-pm2-info');
        if (!badge) return;
        var online = 0, total = (bots || []).length;
        (bots || []).forEach(function (b) { if (b.status === 'online') online++; });
        var countEl = $('telegram-bot-count');
        if (countEl) countEl.textContent = (total === 1 ? '1 Bot' : total + ' Bot');
        if (!total) {
            badge.innerHTML = '<i class="fa-solid fa-circle"></i> Belum Deploy';
            badge.style.background = '#64748b';
            badge.style.color = 'white';
            badge.style.border = '';
            if (pm2) pm2.textContent = 'Belum ada bot ter-deploy di VPS.';
            return;
        }
        if (online === total) {
            badge.innerHTML = '<i class="fa-solid fa-circle"></i> Online';
            badge.style.background = 'rgba(16,185,129,.15)';
            badge.style.color = '#10b981';
            badge.style.border = '1px solid rgba(16,185,129,.35)';
        } else if (online > 0) {
            badge.innerHTML = '<i class="fa-solid fa-circle-half-stroke"></i> ' + online + '/' + total + ' Online';
            badge.style.background = 'rgba(245,158,11,.15)';
            badge.style.color = '#f59e0b';
            badge.style.border = '1px solid rgba(245,158,11,.35)';
        } else {
            badge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Offline';
            badge.style.background = 'rgba(239,68,68,.12)';
            badge.style.color = '#ef4444';
            badge.style.border = '1px solid rgba(239,68,68,.35)';
        }
        if (pm2) pm2.textContent = total + ' bot terdaftar · ' + online + ' aktif · PM2 managed';
    }

    function loadTelegramBots() {
        api('/api/telegram/bots').then(function (data) {
            if (data && data.success) {
                renderTelegramBots(data.bots || []);
                updateTelegramBotStatus(data.bots || []);
            }
        }).catch(function () {
            var badge = $('telegram-bot-status-badge');
            if (badge) {
                badge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Gagal Terhubung';
                badge.style.background = 'rgba(148,163,184,.15)';
                badge.style.color = '#94a3b8';
                badge.style.border = '1px solid rgba(148,163,184,.3)';
            }
        });
    }

    function telegramAction(action, id) {
        if (action === 'delete') {
            Swal.fire({
                title: 'Hapus bot ini?',
                text: 'Bot akan dihentikan dan dihapus dari daftar deploy.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Ya, hapus',
                cancelButtonText: 'Batal'
            }).then(function (result) {
                if (!result.isConfirmed) return;
                sendTelegramAction(action, id);
            });
            return;
        }
        sendTelegramAction(action, id);
    }

    function sendTelegramAction(action, id) {
        api('/api/telegram/' + action, { method: 'POST', body: { id: id } }).then(function (data) {
            Swal.fire({
                icon: data && data.success ? 'success' : 'error',
                title: data && data.success ? 'Berhasil' : 'Gagal',
                text: (data && data.message) || 'Terjadi kesalahan.',
                timer: data && data.success ? 1600 : 3200,
                showConfirmButton: false
            });
            if (data && data.bots) { renderTelegramBots(data.bots); updateTelegramBotStatus(data.bots); }
            else loadTelegramBots();
        }).catch(function () {
            Swal.fire({ icon: 'error', title: 'Gagal', text: 'Tidak dapat terhubung ke server.', timer: 2500, showConfirmButton: false });
        });
    }

    function bindTelegramDeploy() {
        var form = $('form-telegram-deploy');
        if (!form || form.dataset.bound) return;
        form.dataset.bound = '1';
        var checkBtn = $('btn-check-lifetime-bot');
        if (checkBtn) {
            checkBtn.addEventListener('click', function () {
                var badge = $('telegram-bot-status-badge');
                if (badge) { badge.innerHTML = '<i class="fa-solid fa-circle"></i> Memuat...'; badge.style.background = '#64748b'; badge.style.color = 'white'; }
                loadTelegramBots();
            });
        }
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var name = $('telegram-bot-name');
            var token = $('telegram-bot-token');
            var ownerId = $('telegram-owner-id');
            if (!token.value.trim() || !ownerId.value.trim()) {
                Swal.fire({ icon: 'warning', title: 'Lengkapi form', text: 'Bot Token dan Telegram Owner ID wajib diisi.', timer: 2200, showConfirmButton: false });
                return;
            }
            if (!name.value.trim()) {
                name.value = (currentUser ? currentUser.username : 'AM') + ' Bot';
            }
            var btn = $('btn-telegram-deploy');
            var btnText = btn.querySelector('.btn-text');
            var btnSpinner = btn.querySelector('.btn-spinner');
            btn.disabled = true;
            btnText.classList.add('hidden');
            btnSpinner.classList.remove('hidden');
            api('/api/telegram/deploy', { method: 'POST', body: { name: name.value.trim(), token: token.value.trim(), ownerId: ownerId.value.trim() } }).then(function (data) {
                Swal.fire({
                    icon: data && data.success ? 'success' : 'error',
                    title: data && data.success ? 'Bot Deployed!' : 'Gagal Deploy',
                    text: (data && data.message) || 'Terjadi kesalahan.',
                    timer: data && data.success ? 1800 : 3500,
                    showConfirmButton: false
                });
                if (data && data.success) {
                    name.value = ''; token.value = ''; ownerId.value = '';
                }
                if (data && data.bots) { renderTelegramBots(data.bots); updateTelegramBotStatus(data.bots); }
                else loadTelegramBots();
            }).catch(function () {
                Swal.fire({ icon: 'error', title: 'Gagal Deploy', text: 'Tidak dapat terhubung ke server.', timer: 2500, showConfirmButton: false });
            }).finally(function () {
                btn.disabled = false;
                btnText.classList.remove('hidden');
                btnSpinner.classList.add('hidden');
            });
        });
    }

    /* ============================== REVIEWS ============================== */

    function loadReviewsScreen() {
        loadReviews();
        bindReviewSubmit();
    }

    var myReview = null;

    function prefillReviewForm() {
        var form = $('form-submit-review');
        if (!form) return;
        var btn = form.querySelector('button[type="submit"]');
        if ($('input-review-comment')) $('input-review-comment').value = myReview ? (myReview.comment || '') : '';
        document.querySelectorAll('.star-btn').forEach(function (b) {
            b.style.color = myReview && parseInt(b.dataset.value, 10) <= myReview.rating ? '#f59e0b' : '#cbd5e1';
        });
        if (btn) btn.innerHTML = myReview ? '<i class="fa-solid fa-pen-to-square"></i> Perbarui Ulasan ' : '<i class="fa-solid fa-paper-plane"></i> Kirim Ulasan ';
    }

    function bindReviewSubmit() {
        var form = $('form-submit-review');
        if (!form || form.dataset.bound) return;
        form.dataset.bound = '1';
        var rating = 0;
        document.querySelectorAll('.star-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                rating = parseInt(btn.dataset.value, 10);
                document.querySelectorAll('.star-btn').forEach(function (b) {
                    b.style.color = parseInt(b.dataset.value, 10) <= rating ? '#f59e0b' : '#cbd5e1';
                });
            });
        });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (!currentUser) return;
            var chosen = rating || (myReview ? myReview.rating : 0);
            if (!chosen) return Swal.fire({ icon: 'warning', title: 'Perhatian', text: 'Pilih bintang rating terlebih dahulu.' });
            var comment = $('input-review-comment').value.trim();
            api('/api/reviews', { method: 'POST', body: { rating: chosen, comment: comment } }).then(function (data) {
                if (data.success) {
                    Swal.fire({ icon: 'success', title: 'TERKIRIM!', text: data.updated ? 'Ulasan Anda berhasil diperbarui.' : 'Terima kasih atas ulasan Anda.', timer: 1500, showConfirmButton: false });
                    rating = 0;
                    loadReviews();
                } else {
                    Swal.fire({ icon: 'error', title: 'KESALAHAN', text: data.message || 'Gagal mengirim ulasan.' });
                }
            });
        });
    }

    function loadReviews() {
        api('/api/reviews').then(function (data) {
            var reviews = data.reviews || [];
            var avg = data.avg || 0;
            $('review-avg-rating').textContent = avg.toFixed(1);
            var stars = '';
            for (var i = 1; i <= 5; i++) stars += '<i class="fa-solid fa-star" style="color:' + (i <= Math.round(avg) ? '#f59e0b' : '#cbd5e1') + ';font-size:1.2rem;"></i>';
            $('review-avg-stars').innerHTML = stars;
            $('review-total-count').textContent = reviews.length + ' Ulasan';
            for (var s = 5; s >= 1; s--) {
                var count = reviews.filter(function (r) { return r.rating === s; }).length;
                var pct = reviews.length ? Math.round((count / reviews.length) * 100) : 0;
                if ($('bar-' + s + '-star')) $('bar-' + s + '-star').style.width = pct + '%';
                if ($('count-' + s + '-star')) $('count-' + s + '-star').textContent = count;
            }
            var list = $('reviews-list-container');
            if (!reviews.length) {
                list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Belum ada ulasan.</div>';
                return;
            }
            list.innerHTML = reviews.slice().reverse().map(function (r) {
                var s2 = '';
                for (var i = 1; i <= 5; i++) s2 += '<i class="fa-solid fa-star" style="color:' + (i <= r.rating ? '#f59e0b' : '#cbd5e1') + ';font-size:0.8rem;"></i>';
                var mine = currentUser && r.username === currentUser.username;
                return '<div class="review-card">' +
                    '<div class="review-card-header"><strong>' + esc(r.username) + '</strong> ' + (mine ? '<span class="badge badge-premium" style="font-size:0.65rem;background:#6366f1;color:#fff;">Ulasan Anda</span> ' : '') + s2 + '<span style="color:var(--text-muted);font-size:0.7rem;">' + esc(r.createdAt) + '</span></div>' +
                    '<div class="review-card-text">' + esc(r.comment || '') + '</div></div>';
            }).join('');
            myReview = reviews.find(function (r) { return r.username === (currentUser ? currentUser.username : ''); }) || null;
            prefillReviewForm();
        });
    }

    /* ============================== ADMIN PANEL ============================== */

    function loadAdminPanel() {
        if (!isAdminOrOwner()) return;
        loadAdminStats();
        loadAdminH2hProfile();
        loadAdminUsers();
        loadAdminLogs();
        loadAdminTransactions();
        loadAdminUpgrades();
        loadAdminIps();
        loadDuplicateLogs();
        bindAdminActions();
    }

    function loadAdminStats() {
        api('/api/admin/stats').then(function (data) {
            if (data.totalUsers != null) $('stat-admin-total-users').textContent = data.totalUsers;
            if (data.totalRequests != null) $('stat-total-activations').textContent = data.totalRequests;
            if (data.success != null) $('stat-success-activations').textContent = data.success;
            if (data.failed != null) $('stat-failed-activations').textContent = data.failed;
        });
    }

    function loadAdminH2hProfile() {
        var name = $('h2h-name'), status = $('h2h-status');
        if (!name || !status) return;
        api('/api/admin/h2h/profile').then(function (data) {
            var bal = $('h2h-balance'), settle = $('h2h-settlement');
            if (data && data.success) {
                name.textContent = data.name || '--';
                if (bal) bal.textContent = data.balance != null ? Number(data.balance).toLocaleString('id-ID') : '--';
                if (settle) settle.textContent = data.settlementBalance != null ? Number(data.settlementBalance).toLocaleString('id-ID') : '--';
                status.textContent = data.status || '--';
                status.className = 'h2h-value h2h-status ' + (data.status === 'active' ? 'is-active' : 'is-inactive');
            } else {
                name.textContent = '--';
                if (bal) bal.textContent = '--';
                if (settle) settle.textContent = '--';
                status.textContent = (data && data.message) ? data.message : 'Gagal memuat';
                status.className = 'h2h-value h2h-status is-inactive';
            }
        }).catch(function () {
            name.textContent = '--';
            if ($('h2h-balance')) $('h2h-balance').textContent = '--';
            if ($('h2h-settlement')) $('h2h-settlement').textContent = '--';
            status.textContent = 'Gagal terhubung';
            status.className = 'h2h-value h2h-status is-inactive';
        });
    }

    function setAdminTableState(tbody, colspan, message, state) {
        if (!tbody) return;
        var icon = state === 'error' ? 'fa-triangle-exclamation' : state === 'loading' ? 'fa-spinner fa-spin' : 'fa-inbox';
        tbody.innerHTML = '<tr><td colspan="' + colspan + '" class="admin-table-state"><i class="fa-solid ' + icon + '"></i><span>' + esc(message) + '</span></td></tr>';
    }

    function loadAdminUsers(page) {
        var tbody = $('admin-users-table-body');
        setAdminTableState(tbody, 6, 'Memuat daftar anggota...', 'loading');
        api('/api/admin/users').then(function (data) {
            if (!data.success) {
                setAdminTableState(tbody, 6, data.message || 'Daftar anggota tidak dapat dimuat.', 'error');
                if ($('admin-users-result-count')) $('admin-users-result-count').textContent = 'Gagal memuat';
                return;
            }
            adminUsersCache = data.users || [];
            renderAdminUsers(page || 1);
        }).catch(function () {
            setAdminTableState(tbody, 6, 'Gagal terhubung ke server.', 'error');
        });
    }

    function renderAdminUsers(page) {
        var users = adminUsersCache.slice();
        var query = ($('admin-search-users').value || '').trim().toLowerCase();
        var role = $('admin-filter-role') ? $('admin-filter-role').value : 'all';
        var status = $('admin-filter-status') ? $('admin-filter-status').value : 'all';
        if (query) {
            users = users.filter(function (u) {
                return [u.username, u.role, u.device, u.ip].join(' ').toLowerCase().indexOf(query) !== -1;
            });
        }
        if (role !== 'all') users = users.filter(function (u) { return u.role === role; });
        if (status !== 'all') users = users.filter(function (u) { return status === 'banned' ? !!u.banned : !u.banned; });
        var resultCount = $('admin-users-result-count');
        if (resultCount) resultCount.textContent = users.length + ' anggota ditemukan';
        var perPage = 10;
        var totalPages = Math.max(1, Math.ceil(users.length / perPage));
        var current = Math.min(Math.max(1, page || 1), totalPages);
        var slice = users.slice((current - 1) * perPage, current * perPage);
        var tbody = $('admin-users-table-body');
        if (!slice.length) {
            setAdminTableState(tbody, 6, 'Tidak ada anggota yang cocok dengan filter.', 'empty');
        } else {
            tbody.innerHTML = slice.map(function (u) {
                var canManage = currentUser.role === 'owner' || (currentUser.role === 'vip' && u.role === 'user');
                var actions;
                if (canManage && u.role !== 'owner') {
                    actions = '<div class="admin-action-group">' +
                        '<button class="btn btn-secondary btn-sm edit-credits-btn" data-id="' + esc(u.id) + '" data-credits="' + esc(u.credits == null ? 0 : u.credits) + '" title="Edit kredit"><i class="fa-solid fa-bolt"></i><span>Kredit</span></button>' +
                        '<button class="btn btn-secondary btn-sm edit-role-btn" data-id="' + esc(u.id) + '" data-role="' + esc(u.role) + '" title="Ubah role"><i class="fa-solid fa-user-shield"></i><span>Role</span></button>' +
                        '<button class="btn btn-warning btn-sm reset-password-btn" data-id="' + esc(u.id) + '" title="Reset password"><i class="fa-solid fa-key"></i><span>Password</span></button>' +
                        '<button class="btn ' + (u.banned ? 'btn-success' : 'btn-danger') + ' btn-sm toggle-ban-btn" data-id="' + esc(u.id) + '" data-banned="' + (u.banned ? 1 : 0) + '" title="' + (u.banned ? 'Aktifkan akun' : 'Blokir akun') + '"><i class="fa-solid ' + (u.banned ? 'fa-unlock' : 'fa-ban') + '"></i><span>' + (u.banned ? 'Aktifkan' : 'Blokir') + '</span></button>' +
                        '<button class="btn btn-danger btn-sm delete-user-btn" data-id="' + esc(u.id) + '" title="Hapus akun"><i class="fa-solid fa-trash-can"></i><span>Hapus</span></button>' +
                        '</div>';
                } else {
                    actions = '<span class="admin-no-action"><i class="fa-solid fa-lock"></i> Dilindungi</span>';
                }
                var device = u.device || u.os || 'Tidak diketahui';
                return '<tr>' +
                    '<td><div class="admin-user-cell"><span class="admin-user-avatar"><i class="fa-solid fa-user"></i></span><div><strong>' + esc(u.username) + '</strong><small>ID: ' + esc(u.id || '-') + '</small></div></div></td>' +
                    '<td><span class="badge ' + (ROLE_BADGE[u.role] || 'badge-normal') + '">' + esc(ROLE_LABEL[u.role] || u.role) + '</span></td>' +
                    '<td><span class="admin-credit-value">' + (u.credits == null ? '<i class="fa-solid fa-infinity"></i> Unlimited' : esc(u.credits)) + '</span></td>' +
                    '<td><span class="admin-device-cell"><i class="fa-solid fa-desktop"></i>' + esc(device) + '</span><small class="admin-ip-label">' + esc(u.ip || 'IP tidak tersedia') + '</small></td>' +
                    '<td>' + (u.banned ? '<span class="status-failed"><i class="fa-solid fa-ban"></i> Terblokir</span>' : '<span class="status-success"><i class="fa-solid fa-circle-check"></i> Aktif</span>') + '</td>' +
                    '<td>' + actions + '</td></tr>';
            }).join('');
        }
        renderPagination($('admin-users-pagination'), totalPages, current, function (p) { renderAdminUsers(p); });
    }

    function renderPagination(container, totalPages, current, callback) {
        if (!container) return;
        if (totalPages <= 1) { container.innerHTML = ''; return; }
        var html = '';
        if (current > 1) html += '<button class="pag-btn" data-page="' + (current - 1) + '"><i class="fa-solid fa-chevron-left"></i></button>';
        var start = Math.max(1, current - 2), end = Math.min(totalPages, start + 4);
        start = Math.max(1, end - 4);
        for (var i = start; i <= end; i++) {
            if (i === 1 && start > 1) { html += '<span class="pag-dots">...</span>'; }
            html += '<button class="pag-btn' + (i === current ? ' active' : '') + '" data-page="' + i + '">' + i + '</button>';
        }
        if (end < totalPages) html += '<span class="pag-dots">...</span><button class="pag-btn" data-page="' + totalPages + '">' + totalPages + '</button>';
        if (current < totalPages) html += '<button class="pag-btn" data-page="' + (current + 1) + '"><i class="fa-solid fa-chevron-right"></i></button>';
        container.innerHTML = html;
        container.querySelectorAll('.pag-btn').forEach(function (b) {
            b.addEventListener('click', function () { callback(parseInt(b.dataset.page, 10)); });
        });
    }

    function loadAdminLogs(page) {
        var tbody = $('admin-logs-table-body');
        setAdminTableState(tbody, 5, 'Memuat aktivitas global...', 'loading');
        api('/api/admin/logs').then(function (data) {
            if (!data.success) {
                setAdminTableState(tbody, 5, data.message || 'Aktivitas global tidak dapat dimuat.', 'error');
                if ($('admin-logs-result-count')) $('admin-logs-result-count').textContent = 'Gagal memuat';
                return;
            }
            adminLogsCache = data.logs || [];
            renderAdminLogs(page || 1);
        }).catch(function () {
            setAdminTableState(tbody, 5, 'Gagal terhubung ke server.', 'error');
        });
    }

    function renderAdminLogs(page) {
        var logs = adminLogsCache.slice().reverse();
        var query = ($('admin-search-logs').value || '').trim().toLowerCase();
        var statusFilter = $('admin-filter-log-status') ? $('admin-filter-log-status').value : 'all';
        if (query) {
            logs = logs.filter(function (l) {
                return [l.operator, l.email, l.note, l.createdAt].join(' ').toLowerCase().indexOf(query) !== -1;
            });
        }
        if (statusFilter !== 'all') logs = logs.filter(function (l) { return l.status === statusFilter; });
        if ($('admin-logs-result-count')) $('admin-logs-result-count').textContent = logs.length + ' aktivitas ditemukan';
        var perPage = 10;
        var totalPages = Math.max(1, Math.ceil(logs.length / perPage));
        var current = Math.min(Math.max(1, page || 1), totalPages);
        var slice = logs.slice((current - 1) * perPage, current * perPage);
        var tbody = $('admin-logs-table-body');
        if (!slice.length) {
            setAdminTableState(tbody, 5, 'Tidak ada aktivitas yang cocok dengan filter.', 'empty');
        } else {
            tbody.innerHTML = slice.map(function (l) {
                var isSuccess = l.status === 'success';
                var status = isSuccess ? '<span class="status-success"><i class="fa-solid fa-circle-check"></i> Berhasil</span>' : '<span class="status-failed"><i class="fa-solid fa-circle-xmark"></i> Gagal</span>';
                return '<tr><td><span class="admin-date-cell"><i class="fa-regular fa-clock"></i>' + esc(l.createdAt || '-') + '</span></td>' +
                    '<td><strong class="admin-operator-cell"><i class="fa-solid fa-user-tie"></i>' + esc(l.operator || '-') + '</strong></td>' +
                    '<td><code class="admin-email-cell">' + esc(l.email || '-') + '</code></td>' +
                    '<td>' + status + '</td><td><span class="admin-note-cell">' + esc(l.note || 'Tidak ada keterangan') + '</span></td></tr>';
            }).join('');
        }
        renderPagination($('admin-logs-pagination'), totalPages, current, function (p) { renderAdminLogs(p); });
    }

    function loadAdminTransactions(page) {
        var tbody = $('admin-transactions-table-body');
        setAdminTableState(tbody, 6, 'Memuat transaksi pembayaran...', 'loading');
        api('/api/admin/transactions').then(function (data) {
            if (!data.success) {
                setAdminTableState(tbody, 6, data.message || 'Transaksi hanya dapat dilihat oleh owner.', 'error');
                if ($('admin-transactions-pagination')) $('admin-transactions-pagination').innerHTML = '';
                return;
            }
            var txs = data.transactions || [];
            var perPage = 10;
            var totalPages = Math.max(1, Math.ceil(txs.length / perPage));
            var current = Math.min(Math.max(1, page || 1), totalPages);
            var slice = txs.slice((current - 1) * perPage, current * perPage);
            if (!slice.length) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;">Belum ada transaksi.</td></tr>';
            } else {
                tbody.innerHTML = slice.map(function (t) {
                    var status = t.status === 'success' ? '<span class="status-success">Sukses</span>'
                        : t.status === 'failed' ? '<span class="status-failed">Gagal</span>'
                        : t.status === 'rejected' ? '<span class="status-failed">Ditolak</span>'
                        : '<span class="status-pending">Pending</span>';
                    return '<tr><td>' + esc(t.createdAt) + '</td><td>' + esc(t.username) + '</td><td>' + esc(t.transaction_id) + '</td><td>Rp ' + esc(t.amount) + '</td><td>' + esc(t.plan) + '</td><td>' + status + '</td></tr>';
                }).join('');
            }
            renderPagination($('admin-transactions-pagination'), totalPages, current, loadAdminTransactions);
        }).catch(function () {
            setAdminTableState(tbody, 6, 'Gagal terhubung ke server.', 'error');
        });
    }

    function loadAdminUpgrades(page) {
        var tbody = $('admin-upgrades-table-body');
        setAdminTableState(tbody, 7, 'Memuat upgrade user...', 'loading');
        api('/api/admin/upgrades').then(function (data) {
            if (!data.success) {
                setAdminTableState(tbody, 7, data.message || 'Upgrade hanya dapat dilihat oleh owner.', 'error');
                if ($('admin-upgrades-pagination')) $('admin-upgrades-pagination').innerHTML = '';
                return;
            }
            var txs = data.upgrades || [];
            var perPage = 10;
            var totalPages = Math.max(1, Math.ceil(txs.length / perPage));
            var current = Math.min(Math.max(1, page || 1), totalPages);
            var slice = txs.slice((current - 1) * perPage, current * perPage);
            if (!slice.length) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">Belum ada upgrade user.</td></tr>';
            } else {
                tbody.innerHTML = slice.map(function (t) {
                    var status = t.status === 'success' ? '<span class="status-success">Sukses</span>'
                        : t.status === 'failed' ? '<span class="status-failed">Gagal</span>'
                        : t.status === 'rejected' ? '<span class="status-failed">Ditolak</span>'
                        : '<span class="status-pending">Pending</span>';
                    var base = t.baseAmount != null ? t.baseAmount : (t.amount != null ? t.amount - (t.fee || 0) : 0);
                    var fee = t.fee != null ? t.fee : 0;
                    var action = t.status === 'pending'
                        ? '<div style="display:flex;gap:4px;">' +
                        '<button class="btn btn-success btn-sm approve-tx-btn" data-transaction-id="' + esc(t.transaction_id) + '">Setujui</button>' +
                        '<button class="btn btn-danger btn-sm reject-tx-btn" data-transaction-id="' + esc(t.transaction_id) + '">Tolak</button>' +
                        '</div>'
                        : '<span style="color:var(--text-muted);font-size:0.75rem;">-</span>';
                    return '<tr><td>' + esc(t.createdAt) + '</td><td>' + esc(t.username) + '</td><td>' + esc(t.transaction_id) + '</td>' +
                        '<td>Rp ' + esc(t.amount) + '</td>' +
                        '<td>Rp ' + esc(base) + ' + Rp ' + esc(fee) + '</td>' +
                        '<td>' + status + '</td><td>' + action + '</td></tr>';
                }).join('');
            }
            tbody.querySelectorAll('.approve-tx-btn').forEach(function (b) {
                b.addEventListener('click', function () {
                    api('/api/admin/transaction/approve', { method: 'POST', body: { transaction_id: b.dataset.transactionId } }).then(function (d) {
                        Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'DISETUJUI!' : 'GAGAL', text: d.message, timer: 1500, showConfirmButton: false });
                        loadAdminUpgrades(current);
                        loadAdminTransactions(current);
                        loadAdminUsers();
                    });
                });
            });
            renderPagination($('admin-upgrades-pagination'), totalPages, current, loadAdminUpgrades);

            tbody.querySelectorAll(".reject-tx-btn").forEach(function (b) {
                b.addEventListener("click", function () {
                    if (b.disabled) return;
                    b.disabled = true;
                    var orig = b.textContent;
                    b.textContent = "MEMPROSES...";
                    api("/api/admin/transaction/reject", { method: "POST", body: { transaction_id: b.dataset.transactionId } }).then(function (d) {
                        if (d && d.success) {
                            Swal.fire({ icon: "success", title: "DITOLAK!", text: d.message || "Upgrade ditolak.", timer: 1500, showConfirmButton: false });
                            loadAdminUpgrades(current);
                        } else {
                            Swal.fire({ icon: "error", title: "GAGAL", text: (d && d.message) || "Gagal menolak upgrade.", confirmButtonText: "OK" });
                            b.disabled = false;
                            b.textContent = orig;
                        }
                    }).catch(function () {
                        Swal.fire({ icon: "error", title: "GAGAL", text: "Terjadi kesalahan koneksi.", confirmButtonText: "OK" });
                        b.disabled = false;
                        b.textContent = orig;
                    });
                });
            });
        }).catch(function () {
            setAdminTableState(tbody, 7, 'Gagal terhubung ke server.', 'error');
        });
    }

    function loadAdminIps(page) {
        /* IP card telah dihapus — tidak ada yang perlu dimuat */
        if (!$('admin-ips-table-body')) return;
        var tbody = $('admin-ips-table-body');
        setAdminTableState(tbody, 5, 'Memuat alamat IP dan perangkat...', 'loading');
        api('/api/admin/ips').then(function (data) {
            adminIpsCache = data.users || [];
            adminBannedIpsCache = data.bannedIps || [];
            var countEl = $('admin-ips-result-count');
            if (countEl) countEl.textContent = adminIpsCache.length + ' data IP ditemukan';
            renderAdminIpsTab(page || 1);
            renderAdminCleanupTab(1);
        }).catch(function () {
            setAdminTableState(tbody, 5, 'Gagal terhubung ke server.', 'error');
            var pagination = $('admin-ips-pagination');
            if (pagination) pagination.innerHTML = '';
        });
    }

    function groupAdminIps(users) {
        var groups = {};
        users.forEach(function (u) {
            var ip = String(u.ip || 'Tidak diketahui');
            if (!groups[ip]) groups[ip] = { ip: ip, users: [], count: 0, blocked: false };
            groups[ip].users.push(u);
            groups[ip].count += 1;
            groups[ip].blocked = groups[ip].blocked || !!u.bannedIp;
        });
        return Object.keys(groups).map(function (ip) { return groups[ip]; });
    }

    function renderAdminIPMember(u) {
        var blocked = !!u.bannedIp;
        var ip = String(u.ip || '').trim();
        var action = ip
            ? '<button class="btn ' + (blocked ? 'btn-success' : 'btn-danger') + ' btn-sm ban-ip-btn" data-ip="' + esc(ip) + '" data-banned="' + (blocked ? 1 : 0) + '">' + (blocked ? 'Unban IP' : 'Ban IP') + '</button>'
            : '<span class="admin-no-action"><i class="fa-solid fa-minus"></i> IP tidak tersedia</span>';
        return '<div class="ip-member-detail"><div class="ip-member-identity"><strong>' + esc(u.username) + '</strong><span class="badge ' + (ROLE_BADGE[u.role] || 'badge-normal') + '">' + esc(ROLE_LABEL[u.role] || u.role) + '</span></div><span class="ip-member-device"><i class="fa-solid fa-desktop"></i> ' + esc(u.device || u.os || 'Tidak diketahui') + '</span>' + action + '</div>';
    }

    function bindAdminIPActions(container, page) {
        container.querySelectorAll('.ban-ip-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                var blocked = b.dataset.banned === '1';
                api('/api/admin/ip/' + (blocked ? 'unban' : 'ban'), { method: 'POST', body: { ip: b.dataset.ip } }).then(function (d) {
                    Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'OK' : 'GAGAL', text: d.message, timer: 1200, showConfirmButton: false });
                    if (d.success) loadAdminIps(page);
                });
            });
        });
        container.querySelectorAll('.ip-detail-btn').forEach(function (button) {
            button.addEventListener('click', function () {
                var ip = button.dataset.ip;
                container.querySelectorAll('[data-detail-ip]').forEach(function (detail) {
                    if (detail.dataset.detailIp === ip) detail.classList.toggle('hidden');
                });
                button.classList.toggle('is-open');
                button.innerHTML = button.classList.contains('is-open') ? '<i class="fa-solid fa-chevron-up"></i> Tutup' : '<i class="fa-solid fa-list"></i> Detail';
            });
        });
    }

    function renderAdminIpsTab(page) {
        var query = ($('admin-search-ips') ? $('admin-search-ips').value : '').trim().toLowerCase();
        var filter = $('admin-filter-ips') ? $('admin-filter-ips').value : 'all';
        var groups = groupAdminIps(adminIpsCache).filter(function (group) {
            var haystack = [group.ip].concat(group.users.map(function (u) {
                return [u.username, u.device, u.os, u.role, ROLE_LABEL[u.role] || ''].join(' ');
            })).join(' ').toLowerCase();
            var matchesQuery = !query || haystack.indexOf(query) !== -1;
            var matchesFilter = filter === 'all' || (filter === 'over' ? group.count > 3 : group.count === parseInt(filter, 10));
            return matchesQuery && matchesFilter;
        });
        var perPage = 10;
        var totalPages = Math.max(1, Math.ceil(groups.length / perPage));
        var current = Math.min(Math.max(1, page || 1), totalPages);
        var visibleGroups = groups.slice((current - 1) * perPage, current * perPage);
        var resultCount = $('admin-ips-result-count');
        if (resultCount) resultCount.textContent = groups.length + ' grup IP ditemukan';
        var tbody = $('admin-ips-table-body');
        var mobile = $('admin-ips-mobile-list');
        if (!groups.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="ip-list-state"><i class="fa-solid fa-network-wired"></i><span>Tidak ada data IP yang cocok.</span></td></tr>';
            if (mobile) mobile.innerHTML = '<div class="ip-list-state ip-empty-state"><i class="fa-solid fa-network-wired"></i><span>Tidak ada data IP yang cocok.</span></div>';
        } else {
            var desktop = [];
            var mobileHtml = [];
            visibleGroups.forEach(function (group) {
                var over = group.count > 3;
                var status = over ? '<span class="status-failed"><i class="fa-solid fa-triangle-exclamation"></i> Melebihi batas</span>' : group.blocked ? '<span class="status-failed"><i class="fa-solid fa-ban"></i> Blocked</span>' : '<span class="status-success"><i class="fa-solid fa-circle-check"></i> Normal</span>';
                var names = group.users.map(function (u) { return '<span class="ip-user-chip">' + esc(u.username) + '</span>'; }).join('');
                var members = group.users.map(renderAdminIPMember).join('');
                desktop.push('<tr class="ip-group-row"><td><strong class="ip-address-cell"><i class="fa-solid fa-globe"></i> ' + esc(group.ip) + '</strong></td><td><span class="badge ' + (over ? 'badge-admin' : 'badge-normal') + '">' + (over ? '⚠️ ' : '') + group.count + ' akun</span></td><td><div class="ip-user-chips">' + names + '</div></td><td>' + status + '</td><td><button class="btn btn-secondary btn-sm ip-detail-btn" data-ip="' + esc(group.ip) + '"><i class="fa-solid fa-list"></i> Detail</button></td></tr><tr class="ip-detail-row hidden" data-detail-ip="' + esc(group.ip) + '"><td colspan="5"><div class="ip-members-panel"><strong>Daftar akun dari ' + esc(group.ip) + '</strong>' + members + '</div></td></tr>');
                mobileHtml.push('<article class="ip-group-card"><div class="ip-group-card-head"><strong class="ip-address-cell"><i class="fa-solid fa-globe"></i> ' + esc(group.ip) + '</strong>' + status + '</div><div class="ip-group-card-count">' + (over ? '⚠️ ' : '') + group.count + ' akun terdaftar</div><div class="ip-user-chips">' + names + '</div><button class="btn btn-secondary btn-sm ip-detail-btn" data-ip="' + esc(group.ip) + '"><i class="fa-solid fa-list"></i> Detail akun</button><div class="ip-detail-row hidden" data-detail-ip="' + esc(group.ip) + '"><div class="ip-members-panel">' + members + '</div></div></article>');
            });
            tbody.innerHTML = desktop.join('');
            if (mobile) mobile.innerHTML = mobileHtml.join('');
        }
        renderPagination($('admin-ips-pagination'), totalPages, current, function (p) { renderAdminIpsTab(p); });
        bindAdminIPActions(document.getElementById('admin-ips-card'), current);
    }

    function renderAdminCleanupTab(page) {
        var banned = adminBannedIpsCache;
        var perPage = 10;
        var totalPages = Math.max(1, Math.ceil(banned.length / perPage));
        var current = Math.min(Math.max(1, page || 1), totalPages);
        var visible = banned.slice((current - 1) * perPage, current * perPage);
        var countEl = $('admin-banned-result-count');
        if (countEl) countEl.textContent = banned.length + ' IP terblokir';
        var btbody = $('admin-banned-ips-table-body');
        if (!banned.length) {
            setAdminTableState(btbody, 3, 'Tidak ada IP terblokir.', 'empty');
        } else {
            btbody.innerHTML = visible.map(function (entry) {
                var ip = typeof entry === 'string' ? entry : (entry && entry.ip) || '';
                var createdAt = typeof entry === 'string' ? '-' : (entry && entry.createdAt) || '-';
                return '<tr><td><code>' + esc(ip) + '</code></td><td>' + esc(createdAt) + '</td><td><button class="btn btn-success btn-sm unban-ip-btn" data-ip="' + esc(ip) + '">Unban</button></td></tr>';
            }).join('');
            btbody.querySelectorAll('.unban-ip-btn').forEach(function (b) {
                b.addEventListener('click', function () {
                    api('/api/admin/ip/unban', { method: 'POST', body: { ip: b.dataset.ip } }).then(function (d) {
                        Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'OK' : 'GAGAL', text: d.message, timer: 1200, showConfirmButton: false });
                        if (d.success) loadAdminIps(1);
                    });
                });
            });
        }
        renderPagination($('admin-banned-pagination'), totalPages, current, function (p) { renderAdminCleanupTab(p); });
    }

    function loadDuplicateLogs() {
        api('/api/admin/duplicate-logs').then(function (data) {
            var console = $('duplicate-logs-container');
            var logs = data.logs || [];
            if (!logs.length) {
                console.innerHTML = '<div>[SYSTEM] Tidak ada percobaan kloning terdeteksi.</div>';
                return;
            }
            console.innerHTML = logs.slice().reverse().map(function (l) {
                return '<div style="color:#22d3ee;">[' + esc(l.createdAt) + '] ' + esc(l.message) + '</div>';
            }).join('');
        });
    }

    function bindAdminActions() {
        var resetBtn = $('btn-admin-reset-credits');
        if (resetBtn && !resetBtn.dataset.bound) {
            resetBtn.dataset.bound = '1';
            resetBtn.addEventListener('click', function () {
                Swal.fire({ title: 'Reset Semua Kredit?', text: 'Semua anggota (role user) akan dikembalikan ke 50 kredit.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya, Reset', cancelButtonText: 'Batal' })
                    .then(function (r) {
                        if (!r.isConfirmed) return;
                        api('/api/admin/reset-all-credits', { method: 'POST' }).then(function (d) {
                            Swal.fire({ icon: 'success', title: 'BERHASIL!', text: d.message, timer: 1500, showConfirmButton: false });
                            loadAdminUsers();
                            loadAdminStats();
                        });
                    });
            });
            var cleanupBtn = $('btn-cleanup-ry-users');
            if (cleanupBtn) {
                cleanupBtn.addEventListener('click', function () {
                    Swal.fire({ title: 'Bersihkan Akun ry_?', text: 'Cleanup ini menggunakan proses existing dan berlaku global untuk semua akun berawalan "ry_", beserta log dan transaksi terkait.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya, Bersihkan Global', cancelButtonText: 'Batal' })
                        .then(function (r) {
                            if (!r.isConfirmed) return;
                            api('/api/admin/cleanup-ry', { method: 'POST' }).then(function (d) {
                                Swal.fire({ icon: 'success', title: 'BERSIH!', text: d.message, timer: 1500, showConfirmButton: false });
                                loadAdminUsers();
                                loadAdminStats();
                                loadAdminIps(1);
                            });
                        });
                });
            }
            var banIpBtn = $('btn-ban-ip-submit');
            var banIpInput = $('input-ban-ip');
            if (banIpBtn && banIpInput) {
                banIpBtn.addEventListener('click', function () {
                    var ip = banIpInput.value.trim();
                    if (!ip) return Swal.fire({ icon: 'warning', title: 'Perhatian', text: 'Masukkan IP terlebih dahulu.' });
                    api('/api/admin/ip/ban', { method: 'POST', body: { ip: ip } }).then(function (d) {
                        Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'DI-BLOKIR!' : 'GAGAL', text: d.message, timer: 1500, showConfirmButton: false });
                        banIpInput.value = '';
                        loadAdminIps(1);
                    });
                });
            }
            var userFilterControls = ['admin-search-users', 'admin-filter-role', 'admin-filter-status'];
            userFilterControls.forEach(function (id) {
                var control = $(id);
                if (control && !control.dataset.bound) {
                    control.dataset.bound = '1';
                    control.addEventListener('input', function () { renderAdminUsers(1); });
                    control.addEventListener('change', function () { renderAdminUsers(1); });
                }
            });
            var logFilterControls = ['admin-search-logs', 'admin-filter-log-status'];
            logFilterControls.forEach(function (id) {
                var control = $(id);
                if (control && !control.dataset.bound) {
                    control.dataset.bound = '1';
                    control.addEventListener('input', function () { renderAdminLogs(1); });
                    control.addEventListener('change', function () { renderAdminLogs(1); });
                }
            });
            var refreshUsers = $('btn-admin-refresh-users');
            if (refreshUsers && !refreshUsers.dataset.bound) {
                refreshUsers.dataset.bound = '1';
                refreshUsers.addEventListener('click', function () { loadAdminUsers(); });
            }
            var refreshIps = $('btn-admin-refresh-ips');
            if (refreshIps && !refreshIps.dataset.bound) {
                refreshIps.dataset.bound = '1';
                refreshIps.addEventListener('click', function () { loadAdminIps(1); });
            }
            ['admin-search-ips', 'admin-filter-ips'].forEach(function (id) {
                var control = $(id);
                if (control && !control.dataset.bound) {
                    control.dataset.bound = '1';
                    control.addEventListener('input', function () { renderAdminIpsTab(1); });
                    control.addEventListener('change', function () { renderAdminIpsTab(1); });
                }
            });
            /* Tab switching: IP Anggota | Pembersihan */
            var ipTabs = $('admin-ip-tabs');
            if (ipTabs && !ipTabs.dataset.bound) {
                ipTabs.dataset.bound = '1';
                ipTabs.querySelectorAll('.admin-tab-btn').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        ipTabs.querySelectorAll('.admin-tab-btn').forEach(function (b) { b.classList.remove('active'); });
                        btn.classList.add('active');
                        var tabId = btn.dataset.tab;
                        document.querySelectorAll('#admin-ips-card .admin-tab-content').forEach(function (c) { c.classList.add('hidden'); });
                        var target = document.getElementById(tabId);
                        if (target) target.classList.remove('hidden');
                    });
                });
            }
            var refreshLogs = $('btn-admin-refresh-logs');
            if (refreshLogs && !refreshLogs.dataset.bound) {
                refreshLogs.dataset.bound = '1';
                refreshLogs.addEventListener('click', function () { loadAdminLogs(); });
            }
            var refreshH2h = $('btn-admin-refresh-h2h');
            if (refreshH2h && !refreshH2h.dataset.bound) {
                refreshH2h.dataset.bound = '1';
                refreshH2h.addEventListener('click', function () { loadAdminH2hProfile(); });
            }
            var refreshUpgrades = $('btn-admin-refresh-upgrades');
            if (refreshUpgrades && !refreshUpgrades.dataset.bound) {
                refreshUpgrades.dataset.bound = '1';
                refreshUpgrades.addEventListener('click', function () { loadAdminUpgrades(); });
            }
        }

        var tbody = $('admin-users-table-body');
        if (tbody && !tbody.dataset.bound) {
            tbody.dataset.bound = '1';
            tbody.addEventListener('click', function (e) {
                var btn = e.target.closest('button');
                if (!btn) return;
                var id = btn.dataset.id;
                if (btn.classList.contains('edit-credits-btn')) {
                    Swal.fire({
                        title: 'Edit Kredit', input: 'number', inputValue: btn.dataset.credits,
                        inputValidator: function (v) { if (v == null || isNaN(v)) return 'Masukkan angka valid'; }
                    }).then(function (r) {
                        if (!r.isConfirmed) return;
                        api('/api/admin/user/credits', { method: 'POST', body: { userId: id, credits: parseInt(r.value, 10) } }).then(function (d) {
                            Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'DIUBAH!' : 'GAGAL', text: d.message, timer: 1500, showConfirmButton: false });
                            loadAdminUsers();
                        });
                    });
                } else if (btn.classList.contains('edit-role-btn')) {
                    handleEditRole(id);
                } else if (btn.classList.contains('reset-password-btn')) {
                    Swal.fire({
                        title: 'Reset Password', input: 'text',
                        inputValidator: function (v) { if (!v || v.length < 6) return 'Password minimal 6 karakter'; }
                    }).then(function (r) {
                        if (!r.isConfirmed) return;
                        api('/api/admin/user/reset-password', { method: 'POST', body: { userId: id, newPassword: r.value } }).then(function (d) {
                            Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'DI-RESET!' : 'GAGAL', text: d.message, timer: 1500, showConfirmButton: false });
                        });
                    });
                } else if (btn.classList.contains('toggle-ban-btn')) {
                    api('/api/admin/user/toggle-ban', { method: 'POST', body: { userId: id } }).then(function (d) {
                        Swal.fire({ icon: 'success', title: 'OK', text: d.message, timer: 1200, showConfirmButton: false });
                        loadAdminUsers();
                    });
                } else if (btn.classList.contains('delete-user-btn')) {
                    Swal.fire({ title: 'Hapus User?', text: 'Akun akan dihapus permanen.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya, Hapus', cancelButtonText: 'Batal' })
                        .then(function (r) {
                            if (!r.isConfirmed) return;
                            api('/api/admin/user/delete', { method: 'POST', body: { userId: id } }).then(function (d) {
                                Swal.fire({ icon: 'success', title: 'TERHAPUS!', text: d.message, timer: 1200, showConfirmButton: false });
                                loadAdminUsers();
                                loadAdminStats();
                            });
                        });
                }
            });
        }
    }

    function handleEditRole(userId) {
        Swal.fire({
            title: 'Ubah Role', input: 'select',
            inputOptions: { USER: 'USER — Credit Based', RESELLER: 'RESELLER — Unlimited Web Only', PREMIUM: 'PREMIUM — API Single Create', AUTOGEN: 'AUTOGEN — API Bulk Auto', VIP: 'VIP — Unlimited + VIP Feature', PRO: 'PRO — 200 Credits + 1 Bot', OWNER: 'OWNER — Full Access' },
            inputPlaceholder: 'Pilih role baru', showCancelButton: true, confirmButtonText: 'Simpan', cancelButtonText: 'Batal',
            preConfirm: function (role) { if (!role) Swal.showValidationMessage('Pilih role'); return role; }
        }).then(function (r) {
            if (!r.isConfirmed || !r.value) return;
            var role = r.value;
            if (role === 'PREMIUM') {
                Swal.fire({
                    title: 'Durasi Paket', input: 'select',
                    inputOptions: { lifetime: 'Lifetime (Selamanya)', daily: 'Harian (Batas Waktu)' },
                    showCancelButton: true, confirmButtonText: 'Lanjut', cancelButtonText: 'Batal'
                }).then(function (d) {
                    if (!d.isConfirmed) return;
                    if (d.value === 'lifetime') {
                        api('/api/admin/user/role', { method: 'POST', body: { userId: userId, role: 'premium', apiPlan: 'lifetime' } }).then(function (res) {
                            Swal.fire({ icon: res.success ? 'success' : 'error', title: res.success ? 'DIUBAH!' : 'GAGAL', text: res.message, timer: 1500, showConfirmButton: false });
                            loadAdminUsers();
                        });
                    } else {
                        Swal.fire({
                            title: 'Berapa Hari?', input: 'number', inputValue: 30,
                            inputValidator: function (v) { if (!v || isNaN(v)) return 'Masukkan jumlah hari'; }
                        }).then(function (days) {
                            if (!days.isConfirmed) return;
                            api('/api/admin/user/role', { method: 'POST', body: { userId: userId, role: 'premium', apiPlan: 'monthly', expiresInDays: parseInt(days.value, 10) } }).then(function (res) {
                                Swal.fire({ icon: res.success ? 'success' : 'error', title: res.success ? 'DIUBAH!' : 'GAGAL', text: res.message, timer: 1500, showConfirmButton: false });
                                loadAdminUsers();
                            });
                        });
                    }
                });
            } else {
                var selectedRole = role === 'AUTOGEN' ? 'autogen' : role.toLowerCase();
                api('/api/admin/user/role', { method: 'POST', body: { userId: userId, role: selectedRole } }).then(function (res) {
                    Swal.fire({ icon: res.success ? 'success' : 'error', title: res.success ? 'DIUBAH!' : 'GAGAL', text: res.message, timer: 1500, showConfirmButton: false });
                    loadAdminUsers();
                });
            }
        });
    }

    /* ============================== SETTINGS (ADMIN) ============================== */

    function loadAdminSettings() {
        if (!isAdminOrOwner()) return;
        api('/api/admin/system/settings').then(function (data) {
            var maint = data.maintenance || {};
            if ($('maint-generator')) $('maint-generator').checked = !!maint.generator;
            if ($('maint-netflix')) $('maint-netflix').checked = !!maint.netflix;
            if ($('maint-chat')) $('maint-chat').checked = !!maint.chat;
            if ($('maint-purchase')) $('maint-purchase').checked = !!maint.purchase;
            if ($('maint-apikey-user')) $('maint-apikey-user').checked = !!maint.apikeyUserDisabled;
            var ac = data.autoCleanup || {};
            if ($('autocleanup-enabled')) $('autocleanup-enabled').checked = !!ac.enabled;
            if ($('autocleanup-hours')) $('autocleanup-hours').value = String(ac.hours || 24);
            var statusEl = document.getElementById('autocleanup-status');
            if (statusEl) {
                var dot = '<i class="fa-solid fa-circle" style="font-size:0.55rem; margin-right:6px; color:' + (ac.enabled ? '#10b981' : '#64748b') + ';"></i>';
                var msg = ac.enabled ? 'Aktif — akun tanpa login akan dibersihkan otomatis setelah durasi yang dipilih.' : 'Nonaktif — akun nonaktif tidak akan dihapus otomatis.';
                var lastTxt = ac.lastRun ? '<span style="color:var(--text-muted); margin-left:4px;">Terakhir: ' + ac.lastRun + (ac.lastCount ? ' (' + ac.lastCount + ' akun)' : '') + '</span>' : '';
                statusEl.innerHTML = dot + msg + lastTxt;
            }
        });
        var saveBtn = $('btn-save-maintenance');
        if (saveBtn && !saveBtn.dataset.bound) {
            saveBtn.dataset.bound = '1';
            saveBtn.addEventListener('click', function () {
                var value = {
                    generator: $('maint-generator').checked,
                    netflix: $('maint-netflix').checked,
                    chat: $('maint-chat').checked,
                    purchase: $('maint-purchase').checked,
                    apikeyUserDisabled: $('maint-apikey-user').checked
                };
                api('/api/admin/system/settings', { method: 'POST', body: { key: 'maintenance', value: value } }).then(function (d) {
                    Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'TERSIMPAN!' : 'GAGAL', text: d.message, timer: 1500, showConfirmButton: false });
                });
            });
            var saveAcBtn = $('btn-save-autocleanup');
            if (saveAcBtn) saveAcBtn.addEventListener('click', function () {
                api('/api/admin/system/settings', { method: 'POST', body: { autoCleanup: { enabled: !!(document.getElementById('autocleanup-enabled') || {}).checked, hours: parseInt((document.getElementById('autocleanup-hours') || {}).value, 10) } } }).then(function (d) {
                    Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'TERSIMPAN!' : 'GAGAL', text: d.message, timer: 1500, showConfirmButton: false });
                    if (d.success) loadAdminSettings();
                });
            });
            var runAcBtn = $('btn-autocleanup-run');
            if (runAcBtn) runAcBtn.addEventListener('click', function () {
                api('/api/admin/autocleanup/run', { method: 'POST' }).then(function (d) {
                    Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'SELESAI!' : 'GAGAL', text: d.message, timer: 1800, showConfirmButton: false });
                    loadAdminSettings();
                });
            });
            $('btn-admin-add-notif').addEventListener('click', function () {
                Swal.fire({
                    title: 'Tambah Pengumuman', html:
                        '<select id="swal-notif-type" class="swal2-select"><option value="info">Info</option><option value="gift">Hadiah</option><option value="success">Sukses</option></select>' +
                        '<input id="swal-notif-title" class="swal2-input" placeholder="Judul">' +
                        '<textarea id="swal-notif-text" class="swal2-textarea" placeholder="Isi pengumuman"></textarea>',
                    focusConfirm: false, showCancelButton: true, confirmButtonText: 'Simpan', cancelButtonText: 'Batal',
                    preConfirm: function () {
                        var title = document.getElementById('swal-notif-title').value.trim();
                        var text = document.getElementById('swal-notif-text').value.trim();
                        if (!title) { Swal.showValidationMessage('Judul wajib diisi'); return; }
                        return {
                            type: document.getElementById('swal-notif-type').value,
                            title: title, text: text, isActive: true
                        };
                    }
                }).then(function (r) {
                    if (!r.isConfirmed) return;
                    api('/api/admin/notifications', { method: 'POST', body: r.value }).then(function (d) {
                        Swal.fire({ icon: 'success', title: 'DITAMBAH!', timer: 1200, showConfirmButton: false });
                        renderAdminNotifications();
                    });
                });
            });
        }
        renderAdminNotifications();
    }

    function renderAdminNotifications() {
        api('/api/admin/notifications').then(function (data) {
            var list = data.notifications || [];
            var tbody = $('admin-notifications-table-body');
            if (!list.length) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">Belum ada pengumuman.</td></tr>';
                return;
            }
            tbody.innerHTML = list.map(function (n) {
                var badge = n.type === 'gift' ? '<span class="badge badge-warning" style="background:var(--pending);">Hadiah</span>'
                    : n.type === 'success' ? '<span class="badge badge-success" style="background:var(--success);">Sukses</span>'
                    : '<span class="badge badge-info" style="background:var(--accent-secondary);">Info</span>';
                return '<tr><td>' + badge + ' <strong>' + esc(n.title) + '</strong></td>' +
                    '<td>' + esc(n.text) + '</td>' +
                    '<td>' + (n.isActive ? '<span class="status-success">Aktif</span>' : '<span class="status-failed">Nonaktif</span>') + '</td>' +
                    '<td>' +
                    '<button class="btn btn-secondary btn-sm toggle-notif-btn" data-id="' + n.id + '" data-active="' + (n.isActive ? 1 : 0) + '">' + (n.isActive ? 'Nonaktifkan' : 'Aktifkan') + '</button> ' +
                    '<button class="btn btn-warning btn-sm edit-notif-btn" data-id="' + n.id + '" data-title="' + esc(n.title) + '" data-text="' + esc(n.text) + '">Edit</button> ' +
                    '<button class="btn btn-danger btn-sm delete-notif-btn" data-id="' + n.id + '">Hapus</button></td></tr>';
            }).join('');
            tbody.querySelectorAll('button').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = btn.dataset.id;
                    if (btn.classList.contains('toggle-notif-btn')) {
                        api('/api/admin/notifications/' + id, { method: 'PUT', body: { isActive: !(btn.dataset.active === '1') } }).then(function () { renderAdminNotifications(); });
                    } else if (btn.classList.contains('delete-notif-btn')) {
                        api('/api/admin/notifications/' + id, { method: 'DELETE' }).then(function () { renderAdminNotifications(); });
                    } else if (btn.classList.contains('edit-notif-btn')) {
                        Swal.fire({
                            title: 'Edit Pengumuman',
                            html: '<input id="swal-notif-title" class="swal2-input" value="' + esc(btn.dataset.title) + '">' +
                                '<textarea id="swal-notif-text" class="swal2-textarea">' + esc(btn.dataset.text) + '</textarea>',
                            focusConfirm: false, showCancelButton: true, confirmButtonText: 'Simpan', cancelButtonText: 'Batal',
                            preConfirm: function () {
                                return { title: document.getElementById('swal-notif-title').value.trim(), text: document.getElementById('swal-notif-text').value.trim() };
                            }
                        }).then(function (r) {
                            if (!r.isConfirmed) return;
                            api('/api/admin/notifications/' + id, { method: 'PUT', body: r.value }).then(function () { renderAdminNotifications(); });
                        });
                    }
                });
            });
        });
    }

    /* ============================== NOTIFICATIONS & THEME ============================== */

    function loadNotifications() {
        api('/api/auth/notifications').then(function (data) {
            var list = data.notifications || [];
            var badge = $('notifications-badge');
            var readSet = {};
            try { readSet = JSON.parse(localStorage.getItem('read_notifications') || '[]'); } catch (e) {}
            var unread = list.filter(function (n) { return n.isActive && readSet.indexOf(n.id) === -1; }).length;
            if (badge) {
                if (unread) {
                    badge.textContent = unread;
                    badge.style.cssText = 'display:flex;background:#ef4444;color:#fff;font-size:0.65rem;font-weight:700;min-width:16px;width:auto;height:16px;padding:0 4px;border-radius:50%;align-items:center;justify-content:center;position:absolute;top:-2px;right:-2px;';
                } else {
                    badge.textContent = '';
                    badge.style.display = 'none';
                }
            }
            var listEl = $('notifications-list');
            if (!list.length) {
                listEl.innerHTML = '<div class="notifications-empty"><i class="fa-solid fa-bell-slash" style="font-size:1.5rem;"></i>Belum ada pemberitahuan</div>';
                return;
            }
            listEl.innerHTML = list.map(function (n) {
                var icon = n.type === 'gift' ? 'fa-gift notification-icon-gift' : n.type === 'success' ? 'fa-circle-check notification-icon-success' : 'fa-circle-info notification-icon-info';
                return '<div class="notification-item' + (readSet.indexOf(n.id) === -1 && n.isActive ? ' unread' : '') + '" data-id="' + n.id + '">' +
                    '<div class="notification-icon-wrapper ' + icon + '"><i class="fa-solid ' + icon.split(' ')[0] + '"></i></div>' +
                    '<div class="notification-content"><p class="notification-title">' + esc(n.title) + '</p>' +
                    '<p class="notification-text">' + esc(n.text) + '</p>' +
                    '<span class="notification-time">' + esc(n.createdAt) + '</span></div></div>';
            }).join('');
            listEl.querySelectorAll('.notification-item').forEach(function (item) {
                item.addEventListener('click', function () {
                    var id = item.dataset.id;
                    readSet.push(id);
                    localStorage.setItem('read_notifications', JSON.stringify(readSet));
                    item.classList.remove('unread');
                    loadNotifications();
                });
            });
        });
    }

    function bindNotifications() {
        var bell = $('btn-topbar-notifications');
        var dropdown = $('notifications-dropdown');
        if (bell && dropdown) {
            bell.addEventListener('click', function (e) {
                e.stopPropagation();
                dropdown.classList.toggle('hidden');
            });
            document.addEventListener('click', function (e) {
                if (!dropdown.contains(e.target)) dropdown.classList.add('hidden');
            });
            if ($('btn-clear-notifications')) {
                $('btn-clear-notifications').addEventListener('click', function () {
                    localStorage.setItem('notifications_cleared', 'true');
                    dropdown.classList.add('hidden');
                });
            }
        }
        loadNotifications();
    }

    function checkAppVersion() {
        try {
            var version = localStorage.getItem('app_version');
            if (version && version !== '1.0.3') {
                Swal.fire({
                    icon: 'warning', title: 'Update Tersedia!',
                    text: 'Versi aplikasi Anda sudah usang. Silakan unduh versi terbaru.',
                    confirmButtonText: 'Download APK'
                }).then(function () {
                    window.location.href = '/alwayscodex.apk';
                });
            }
        } catch (e) {}
    }

    /* ============================== PREMIUM THEME ============================== */
    var themeMediaQuery = null;
    var themeGateTimer = null;

    function themeStorageKey() {
        var identity = currentUser && (currentUser.username || currentUser.id);
        return 'am-theme-preference:' + (identity ? String(identity).toLowerCase() : 'guest');
    }

    function normalizeThemePreference(value) {
        return ['light', 'dark', 'system'].indexOf(value) !== -1 ? value : 'system';
    }

    function readThemePreference() {
        try {
            var saved = localStorage.getItem(themeStorageKey());
            if (!saved && currentUser) saved = localStorage.getItem('am-theme-preference:guest');
            if (!saved) {
                var legacy = localStorage.getItem('theme');
                saved = legacy === 'dark' || legacy === 'light' ? legacy : 'system';
            }
            return normalizeThemePreference(saved);
        } catch (e) { return 'system'; }
    }

    function isSystemDark() {
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    function revealThemePage() {
        if (themeGateTimer) {
            clearTimeout(themeGateTimer);
            themeGateTimer = null;
        }
        document.documentElement.classList.remove('theme-pending');
    }

    function applyThemePreference(preference) {
        var choice = normalizeThemePreference(preference);
        var dark = choice === 'dark' || (choice === 'system' && isSystemDark());
        document.documentElement.dataset.themePreference = choice;
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        var themeMeta = document.querySelector('meta[name="theme-color"]');
        if (themeMeta) themeMeta.setAttribute('content', dark ? '#0B0F19' : '#F8FAFC');
        document.body.classList.toggle('dark-theme', dark);
        document.body.classList.toggle('light-theme', !dark);

        var trigger = $('btn-theme-menu');
        if (trigger) {
            trigger.dataset.activeTheme = choice;
            trigger.setAttribute('aria-label', 'Theme: ' + choice.charAt(0).toUpperCase() + choice.slice(1));
        }
        document.querySelectorAll('.theme-option').forEach(function (option) {
            var active = option.dataset.themeChoice === choice;
            option.classList.toggle('active', active);
            option.setAttribute('aria-checked', active ? 'true' : 'false');
        });
    }

    function saveThemePreference(preference) {
        var choice = normalizeThemePreference(preference);
        try {
            localStorage.setItem(themeStorageKey(), choice);
            if (!currentUser) localStorage.setItem('am-theme-preference:guest', choice);
        } catch (e) {}
        applyThemePreference(choice);
    }

    function initThemeToggle() {
        applyThemePreference(readThemePreference());
        if (window.matchMedia) {
            themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            var onSystemThemeChange = function () {
                if (readThemePreference() === 'system') applyThemePreference('system');
            };
            if (themeMediaQuery.addEventListener) themeMediaQuery.addEventListener('change', onSystemThemeChange);
            else if (themeMediaQuery.addListener) themeMediaQuery.addListener(onSystemThemeChange);
        }

        var trigger = $('btn-theme-menu');
        var menu = $('theme-menu');
        if (!trigger || !menu || trigger.dataset.bound) return;
        trigger.dataset.bound = '1';
        trigger.addEventListener('click', function (event) {
            event.stopPropagation();
            var open = menu.classList.toggle('hidden');
            trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
            trigger.classList.toggle('is-open', !open);
        });
        document.querySelectorAll('.theme-option').forEach(function (option) {
            option.addEventListener('click', function (event) {
                event.stopPropagation();
                createThemeRipple(event, option);
                saveThemePreference(option.dataset.themeChoice);
                menu.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
                trigger.classList.remove('is-open');
            });
        });
        trigger.addEventListener('pointerdown', function (event) {
            createThemeRipple(event, trigger);
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                menu.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
                trigger.classList.remove('is-open');
            }
        });
        document.addEventListener('click', function (event) {
            if (!event.target.closest('#theme-control')) {
                menu.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
                trigger.classList.remove('is-open');
            }
        });
    }

    function createThemeRipple(event, element) {
        if (!element || window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var rect = element.getBoundingClientRect();
        var ripple = document.createElement('span');
        ripple.className = 'theme-ripple';
        ripple.style.left = (event.clientX - rect.left) + 'px';
        ripple.style.top = (event.clientY - rect.top) + 'px';
        element.appendChild(ripple);
        setTimeout(function () { ripple.remove(); }, 600);
    }
    // Theme preference is initialized before session detection and refreshed per user after login.

    /* ============================== INIT ============================== */

    document.addEventListener('DOMContentLoaded', function () {
        bindNav();
        bindAuth();
        restoreAuthView(); // Refresh tetap di view login/register + draft form dipulihkan
        bindNotifications();
        checkAppVersion();
        initThemeToggle(); // FITUR BARU - Pemanggilan Switch Theme
        // Referral dari link (format /invite?code=, /?ref=, /#referal?ref=, /#register?ref=)
        // URL adalah SATU-SATUNYA sumber kebenaran. Tidak ada default/hardcode.
        try {
            var inviteCode = getReferralFromUrl();
            var refField = $('register-referral');
            if (inviteCode) {
                // Ada ?invite=CODE → gunakan CODE, simpan untuk persist saat refresh.
                try { localStorage.setItem('pendingReferral', inviteCode); } catch (err) {}
                if (refField) refField.value = inviteCode;
                checkReferral(inviteCode);
            } else {
                // TIDAK ada invite di URL → referral kosong, buang pending basi.
                try { localStorage.removeItem('pendingReferral'); } catch (err) {}
                if (refField) refField.value = '';
                setReferralUI('idle');
            }
            if (refField) {
                // Validasi kode referral live dengan debounce 600ms (anti-spam API)
                var refDebounce = null;
                refField.addEventListener('input', function () {
                    clearTimeout(refDebounce);
                    refDebounce = setTimeout(function () {
                        var v = refField.value.trim();
                        // User menghapus kode = tidak pakai referral; buang pending basi
                        if (!v) { try { localStorage.removeItem('pendingReferral'); } catch (err) {} }
                        checkReferral(v);
                    }, 600);
                });
            }
        } catch (err) {}
        // Router hash: dukung akses langsung #lifetime / #referal & edit manual hash.
        // Guard: jangan pindah screen non-auth saat belum login (hindari error 401 tampil ke guest).
        window.addEventListener('hashchange', function () {
            // Link referral dibuka di tab yang sama: #...?ref= → deteksi ulang kode.
            // Kode dari URL (klik eksplisit) menang atas isian lama.
            var urlCode = getReferralFromUrl();
            if (urlCode) {
                try { localStorage.setItem('pendingReferral', urlCode); } catch (err) {}
                var rf = $('register-referral');
                if (rf) rf.value = urlCode;
                checkReferral(urlCode);
            } else {
                // URL tidak punya invite → pastikan tidak ada sisa referral basi.
                try { localStorage.removeItem('pendingReferral'); } catch (err) {}
                var rf0 = $('register-referral');
                if (rf0 && !rf0.value.trim()) { rf0.value = ''; setReferralUI('idle'); }
            }
            var n = normalizeScreen(window.location.hash.replace('#', '').split('?')[0]);
            if (!n || n === 'auth' || n === currentScreen) return;
            if (!currentUser) return;
            if (VALID_SCREENS.indexOf(n) === -1) return;
            showScreen(n);
        });
        checkSession();
    });
})();
