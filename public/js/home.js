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
            return res.json().catch(function () { return {}; });
        });
    }

    var currentUser = null;
    var chatPollTimer = null;
    var chatEventSource = null;
    var batchPollTimer = null;
    var currentBatch = null;
    var historyCache = [];
    var adminUsersCache = [];
    var adminLogsCache = [];

    var ROLE_BADGE = {
        owner: 'badge-owner', admin: 'badge-admin', premium: 'badge-premium',
        autogen: 'badge-autogen', user: 'badge-normal'
    };
    var ROLE_LABEL = { owner: 'Owner', admin: 'Admin', premium: 'Premium', autogen: 'Auto Gen', user: 'User' };
    var PROFILE_ROLE = { owner: 'Owner', admin: 'Administrator', premium: 'Premium', autogen: 'Auto Gen', user: 'Anggota' };

    var VALID_SCREENS = ['dashboard', 'generator', 'netflix', 'purchase', 'chat', 'apiguide', 'profile', 'admin', 'contributors', 'history', 'settings', 'reviews'];

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

    function isPrivileged() {
        return currentUser && ['admin', 'owner', 'premium', 'autogen'].indexOf(currentUser.role) !== -1;
    }
    function isAdminOrOwner() {
        return currentUser && ['admin', 'owner'].indexOf(currentUser.role) !== -1;
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
    }

    function showScreen(name) {
        if (name === 'auth') {
            window.location.hash = '';
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
        if (name === 'apiguide' && !isPrivileged()) name = 'dashboard';
        $('main-content').classList.toggle('profile-screen-active', name === 'profile');
        if (name !== 'chat') closeChatStream();

        if (name !== 'auth') setLastScreenCookie(name);
        window.location.hash = name;
        document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); });
        $('screen-' + name).classList.remove('hidden');
        document.querySelectorAll('.sidebar-link').forEach(function (b) { b.classList.remove('active'); });
        var btn = $('btn-' + name + '-view');
        if (btn) btn.classList.add('active');
        closeSidebar();

        var loader = {
            dashboard: loadDashboard, generator: loadGenerator, netflix: loadNetflix,
            purchase: loadAPIPanel, chat: loadChatPanel, apiguide: loadAPIGuide,
            profile: loadProfile, admin: loadAdminPanel, history: loadHistoryScreen,
            settings: loadAdminSettings, reviews: loadReviewsScreen
        }[name];
        if (loader) loader();
    }

    function closeSidebar() {
        $('app-sidebar').classList.remove('active');
        $('sidebar-overlay').classList.remove('active');
    }

    function bindNav() {
        document.querySelectorAll('[id^="btn-"][id$="-view"]').forEach(function (btn) {
            var name = btn.id.replace(/^btn-/, '').replace(/-view$/, '');
            btn.addEventListener('click', function () { showScreen(name); });
        });
        $('btn-sidebar-toggle').addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = $('app-sidebar').classList.toggle('active');
            $('sidebar-overlay').classList.toggle('active', isOpen);
        });
        $('btn-sidebar-close').addEventListener('click', closeSidebar);
        $('sidebar-overlay').addEventListener('click', closeSidebar);
        $('btn-profile-logout').addEventListener('click', handleLogout);
        $('btn-topbar-chat').addEventListener('click', function () { showScreen('chat'); });
        $('btn-topbar-profile').addEventListener('click', function () { showScreen('profile'); });
    }

    /* ============================== AUTH ============================== */

    function checkSession() {
        var attempts = 0;
        themeGateTimer = setTimeout(revealThemePage, 9000);
        function tryFetch() {
            api('/api/auth/profile').then(function (data) {
                if (data.user) {
                    currentUser = data.user;
                    applyThemePreference(readThemePreference());
                    revealThemePage();
                    updateNavbar();
                    var hash = window.location.hash.replace('#', '');
                    var last = hash || getLastScreenCookie();
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

    function bindAuth() {
        $('link-to-register').addEventListener('click', function () {
            $('auth-login-view').classList.add('hidden');
            $('auth-register-view').classList.remove('hidden');
        });
        $('link-to-login').addEventListener('click', function () {
            $('auth-register-view').classList.add('hidden');
            $('auth-login-view').classList.remove('hidden');
        });

        $('form-login').addEventListener('submit', function (e) {
            e.preventDefault();
            setAuthLoading(e.target, true);
            api('/api/auth/login', { method: 'POST', body: { username: $('login-username').value.trim(), password: $('login-password').value } })
                .then(function (data) {
                    if (data.success) {
                        Swal.fire({ icon: 'success', title: 'BERHASIL!', text: 'Login berhasil.', timer: 1500, showConfirmButton: false });
                        document.documentElement.classList.add('theme-pending');
                        themeGateTimer = setTimeout(revealThemePage, 5000);
                        currentUser = data.user;
                        applyThemePreference(readThemePreference());
                        revealThemePage();
                        updateNavbar();
                        showScreen('dashboard');
                    } else {
                        Swal.fire({ icon: 'error', title: 'KESALAHAN', text: data.message || 'Username atau password salah.' });
                    }
                })
                .catch(function () { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: 'Gagal terhubung ke server.' }); })
                .finally(function () { setAuthLoading(e.target, false); });
        });

        $('form-register').addEventListener('submit', function (e) {
            e.preventDefault();
            setAuthLoading(e.target, true);
            api('/api/auth/register', { method: 'POST', body: { username: $('register-username').value.trim(), password: $('register-password').value } })
                .then(function (data) {
                    if (data.success) {
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
                .catch(function () { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: 'Gagal terhubung ke server.' }); })
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
                .catch(function () { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: 'Gagal terhubung ke server.' }); })
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
                .catch(function () { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: 'Gagal terhubung ke server.' }); })
                .finally(function () {
                    abtn.disabled = false;
                    abtn.innerHTML = 'Terapkan Lisensi Premium <i class="fa-solid fa-bolt"></i>';
                });
        });
    }
        function setupAutoGenerator() {
        bindGeneratorManual();
        if (!currentUser) return;
        var unlocked = isPrivileged();
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
                    .catch(function () { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: 'Gagal terhubung ke server.' }); })
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
                    lines.push((i + 1) + '. Email: ' + r.email + (ok ? ' | PREMIUM AKTIF' : ' | GAGAL: ' + (r.error || 'unknown')) + (r.codeorder ? ' | Alwayscodex: ' + r.codeorder : '') + ' | Inbox: ' + inbox + ' | Login Link: ' + (r.verifyLink || '-'));
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
                    .catch(function () { Swal.fire({ icon: 'error', title: 'KESALAHAN', text: 'Gagal terhubung ke server.' }); })
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

    function loadAPIPanel() {
        document.querySelectorAll('.btn-purchase-plan').forEach(function (btn) {
            if (btn.dataset.bound) return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', function () {
                var price = btn.dataset.price, name = btn.dataset.name;
                var paymentMethod = null;
                Swal.fire({
                    title: '<span style="font-weight:700;color:var(--text-primary);">Pilih Metode Pembayaran</span>',
                    html:
                        '<div style="text-align:center;margin-bottom:20px;">' +
                        '<p style="color:var(--text-secondary);margin-bottom:4px;font-size:0.9rem;">Anda memilih paket:</p>' +
                        '<h4 style="color:var(--accent-primary);font-size:1.15rem;font-weight:700;margin-bottom:4px;">' + esc(name) + '</h4>' +
                        '<p style="color:var(--text-primary);font-weight:600;font-size:1.1rem;">Rp ' + parseInt(price).toLocaleString('id-ID') + '</p>' +
                        '</div>' +
                        '<div class="payment-methods-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:15px;">' +
                        paymentMethodBtn('DANA', 'fa-wallet', '#008cff') +
                        paymentMethodBtn('GoPay', 'fa-wallet', '#00a651') +
                        paymentMethodBtn('OVO', 'fa-wallet', '#4f2d7f') +
                        paymentMethodBtn('Shopee', 'fa-wallet', '#ee4d2d') +
                        paymentMethodBtn('QRIS (E-Wallet)', 'fa-qrcode', '#e51e44', 'grid-column:span 2;') +
                        '</div>' +
                        '<style>.swal-payment-btn:hover{border-color:var(--accent-primary) !important;background:rgba(99,102,241,0.08) !important;transform:translateY(-2px);}</style>',
                    showConfirmButton: false,
                    showCancelButton: true,
                    cancelButtonText: 'Batal',
                    cancelButtonColor: '#ef4444',
                    didOpen: function () {
                        var buttons = Swal.getHtmlContainer().querySelectorAll('.swal-payment-btn');
                        buttons.forEach(function (button) {
                            button.addEventListener('click', function () {
                                paymentMethod = button.getAttribute('data-method');
                                Swal.close();
                            });
                        });
                    }
                }).then(function () {
                    if (!paymentMethod) return;
                    Swal.fire({
                        icon: 'success',
                        title: 'Menghubungkan ke WhatsApp...',
                        text: 'Silakan kirim detail pembelian Anda di WhatsApp.',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    var msg = 'Halo Owner, saya ingin membeli paket *' + name + '* seharga *Rp ' + parseInt(price).toLocaleString('id-ID') + '* via *' + paymentMethod + '*.\n' +
                        'Detail Akun:\n- Username: ' + (currentUser ? currentUser.username : '-') + '\n- ID Pengguna: ' + (currentUser ? (currentUser.id || '-') : '-') +
                        '\nMohon instruksi pembayaran selanjutnya. Terima kasih!';
                    setTimeout(function () {
                        window.open('https://wa.me/6288297563383?text=' + encodeURIComponent(msg), '_blank');
                    }, 1000);
                });
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
        else if (m.role === 'admin') badge = '<span class="chat-role-badge" style="background:#3b82f6;">Admin</span>';
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

        var backButton = $('btn-docs-back');
        if (backButton) {
            backButton.addEventListener('click', function () { showScreen('dashboard'); });
        }
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

        // FITUR BARU MULAI DI SINI - Centang Biru (Verified Badge) Khusus Premium / Admin / AutoGen / Owner
        var profileCheckBadge = document.querySelector('#profile-avatar-circle + div span[title="Terverifikasi"]');
        if (profileCheckBadge) {
            var isVerifiedRole = ['premium', 'admin', 'owner', 'autogen'].indexOf(u.role) !== -1;
            profileCheckBadge.style.display = isVerifiedRole ? 'inline-flex' : 'none';
            profileCheckBadge.style.background = '#0095f6'; // Warna Biru Khas Meta AI / Verified
            profileCheckBadge.innerHTML = '<i class="fa-solid fa-check"></i>';
        }
        // FITUR BARU SELESAI DI SINI

        $('profile-role-label').textContent = PROFILE_ROLE[u.role] || 'Anggota';
        $('profile-join-date-label').textContent = u.createdAt ? 'Since: ' + new Date(u.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Since: -';

        // Populate Personal Info (pinfo) section
        if ($('pinfo-name')) $('pinfo-name').textContent = u.username;
        if ($('pinfo-role')) $('pinfo-role').textContent = u.role || 'user';
        if ($('pinfo-credits')) $('pinfo-credits').textContent = creditsDisplay();
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
        if ($('pinfo-admin')) $('pinfo-admin').textContent = (u.role === 'admin' || u.role === 'owner') ? 'True' : 'False';
        if ($('pinfo-limit')) $('pinfo-limit').textContent = u.role === 'owner' ? 'Unlimited' : (u.role === 'premium' || u.role === 'autogen' ? 'Premium' : '0');

        $('api-key-input').value = u.apiKey || 'Belum ada API Key. Silahkan beli di menu Beli API Key.';

        var apiSection = $('profile-apikey-section');
        var canManageApiKey = ['user', 'autogen'].indexOf(u.role) === -1;
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
                    title: 'Ganti API Key sekarang?',
                    text: 'Key lama akan langsung dicabut dan tidak bisa digunakan lagi.',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Ya, buat key baru',
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
                        Swal.fire({ icon: 'success', title: 'API Key berhasil diperbarui', text: 'Key lama sudah dicabut. Simpan atau copy key baru Anda.', timer: 2200, showConfirmButton: false });
                        loadProfile();
                    }).catch(function (error) {
                        Swal.fire({ icon: 'error', title: 'Gagal memperbarui API Key', text: error.message || 'Gagal terhubung ke server.' });
                    }).finally(function () {
                        resetBtn.disabled = false;
                        resetBtn.removeAttribute('aria-busy');
                        resetBtn.classList.remove('is-loading');
                        resetBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i><span>Revoke &amp; Generate New Key</span>';
                    });
                });
            });
        }
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
        loadAdminUsers();
        loadAdminLogs();
        loadAdminTransactions();
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
                var canManage = currentUser.role === 'owner' || (currentUser.role === 'admin' && u.role === 'user');
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
        setAdminTableState(tbody, 7, 'Memuat transaksi pembayaran...', 'loading');
        api('/api/admin/transactions').then(function (data) {
            if (!data.success) {
                setAdminTableState(tbody, 7, data.message || 'Transaksi hanya dapat dilihat oleh owner.', 'error');
                if ($('admin-transactions-pagination')) $('admin-transactions-pagination').innerHTML = '';
                return;
            }
            var txs = data.transactions || [];
            var perPage = 10;
            var totalPages = Math.max(1, Math.ceil(txs.length / perPage));
            var current = Math.min(Math.max(1, page || 1), totalPages);
            var slice = txs.slice((current - 1) * perPage, current * perPage);
            if (!slice.length) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">Belum ada transaksi.</td></tr>';
            } else {
                tbody.innerHTML = slice.map(function (t) {
                    var status = t.status === 'success' ? '<span class="status-success">Sukses</span>'
                        : t.status === 'failed' ? '<span class="status-failed">Gagal</span>'
                        : '<span class="status-pending">Pending</span>';
                    var action = t.status === 'pending'
                        ? '<button class="btn btn-success btn-sm approve-tx-btn" data-ref="' + esc(t.refNo) + '">Setujui</button>'
                        : '<span style="color:var(--text-muted);font-size:0.75rem;">-</span>';
                    return '<tr><td>' + esc(t.createdAt) + '</td><td>' + esc(t.username) + '</td><td>' + esc(t.refNo) + '</td><td>Rp ' + esc(t.amount) + '</td><td>' + esc(t.plan) + '</td><td>' + status + '</td><td>' + action + '</td></tr>';
                }).join('');
            }
            tbody.querySelectorAll('.approve-tx-btn').forEach(function (b) {
                b.addEventListener('click', function () {
                    api('/api/admin/transaction/approve', { method: 'POST', body: { refNo: b.dataset.ref } }).then(function (d) {
                        Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'DISETUJUI!' : 'GAGAL', text: d.message, timer: 1500, showConfirmButton: false });
                        loadAdminTransactions(current);
                        loadAdminUsers();
                    });
                });
            });
            renderPagination($('admin-transactions-pagination'), totalPages, current, loadAdminTransactions);
        }).catch(function () {
            setAdminTableState(tbody, 7, 'Gagal terhubung ke server.', 'error');
        });
    }

    function loadAdminIps() {
        api('/api/admin/ips').then(function (data) {
            var users = data.users || [];
            var tbody = $('admin-ips-table-body');
            if (!users.length) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;">Belum ada data IP.</td></tr>';
            } else {
                tbody.innerHTML = users.map(function (u) {
                    var over = u.ipCount > 3;
                    return '<tr><td><strong>' + esc(u.username) + '</strong></td>' +
                        '<td><span class="badge ' + (ROLE_BADGE[u.role] || 'badge-normal') + '">' + esc(ROLE_LABEL[u.role] || u.role) + '</span></td>' +
                        '<td>' + esc(u.ip || '-') + '</td><td>' + esc(u.device || u.os || '-') + '</td>' +
                        '<td><span class="badge ' + (over ? 'badge-admin' : 'badge-normal') + '" style="' + (over ? 'background:#ef4444;color:#fff;' : '') + '">' + (u.ipCount || 0) + '</span></td>' +
                        '<td><button class="btn ' + (u.banned ? 'btn-success' : 'btn-danger') + ' btn-sm ban-ip-btn" data-ip="' + esc(u.ip) + '" data-banned="' + (u.banned ? 1 : 0) + '">' + (u.banned ? 'Unban' : 'Ban') + '</button></td></tr>';
                }).join('');
            }
            tbody.querySelectorAll('.ban-ip-btn').forEach(function (b) {
                b.addEventListener('click', function () {
                    var banned = b.dataset.banned === '1';
                    api('/api/admin/ip/' + (banned ? 'unban' : 'ban'), { method: 'POST', body: { ip: b.dataset.ip } }).then(function (d) {
                        Swal.fire({ icon: 'success', title: 'OK', text: d.message, timer: 1200, showConfirmButton: false });
                        loadAdminIps();
                    });
                });
            });
            var banned = data.bannedIps || [];
            var btbody = $('admin-banned-ips-table-body');
            if (!banned.length) {
                btbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:24px;">Tidak ada IP terblokir.</td></tr>';
            } else {
                btbody.innerHTML = banned.map(function (b) {
                    return '<tr><td>' + esc(b.ip) + '</td><td>' + esc(b.createdAt) + '</td>' +
                        '<td><button class="btn btn-success btn-sm unban-ip-btn" data-ip="' + esc(b.ip) + '">Unban</button></td></tr>';
                }).join('');
            }
            btbody.querySelectorAll('.unban-ip-btn').forEach(function (b) {
                b.addEventListener('click', function () {
                    api('/api/admin/ip/unban', { method: 'POST', body: { ip: b.dataset.ip } }).then(function (d) {
                        Swal.fire({ icon: 'success', title: 'OK', text: d.message, timer: 1200, showConfirmButton: false });
                        loadAdminIps();
                    });
                });
            });
        });
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
            $('btn-cleanup-ry-users').addEventListener('click', function () {
                Swal.fire({ title: 'Bersihkan Akun ry_?', text: 'Semua akun berawalan "ry_" beserta log & transaksinya akan dihapus.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya, Bersihkan', cancelButtonText: 'Batal' })
                    .then(function (r) {
                        if (!r.isConfirmed) return;
                        api('/api/admin/cleanup-ry', { method: 'POST' }).then(function (d) {
                            Swal.fire({ icon: 'success', title: 'BERSIH!', text: d.message, timer: 1500, showConfirmButton: false });
                            loadAdminUsers();
                            loadAdminStats();
                        });
                    });
            });
            $('btn-ban-ip-submit').addEventListener('click', function () {
                var ip = $('input-ban-ip').value.trim();
                if (!ip) return Swal.fire({ icon: 'warning', title: 'Perhatian', text: 'Masukkan IP terlebih dahulu.' });
                api('/api/admin/ip/ban', { method: 'POST', body: { ip: ip } }).then(function (d) {
                    Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'DI-BLOKIR!' : 'GAGAL', text: d.message, timer: 1500, showConfirmButton: false });
                    $('input-ban-ip').value = '';
                    loadAdminIps();
                });
            });
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
            var refreshLogs = $('btn-admin-refresh-logs');
            if (refreshLogs && !refreshLogs.dataset.bound) {
                refreshLogs.dataset.bound = '1';
                refreshLogs.addEventListener('click', function () { loadAdminLogs(); });
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
            inputOptions: { USER: 'USER', PREMIUM: 'PREMIUM', 'AUTO GENERATOR': 'AUTO GENERATOR', ADMIN: 'ADMIN' },
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
                api('/api/admin/user/role', { method: 'POST', body: { userId: userId, role: role.toLowerCase() } }).then(function (res) {
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
        });
        var saveBtn = $('btn-save-maintenance');
        if (saveBtn && !saveBtn.dataset.bound) {
            saveBtn.dataset.bound = '1';
            saveBtn.addEventListener('click', function () {
                var value = {
                    generator: $('maint-generator').checked,
                    netflix: $('maint-netflix').checked,
                    chat: $('maint-chat').checked,
                    purchase: $('maint-purchase').checked
                };
                api('/api/admin/system/settings', { method: 'POST', body: { key: 'maintenance', value: value } }).then(function (d) {
                    Swal.fire({ icon: d.success ? 'success' : 'error', title: d.success ? 'TERSIMPAN!' : 'GAGAL', text: d.message, timer: 1500, showConfirmButton: false });
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
                badge.textContent = unread;
                badge.style.display = unread ? 'flex' : 'none';
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
                    window.location.href = '/createamryezen.apk';
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
        bindNotifications();
        checkAppVersion();
        initThemeToggle(); // FITUR BARU - Pemanggilan Switch Theme
        checkSession();
    });
})();