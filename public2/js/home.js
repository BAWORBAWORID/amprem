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
            closeSidebar();
            return;
        }
        if (VALID_SCREENS.indexOf(name) === -1) name = 'dashboard';
        if ((name === 'admin' || name === 'settings') && !isAdminOrOwner()) name = 'dashboard';
        if (name === 'apiguide' && !isPrivileged()) name = 'dashboard';
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
        function tryFetch() {
            api('/api/auth/profile').then(function (data) {
                if (data.user) {
                    currentUser = data.user;
                    updateNavbar();
                    var hash = window.location.hash.replace('#', '');
                    var last = hash || getLastScreenCookie();
                    showScreen(last && VALID_SCREENS.indexOf(last) !== -1 ? last : 'dashboard');
                } else {
                    showScreen('auth');
                }
            }).catch(function () {
                attempts++;
                if (attempts < 3) setTimeout(tryFetch, 2000);
                else showScreen('auth');
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
                        currentUser = data.user;
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
        if (sel && sel.options.length === 0) {
            api('/api/am/domains').then(function (data) {
                sel.innerHTML = '';
                (data.domains || ['softbank.id']).forEach(function (d) {
                    var opt = document.createElement('option');
                    opt.value = d; opt.textContent = d;
                    sel.appendChild(opt);
                });
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
                    lines.push((i + 1) + '. Email: ' + r.email + ' | Inbox: ' + r.inbox + ' | Login Link: ' + r.link);
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

    function loadAPIPanel() {
        document.querySelectorAll('.btn-purchase-plan').forEach(function (btn) {
            if (btn.dataset.bound) return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', function () {
                var price = btn.dataset.price, name = btn.dataset.name;
                Swal.fire({
                    title: 'Pilih Metode Pembayaran',
                    text: 'Paket: ' + name + ' - Rp ' + parseInt(price).toLocaleString('id-ID'),
                    input: 'select',
                    inputOptions: { DANA: 'DANA', GoPay: 'GoPay', OVO: 'OVO', Shopee: 'ShopeePay', QRIS: 'QRIS (E-Wallet)' },
                    inputPlaceholder: 'Pilih metode pembayaran',
                    showCancelButton: true,
                    confirmButtonText: 'Lanjutkan',
                    cancelButtonText: 'Batal',
                    preConfirm: function (method) {
                        if (!method) Swal.showValidationMessage('Pilih metode pembayaran terlebih dahulu');
                        return method;
                    }
                }).then(function (result) {
                    if (!result.isConfirmed || !result.value) return;
                    var msg = 'Halo Owner, saya ingin membeli paket *' + name + '* seharga *Rp ' + parseInt(price).toLocaleString('id-ID') + '* via *' + result.value + '*.\n' +
                        'Detail Akun:\n- Username: ' + (currentUser ? currentUser.username : '-') + '\n- ID Pengguna: ' + (currentUser ? currentUser.id : '-') +
                        '\nMohon instruksi pembayaran selanjutnya. Terima kasih!';
                    window.open('https://wa.me/6288297563383?text=' + encodeURIComponent(msg), '_blank');
                    Swal.fire({ icon: 'info', title: 'Instruksi Dikirim', text: 'Silakan lanjutkan pembayaran via WhatsApp.', timer: 2000, showConfirmButton: false });
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
        if ($('code-curl').dataset.bound) return;
        $('code-curl').dataset.bound = '1';
        document.querySelectorAll('.code-tab-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.code-tab-btn').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                document.querySelectorAll('.code-block-item').forEach(function (b) { b.classList.add('hidden'); });
                $('code-' + btn.dataset.lang).classList.remove('hidden');
            });
        });
        var baseEl = $('docs-base-url');
        if (baseEl) baseEl.textContent = origin + '/api/v1/bot-premium?apikey=' + key;
        ['curl', 'nodejs', 'python', 'php'].forEach(function (lang) {
            var el = $('code-' + lang);
            if (el) el.textContent = el.textContent.replace(/__API_KEY__/g, key);
        });
        document.querySelectorAll('.btn-copy-code').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var target = $(btn.dataset.target);
                if (!target) return;
                navigator.clipboard.writeText(target.textContent).then(function () {
                    Swal.fire({ icon: 'success', title: 'Tersalin!', text: 'Kode berhasil disalin ke clipboard.', timer: 1200, showConfirmButton: false });
                });
            });
        });
        if ($('btn-copy-base-url')) {
            $('btn-copy-base-url').addEventListener('click', function () {
                navigator.clipboard.writeText(baseEl.textContent).then(function () {
                    Swal.fire({ icon: 'success', title: 'Tersalin!', timer: 1200, showConfirmButton: false });
                });
            });
        }
        if ($('btn-docs-toggle')) {
            $('btn-docs-toggle').addEventListener('click', function () {
                $('docs-sidebar-menu').classList.toggle('hidden');
            });
        }
        document.querySelectorAll('#docs-sidebar-menu a').forEach(function (a) {
            a.addEventListener('click', function () { $('docs-sidebar-menu').classList.add('hidden'); });
        });
    }

    /* ============================== PROFILE ============================== */

    function loadProfile() {
        if (!currentUser) return;
        var u = currentUser;
        $('profile-username').textContent = u.username;
        $('profile-role-label').textContent = PROFILE_ROLE[u.role] || 'Anggota';
        $('profile-join-date-label').textContent = u.createdAt ? 'Since: ' + new Date(u.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Since: -';

        // Populate Personal Info (pinfo) section
        if ($('pinfo-name')) $('pinfo-name').textContent = u.username;
        if ($('pinfo-role')) $('pinfo-role').textContent = u.role || 'user';
        if ($('pinfo-credits')) $('pinfo-credits').textContent = creditsDisplay();
        if ($('pinfo-apikey')) $('pinfo-apikey').textContent = u.apiKey || '-';
        if ($('pinfo-expired')) {
            if (u.apiExpiresAt) {
                $('pinfo-expired').textContent = new Date(u.apiExpiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
            } else {
                $('pinfo-expired').textContent = u.apiPlan === 'lifetime' ? 'No Expired' : '-';
            }
        }
        if ($('pinfo-admin')) $('pinfo-admin').textContent = (u.role === 'admin' || u.role === 'owner') ? 'True' : 'False';
        if ($('pinfo-limit')) $('pinfo-limit').textContent = u.role === 'owner' ? 'Unlimited' : (u.role === 'premium' || u.role === 'autogen' ? 'Premium' : '0');

        $('api-key-input').value = u.apiKey || 'Belum ada API Key. Silahkan beli di menu Beli API Key.';

        var apiSection = $('profile-apikey-section');
        if (apiSection) apiSection.classList.toggle('hidden', u.role === 'user' || u.role === 'autogen');

        var copyBtn = $('btn-copy-api');
        if (copyBtn && !copyBtn.dataset.bound) {
            copyBtn.dataset.bound = '1';
            copyBtn.addEventListener('click', function () {
                var v = $('api-key-input').value;
                if (!v || v.indexOf('Belum ada') === 0) return Swal.fire({ icon: 'info', title: 'Info', text: 'Anda belum memiliki API Key.' });
                navigator.clipboard.writeText(v).then(function () { Swal.fire({ icon: 'success', title: 'Tersalin!', timer: 1200, showConfirmButton: false }); });
            });
            $('btn-reset-api').addEventListener('click', function () {
                Swal.fire({
                    title: 'Reset API Key?',
                    text: 'API Key lama akan langsung tidak berlaku.',
                    icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya, Reset', cancelButtonText: 'Batal'
                }).then(function (r) {
                    if (!r.isConfirmed) return;
                    api('/api/auth/reset-key', { method: 'POST' }).then(function (data) {
                        if (data.success) {
                            currentUser.apiKey = data.apiKey;
                            Swal.fire({ icon: 'success', title: 'DI-RESET!', text: 'API Key baru: ' + data.apiKey, timer: 3000, showConfirmButton: false });
                            loadProfile();
                        }
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

    function loadAdminUsers(page) {
        api('/api/admin/users').then(function (data) {
            adminUsersCache = data.users || [];
            renderAdminUsers(page || 1);
        });
    }

    function renderAdminUsers(page) {
        var users = adminUsersCache.slice();
        var query = ($('admin-search-users').value || '').toLowerCase();
        if (query) users = users.filter(function (u) { return u.username.toLowerCase().indexOf(query) !== -1; });
        var perPage = 10;
        var totalPages = Math.max(1, Math.ceil(users.length / perPage));
        var current = Math.min(Math.max(1, page || 1), totalPages);
        var slice = users.slice((current - 1) * perPage, current * perPage);
        var tbody = $('admin-users-table-body');
        if (!slice.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;">Tidak ada anggota.</td></tr>';
        } else {
            tbody.innerHTML = slice.map(function (u) {
                var canManage = currentUser.role === 'owner' || (currentUser.role === 'admin' && u.role === 'user');
                var actions;
                if (canManage && u.role !== 'owner') {
                    actions = '<button class="btn btn-secondary btn-sm edit-credits-btn" data-id="' + u.id + '" data-credits="' + (u.credits || 0) + '">Kredit</button> ' +
                        '<button class="btn btn-secondary btn-sm edit-role-btn" data-id="' + u.id + '" data-role="' + u.role + '">Role</button> ' +
                        '<button class="btn btn-warning btn-sm reset-password-btn" data-id="' + u.id + '">Reset PW</button> ' +
                        '<button class="btn ' + (u.banned ? 'btn-success' : 'btn-danger') + ' btn-sm toggle-ban-btn" data-id="' + u.id + '" data-banned="' + (u.banned ? 1 : 0) + '">' + (u.banned ? 'Aktifkan' : 'Blokir') + '</button> ' +
                        '<button class="btn btn-danger btn-sm delete-user-btn" data-id="' + u.id + '">Hapus</button>';
                } else {
                    actions = '<span style="color:var(--text-muted);font-size:0.75rem;">Tidak ada aksi</span>';
                }
                return '<tr><td><strong>' + esc(u.username) + '</strong></td>' +
                    '<td><span class="badge ' + (ROLE_BADGE[u.role] || 'badge-normal') + '">' + esc(ROLE_LABEL[u.role] || u.role) + '</span></td>' +
                    '<td>' + (u.credits == null ? 'Unlimited' : esc(u.credits)) + '</td>' +
                    '<td>' + esc(u.device || u.os || '-') + '</td>' +
                    '<td>' + (u.banned ? '<span class="status-failed">Terblokir</span>' : '<span class="status-success">Aktif</span>') + '</td>' +
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
        api('/api/admin/logs').then(function (data) {
            var logs = data.logs || [];
            var perPage = 10;
            var totalPages = Math.max(1, Math.ceil(logs.length / perPage));
            var current = Math.min(Math.max(1, page || 1), totalPages);
            var slice = logs.slice((current - 1) * perPage, current * perPage);
            var tbody = $('admin-logs-table-body');
            if (!slice.length) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px;">Belum ada log aktivasi.</td></tr>';
            } else {
                tbody.innerHTML = slice.map(function (l) {
                    var status = l.status === 'success' ? '<span class="status-success">Aktif</span>' : '<span class="status-failed">Gagal</span>';
                    return '<tr><td>' + esc(l.createdAt) + '</td><td>' + esc(l.operator) + '</td><td>' + esc(l.email) + '</td><td>' + status + '</td><td>' + esc(l.note || '-') + '</td></tr>';
                }).join('');
            }
            renderPagination($('admin-logs-pagination'), totalPages, current, loadAdminLogs);
        });
    }

    function loadAdminTransactions(page) {
        api('/api/admin/transactions').then(function (data) {
            var txs = data.transactions || [];
            var perPage = 10;
            var totalPages = Math.max(1, Math.ceil(txs.length / perPage));
            var current = Math.min(Math.max(1, page || 1), totalPages);
            var slice = txs.slice((current - 1) * perPage, current * perPage);
            var tbody = $('admin-transactions-table-body');
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
                Swal.fire({ title: 'Reset Semua Kredit?', text: 'Semua anggota (role user) akan dikembalikan ke 10 kredit.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya, Reset', cancelButtonText: 'Batal' })
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
            $('admin-search-users').addEventListener('input', function () { renderAdminUsers(1); });
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

    var themeIcon = null;
    function applyTheme(theme) {
        document.body.classList.toggle('dark-theme', theme === 'dark');
        localStorage.setItem('theme', theme);
        if (themeIcon) themeIcon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }

    function bindTheme() {
        themeIcon = $('btn-topbar-theme').querySelector('i');
        $('btn-topbar-theme').addEventListener('click', function () {
            applyTheme(document.body.classList.contains('dark-theme') ? 'light' : 'dark');
        });
        applyTheme(localStorage.getItem('theme') || 'light');
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

    /* ============================== INIT ============================== */

    document.addEventListener('DOMContentLoaded', function () {
        bindNav();
        bindAuth();
        bindTheme();
        bindNotifications();
        checkAppVersion();
        checkSession();
    });
})();
