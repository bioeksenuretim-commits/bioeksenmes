// Extracted from index.html to keep the page shell lightweight.
        // ===== AUTH SYSTEM =====
        let currentUser = null;
        let loginInProgress = false;
        const DEV_ENV_QUERY_VALUE = 'dev';
        const FIREBASE_SESSION_KEY = 'reaksiyon_session';
        const TEST_LOCAL_SESSION_KEY = 'reaksiyon_test_session';
        const LEGACY_AUTH_SESSION_KEYS = [FIREBASE_SESSION_KEY, 'reaksiyon_local_admin_session', TEST_LOCAL_SESSION_KEY];
        const TEST_LOCAL_PARAF = 'test';
        const TEST_LOCAL_PASSWORD = 'test123';

        // ===== FIREBASE AUTH INTEGRATION =====
        function isFirebaseAvailable() {
            return typeof firebaseReady !== 'undefined' && firebaseReady;
        }

        function withTimeout(promise, timeoutMs, timeoutMessage) {
            return Promise.race([
                promise,
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(timeoutMessage || 'İşlem zaman aşımına uğradı.')), timeoutMs);
                })
            ]);
        }

        function removeLegacyLocalAuthSessions() {
            LEGACY_AUTH_SESSION_KEYS.forEach(key => localStorage.removeItem(key));
        }

        function clearStoredAuthSession() {
            LEGACY_AUTH_SESSION_KEYS.forEach(key => sessionStorage.removeItem(key));
            removeLegacyLocalAuthSessions();
        }

        function setCurrentUser(user) {
            currentUser = user || null;
            window.currentUser = currentUser;
            syncDevEnvironmentState();
            if (typeof renderDevNotifications === 'function') renderDevNotifications();
        }

        function hasDevEnvQuery() {
            return new URLSearchParams(window.location.search).get('env') === DEV_ENV_QUERY_VALUE;
        }

        function canUseDevEnvironment(user = currentUser) {
            const role = String(user?.role || '').trim().toLowerCase();
            return role === 'admin' || role === 'dev';
        }

        function isDevEnvironment() {
            const role = String(currentUser?.role || '').trim().toLowerCase();
            return canUseDevEnvironment() && (hasDevEnvQuery() || role === 'dev');
        }

        function getFirebaseDbPrefix() {
            return isDevEnvironment() ? 'dev/' : '';
        }

        function getFirebaseDbPath(path = '') {
            return `${getFirebaseDbPrefix()}${String(path || '').replace(/^\/+/, '')}`;
        }

        function syncDevEnvironmentState() {
            const enabled = isDevEnvironment();
            window.IS_DEV_ENV = enabled;
            window.DB_PREFIX = getFirebaseDbPrefix();
            document.body?.classList.toggle('dev-environment', enabled);
            renderDevEnvironmentBanner();
        }

        function renderDevEnvironmentBanner() {
            let banner = document.getElementById('devEnvironmentBanner');
            if (!isDevEnvironment()) {
                if (banner) banner.remove();
                return;
            }
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'devEnvironmentBanner';
                document.body.prepend(banner);
            }
            banner.textContent = 'DEV ORTAMI - Canli veriye yazmaz';
        }

        window.isDevEnvironment = isDevEnvironment;
        window.getFirebaseDbPrefix = getFirebaseDbPrefix;
        window.getFirebaseDbPath = getFirebaseDbPath;
        window.syncDevEnvironmentState = syncDevEnvironmentState;

        function buildFirebaseSession(firebaseUser, profile) {
            if (!firebaseUser || !profile) return null;
            return {
                uid: firebaseUser.uid,
                userId: firebaseUser.uid,
                authUid: firebaseUser.uid,
                authProvider: 'firebase',
                fullName: profile.fullName,
                paraf: profile.paraf,
                role: profile.role || 'user',
                department: profile.department || '',
                isApproved: profile.isApproved,
                permissions: profile.permissions || null
            };
        }

        function hasMatchingFirebaseAuthSession(user = currentUser) {
            if (!user || user.authProvider !== 'firebase' || !user.uid) return false;
            if (!isFirebaseAvailable() || !firebase.auth().currentUser) return false;
            return firebase.auth().currentUser.uid === user.uid;
        }

        function isTestLocalSession(user = currentUser) {
            return !!(user && user.authProvider === 'test-local' && user.paraf === TEST_LOCAL_PARAF);
        }

        function buildTestLocalSession() {
            return {
                uid: 'test-local',
                userId: 'test-local',
                authUid: null,
                authProvider: 'test-local',
                fullName: 'Test Hesabı',
                paraf: TEST_LOCAL_PARAF,
                role: 'admin',
                department: 'test',
                isApproved: true,
                permissions: {
                    canViewOrders: true,
                    canViewProductTree: true,
                    canDeleteData: true,
                    canViewQuickAccess: true
                }
            };
        }

        function persistTestLocalSession() {
            sessionStorage.setItem(TEST_LOCAL_SESSION_KEY, JSON.stringify(currentUser));
            sessionStorage.removeItem(FIREBASE_SESSION_KEY);
            sessionStorage.removeItem('reaksiyon_local_admin_session');
            removeLegacyLocalAuthSessions();
        }

        function restoreTestLocalSession() {
            removeLegacyLocalAuthSessions();
            try {
                const session = JSON.parse(sessionStorage.getItem(TEST_LOCAL_SESSION_KEY) || 'null');
                if (!isTestLocalSession(session)) return false;
                setCurrentUser(session);
                if (typeof storage !== 'undefined' && storage?.setTestLocalMode) storage.setTestLocalMode(true);
                document.getElementById('loginScreen')?.classList.add('hidden');
                renderUserHeader();
                renderAdminPanel();
                updateAdminOnlyElements();
                loadOrdersAccountPreferences().catch(() => {});
                refreshSyncStatusFromRuntime();
                return true;
            } catch (_) {
                sessionStorage.removeItem(TEST_LOCAL_SESSION_KEY);
                return false;
            }
        }

        function persistCurrentSession() {
            if (isTestLocalSession()) {
                persistTestLocalSession();
                return;
            }
            if (!hasMatchingFirebaseAuthSession()) return;
            sessionStorage.setItem(FIREBASE_SESSION_KEY, JSON.stringify(currentUser));
            sessionStorage.removeItem('reaksiyon_local_admin_session');
            sessionStorage.removeItem(TEST_LOCAL_SESSION_KEY);
            removeLegacyLocalAuthSessions();
        }

        function getActiveUserParaf(fallback = 'Bilinmiyor') {
            if (isTestLocalSession() && currentUser.paraf) return String(currentUser.paraf).trim();
            if (hasMatchingFirebaseAuthSession() && currentUser.paraf) return String(currentUser.paraf).trim();
            return fallback;
        }

        const syncStatusState = {
            state: 'offline',
            label: 'Bağlantı koptu',
            detail: '',
            updatedAt: null,
            timer: null
        };

        function setSyncStatus(state, detail = '') {
            const labels = {
                live: 'Canlı',
                syncing: 'Senkronlanıyor',
                pending: 'Bekleyen değişiklik var',
                offline: 'Bağlantı koptu',
                conflict: 'Çakışmalar'
            };
            syncStatusState.state = state;
            syncStatusState.label = labels[state] || labels.offline;
            syncStatusState.detail = detail || '';
            syncStatusState.updatedAt = new Date();
            renderSyncStatusBadge();

            if (syncStatusState.timer) {
                clearTimeout(syncStatusState.timer);
                syncStatusState.timer = null;
            }
            if (state === 'syncing') {
                syncStatusState.timer = setTimeout(() => {
                    if (syncStatusState.state === 'syncing') {
                        setSyncStatus(navigator.onLine ? 'live' : 'offline');
                    }
                }, 12000);
            }
        }

        function renderSyncStatusBadge() {
            const badge = document.getElementById('syncStatusBadge');
            if (!badge) return;
            badge.className = `sync-status-badge ${syncStatusState.state}`;
            const timeText = syncStatusState.updatedAt
                ? `Son güncelleme: ${syncStatusState.updatedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                : '';
            badge.textContent = syncStatusState.label;
            badge.title = [syncStatusState.label, syncStatusState.detail, timeText].filter(Boolean).join(' - ');
            badge.onclick = null;
            badge.onkeydown = null;
            badge.removeAttribute('role');
            badge.removeAttribute('tabindex');
            if (syncStatusState.state === 'conflict') {
                badge.setAttribute('role', 'button');
                badge.setAttribute('tabindex', '0');
                badge.onclick = openSalesLinesConflictPanel;
                badge.onkeydown = (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openSalesLinesConflictPanel();
                    }
                };
            }
        }

        function refreshSyncStatusFromRuntime() {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                setSyncStatus('offline');
                return;
            }

            try {
                const hasPending = localStorage.getItem('firebase_pending_sync') === 'true'
                    || (typeof offlineManager !== 'undefined' && offlineManager.pendingSync === true);
                if (hasPending) {
                    setSyncStatus('pending');
                    return;
                }
            } catch (_) {}

            if (isTestLocalSession()) {
                setSyncStatus('offline', 'Test modu: Firebase okuma/yazma kapalı.');
                return;
            }

            setSyncStatus(isFirebaseAvailable() ? 'live' : 'offline');
        }

        window.setSyncStatus = setSyncStatus;
        window.refreshSyncStatusFromRuntime = refreshSyncStatusFromRuntime;

        function togglePasswordVisibility(inputId, button) {
            const input = document.getElementById(inputId);
            if (!input) return;
            const shouldShow = input.type === 'password';
            input.type = shouldShow ? 'text' : 'password';
            if (button) {
                button.setAttribute('aria-pressed', shouldShow ? 'true' : 'false');
                button.setAttribute('aria-label', shouldShow ? 'Şifreyi gizle' : 'Şifreyi göster');
                button.textContent = shouldShow ? '🙈' : '👁';
            }
            input.focus();
        }

        window.togglePasswordVisibility = togglePasswordVisibility;

        function toggleLoginMode() {
            const loginForm = document.getElementById('loginForm');
            const registerForm = document.getElementById('registerForm');
            const title = document.getElementById('loginTitle');
            if (loginForm.style.display === 'none') {
                loginForm.style.display = 'block';
                registerForm.style.display = 'none';
                title.textContent = 'Giriş Yap';
            } else {
                loginForm.style.display = 'none';
                registerForm.style.display = 'block';
                title.textContent = 'Hesap Oluştur';
            }
            document.getElementById('loginError').textContent = '';
            document.getElementById('registerError').textContent = '';
        }

        function showLoginView(view) {
            const loginForm = document.getElementById('loginForm');
            const registerForm = document.getElementById('registerForm');
            const changePasswordForm = document.getElementById('changePasswordForm');
            const title = document.getElementById('loginTitle');

            if (loginForm) loginForm.style.display = view === 'login' ? 'block' : 'none';
            if (registerForm) registerForm.style.display = view === 'register' ? 'block' : 'none';
            if (changePasswordForm) changePasswordForm.style.display = view === 'change-password' ? 'block' : 'none';

            if (title) {
                if (view === 'register') title.textContent = 'Hesap Olustur';
                else if (view === 'change-password') title.textContent = 'Sifre Degistir';
                else title.textContent = 'Giris Yap';
            }

            ['loginError', 'registerError', 'changePasswordError'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.textContent = '';
                    el.style.color = '';
                }
            });
        }

        async function doLogin() {
            if (loginInProgress) return;

            const paraf = document.getElementById('loginParaf').value.trim();
            const password = document.getElementById('loginPassword').value;
            const isTestLogin = paraf.toLowerCase() === TEST_LOCAL_PARAF && password === TEST_LOCAL_PASSWORD;
            if (isTestLogin) {
                setCurrentUser(buildTestLocalSession());
                persistTestLocalSession();
                if (typeof storage !== 'undefined' && storage?.setTestLocalMode) {
                    storage.setTestLocalMode(true);
                    await storage.init();
                    orders = await storage.getAll();
                } else {
                    orders = [];
                }
                if (typeof firebaseSync !== 'undefined') {
                    firebaseSync.stopListening?.();
                    firebaseSync.stopSalesLinesListening?.();
                    firebaseSync.stopProductTreeListening?.();
                }
                const salesFrame = document.getElementById('salesLinesFrame');
                if (salesFrame) {
                    salesFrame.dataset.embeddedReady = 'false';
                    salesFrame.removeAttribute('src');
                }
                if (pagination) pagination.setTotalItems(orders.length);
                renderDashboard();
                renderWeekSidebar();
                applyFilters();
                onLoginSuccess();
                showToast('Test modu acildi. Degisiklikler canli veriye yazilmaz.', 'info');
                return;
            }
            if (!paraf || !password) {
                document.getElementById('loginError').textContent = 'Paraf ve şifre gerekli!';
                return;
            }

            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                document.getElementById('loginError').textContent = 'İnternet bağlantısı yok. Lütfen bağlantınızı kontrol edin.';
                return;
            }

            if (!isFirebaseAvailable()) {
                document.getElementById('loginError').textContent = 'Firebase bağlantısı yok. Giriş şu an yapılamıyor.';
                return;
            }

            const loginBtn = document.querySelector('#loginForm .login-btn');
            loginInProgress = true;
            if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = 'Giriş yapılıyor...'; }

            try {
                const user = await withTimeout(
                    FirebaseAuthManager.login(paraf, password),
                    45000,
                    'Giriş zaman aşımına uğradı. Lütfen tekrar deneyin.'
                );
                setCurrentUser(buildFirebaseSession({ uid: user.uid }, user));
                persistCurrentSession();
                onLoginSuccess();
            } catch (error) {
                let msg = 'Hatalı paraf veya şifre!';
                if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                    msg = 'Hatalı paraf veya şifre!';
                } else if (error.code === 'auth/too-many-requests') {
                    msg = 'Çok fazla deneme! Lütfen biraz bekleyin.';
                } else if (error.message) {
                    msg = error.message;
                }
                document.getElementById('loginError').textContent = msg;
            } finally {
                loginInProgress = false;
                if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Giriş Yap'; }
            }
        }

        async function doChangePassword() {
            const paraf = document.getElementById('changeParaf').value.trim();
            const oldPassword = document.getElementById('changeOldPassword').value;
            const newPassword = document.getElementById('changeNewPassword').value;
            const confirmPassword = document.getElementById('changeNewPasswordConfirm').value;
            const errorEl = document.getElementById('changePasswordError');

            if (!paraf || !oldPassword || !newPassword || !confirmPassword) {
                errorEl.textContent = 'Tum alanlari doldurun!';
                return;
            }

            if (newPassword.length < 6) {
                errorEl.textContent = 'Yeni sifre en az 6 karakter olmali!';
                return;
            }

            if (newPassword !== confirmPassword) {
                errorEl.textContent = 'Yeni sifreler eslesmiyor!';
                return;
            }

            if (!isFirebaseAvailable()) {
                errorEl.textContent = 'Firebase baglantisi yok. Sifre su an degistirilemiyor.';
                return;
            }

            const btn = document.querySelector('#changePasswordForm .login-btn');
            if (btn) { btn.disabled = true; btn.textContent = 'Sifre degistiriliyor...'; }

            try {
                await withTimeout(
                    FirebaseAuthManager.changeOwnPassword(paraf, oldPassword, newPassword),
                    45000,
                    'Sifre degistirme zaman asimina ugradi. Lutfen tekrar deneyin.'
                );

                ['changeOldPassword', 'changeNewPassword', 'changeNewPasswordConfirm'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                });
                errorEl.style.color = 'var(--success)';
                errorEl.textContent = 'Sifreniz degistirildi. Yeni sifrenizle giris yapabilirsiniz.';
                setTimeout(() => showLoginView('login'), 1200);
            } catch (error) {
                errorEl.style.color = 'var(--danger)';
                let msg = error.message || 'Sifre degistirilemedi!';
                if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                    msg = 'Paraf veya mevcut sifre hatali!';
                } else if (error.code === 'auth/weak-password') {
                    msg = 'Yeni sifre en az 6 karakter olmali!';
                } else if (error.code === 'auth/too-many-requests') {
                    msg = 'Cok fazla deneme yapildi. Lutfen biraz bekleyin.';
                }
                errorEl.textContent = msg;
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Sifreyi Degistir'; }
            }
        }

        function openChangeParafModal() {
            if (!hasMatchingFirebaseAuthSession()) return;
            const modal = document.getElementById('changeParafModal');
            const currentParafInput = document.getElementById('profileCurrentParaf');
            const newParafInput = document.getElementById('profileNewParaf');
            const passwordInput = document.getElementById('profileParafPassword');
            const errorEl = document.getElementById('changeParafError');
            if (currentParafInput) currentParafInput.value = currentUser.paraf || '';
            if (newParafInput) newParafInput.value = '';
            if (passwordInput) passwordInput.value = '';
            if (errorEl) {
                errorEl.textContent = '';
                errorEl.style.color = '';
            }
            if (modal) modal.classList.add('active');
            setTimeout(() => newParafInput?.focus(), 50);
        }

        function closeChangeParafModal() {
            const modal = document.getElementById('changeParafModal');
            if (modal) modal.classList.remove('active');
        }

        async function doChangeParaf() {
            if (!hasMatchingFirebaseAuthSession()) return;

            const newParaf = document.getElementById('profileNewParaf').value.trim();
            const password = document.getElementById('profileParafPassword').value;
            const errorEl = document.getElementById('changeParafError');
            const btn = document.getElementById('changeParafBtn');
            const oldParaf = String(currentUser.paraf || '').trim();

            if (!newParaf || !password) {
                errorEl.textContent = 'Yeni paraf ve mevcut şifre gerekli.';
                return;
            }
            if (FirebaseAuthManager.parafToEmail(oldParaf) === FirebaseAuthManager.parafToEmail(newParaf)) {
                errorEl.textContent = 'Yeni paraf mevcut paraf ile aynı olamaz.';
                return;
            }
            if (!isFirebaseAvailable()) {
                errorEl.textContent = 'Firebase bağlantısı yok. Paraf şu an değiştirilemiyor.';
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Paraf değiştiriliyor...';
            }

            try {
                await withTimeout(
                    FirebaseAuthManager.changeOwnParaf(oldParaf, password, newParaf),
                    60000,
                    'Paraf değiştirme zaman aşımına uğradı. Lütfen tekrar deneyin.'
                );

                errorEl.style.color = 'var(--success)';
                errorEl.textContent = 'Paraf değişikliği admin onayına gönderildi.';
                showToast('Paraf değişikliği onay bekliyor', 'success');
                setTimeout(closeChangeParafModal, 1200);
            } catch (error) {
                errorEl.style.color = 'var(--danger)';
                let msg = error.message || 'Paraf değiştirilemedi.';
                if (error.code === 'auth/email-already-in-use') msg = 'Bu paraf zaten kullanılıyor.';
                if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') msg = 'Mevcut şifre hatalı.';
                if (error.code === 'auth/requires-recent-login') msg = 'Güvenlik için çıkış yapıp tekrar giriş yaptıktan sonra deneyin.';
                errorEl.textContent = msg;
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Parafı Değiştir';
                }
            }
        }

        async function doRegister() {
            const fullName = document.getElementById('regFullName').value.trim();
            const paraf = document.getElementById('regParaf').value.trim();
            const password = document.getElementById('regPassword').value;
            const department = (document.getElementById('regDepartment').value || '').trim().toLowerCase();
            if (!fullName || !paraf || !password || !department) {
                document.getElementById('registerError').textContent = 'Tüm alanları doldurun!';
                return;
            }
            if (password.length < 6) {
                document.getElementById('registerError').textContent = 'Şifre en az 6 karakter olmalı!';
                return;
            }
            if (!['lojistik', 'satis', 'uretim'].includes(department)) {
                document.getElementById('registerError').textContent = 'Geçerli bir departman seçin!';
                return;
            }
            if (!isFirebaseAvailable()) {
                document.getElementById('registerError').textContent = 'Firebase bağlantısı yok. Kayıt şu an yapılamıyor.';
                return;
            }

            const regBtn = document.querySelector('#registerForm .login-btn');
            if (regBtn) { regBtn.disabled = true; regBtn.textContent = 'Hesap oluşturuluyor...'; }

            try {
                // Firebase Auth ile kayıt (otomatik giriş yapılmaz, admin onayı beklenir)
                await FirebaseAuthManager.register(fullName, paraf, password, department);

                // Başarılı kayıt mesajı
                document.getElementById('registerError').style.color = 'var(--success)';
                document.getElementById('registerError').textContent = 'Hesabınız oluşturuldu. Admin onayı bekleniyor.';

                // Formu temizle
                document.getElementById('regFullName').value = '';
                document.getElementById('regParaf').value = '';
                document.getElementById('regPassword').value = '';
                document.getElementById('regDepartment').value = '';

            } catch (error) {
                document.getElementById('registerError').style.color = 'var(--danger)';
                let msg = error.message || 'Kayıt başarısız!';
                if (error.code === 'auth/email-already-in-use') msg = 'Bu paraf zaten kullanılıyor!';
                if (error.code === 'auth/weak-password') msg = 'Şifre en az 6 karakter olmalı!';
                document.getElementById('registerError').textContent = msg;
            } finally {
                if (regBtn) { regBtn.disabled = false; regBtn.textContent = 'Hesap Oluştur'; }
            }
        }

        function onLoginSuccess() {
            document.getElementById('loginScreen').classList.add('hidden');
            renderUserHeader();
            renderAdminPanel();
            updateAdminOnlyElements();
            switchTab(canViewOrders() ? 'dashboard' : 'sales-lines');
            refreshSyncStatusFromRuntime();

            if (isTestLocalSession()) return;

            // Firebase sync başlat
            if (canViewOrders() && isFirebaseAvailable() && firebaseSync.ordersRef) {
                firebaseSync.startListening();
            }
        }

        async function doLogout() {
            // Firebase sync durdur
            if (isFirebaseAvailable()) {
                firebaseSync.stopListening();
                try { await FirebaseAuthManager.logout(); } catch (e) { }
            }
            clearStoredAuthSession();
            if (typeof storage !== 'undefined' && storage?.setTestLocalMode) storage.setTestLocalMode(false);
            setCurrentUser(null);
            document.getElementById('loginScreen').classList.remove('hidden');
            document.getElementById('loginParaf').value = '';
            document.getElementById('loginPassword').value = '';
            document.getElementById('loginError').textContent = '';
        }

        function renderUserHeader() {
            const container = document.getElementById('userHeaderInfo');
            if (!currentUser || !container) return;
            const adminRole = currentUser.role === 'admin';
            const devRole = String(currentUser.role || '').trim().toLowerCase() === 'dev';
            container.innerHTML = `
                <span class="user-badge ${adminRole ? 'admin-badge' : ''}">
                    ${adminRole ? 'Admin' : 'Kullanıcı'} ${currentUser.paraf}
                </span>
                ${isFirebaseAvailable() ? '<span style="color: #10b981; font-size: 0.7rem;">Çevrimiçi</span>' : '<span style="color: #f59e0b; font-size: 0.7rem;">Çevrimdışı</span>'}
                <button class="logout-btn profile-btn" onclick="openChangeParafModal()">Paraf değiştir</button>
                <button class="logout-btn" onclick="doLogout()">Çıkış yap</button>
            `;

            const connectionLabel = isFirebaseAvailable() ? 'Çevrimiçi' : 'Çevrimdışı';
            const connectionClass = isFirebaseAvailable() ? 'online' : 'offline';
            container.innerHTML = `
                <span class="user-badge ${adminRole ? 'admin-badge' : ''}">
                    ${currentUser.paraf}${devRole ? ' · DEV' : ''}
                </span>
                <span class="status-badge-header ${connectionClass}">
                    ${connectionLabel}
                </span>
                <span class="sync-status-badge ${syncStatusState.state}" id="syncStatusBadge" title=""></span>
                <button class="logout-btn profile-btn" onclick="openChangeParafModal()">Paraf değiştir</button>
                <button class="logout-btn" onclick="doLogout()">Çıkış yap</button>
            `;
            renderSyncStatusBadge();

            // Auto-fill Requester fields
            const newOrderRequester = document.getElementById('newOrderRequester');
            if (newOrderRequester && currentUser && currentUser.paraf) {
                newOrderRequester.value = currentUser.paraf;
            }

            // Also try to find any other requester inputs
            const detailRequester = document.getElementById('detailRequester'); // If exists
            if (detailRequester && !detailRequester.value && currentUser) detailRequester.value = currentUser.paraf;
        }

        function isAdmin() {
            return isTestLocalSession() || (hasMatchingFirebaseAuthSession() && currentUser.role === 'admin');
        }

        function normalizeDepartmentName(value) {
            return String(value || '')
                .trim()
                .toLowerCase()
                .replace(/ı/g, 'i')
                .replace(/ğ/g, 'g')
                .replace(/ü/g, 'u')
                .replace(/ş/g, 's')
                .replace(/ö/g, 'o')
                .replace(/ç/g, 'c')
                .replace(/ı/g, 'i')
                .replace(/ğ/g, 'g')
                .replace(/ü/g, 'u')
                .replace(/ş/g, 's')
                .replace(/ö/g, 'o')
                .replace(/ç/g, 'c');
        }

        function getUserPermissions() {
            if (isTestLocalSession()) {
                return {
                    canViewOrders: true,
                    canViewProductTree: true,
                    canDeleteData: true,
                    canViewQuickAccess: true
                };
            }

            if (!hasMatchingFirebaseAuthSession()) {
                return {
                    canViewOrders: false,
                    canViewProductTree: false,
                    canDeleteData: false,
                    canViewQuickAccess: false
                };
            }

            if (isAdmin()) {
                return {
                    canViewOrders: true,
                    canViewProductTree: true,
                    canDeleteData: true,
                    canViewQuickAccess: true
                };
            }

            if (String(currentUser.role || '').trim().toLowerCase() === 'dev') {
                return {
                    canViewOrders: true,
                    canViewProductTree: true,
                    canDeleteData: false,
                    canViewQuickAccess: true
                };
            }

            const department = normalizeDepartmentName(currentUser.department);
            const departmentPermissions = {
                uretim: {
                    canViewOrders: true,
                    canViewProductTree: false,
                    canDeleteData: false,
                    canViewQuickAccess: false
                },
                lojistik: {
                    canViewOrders: false,
                    canViewProductTree: false,
                    canDeleteData: false,
                    canViewQuickAccess: false
                },
                satis: {
                    canViewOrders: false,
                    canViewProductTree: false,
                    canDeleteData: false,
                    canViewQuickAccess: false
                }
            };

            const basePermissions = departmentPermissions[department] || {
                canViewOrders: false,
                canViewProductTree: false,
                canDeleteData: false,
                canViewQuickAccess: false
            };

            const profilePermissions = (currentUser && currentUser.permissions && typeof currentUser.permissions === 'object')
                ? currentUser.permissions
                : {};

            const merged = {
                ...basePermissions,
                ...profilePermissions
            };

            return merged;
        }

        function canViewOrders() {
            return !!getUserPermissions().canViewOrders;
        }

        function canViewProductTree() {
            return !!getUserPermissions().canViewProductTree;
        }

        function canViewFinalProductQuantities() {
            if (!isDevEnvironment()) return false;
            if (isTestLocalSession()) return true;
            if (!hasMatchingFirebaseAuthSession()) return false;
            const role = String(currentUser?.role || '').trim().toLowerCase();
            const department = normalizeDepartmentName(currentUser?.department);
            return role === 'admin' || role === 'dev' || department === 'uretim';
        }

        function canDeleteData() {
            return !!isAdmin();
        }

        function canManageSalesLineRequests() {
            if (isTestLocalSession()) return true;
            if (!hasMatchingFirebaseAuthSession()) return false;
            const role = String(currentUser.role || '').trim().toLowerCase();
            const department = normalizeDepartmentName(currentUser.department);
            return role === 'admin' || role === 'dev' || department === 'uretim';
        }

        function canCreateManualSalesLines() {
            if (isTestLocalSession()) return true;
            if (!hasMatchingFirebaseAuthSession()) return false;
            const role = String(currentUser.role || '').trim().toLowerCase();
            const department = normalizeDepartmentName(currentUser.department);
            return role === 'admin' || role === 'dev' || department === 'uretim' || department === 'satis';
        }

        function buildSalesLinesPermissionState() {
            const sessionUser = (hasMatchingFirebaseAuthSession() || isTestLocalSession()) ? currentUser : null;

            const role = String(sessionUser?.role || '').trim().toLowerCase();
            const department = normalizeDepartmentName(sessionUser?.department);

            return {
                canManageSalesLineRequests: isTestLocalSession() || role === 'admin' || role === 'dev' || department === 'uretim',
                canCreateManualSalesLines: isTestLocalSession() || role === 'admin' || role === 'dev' || department === 'uretim' || department === 'satis',
                canDeleteSalesLines: role === 'admin',
                testLocal: isTestLocalSession(),
                currentUser: sessionUser || null
            };
        }

        function getSalesLinePreferencesRef() {
            if (!hasMatchingFirebaseAuthSession() || !currentUser?.uid || !isFirebaseAvailable()) return null;
            return firebase.database().ref(`users/${currentUser.uid}/preferences/salesLinesColumns`);
        }

        function sanitizeSalesLinePreferences(preferences = {}) {
            const visibleColumns = Array.isArray(preferences.visibleColumns)
                ? preferences.visibleColumns.map(value => String(value || '').trim()).filter(Boolean)
                : [];
            const dashboardActions = Array.isArray(preferences.dashboardActions)
                ? preferences.dashboardActions.map(value => String(value || '').trim()).filter(Boolean)
                : [];
            const columnOrder = Array.isArray(preferences.columnOrder)
                ? preferences.columnOrder.map(value => String(value || '').trim()).filter(Boolean)
                : [];
            const columnWidths = preferences.columnWidths && typeof preferences.columnWidths === 'object'
                ? Object.fromEntries(Object.entries(preferences.columnWidths)
                    .map(([key, value]) => [String(key || '').trim(), Number(value)])
                    .filter(([key, value]) => key && Number.isFinite(value) && value > 0))
                : {};
            return {
                visibleColumns,
                dashboardActions,
                columnOrder,
                columnWidths,
                updatedAt: preferences.updatedAt || new Date().toISOString()
            };
        }

        async function getSalesLineAccountPreferences() {
            const ref = getSalesLinePreferencesRef();
            if (!ref) return null;
            const snapshot = await ref.once('value');
            const value = snapshot.val();
            return value && typeof value === 'object' ? sanitizeSalesLinePreferences(value) : null;
        }

        async function saveSalesLineAccountPreferences(preferences) {
            const ref = getSalesLinePreferencesRef();
            if (!ref) return false;
            if (preferences === null) {
                await ref.remove();
                return true;
            }
            await ref.set(sanitizeSalesLinePreferences(preferences));
            return true;
        }

        window.getSalesLineAccountPreferences = getSalesLineAccountPreferences;
        window.saveSalesLineAccountPreferences = saveSalesLineAccountPreferences;

        function syncSalesLinesPermissionsToFrame() {
            const frame = document.getElementById('salesLinesFrame');
            if (!frame || !frame.contentWindow) return;
            frame.contentWindow.postMessage({
                type: 'sales-lines-permissions',
                payload: buildSalesLinesPermissionState()
            }, '*');
        }

        function updateAdminOnlyElements() {
            const deleteAllBtn = document.getElementById('deleteAllDataBtn');
            if (deleteAllBtn) {
                deleteAllBtn.style.display = canDeleteData() ? 'inline-block' : 'none';
            }

            const ordersResetBtn = document.getElementById('ordersResetBtn');
            if (ordersResetBtn) {
                ordersResetBtn.style.display = canDeleteData() ? 'inline-flex' : 'none';
            }

            const ordersFileUploadBtn = document.getElementById('ordersFileUploadBtn');
            if (ordersFileUploadBtn) {
                ordersFileUploadBtn.style.display = isAdmin() ? 'inline-flex' : 'none';
            }

            const clearProductTreeBtn = document.getElementById('clearPTBtn');
            if (clearProductTreeBtn) {
                clearProductTreeBtn.style.display = isAdmin() ? '' : 'none';
            }

            const embeddedSalesLinesResetBtn = document.getElementById('embeddedSalesLinesResetBtn');
            if (embeddedSalesLinesResetBtn) {
                embeddedSalesLinesResetBtn.style.display = isAdmin() ? 'inline-flex' : 'none';
            }

            const embeddedBulkSalesLineRequestBtn = document.getElementById('embeddedBulkSalesLineRequestBtn');
            if (embeddedBulkSalesLineRequestBtn) {
                embeddedBulkSalesLineRequestBtn.style.display = canManageSalesLineRequests() ? 'inline-flex' : 'none';
            }

            const menuWrapper = document.getElementById('menuWrapper');
            if (menuWrapper) {
                menuWrapper.style.display = (isAdmin() || canViewFinalProductQuantities()) ? 'block' : 'none';
            }

            const productTreeNavTab = document.querySelector('.nav-tab[data-tab="product-tree-tools"]');
            if (productTreeNavTab) {
                productTreeNavTab.style.display = canViewProductTree() ? '' : 'none';
            }

            const adminToolsNavTab = document.querySelector('.nav-tab[data-tab="admin-tools"]');
            if (adminToolsNavTab) {
                adminToolsNavTab.style.display = isAdmin() ? '' : 'none';
            }

            const backupToolsNavTab = document.querySelector('.nav-tab[data-tab="backup-tools"]');
            if (backupToolsNavTab) {
                backupToolsNavTab.style.display = isAdmin() ? '' : 'none';
            }

            const finalProductQuantitiesNavTab = document.querySelector('.nav-tab[data-tab="final-product-quantities"]');
            if (finalProductQuantitiesNavTab) {
                finalProductQuantitiesNavTab.style.display = canViewFinalProductQuantities() ? '' : 'none';
            }

            const finalProductQuantitiesQuickBtn = document.getElementById('quickFinalProductQuantitiesBtn');
            if (finalProductQuantitiesQuickBtn) {
                finalProductQuantitiesQuickBtn.style.display = canViewFinalProductQuantities() ? '' : 'none';
            }

            const adminQuickBtn = document.getElementById('quickAdminBtn');
            if (adminQuickBtn) adminQuickBtn.style.display = isAdmin() ? '' : 'none';

            const backupQuickBtn = document.getElementById('quickBackupBtn');
            if (backupQuickBtn) backupQuickBtn.style.display = isAdmin() ? '' : 'none';

            const productTreeQuickBtn = document.getElementById('quickProductTreeBtn');
            if (productTreeQuickBtn) productTreeQuickBtn.style.display = isAdmin() ? '' : 'none';

            const dashboardNavTab = document.querySelector('.nav-tab[data-tab="dashboard"]');
            if (dashboardNavTab) {
                dashboardNavTab.style.display = canViewOrders() ? '' : 'none';
            }

            const headerDashboardBtn = document.getElementById('headerPrimaryDashboardBtn');
            if (headerDashboardBtn) {
                headerDashboardBtn.style.display = canViewOrders() ? '' : 'none';
            }

            const headerOrdersBtn = document.getElementById('headerPrimaryOrdersBtn');
            if (headerOrdersBtn) {
                headerOrdersBtn.style.display = canViewOrders() ? '' : 'none';
            }

            const ordersNavTab = document.querySelector('.nav-tab[data-tab="orders"]');
            if (ordersNavTab) {
                ordersNavTab.style.display = canViewOrders() ? '' : 'none';
            }

            ['qc-view', 'islemde-view', 'teslim-view', 'dagitilan-view', 'qcrepeat-view', 'etiketlendi-view', 'destroyed-view', 'new-order'].forEach(tabId => {
                const tabButton = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
                if (tabButton) tabButton.style.display = canViewOrders() ? '' : 'none';
            });

            const productTreeSection = document.getElementById('product-tree-tools');
            if (productTreeSection) {
                productTreeSection.style.display = canViewProductTree() ? '' : 'none';
            }

            const adminToolsSection = document.getElementById('admin-tools');
            if (adminToolsSection) {
                adminToolsSection.style.display = isAdmin() ? '' : 'none';
            }

            const finalProductQuantitiesSection = document.getElementById('final-product-quantities');
            if (finalProductQuantitiesSection) {
                finalProductQuantitiesSection.style.display = canViewFinalProductQuantities() ? '' : 'none';
            }

            const dashboardSection = document.getElementById('dashboard');
            if (dashboardSection) {
                dashboardSection.style.display = canViewOrders() ? '' : 'none';
            }

            syncSalesLinesPermissionsToFrame();
        }

        // Render Admin Panel in Dashboard (Firebase version)
        async function renderAdminPanel() {
            let panel = document.getElementById('adminPanelSection');
            if (!isAdmin()) {
                if (panel) panel.style.display = 'none';
                return;
            }
            if (!panel) return;
            panel.style.display = 'block';

            if (isTestLocalSession()) {
                const tbody = document.getElementById('adminUserTableBody');
                if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:1rem;">Test modu: Firebase kullanıcı yönetimi kapalıdır.</td></tr>`;
                }
                return;
            }

            let users = [];
            if (isFirebaseAvailable()) {
                users = await FirebaseAuthManager.getAllUsers();
            }

            let rows = users.filter(u => !u.disabled).map(u => {
                const isApproved = u.isApproved !== false; // undefined ise onaylı say (eski kullanıcılar için)
                const pendingParaf = u.pendingParafChange && u.pendingParafChange.status === 'pending'
                    ? u.pendingParafChange
                    : null;
                const statusBadge = isApproved
                    ? '<span style="color: var(--success); font-size: 0.8rem;">âœ… Onaylı</span>'
                    : '<span style="color: var(--warning); font-size: 0.8rem;">â³ Onay Bekliyor</span>';
                const departmentMap = { lojistik: 'Lojistik', satis: 'Satış', uretim: 'Üretim' };
                const departmentLabel = departmentMap[String(u.department || '').toLowerCase()] || '-';
                const parafCell = pendingParaf
                    ? `<strong>${u.paraf || '-'}</strong><div style="font-size:0.78rem;color:var(--warning);margin-top:4px;">Yeni paraf: <strong>${pendingParaf.requestedParaf || '-'}</strong> onay bekliyor</div>`
                    : `<strong>${u.paraf || '-'}</strong>`;

                return `
                <tr>
                    <td>${u.fullName || '-'}</td>
                    <td>${parafCell}</td>
                    <td>${u.role === 'admin' ? 'Admin' : 'Kullanıcı'}</td>
                    <td>${departmentLabel}</td>
                    <td>${statusBadge}</td>
                    <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString('tr-TR') : '-'}</td>
                    <td>
                        ${!isApproved ? `<button class="btn btn-sm btn-success" onclick="approveUser('${u.id}')" style="margin-right: 5px;"> Onayla</button>` : ''}
                        ${pendingParaf ? `<button class="btn btn-sm btn-success" onclick="approveParafChange('${u.id}')" style="margin-right: 5px;">Parafı Onayla</button><button class="btn btn-sm btn-secondary" onclick="rejectParafChange('${u.id}')" style="margin-right: 5px;">Reddet</button>` : ''}
                        ${u.role !== 'admin' ? `<button class="btn btn-sm btn-secondary" onclick="deleteUser('${u.id}')" style="background: #ef4444; border: none;">Sil</button>` : ''}
                    </td>
                </tr>
            `}).join('');
            document.getElementById('adminUserTableBody').innerHTML = rows;
        }

        async function copyLiveDataToDevEnvironment() {
            if (!isAdmin() || !firebaseReady || !firebaseSync?.copyLiveDataToDev) return;
            if (!confirm('Canli orders, salesLines ve productTrees verileri dev ortamina kopyalansin mi?')) return;
            try {
                await firebaseSync.copyLiveDataToDev();
                showToast('Canli veri dev ortamina kopyalandi.', 'success');
            } catch (error) {
                console.error(error);
                showToast('Dev ortamina kopyalama basarisiz.', 'error');
            }
        }

        async function clearDevEnvironmentData() {
            if (!isAdmin() || !firebaseReady || !firebaseSync?.clearDevEnvironmentData) return;
            if (!confirm('Dev ortami tamamen temizlenecek. Emin misiniz?')) return;
            try {
                await firebaseSync.clearDevEnvironmentData();
                showToast('Dev ortami temizlendi.', 'warning');
            } catch (error) {
                console.error(error);
                showToast('Dev ortami temizlenemedi.', 'error');
            }
        }

        window.copyLiveDataToDevEnvironment = copyLiveDataToDevEnvironment;
        window.clearDevEnvironmentData = clearDevEnvironmentData;

        let finalProductQuantityRows = [];
        let finalProductQuantitiesLoading = false;
        let finalProductColFilters = {};
        let activeFinalProductFilterPopup = null;

        const FINAL_PRODUCT_FILTER_LABELS = {
            product: 'Mamül',
            description: 'Açıklama',
            lot: 'Lot',
            quantity: 'Toplam',
            format: 'Format',
            status: 'Durum'
        };

        function parseFinalProductNumber(value) {
            if (value === null || value === undefined) return 0;
            if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
            const normalized = String(value).trim().replace(/\./g, '').replace(',', '.');
            const parsed = parseFloat(normalized);
            return Number.isFinite(parsed) ? parsed : 0;
        }

        function getFinalProductQuantityValue(order) {
            const candidates = [
                { label: 'Gerçekleşen Rack', value: order?.producedQty },
                { label: 'Gerçekleşen Rxn', value: order?.actualRxnQty },
                { label: 'Gerçekleşen Well', value: order?.actualWellQty },
                { label: 'Planlanan Rack', value: order?.quantity },
                { label: 'Planlanan Rxn', value: order?.plannedRxnQty },
                { label: 'Planlanan Well', value: order?.plannedWellQty }
            ];
            const item = candidates.find(candidate => {
                const raw = candidate.value;
                return raw !== null && raw !== undefined && String(raw).trim() !== '';
            });
            if (!item) return '-';
            return `${item.value} ${item.label.replace('Gerçekleşen ', '').replace('Planlanan ', '')}`;
        }

        function normalizeFinalProductOrder(order) {
            const orderNo = String(order?.orderNo || order?.salesOrderNo || order?.documentNo || '').trim();
            const lotNo = String(order?.lotNo || order?.lot || '').trim();
            return {
                id: String(order?.id || order?._id || ''),
                sourceType: 'Talep',
                orderNo,
                productNo: String(order?.catalogNo || order?.materialNo || '').trim(),
                materialNo: String(order?.materialNo || '').trim(),
                rxnName: String(order?.rxnName || order?.description || '').trim(),
                lotNo,
                quantityText: getFinalProductQuantityValue(order),
                format: normalizeOrderFormat(order?.format || ''),
                status: normalizeOrderStatus(order?.status || ''),
                plannedEndDate: String(order?.plannedEndDate || '').trim(),
                deliveryDate: String(order?.deliveryDate || '').trim(),
                source: order
            };
        }

        function normalizeFinalProductSalesLine(row) {
            const orderNo = String(row?.['Belge No'] || row?.orderNo || row?.documentNo || '').trim();
            const lotNo = String(row?.['Lot No'] || row?.lotNo || '').trim();
            const quantity = row?.['Miktar'] ?? row?.quantity ?? '';
            const unit = String(row?.['Ölçü Birimi'] || row?.unit || '').trim();
            const quantityText = quantity !== null && quantity !== undefined && String(quantity).trim() !== ''
                ? `${quantity}${unit ? ` ${unit}` : ''}`
                : '-';

            return {
                id: String(row?._id || row?.id || ''),
                sourceType: 'Satış satırı',
                orderNo,
                productNo: String(row?.['No'] || row?.catalogNo || row?.materialNo || '').trim(),
                materialNo: String(row?.materialNo || '').trim(),
                rxnName: String(row?.['Açıklama'] || row?.rxnName || row?.description || '').trim(),
                lotNo,
                quantityValue: parseFinalProductNumber(quantity),
                quantityText,
                stockCollectedQty: parseFinalProductNumber(row?._stockCollectedQty),
                format: String(row?.['Ölçü Birimi'] || row?.format || '').trim(),
                status: String(row?.['Ürün Durumu'] || row?.status || '').trim(),
                plannedEndDate: '',
                deliveryDate: String(row?.['Teslim Tarihi'] || row?.deliveryDate || '').trim(),
                source: row
            };
        }

        function getFinalProductSearchText(row) {
            return [
                row.productNo,
                row.materialNo,
                row.rxnName,
                row.quantityText,
                row.format,
                row.status,
                row.details?.map(detail => `${detail.orderNo} ${detail.lotNo}`).join(' ')
            ].join(' ').toLocaleLowerCase('tr');
        }

        function getFinalProductColumnRawText(row, key) {
            const values = {
                product: [row.productNo, row.materialNo].filter(Boolean).join(' '),
                description: row.rxnName,
                lot: (Array.isArray(row.details) ? row.details.map(detail => detail.lotNo).filter(Boolean).join(', ') : ''),
                quantity: String(getFinalProductAggregateTotalQty(row)),
                format: row.format,
                status: row.status
            };
            return String(values[key] || '');
        }

        function getFinalProductColumnText(row, key) {
            return getFinalProductColumnRawText(row, key).toLocaleLowerCase('tr');
        }

        function finalProductRowMatchesColumnFilters(row) {
            return Object.entries(finalProductColFilters).every(([key, selectedValues]) => {
                if (!(selectedValues instanceof Set) || selectedValues.size === 0) return true;
                return selectedValues.has(getFinalProductColumnRawText(row, key));
            });
        }

        function filterFinalProductRows(rows) {
            const query = String(document.getElementById('finalProductSearch')?.value || '').trim().toLocaleLowerCase('tr');
            return rows.filter(row => {
                if (query && !getFinalProductSearchText(row).includes(query)) return false;
                if (!finalProductRowMatchesColumnFilters(row)) return false;
                return true;
            });
        }

        function renderFinalProductSummary(rows) {
            const container = document.getElementById('finalProductSummary');
            if (!container) return;
            const productCount = new Set(rows.map(row => row.productNo || row.materialNo).filter(Boolean)).size;
            const totalQty = rows.reduce((sum, row) => sum + getFinalProductAggregateTotalQty(row), 0);
            const detailCount = rows.reduce((sum, row) => sum + (Array.isArray(row.details) ? row.details.length : 0), 0);
            const stockKitCount = rows.reduce((sum, row) => sum + getFinalProductStockKitDetails([row]).length, 0);
            const stockKitQty = getFinalProductStockKitDetails(rows).reduce((sum, detail) => sum + (Number(detail.stockCollectedQty) || 0), 0);
            container.innerHTML = `
                <div class="final-product-metric"><strong>${productCount}</strong><span>Mamül</span></div>
                <div class="final-product-metric"><strong>${totalQty}</strong><span>Toplam sayı</span></div>
                <div class="final-product-metric"><strong>${detailCount}</strong><span>Lot / STS detayı</span></div>
                <div class="final-product-metric"><strong>${stockKitQty}</strong><span>Stok kit adedi (${stockKitCount})</span></div>
            `;
        }

        function getFinalProductStockKitDetails(rows) {
            const list = [];
            (Array.isArray(rows) ? rows : []).forEach(row => {
                (Array.isArray(row.details) ? row.details : []).forEach(detail => {
                    const stockQty = Number(detail.stockCollectedQty) || 0;
                    const status = String(detail.status || '').trim().toLocaleLowerCase('tr');
                    if (stockQty > 0 || status === 'ürün hazır ve stok toplandı') {
                        list.push({ ...detail, aggregate: row, stockCollectedQty: stockQty });
                    }
                });
            });
            return list.sort((a, b) => String(a.productNo || a.aggregate?.productNo || '').localeCompare(String(b.productNo || b.aggregate?.productNo || ''), 'tr'));
        }

        function renderFinalProductStockKits(rows) {
            const container = document.getElementById('finalProductStockKits');
            if (!container) return;
            const details = getFinalProductStockKitDetails(rows);
            if (details.length === 0) {
                container.innerHTML = '';
                return;
            }
            container.innerHTML = `
                <div class="final-product-stock-kits-header">
                    <h3>Stok Kitleri</h3>
                    <span>${details.length} satır</span>
                </div>
                <div class="table-scroll final-product-stock-kits-table-wrap">
                    <table class="data-table final-product-stock-kits-table">
                        <thead>
                            <tr>
                                <th>Mamül</th>
                                <th>Açıklama</th>
                                <th>STS</th>
                                <th>Lot</th>
                                <th>Stok</th>
                                <th>Durum</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${details.map(detail => `
                                <tr>
                                    <td><strong>${esc(detail.aggregate?.productNo || detail.productNo || '-')}</strong></td>
                                    <td>${esc(detail.aggregate?.rxnName || detail.rxnName || '-')}</td>
                                    <td>${esc(detail.orderNo || '-')}</td>
                                    <td>${detail.lotNo ? `<span class="lot-chip">${esc(detail.lotNo)}</span>` : '<span class="cell-subtle">Lot yok</span>'}</td>
                                    <td>${esc(String(detail.stockCollectedQty || 0))}</td>
                                    <td>${esc(detail.status || '-')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        function renderFinalProductDetailRows(row) {
            const details = Array.isArray(row.details) ? row.details : [];
            if (details.length === 0) {
                return '<tr><td colspan="7" class="empty-state-cell">Detay bulunamadı.</td></tr>';
            }
            return details.map(detail => `
                <tr>
                    <td>${esc(detail.orderNo || '-')}</td>
                    <td>${detail.lotNo ? `<span class="lot-chip">${esc(detail.lotNo)}</span>` : '<span class="cell-subtle">Lot yok</span>'}</td>
                    <td>
                        <input class="final-product-count-input" type="number" min="0" step="1" value="${esc(detail.quantityValue || '')}" data-final-order-id="${esc(detail.id)}" placeholder="Sipariş">
                    </td>
                    <td>
                        <input class="final-product-count-input" type="number" min="0" step="1" value="${esc(detail.stockCollectedQty || '')}" data-final-stock-id="${esc(detail.id)}" placeholder="Stok">
                    </td>
                    <td>${esc(String(getFinalProductDetailTotalQty(detail)))}</td>
                    <td>${esc(detail.status || '-')}</td>
                    <td>
                        <button type="button" class="btn btn-sm btn-secondary" onclick="saveFinalProductDetailCount('${esc(detail.id)}')">Kaydet</button>
                    </td>
                </tr>
            `).join('');
        }

        function getFinalProductDetailTotalQty(detail) {
            const orderQty = Number(detail?.quantityValue) || parseFinalProductNumber(detail?.quantityText);
            const stockQty = Number(detail?.stockCollectedQty) || 0;
            return orderQty + stockQty;
        }

        function getFinalProductAggregateTotalQty(row) {
            const details = Array.isArray(row?.details) ? row.details : [];
            if (details.length > 0) {
                return details.reduce((sum, detail) => sum + getFinalProductDetailTotalQty(detail), 0);
            }
            return (Number(row?.quantityValue) || 0) + (Number(row?.stockCollectedQty) || 0);
        }

        function getOpenFinalProductDetailKeys() {
            return Array.from(document.querySelectorAll('.final-product-detail-row'))
                .filter(row => row.style.display !== 'none')
                .map(row => String(row.id || '').replace(/^finalProductDetail_/, ''))
                .filter(Boolean);
        }

        function restoreFinalProductDetailKeys(keys = []) {
            const keySet = new Set((Array.isArray(keys) ? keys : []).map(String));
            keySet.forEach(key => {
                const row = document.getElementById(`finalProductDetail_${key}`);
                if (row) row.style.display = '';
            });
        }

        function renderFinalProductQuantities(options = {}) {
            const tbody = document.getElementById('finalProductTableBody');
            if (!tbody) return;
            const openKeys = Array.isArray(options.openKeys) ? options.openKeys : getOpenFinalProductDetailKeys();

            if (!canViewFinalProductQuantities()) {
                tbody.innerHTML = '<tr><td colspan="7" class="empty-state-cell">Bu ekran yalnızca dev ortamında admin ve üretim ekibi için açıktır.</td></tr>';
                renderFinalProductSummary([]);
                renderFinalProductStockKits([]);
                return;
            }

            if (finalProductQuantitiesLoading) {
                tbody.innerHTML = '<tr><td colspan="7" class="empty-state-cell">Veri yükleniyor...</td></tr>';
                renderFinalProductSummary([]);
                renderFinalProductStockKits([]);
                return;
            }

            const rows = filterFinalProductRows(finalProductQuantityRows);
            renderFinalProductSummary(rows);
            renderFinalProductStockKits(finalProductQuantityRows);

            if (rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="empty-state-cell">Eşleşen kayıt bulunamadı.</td></tr>';
                syncFinalProductHeaderFilterIcons();
                return;
            }

            tbody.innerHTML = rows.map(row => `
                <tr class="final-product-summary-row" onclick="toggleFinalProductDetail('${esc(row.key)}')">
                    <td>
                        <strong>${esc(row.productNo || row.materialNo || '-')}</strong>
                        ${row.materialNo && row.materialNo !== row.productNo ? `<div class="cell-subtle">${esc(row.materialNo)}</div>` : ''}
                    </td>
                    <td>${esc(row.rxnName || '-')}</td>
                    <td>${esc((row.details || []).map(detail => detail.lotNo).filter(Boolean).slice(0, 3).join(', ') || '-')}</td>
                    <td>${esc(String(getFinalProductAggregateTotalQty(row)))}</td>
                    <td>${esc(row.format || '-')}</td>
                    <td>${esc(row.status || '-')}</td>
                    <td>${esc(String(row.details?.length || 0))}</td>
                </tr>
                <tr class="final-product-detail-row" id="finalProductDetail_${esc(row.key)}" style="display:none;">
                    <td colspan="7">
                        <table class="final-product-inner-table">
                            <thead>
                                <tr>
                                    <th>STS</th>
                                    <th>Lot</th>
                                    <th>Sipariş</th>
                                    <th>Stok</th>
                                    <th>Toplam</th>
                                    <th>Durum</th>
                                    <th>İşlem</th>
                                </tr>
                            </thead>
                            <tbody>${renderFinalProductDetailRows(row)}</tbody>
                        </table>
                    </td>
                </tr>
            `).join('');
            restoreFinalProductDetailKeys(openKeys);
            syncFinalProductHeaderFilterIcons();
        }

        function getFinalProductRowsForFilterOptions(ignoreKey) {
            return finalProductQuantityRows.filter(row => {
                const query = String(document.getElementById('finalProductSearch')?.value || '').trim().toLocaleLowerCase('tr');
                if (query && !getFinalProductSearchText(row).includes(query)) return false;
                return Object.entries(finalProductColFilters).every(([key, selectedValues]) => {
                    if (key === ignoreKey) return true;
                    if (!(selectedValues instanceof Set) || selectedValues.size === 0) return true;
                    return selectedValues.has(getFinalProductColumnRawText(row, key));
                });
            });
        }

        function openFinalProductColFilter(event, key) {
            closeFinalProductColFilter();
            const th = event.target.closest('th');
            if (!th) return;
            const rect = th.getBoundingClientRect();
            const currentFilter = finalProductColFilters[key] instanceof Set ? finalProductColFilters[key] : new Set();
            const isFiltered = currentFilter.size > 0;
            const values = Array.from(new Set(
                getFinalProductRowsForFilterOptions(key).map(row => getFinalProductColumnRawText(row, key))
            )).sort((a, b) => String(a).localeCompare(String(b), 'tr'));

            const popup = document.createElement('div');
            popup.className = 'orders-col-filter-popup final-product-col-filter-popup';
            popup.id = 'finalProductColFilterPopup';
            popup.dataset.col = key;
            popup.dataset.isFiltered = isFiltered ? '1' : '0';
            popup.dataset.searchPrimed = '0';

            let left = rect.left;
            if (left + 280 > window.innerWidth) left = Math.max(8, window.innerWidth - 290);
            popup.style.top = `${rect.bottom + 4}px`;
            popup.style.left = `${left}px`;

            popup.innerHTML = `
                <div class="cfp-header">
                    <strong>${esc(FINAL_PRODUCT_FILTER_LABELS[key] || key)}</strong>
                    <input class="cfp-search" type="text" placeholder="Ara..." oninput="filterFinalProductPopupSearch(this.value)">
                </div>
                <div class="cfp-list" id="finalProductCfpList">
                    <div class="cfp-item cfp-select-all">
                        <input type="checkbox" id="finalProductCfpSelectAll" onchange="toggleFinalProductPopupAll(this.checked)" ${!isFiltered ? 'checked' : ''}>
                        <label for="finalProductCfpSelectAll">Tümünü Seç</label>
                    </div>
                    ${values.map((value, index) => {
                        const checked = !isFiltered || currentFilter.has(value);
                        const display = value || '(Boş)';
                        return `<div class="cfp-item" data-val="${esc(value)}">
                            <input type="checkbox" id="finalProductCfp_${index}" data-value="${esc(value)}" ${checked ? 'checked' : ''} onchange="syncFinalProductPopupSelectAllState()">
                            <label for="finalProductCfp_${index}" title="${esc(display)}">${esc(display)}</label>
                        </div>`;
                    }).join('')}
                </div>
                <div class="cfp-footer">
                    <button class="btn btn-sm btn-primary" onclick="applyFinalProductColFilter('${key}')">Uygula</button>
                    <button class="btn btn-sm" onclick="clearFinalProductColFilter('${key}')">Temizle</button>
                </div>
            `;

            document.body.appendChild(popup);
            activeFinalProductFilterPopup = key;
            popup.querySelector('.cfp-search')?.focus();
            syncFinalProductPopupSelectAllState();
        }

        function filterFinalProductPopupSearch(query) {
            const q = String(query || '').toLocaleLowerCase('tr');
            const popup = document.getElementById('finalProductColFilterPopup');
            document.querySelectorAll('#finalProductCfpList .cfp-item[data-val]').forEach(item => {
                const value = String(item.dataset.val || '').toLocaleLowerCase('tr');
                const label = String(item.querySelector('label')?.textContent || '').toLocaleLowerCase('tr');
                item.style.display = value.includes(q) || label.includes(q) ? '' : 'none';
            });

            if (q && popup && popup.dataset.isFiltered !== '1' && popup.dataset.searchPrimed !== '1') {
                document.querySelectorAll('#finalProductCfpList .cfp-item[data-val] input[type=checkbox]').forEach(cb => {
                    cb.checked = false;
                });
                popup.dataset.searchPrimed = '1';
            }
            syncFinalProductPopupSelectAllState();
        }

        function toggleFinalProductPopupAll(checked) {
            document.querySelectorAll('#finalProductCfpList .cfp-item[data-val] input[type=checkbox]').forEach(cb => {
                if (cb.closest('.cfp-item')?.style.display !== 'none') cb.checked = checked;
            });
            syncFinalProductPopupSelectAllState();
        }

        function syncFinalProductPopupSelectAllState() {
            const selectAll = document.getElementById('finalProductCfpSelectAll');
            if (!selectAll) return;
            const visibleCheckboxes = Array.from(document.querySelectorAll('#finalProductCfpList .cfp-item[data-val] input[type=checkbox]'))
                .filter(cb => cb.closest('.cfp-item')?.style.display !== 'none');
            const checkedCount = visibleCheckboxes.filter(cb => cb.checked).length;
            selectAll.checked = visibleCheckboxes.length > 0 && checkedCount === visibleCheckboxes.length;
            selectAll.indeterminate = checkedCount > 0 && checkedCount < visibleCheckboxes.length;
        }

        function applyFinalProductColFilter(key) {
            const searchValue = String(document.querySelector('#finalProductColFilterPopup .cfp-search')?.value || '').trim();
            const allCheckboxes = Array.from(document.querySelectorAll('#finalProductCfpList .cfp-item[data-val] input[type=checkbox]'));
            const checkboxes = allCheckboxes.filter(cb => !searchValue || cb.closest('.cfp-item')?.style.display !== 'none');
            const checked = searchValue ? new Set(finalProductColFilters[key] || []) : new Set();
            checkboxes.forEach(cb => {
                if (cb.checked) checked.add(cb.dataset.value || '');
                else checked.delete(cb.dataset.value || '');
            });

            if (checked.size === 0 || (!searchValue && checked.size === checkboxes.length)) {
                delete finalProductColFilters[key];
            } else {
                finalProductColFilters[key] = checked;
            }

            closeFinalProductColFilter();
            renderFinalProductQuantities();
        }

        function clearFinalProductColFilter(key) {
            delete finalProductColFilters[key];
            closeFinalProductColFilter();
            renderFinalProductQuantities();
        }

        function closeFinalProductColFilter() {
            document.getElementById('finalProductColFilterPopup')?.remove();
            activeFinalProductFilterPopup = null;
        }

        function syncFinalProductHeaderFilterIcons() {
            document.querySelectorAll('[data-final-product-filter]').forEach(icon => {
                const key = icon.dataset.finalProductFilter;
                const active = finalProductColFilters[key] instanceof Set && finalProductColFilters[key].size > 0;
                icon.classList.toggle('active-filter', active);
            });
        }

        window.openFinalProductColFilter = openFinalProductColFilter;
        window.filterFinalProductPopupSearch = filterFinalProductPopupSearch;
        window.toggleFinalProductPopupAll = toggleFinalProductPopupAll;
        window.syncFinalProductPopupSelectAllState = syncFinalProductPopupSelectAllState;
        window.applyFinalProductColFilter = applyFinalProductColFilter;
        window.clearFinalProductColFilter = clearFinalProductColFilter;

        function isFinalProductReadyStatus(status) {
            const normalized = String(status || '').trim().toLocaleLowerCase('tr');
            return normalized === 'ürün hazır' || normalized === 'ürün hazır ve stok toplandı';
        }

        function buildFinalProductAggregateRows(detailRows) {
            const byProduct = new Map();
            detailRows.filter(row => isFinalProductReadyStatus(row.status)).forEach(row => {
                const key = String(row.productNo || row.materialNo || row.rxnName || 'unknown').trim() || 'unknown';
                if (!byProduct.has(key)) {
                    byProduct.set(key, {
                        key: key.replace(/[^a-zA-Z0-9_-]/g, '_'),
                        productNo: row.productNo,
                        materialNo: row.materialNo,
                        rxnName: row.rxnName,
                        quantityValue: 0,
                        quantityText: '0',
                        format: row.format,
                        status: 'Ürün Hazır',
                        details: []
                    });
                }
                const aggregate = byProduct.get(key);
                aggregate.quantityValue += Number(row.quantityValue) || 0;
                aggregate.details.push(row);
                if (!aggregate.rxnName && row.rxnName) aggregate.rxnName = row.rxnName;
                if (!aggregate.format && row.format) aggregate.format = row.format;
            });
            return Array.from(byProduct.values())
                .map(row => ({ ...row, quantityText: String(row.quantityValue) }))
                .sort((a, b) => String(a.productNo || '').localeCompare(String(b.productNo || ''), 'tr'));
        }

        function toggleFinalProductDetail(key) {
            const row = document.getElementById(`finalProductDetail_${key}`);
            if (!row) return;
            row.style.display = row.style.display === 'none' ? '' : 'none';
        }

        async function saveFinalProductDetailCount(rowId) {
            if (!canViewFinalProductQuantities() || !isDevEnvironment() || !isFirebaseAvailable() || !rowId) return;
            const escapedRowId = window.CSS && typeof CSS.escape === 'function'
                ? CSS.escape(String(rowId))
                : String(rowId).replace(/"/g, '\\"');
            const orderInput = document.querySelector(`[data-final-order-id="${escapedRowId}"]`);
            const stockInput = document.querySelector(`[data-final-stock-id="${escapedRowId}"]`);
            const orderQty = parseFinalProductNumber(orderInput?.value || '');
            const stockQty = parseFinalProductNumber(stockInput?.value || '');
            try {
                const rowKey = typeof firebaseSync !== 'undefined' && firebaseSync && typeof firebaseSync.encodeDatabaseKey === 'function'
                    ? firebaseSync.encodeDatabaseKey(rowId)
                    : rowId;
                const rowRef = firebase.database().ref(getFirebaseDbPath(`salesLines/v2/rows/${rowKey}`));
                const snapshot = await rowRef.once('value');
                const wrapper = snapshot.val() || {};
                let rowJson = {};
                if (typeof wrapper.rowJson === 'string') {
                    try { rowJson = JSON.parse(wrapper.rowJson) || {}; } catch (_) { rowJson = {}; }
                } else if (wrapper.data && typeof wrapper.data === 'object') {
                    rowJson = { ...wrapper.data };
                } else if (wrapper && typeof wrapper === 'object') {
                    rowJson = { ...wrapper };
                    delete rowJson.rowJson;
                    delete rowJson.rowUpdatedAt;
                    delete rowJson.rowUpdatedBy;
                    delete rowJson.rowUpdatedByUid;
                    delete rowJson.rowVersion;
                    delete rowJson.index;
                }
                const updatedAt = new Date().toISOString();
                const updatedBy = currentUser?.paraf || currentUser?.fullName || 'dev';
                rowJson['Miktar'] = orderQty;
                rowJson.quantity = orderQty;
                rowJson._finalProductOrderQtyUpdatedAt = updatedAt;
                rowJson._finalProductOrderQtyUpdatedBy = updatedBy;
                rowJson._stockCollectedQty = stockQty;
                rowJson._stockCollectedAt = updatedAt;
                rowJson._stockCollectedBy = updatedBy;
                const updates = {
                    rowJson: JSON.stringify(rowJson),
                    rowUpdatedAt: updatedAt,
                    rowUpdatedBy: updatedBy,
                    rowUpdatedByUid: currentUser?.uid || null
                };
                if (wrapper.data && typeof wrapper.data === 'object') updates.data = rowJson;
                await rowRef.update(updates);
                updateFinalProductDetailLocal(rowId, {
                    orderQty,
                    stockCollectedQty: stockQty,
                    sourcePatch: {
                        'Miktar': orderQty,
                        quantity: orderQty,
                        _finalProductOrderQtyUpdatedAt: updatedAt,
                        _finalProductOrderQtyUpdatedBy: updatedBy,
                        _stockCollectedQty: stockQty,
                        _stockCollectedAt: updatedAt,
                        _stockCollectedBy: updatedBy
                    }
                });
                showToast('Sipariş ve stok miktarı güncellendi.', 'success');
                const openKeys = getOpenFinalProductDetailKeys();
                const scrollX = window.scrollX;
                const scrollY = window.scrollY;
                renderFinalProductQuantities({ openKeys });
                requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
            } catch (error) {
                console.error(error);
                showToast('Miktar kaydedilemedi.', 'error');
            }
        }

        function updateFinalProductDetailLocal(rowId, patch = {}) {
            const id = String(rowId || '');
            finalProductQuantityRows = finalProductQuantityRows.map(row => {
                if (!Array.isArray(row.details)) return row;
                let changed = false;
                const details = row.details.map(detail => {
                    if (String(detail.id || '') !== id) return detail;
                    changed = true;
                    const orderQty = Number(patch.orderQty) || 0;
                    return {
                        ...detail,
                        quantityValue: orderQty,
                        quantityText: String(orderQty),
                        stockCollectedQty: Number(patch.stockCollectedQty) || 0,
                        source: {
                            ...(detail.source || {}),
                            ...(patch.sourcePatch || {})
                        }
                    };
                });
                if (!changed) return row;
                const quantityValue = details.reduce((sum, detail) => sum + (Number(detail.quantityValue) || 0), 0);
                return { ...row, details, quantityValue, quantityText: String(quantityValue) };
            });
        }

        window.toggleFinalProductDetail = toggleFinalProductDetail;
        window.saveFinalProductDetailCount = saveFinalProductDetailCount;

        async function refreshFinalProductQuantities() {
            if (!canViewFinalProductQuantities()) {
                renderFinalProductQuantities();
                return;
            }

            finalProductQuantitiesLoading = true;
            renderFinalProductQuantities();

            try {
                let sourceOrders = Array.isArray(orders) ? orders : [];
                let sourceSalesLines = [];
                if (isFirebaseAvailable() && firebaseSync && typeof firebaseSync.getAll === 'function') {
                    const [remoteOrders, salesLinesPayload] = await Promise.all([
                        firebaseSync.getAll(),
                        typeof firebaseSync.getSalesLinesPayload === 'function'
                            ? firebaseSync.getSalesLinesPayload()
                            : Promise.resolve(null)
                    ]);
                    if (Array.isArray(remoteOrders)) sourceOrders = remoteOrders;
                    if (Array.isArray(salesLinesPayload?.allOrders)) sourceSalesLines = salesLinesPayload.allOrders;
                }

                const salesRows = sourceSalesLines
                    .map(normalizeFinalProductSalesLine)
                    .filter(row => row.orderNo || row.productNo || row.materialNo || row.rxnName || row.lotNo);

                const orderRows = sourceOrders
                    .filter(order => order && order.sourceSystem !== 'sales-lines')
                    .map(normalizeFinalProductOrder)
                    .filter(row => row.orderNo || row.productNo || row.materialNo || row.rxnName || row.lotNo);

                finalProductQuantityRows = buildFinalProductAggregateRows(salesRows.length > 0 ? salesRows : orderRows);
            } catch (error) {
                console.error('Son ürün miktarları okunamadı:', error);
                showToast('Son ürün miktarları okunamadı.', 'error');
                finalProductQuantityRows = [];
            } finally {
                finalProductQuantitiesLoading = false;
                renderFinalProductQuantities();
            }
        }

        window.refreshFinalProductQuantities = refreshFinalProductQuantities;
        window.renderFinalProductQuantities = renderFinalProductQuantities;

        async function approveUser(userId) {
            if (!isAdmin()) return;

            const btn = event.target;
            const originalText = btn.textContent;
            btn.textContent = '...';
            btn.disabled = true;

            try {
                await FirebaseAuthManager.approveUser(userId);
                showToast('Kullanıcı onaylandı.', 'success');
                renderAdminPanel();
            } catch (error) {
                console.error(error);
                showToast('Onay başarısız!', 'error');
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }

        async function deleteUser(userId) {
            if (!isAdmin()) return;
            if (!confirm('Bu kullanıcıyı silmek istediğinizden emin misiniz?')) return;

            await FirebaseAuthManager.disableUser(userId);
            renderAdminPanel();
            showToast('Kullanıcı silindi.', 'warning');
        }

        async function approveParafChange(userId) {
            if (!isAdmin()) return;

            const btn = event.target;
            const originalText = btn.textContent;
            btn.textContent = '...';
            btn.disabled = true;

            try {
                await FirebaseAuthManager.approveParafChange(userId);
                showToast('Paraf değişikliği onaylandı.', 'success');
                renderAdminPanel();
            } catch (error) {
                console.error(error);
                showToast(error.message || 'Paraf onayı başarısız!', 'error');
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }

        async function rejectParafChange(userId) {
            if (!isAdmin()) return;
            if (!confirm('Paraf değişiklik talebi reddedilsin mi?')) return;

            try {
                await FirebaseAuthManager.rejectParafChange(userId);
                showToast('Paraf değişikliği reddedildi.', 'info');
                renderAdminPanel();
            } catch (error) {
                console.error(error);
                showToast('Paraf reddi başarısız!', 'error');
            }
        }

        // Firebase Auth State Observer + Fallback Session Check
        (function initAuthListener() {
            if (restoreTestLocalSession()) {
                return;
            }

            if (isFirebaseAvailable()) {
                // Firebase auth state listener
                FirebaseAuthManager.onAuthStateChanged(async (firebaseUser) => {
                    if (firebaseUser) {
                        const profile = await FirebaseAuthManager.getUserProfile(firebaseUser.uid);

                        // Onay kontrolü ekle
                        if (profile && !profile.disabled) {
                            if (profile.role !== 'admin' && profile.role !== 'dev' && profile.isApproved === false) {
                                // Onaysız ise çıkış yap
                                console.log('Kullanıcı onaylı değil, çıkış yapılıyor...');
                                await FirebaseAuthManager.logout();
                                clearStoredAuthSession();
                                setCurrentUser(null);
                                document.getElementById('loginError').textContent = 'Hesabınız onay bekliyor. Admin onayı olmadan giriş yapamazsınız.';
                                document.getElementById('loginScreen').classList.remove('hidden');
                                return;
                            }

                            setCurrentUser(buildFirebaseSession(firebaseUser, profile));
                            persistCurrentSession();
                            document.getElementById('loginScreen').classList.add('hidden');
                            renderUserHeader();
                            renderAdminPanel();
                            updateAdminOnlyElements();
                            loadOrdersAccountPreferences().catch(() => {});
                            refreshSyncStatusFromRuntime();
                            switchTab(canViewOrders() ? (localStorage.getItem('reaksiyon_active_tab') || 'dashboard') : 'sales-lines');

                            // Sync başlat
                            firebaseSync.init();
                            if (canViewOrders()) {
                                firebaseSync.startListening();
                            }
                            offlineManager.init();
                        } else {
                            // Profil yok veya disabled
                            clearStoredAuthSession();
                            setCurrentUser(null);
                            document.getElementById('loginScreen').classList.remove('hidden');
                        }
                    } else {
                        // Giriş yapılmamış
                        clearStoredAuthSession();
                        setCurrentUser(null);
                        document.getElementById('loginScreen').classList.remove('hidden');
                        firebaseSync.stopListening();
                    }
                });

                // Admin hesabını kontrol et
            } else {
                clearStoredAuthSession();
                setCurrentUser(null);
                document.getElementById('loginScreen').classList.remove('hidden');
                document.getElementById('loginError').textContent = 'Firebase bağlantısı bulunamadı.';
            }
        })();

        // Enter key support for login/register
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                const changeParafModal = document.getElementById('changeParafModal');
                if (changeParafModal && changeParafModal.classList.contains('active')) {
                    doChangeParaf();
                    return;
                }
                const loginScreen = document.getElementById('loginScreen');
                if (loginScreen && !loginScreen.classList.contains('hidden')) {
                    const loginForm = document.getElementById('loginForm');
                    const changePasswordForm = document.getElementById('changePasswordForm');
                    if (changePasswordForm && changePasswordForm.style.display !== 'none') {
                        doChangePassword();
                    } else if (loginForm.style.display !== 'none') {
                        doLogin();
                    } else {
                        doRegister();
                    }
                }
            } else if (e.key === 'Escape') {
                closeChangeParafModal();
            }
        });

        // ===== END AUTH SYSTEM =====

        // Utility Functions
        function esc(str) {
            if (str == null) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        Date.prototype.getWeek = function () {
            var date = new Date(this.getTime());
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
            var week1 = new Date(date.getFullYear(), 0, 4);
            return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
        }

        // Data Storage
        // orders dizisi init-v4.js tarafından yönetilir (Firebase/IndexedDB)
        // init-v4.js'deki global 'orders' değişkeni kullanılır
        if (typeof orders === 'undefined') {
            var orders = [];
        }

        function openSalesLinesConflictPanel() {
            const frame = document.getElementById('salesLinesFrame');
            if (frame && frame.contentWindow) {
                frame.contentWindow.postMessage({ type: 'sales-lines-open-conflicts' }, '*');
            }
            switchTab('sales-lines');
        }
        window.openSalesLinesConflictPanel = openSalesLinesConflictPanel;

        const ORDER_STATUS_OPTIONS = [
            'Ürün İşlem Bekliyor',
            'Ürün Oligo Bekliyor',
            'Ürün Planlandı',
            'Ürün Dağıtıldı',
            'Ürün QC ye gitti',
            'Ürün QC tekrarına gitti',
            'Ürün QC den Geçmedi',
            'Ürün Revizyon bekliyor',
            'Ürün Etiketlendi',
            'Ürün Teslim Edildi',
            'Ürün İptal Edildi'
        ];

        function normalizeOrderStatus(value) {
            const raw = String(value || '').trim();
            if (!raw || raw === '-') return 'Ürün İşlem Bekliyor';
            const key = raw.toLocaleLowerCase('tr');
            const statusMap = {
                'işlem bekliyor': 'Ürün İşlem Bekliyor',
                'islem bekliyor': 'Ürün İşlem Bekliyor',
                'ürün işlem bekliyor': 'Ürün İşlem Bekliyor',
                'urun islem bekliyor': 'Ürün İşlem Bekliyor',
                'oligo bekliyor': 'Ürün Oligo Bekliyor',
                'ürün oligo bekliyor': 'Ürün Oligo Bekliyor',
                'urun oligo bekliyor': 'Ürün Oligo Bekliyor',
                'ürün planlandı': 'Ürün Planlandı',
                'urun planlandi': 'Ürün Planlandı',
                'dağıtıldı': 'Ürün Dağıtıldı',
                'dagitildi': 'Ürün Dağıtıldı',
                'ürün dağıtıldı': 'Ürün Dağıtıldı',
                'urun dagitildi': 'Ürün Dağıtıldı',
                'qc bekliyor': 'Ürün QC ye gitti',
                'qc gidecek': 'Ürün QC ye gitti',
                'ürün qc ye gitti': 'Ürün QC ye gitti',
                'urun qc ye gitti': 'Ürün QC ye gitti',
                'qc tekrarlanacak': 'Ürün QC tekrarına gitti',
                'qc tekrar': 'Ürün QC tekrarına gitti',
                'ürün qc tekrarına gitti': 'Ürün QC tekrarına gitti',
                'urun qc tekrarina gitti': 'Ürün QC tekrarına gitti',
                'ürün qc den geçmedi': 'Ürün QC den Geçmedi',
                'urun qc den gecmedi': 'Ürün QC den Geçmedi',
                'qc den geçmedi': 'Ürün QC den Geçmedi',
                'qc den gecmedi': 'Ürün QC den Geçmedi',
                'qc geçti': 'Ürün Etiketlendi',
                'qc gecti': 'Ürün Etiketlendi',
                'etiketlendi': 'Ürün Etiketlendi',
                'ürün etiketlendi': 'Ürün Etiketlendi',
                'urun etiketlendi': 'Ürün Etiketlendi',
                'revizyon bekliyor': 'Ürün Revizyon bekliyor',
                'ürün revizyon bekliyor': 'Ürün Revizyon bekliyor',
                'urun revizyon bekliyor': 'Ürün Revizyon bekliyor',
                'teslim edildi': 'Ürün Teslim Edildi',
                'ürün teslim edildi': 'Ürün Teslim Edildi',
                'urun teslim edildi': 'Ürün Teslim Edildi',
                'iptal edildi': 'Ürün İptal Edildi',
                'ürün iptal edildi': 'Ürün İptal Edildi',
                'urun iptal edildi': 'Ürün İptal Edildi',
                'imha edilecek': 'Ürün İptal Edildi'
            };
            return statusMap[key] || raw;
        }

        function isOrderStatus(order, expectedStatus) {
            return normalizeOrderStatus(order?.status) === expectedStatus;
        }

        // Column Configuration
        const defaultColumns = [
            { id: 'weekNumber', label: 'Hafta', width: '70px' },
            { id: 'requestDate', label: 'Tarih', width: '110px', type: 'date', wrap: true },
            { id: 'materialNo', label: 'Madde No', width: '120px', wrap: true },
            { id: 'rxnName', label: 'Ürün Açıklaması', width: '180px', bold: true, wrap: true },
            { id: 'format', label: 'Format', width: '90px', wrap: true },
            { id: 'requesterNote', label: 'Talep Geçen Not', width: '170px', wrap: true },
            { id: 'quantity', label: 'Planlanan Miktar (Rack)', width: '210px', editable: true, wrap: true },
            { id: 'plannedRxnQty', label: 'Planlanan Miktar (Rxn)', width: '210px', editable: true, wrap: true },
            { id: 'plannedWellQty', label: 'Planlanan (well)', width: '165px', editable: true, wrap: true },
            { id: 'producer', label: 'Sorumlu Kişi', width: '145px', wrap: true },
            { id: 'distributionNote', label: 'Dağıtım Ekibinin Notu', width: '190px', editable: true, wrap: true },
            { id: 'plannedEndDate', label: 'Planlanan Bitiş', width: '170px', type: 'date', wrap: true },
            { id: 'producedQty', label: 'Gerçekleşen Miktar (Rack)', width: '225px', editable: true, wrap: true },
            { id: 'actualRxnQty', label: 'Gerçekleşen Miktar (Rxn)', width: '225px', editable: true, wrap: true },
            { id: 'actualWellQty', label: 'Gerçekleşen Miktar (well)', width: '225px', editable: true, wrap: true },
            { id: 'productionOrderNo', label: 'SBUE No', width: '140px', wrap: true },
            { id: 'lotNo', label: 'Lot No', width: '160px', wrap: false },
            { id: 'status', label: 'Durum', width: '150px', type: 'status' },
            { id: 'qcApprover', label: 'QC Onaylayan', width: '120px', wrap: true }
        ];

        let currentColumns = JSON.parse(localStorage.getItem('reaksiyon_column_order')) || defaultColumns;

        const ORDERS_COLUMN_SCHEMA_VERSION = '20260531-orders-personalization';
        const ORDERS_COLUMN_PREFS_LOCAL_KEY = 'reaksiyon_orders_column_prefs_v1';
        const storedOrdersColumnSchemaVersion = localStorage.getItem('reaksiyon_column_schema_version');
        const needsReorder = storedOrdersColumnSchemaVersion !== ORDERS_COLUMN_SCHEMA_VERSION;

        const weekCol = currentColumns.find(c => c.id === 'weekNumber');
        const needsUpdate = !weekCol;

        const defaultColumnIds = new Set(defaultColumns.map(col => col.id));
        const hasRequiredColumns = defaultColumns.every(def => currentColumns.some(col => col.id === def.id));
        const hasRemovedColumns = currentColumns.some(col => !defaultColumnIds.has(col.id));

        if (needsReorder || needsUpdate || !hasRequiredColumns || hasRemovedColumns) {
            console.log('Sütun sırası güncelleniyor...');
            // Update logic: If new column missing OR width outdated OR order changed
            currentColumns = JSON.parse(JSON.stringify(defaultColumns)); // Deep copy reset
            localStorage.setItem('reaksiyon_column_order', JSON.stringify(currentColumns));
            localStorage.setItem('reaksiyon_column_schema_version', ORDERS_COLUMN_SCHEMA_VERSION);
        } else {
            // Just sync widths/wrap if they exist (safety net)
            currentColumns.forEach(col => {
                const def = defaultColumns.find(d => d.id === col.id);
                if (def) {
                    col.width = def.width;
                    col.wrap = def.wrap;
                    col.label = def.label; // Sync label too (for renamed notes)
                }
            });
            localStorage.setItem('reaksiyon_column_order', JSON.stringify(currentColumns));
            localStorage.setItem('reaksiyon_column_schema_version', ORDERS_COLUMN_SCHEMA_VERSION);
        }

        let ordersVisibleColumnSet = null;

        function normalizeOrdersColumnIds(columns) {
            if (!Array.isArray(columns)) return [];
            const allowed = new Set(defaultColumns.map(col => col.id));
            return columns.map(col => String(col || '').trim()).filter(col => allowed.has(col));
        }

        function normalizeOrdersColumnOrder(order) {
            const requested = normalizeOrdersColumnIds(order);
            const normalized = [];
            requested.forEach(id => {
                if (!normalized.includes(id)) normalized.push(id);
            });
            defaultColumns.forEach(col => {
                if (!normalized.includes(col.id)) normalized.push(col.id);
            });
            return normalized;
        }

        function normalizeOrdersColumnWidths(widths) {
            if (!widths || typeof widths !== 'object') return {};
            const allowed = new Set(defaultColumns.map(col => col.id));
            const normalized = {};
            Object.entries(widths).forEach(([key, value]) => {
                const id = String(key || '').trim();
                const width = Math.max(50, Math.min(Number(value) || 0, 600));
                if (allowed.has(id) && Number.isFinite(width) && width > 0) normalized[id] = width;
            });
            return normalized;
        }

        function getOrdersAccountPreferencesRef() {
            if (!hasMatchingFirebaseAuthSession() || !currentUser?.uid || !isFirebaseAvailable()) return null;
            return firebase.database().ref(`users/${currentUser.uid}/preferences/ordersColumns`);
        }

        function readLocalOrdersColumnPreferences() {
            try {
                const parsed = JSON.parse(localStorage.getItem(ORDERS_COLUMN_PREFS_LOCAL_KEY) || 'null');
                return parsed && typeof parsed === 'object' ? parsed : null;
            } catch (_) {
                return null;
            }
        }

        function writeLocalOrdersColumnPreferences(preferences) {
            if (!preferences) {
                localStorage.removeItem(ORDERS_COLUMN_PREFS_LOCAL_KEY);
                return;
            }
            localStorage.setItem(ORDERS_COLUMN_PREFS_LOCAL_KEY, JSON.stringify({
                visibleColumns: normalizeOrdersColumnIds(preferences.visibleColumns),
                columnOrder: normalizeOrdersColumnOrder(preferences.columnOrder),
                columnWidths: normalizeOrdersColumnWidths(preferences.columnWidths),
                updatedAt: preferences.updatedAt || new Date().toISOString()
            }));
        }

        function applyOrdersColumnPreferences(preferences) {
            const order = normalizeOrdersColumnOrder(preferences?.columnOrder);
            const visible = normalizeOrdersColumnIds(preferences?.visibleColumns);
            const widths = normalizeOrdersColumnWidths(preferences?.columnWidths);
            if (order.length > 0) {
                const byId = new Map(currentColumns.map(col => [col.id, col]));
                currentColumns = order.map(id => ({ ...(byId.get(id) || defaultColumns.find(col => col.id === id)) })).filter(Boolean);
            }
            Object.entries(widths).forEach(([id, width]) => {
                const col = currentColumns.find(item => item.id === id);
                if (col) col.width = `${width}px`;
            });
            ordersVisibleColumnSet = visible.length > 0 ? new Set(visible) : null;
            localStorage.setItem('reaksiyon_column_order', JSON.stringify(currentColumns));
            writeLocalOrdersColumnPreferences({
                visibleColumns: visible.length > 0 ? visible : currentColumns.map(col => col.id),
                columnOrder: currentColumns.map(col => col.id),
                columnWidths: Object.fromEntries(currentColumns.map(col => [col.id, parseInt(String(col.width || '120px'), 10) || 120]))
            });
        }

        function loadLocalOrdersColumnPreferences() {
            const preferences = readLocalOrdersColumnPreferences();
            if (preferences) applyOrdersColumnPreferences(preferences);
        }

        async function loadOrdersAccountPreferences() {
            const ref = getOrdersAccountPreferencesRef();
            if (!ref) return false;
            try {
                const snapshot = await ref.once('value');
                const preferences = snapshot.val();
                if (preferences && typeof preferences === 'object') {
                    applyOrdersColumnPreferences(preferences);
                    renderTableHeader();
                    if (typeof renderOrders === 'function') renderOrders();
                    return true;
                }
            } catch (error) {
                console.warn('Talep sütun kişiselleştirmesi okunamadı:', error);
            }
            return false;
        }

        async function saveOrdersAccountPreferences(preferences) {
            const ref = getOrdersAccountPreferencesRef();
            if (!ref) return false;
            if (preferences === null) {
                await ref.remove();
                return true;
            }
            await ref.set({
                visibleColumns: normalizeOrdersColumnIds(preferences.visibleColumns),
                columnOrder: normalizeOrdersColumnOrder(preferences.columnOrder),
                columnWidths: normalizeOrdersColumnWidths(preferences.columnWidths),
                updatedAt: preferences.updatedAt || new Date().toISOString()
            });
            return true;
        }

        loadLocalOrdersColumnPreferences();

        // Global State
        let selectedWeekFilter = null; // null = All weeks
        let activeTabFilter = localStorage.getItem('reaksiyon_active_tab') || 'orders'; // 'orders', 'urgent', 'vcap', 'liyofilize', 'tube', 'unmatched'
        let activeColFilters = {}; // Global filter state for text/select filters
        let ordersColFilters = {};
        let activeOrdersFilterPopup = null;
        let activeOrdersColumnDropdown = null;
        let _copiedRow = null; // row copy/paste state used by renderOrders menu
        const SALES_LINES_STORAGE_KEY = 'reaksiyon_sales_lines_data_v1';
        const SALES_LINES_TEST_STORAGE_KEY = 'reaksiyon_test_sales_lines_data_v1';
        function getSalesLinesStorageKey() {
            return isTestLocalSession() ? SALES_LINES_TEST_STORAGE_KEY : SALES_LINES_STORAGE_KEY;
        }
        let pendingSalesLinesCloudPayload = null;

        function getSafeColumns() {
            if (!Array.isArray(currentColumns)) {
                return JSON.parse(JSON.stringify(defaultColumns));
            }

            const defaultIds = new Set(defaultColumns.map(c => c.id));
            const safe = currentColumns.filter(col => col && typeof col.id === 'string' && defaultIds.has(col.id));
            if (safe.length === 0) {
                return JSON.parse(JSON.stringify(defaultColumns));
            }
            if (!ordersVisibleColumnSet || ordersVisibleColumnSet.size === 0) return safe;
            const visible = safe.filter(col => ordersVisibleColumnSet.has(col.id));
            return visible.length > 0 ? visible : safe;
        }
        let lastRemoteSalesLinesPayload = null;
        let lastAppliedSalesLinesPayloadSignature = '';
        let lastPersistedSalesLinesPayloadTime = 0;
        let lastPersistedSalesLinesPayloadSignature = '';
        let lastPersistedSalesLinesPayloadRows = 0;

        function getSalesLinesPayloadSignature(payload) {
            if (!payload) return '';

            try {
                return JSON.stringify({
                    version: payload.version || 1,
                    savedAt: payload.savedAt || '',
                    meta: payload.meta || {},
                    editedLog: payload.editedLog || {},
                    columnOrder: Array.isArray(payload.columnOrder) ? payload.columnOrder : [],
                    allOrders: Array.isArray(payload.allOrders) ? payload.allOrders : []
                });
            } catch (error) {
                console.warn('Sales lines payload signature üretilemedi:', error);
                return String(payload.savedAt || '');
            }
        }

        function getSalesLinesPayloadTime(payload) {
            const time = Date.parse(payload?.savedAt || '');
            return Number.isFinite(time) ? time : 0;
        }

        function isUserAuthoredSalesLinesPayload(payload, reason = '') {
            const source = String(payload?.meta?.source || '').trim();
            return reason === 'sales_lines_iframe_update'
                || reason === 'sales_lines_iframe_debounced'
                || reason === 'sales_lines_retry'
                || !!source;
        }

        function readStoredSalesLinesPayload() {
            try {
                return JSON.parse(localStorage.getItem(getSalesLinesStorageKey()) || 'null');
            } catch (_) {
                return null;
            }
        }

        function getSalesLinesPayloadRowCount(payload) {
            if (Array.isArray(payload?.allOrders)) return payload.allOrders.length;
            return Number(payload?.meta?.rowCount || 0) || 0;
        }

        function buildSalesLinesStorageMarker(payload) {
            const orders = Array.isArray(payload?.allOrders) ? payload.allOrders : [];
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const oneWeekLater = new Date(now);
            oneWeekLater.setDate(oneWeekLater.getDate() + 7);
            const overdueCount = orders.filter(order => {
                const status = String(order?.['Ürün Durumu'] || '').trim().toLocaleLowerCase('tr');
                if (isTerminalSalesStatus(status)) return false;
                if (!order?._teslimTarihi) return false;
                const deliveryDate = new Date(order._teslimTarihi);
                return !isNaN(deliveryDate.getTime()) && deliveryDate <= oneWeekLater;
            }).length;
            const weeks = Array.from(new Set(orders.map(order => order?.['Hafta']).filter(Boolean))).sort((a, b) => Number(a) - Number(b));

            return {
                version: payload?.version || 1,
                savedAt: payload?.savedAt || new Date().toISOString(),
                storage: 'indexeddb',
                meta: {
                    ...(payload?.meta || {}),
                    rowCount: orders.length || Number(payload?.meta?.rowCount || 0) || 0,
                    overdueCount,
                    latestWeek: weeks.length > 0 ? weeks[weeks.length - 1] : (payload?.meta?.latestWeek || '-')
                },
                columnOrder: Array.isArray(payload?.columnOrder) ? payload.columnOrder : []
            };
        }

        function persistSalesLinesStorageMarker(payload) {
            lastPersistedSalesLinesPayloadTime = getSalesLinesPayloadTime(payload);
            lastPersistedSalesLinesPayloadSignature = getSalesLinesPayloadSignature(payload);
            lastPersistedSalesLinesPayloadRows = getSalesLinesPayloadRowCount(payload);

            try {
                localStorage.setItem(getSalesLinesStorageKey(), JSON.stringify(buildSalesLinesStorageMarker(payload)));
            } catch (error) {
                console.warn('Sales lines local marker guncellenemedi:', error);
            }
        }

        function shouldAcceptSalesLinesPayload(payload, options = {}) {
            if (!payload || options.force) return !!payload;

            const incomingTime = getSalesLinesPayloadTime(payload);
            const incomingSignature = getSalesLinesPayloadSignature(payload);
            const storedPayload = readStoredSalesLinesPayload();
            const storedPayloadHasRows = Array.isArray(storedPayload?.allOrders);
            const storedTime = storedPayloadHasRows
                ? getSalesLinesPayloadTime(storedPayload)
                : lastPersistedSalesLinesPayloadTime;
            const storedSignature = storedPayloadHasRows
                ? getSalesLinesPayloadSignature(storedPayload)
                : lastPersistedSalesLinesPayloadSignature;
            const pendingTime = getSalesLinesPayloadTime(pendingSalesLinesCloudPayload);
            const pendingSignature = getSalesLinesPayloadSignature(pendingSalesLinesCloudPayload);
            const incomingRows = getSalesLinesPayloadRowCount(payload);
            const storedRows = storedPayloadHasRows
                ? getSalesLinesPayloadRowCount(storedPayload)
                : (lastPersistedSalesLinesPayloadRows || getSalesLinesPayloadRowCount(storedPayload));

            if (incomingRows > 0 && storedRows === 0) return true;

            if (pendingTime && incomingTime && incomingTime < pendingTime) return false;
            if (pendingTime && incomingTime === pendingTime && pendingSignature && incomingSignature !== pendingSignature) return false;
            if (storedTime && incomingTime && incomingTime < storedTime) return false;
            if (storedTime && incomingTime === storedTime && storedSignature && incomingSignature !== storedSignature) return false;

            return true;
        }

        function applyRemoteSalesLinesPayload(payload, options = {}) {
            if (!payload) return Promise.resolve(0);
            if (isTestLocalSession()) return Promise.resolve(0);
            if (!shouldAcceptSalesLinesPayload(payload, options)) return Promise.resolve(0);
            lastRemoteSalesLinesPayload = payload;

            persistSalesLinesStorageMarker(payload);

            const frame = document.getElementById('salesLinesFrame');
            if (frame && frame.contentWindow) {
                frame.contentWindow.postMessage({ type: 'sales-lines-remote-state', payload }, '*');
            }

            return Promise.resolve(cleanupLegacySalesLineOrdersFromPayload(payload, {
                persist: options.skipPersist !== true
            }))
                .then(() => {
                    renderSalesLinesSummary();
                    renderDashboard();
                    return 0;
                });
        }
        window.applyRemoteSalesLinesPayload = applyRemoteSalesLinesPayload;

        async function syncSalesLinesPayloadToCloud(payload, reason = 'sales_lines_iframe_update', syncOptions = {}) {
            if (!payload) return false;
            if (isTestLocalSession()) return true;
            const payloadTime = getSalesLinesPayloadTime(payload);
            const userAuthoredPayload = isUserAuthoredSalesLinesPayload(payload, reason);
            const storedPayload = readStoredSalesLinesPayload();
            const storedTime = getSalesLinesPayloadTime(storedPayload);
            if (!userAuthoredPayload && storedTime > payloadTime) {
                console.warn('Daha eski satis satirlari payload buluta yazilmadi:', { reason, payloadTime, storedTime });
                return false;
            }
            const knownRemoteTime = getSalesLinesPayloadTime(lastRemoteSalesLinesPayload);
            if (!userAuthoredPayload && knownRemoteTime > payloadTime) {
                console.warn('Daha eski satış satırları payload buluta yazılmadı:', { reason, payloadTime, knownRemoteTime });
                return false;
            }

            if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof firebaseSync !== 'undefined' && firebaseSync.salesLinesRef) {
                try {
                    if (userAuthoredPayload) {
                        persistSalesLinesStorageMarker(payload);
                    }
                    const syncResult = await firebaseSync.syncSalesLinesPayload(payload, { reason, ...syncOptions });
                    if (syncResult && typeof syncResult === 'object' && Array.isArray(syncResult.conflicts) && syncResult.conflicts.length > 0) {
                        setSyncStatus('conflict', `${syncResult.conflicts.length} satış satırı karar bekliyor.`);
                        return syncResult;
                    }
                    lastRemoteSalesLinesPayload = payload;
                    pendingSalesLinesCloudPayload = null;
                    Promise.resolve(cleanupLegacySalesLineOrdersFromPayload(payload, { persist: true })).finally(() => {
                        renderSalesLinesSummary();
                        renderDashboard();
                    });
                    return syncResult || true;
                } catch (error) {
                    console.warn('Sales lines Firebase sync hatasi:', error);
                }
            }

            pendingSalesLinesCloudPayload = payload;
            setTimeout(() => {
                if (pendingSalesLinesCloudPayload) {
                    syncSalesLinesPayloadToCloud(pendingSalesLinesCloudPayload, 'sales_lines_retry');
                }
            }, 400);
            return false;
        }
        const REQUEST_SAVE_DEBOUNCE_MS = 800;
        let scheduledRequestSaveTimer = null;
        let scheduledRequestChangedIds = new Set();
        let scheduledRequestDeletedIds = new Set();
        let scheduledRequestRowBaseMeta = {};
        let activeRequestEditBaseMeta = {};
        let requestFilterDebounceTimer = null;
        let selectedOrderIds = new Set();

        function getOrderSyncMeta(order) {
            if (typeof firebaseSync !== 'undefined' && firebaseSync && typeof firebaseSync.getOrderSyncMeta === 'function') {
                return firebaseSync.getOrderSyncMeta(order);
            }
            const sync = order?._sync && typeof order._sync === 'object' ? order._sync : {};
            return {
                version: Number(sync.version || order?.version || 0) || 0,
                updatedAt: String(sync.updatedAt || order?.updatedAt || order?.lastModifiedAt || ''),
                updatedByUid: sync.updatedByUid || order?.updatedByUid || null,
                updatedByParaf: sync.updatedByParaf || order?.updatedBy || order?.lastModifiedBy || ''
            };
        }

        function getOrderHistoryLength(order) {
            return Array.isArray(order?.changeHistory) ? order.changeHistory.length : 0;
        }

        function getOrderBaseMeta(order) {
            return {
                ...getOrderSyncMeta(order),
                changeHistoryLength: getOrderHistoryLength(order)
            };
        }

        function trimOrderHistoryToBase(orderId, baseMeta = {}) {
            const order = orders.find(item => String(item.id) === String(orderId));
            if (!order || !Array.isArray(order.changeHistory)) return;
            const baseLength = Number(baseMeta.changeHistoryLength);
            if (!Number.isFinite(baseLength) || baseLength < 0) return;
            order.changeHistory = order.changeHistory.slice(0, baseLength);
        }

        function handleOrderSyncConflicts(conflicts = []) {
            const incoming = Array.isArray(conflicts) ? conflicts : [];
            if (incoming.length === 0) return;
            incoming.forEach(conflict => {
                const id = String(conflict?.id || '').trim();
                if (id) trimOrderHistoryToBase(id, conflict.baseMeta || {});
                if (id && conflict.remoteOrder && !conflict.remoteOrder.deleted) {
                    const index = orders.findIndex(item => String(item.id) === id);
                    if (index >= 0) orders[index] = { ...conflict.remoteOrder };
                    else orders.push({ ...conflict.remoteOrder });
                }
            });
            showToast(incoming.length === 1
                ? 'Bu talep başka biri tarafından güncellendi. Değişikliğiniz kaydedilmedi.'
                : `${incoming.length} talep başka kullanıcılar tarafından güncellendi. Değişiklikler kaydedilmedi.`, 'warning', 6000);
            if (typeof applyRequestFilters === 'function') applyRequestFilters();
        }
        window.handleOrderSyncConflicts = handleOrderSyncConflicts;

        function scheduleApplyRequestFilters(delay = 200) {
            if (requestFilterDebounceTimer) clearTimeout(requestFilterDebounceTimer);
            requestFilterDebounceTimer = setTimeout(() => {
                requestFilterDebounceTimer = null;
                applyRequestFilters();
            }, Number(delay) || 200);
        }
        window.scheduleApplyRequestFilters = scheduleApplyRequestFilters;

        function openOrdersColumnPersonalizationModal() {
            const modal = document.getElementById('ordersColumnPersonalizationModal');
            const list = document.getElementById('ordersColumnPersonalizationList');
            if (!modal || !list) return;
            const selected = ordersVisibleColumnSet || new Set(currentColumns.map(col => col.id));
            list.innerHTML = currentColumns.map((col, index) => {
                const checked = selected.has(col.id) ? ' checked' : '';
                return `<div class="personalization-item">
                    <input type="checkbox" id="orders_personal_col_${index}" data-col="${esc(col.id)}"${checked}>
                    <label for="orders_personal_col_${index}">${esc(col.label || col.id)}</label>
                </div>`;
            }).join('');
            modal.classList.add('active');
        }
        window.openOrdersColumnPersonalizationModal = openOrdersColumnPersonalizationModal;

        function closeOrdersColumnPersonalizationModal() {
            document.getElementById('ordersColumnPersonalizationModal')?.classList.remove('active');
        }
        window.closeOrdersColumnPersonalizationModal = closeOrdersColumnPersonalizationModal;

        function selectAllOrdersPersonalizationColumns() {
            document.querySelectorAll('#ordersColumnPersonalizationList input[type=checkbox]').forEach(input => {
                input.checked = true;
            });
        }
        window.selectAllOrdersPersonalizationColumns = selectAllOrdersPersonalizationColumns;

        async function resetOrdersPersonalizationColumns() {
            currentColumns = JSON.parse(JSON.stringify(defaultColumns));
            ordersVisibleColumnSet = null;
            localStorage.setItem('reaksiyon_column_order', JSON.stringify(currentColumns));
            writeLocalOrdersColumnPreferences(null);
            closeOrdersColumnPersonalizationModal();
            renderTableHeader();
            renderOrders();
            const saved = await saveOrdersAccountPreferences(null).catch(error => {
                console.warn('Talep sütun kişiselleştirmesi sıfırlanamadı:', error);
                return false;
            });
            showToast(saved ? 'Talep sütunları hesapta varsayılana döndü' : 'Talep sütunları bu cihazda varsayılana döndü', saved ? 'success' : 'warning');
        }
        window.resetOrdersPersonalizationColumns = resetOrdersPersonalizationColumns;

        async function saveOrdersPersonalizationColumns() {
            const selected = Array.from(document.querySelectorAll('#ordersColumnPersonalizationList input[type=checkbox]'))
                .filter(input => input.checked)
                .map(input => input.dataset.col)
                .filter(Boolean);
            if (selected.length === 0) {
                showToast('En az bir sütun seçin.', 'warning');
                return;
            }

            ordersVisibleColumnSet = new Set(normalizeOrdersColumnIds(selected));
            const preferences = {
                visibleColumns: normalizeOrdersColumnIds(selected),
                columnOrder: normalizeOrdersColumnOrder(currentColumns.map(col => col.id)),
                columnWidths: Object.fromEntries(currentColumns.map(col => [col.id, parseInt(String(col.width || '120px'), 10) || 120])),
                updatedAt: new Date().toISOString()
            };
            writeLocalOrdersColumnPreferences(preferences);
            closeOrdersColumnPersonalizationModal();
            renderTableHeader();
            renderOrders();
            const saved = await saveOrdersAccountPreferences(preferences).catch(error => {
                console.warn('Talep sütun kişiselleştirmesi kaydedilemedi:', error);
                return false;
            });
            showToast(saved ? 'Talep sütun görünümü hesabınıza kaydedildi' : 'Talep sütun görünümü bu cihazda kaydedildi', saved ? 'success' : 'warning');
        }
        window.saveOrdersPersonalizationColumns = saveOrdersPersonalizationColumns;

        function scheduleRequestOrderSave(orderId, baseMeta = null, options = {}) {
            const id = String(orderId || '').trim();
            if (!id) return Promise.resolve(false);
            if (!scheduledRequestRowBaseMeta[id]) {
                const order = orders.find(item => String(item.id) === id);
                scheduledRequestRowBaseMeta[id] = baseMeta || getOrderBaseMeta(order);
            }
            scheduledRequestChangedIds.add(id);
            scheduledRequestDeletedIds.delete(id);

            if (scheduledRequestSaveTimer) clearTimeout(scheduledRequestSaveTimer);
            return new Promise(resolve => {
                scheduledRequestSaveTimer = setTimeout(async () => {
                    const changedOrderIds = Array.from(scheduledRequestChangedIds);
                    const deletedOrderIds = Array.from(scheduledRequestDeletedIds);
                    const rowBaseMeta = { ...scheduledRequestRowBaseMeta };
                    scheduledRequestChangedIds = new Set();
                    scheduledRequestDeletedIds = new Set();
                    scheduledRequestRowBaseMeta = {};
                    scheduledRequestSaveTimer = null;

                    try {
                        const result = await saveOrders({
                            reason: options.reason || 'request-row-patch',
                            changedOrderIds,
                            deletedOrderIds,
                            rowBaseMeta
                        });
                        resolve(result !== false);
                    } catch (error) {
                        console.warn('Talep satırı gecikmeli kayıt hatası:', error);
                        resolve(false);
                    }
                }, Number(options.delay || REQUEST_SAVE_DEBOUNCE_MS));
            });
        }
        window.scheduleRequestOrderSave = scheduleRequestOrderSave;

        function getSelectedOrderIds() {
            return Array.from(selectedOrderIds).filter(id => orders.some(order => String(order.id) === String(id)));
        }

        function isOrderBulkSelected(orderId) {
            return selectedOrderIds.has(String(orderId));
        }

        function getVisibleOrderIdsForBulk() {
            if (ordersRenderState && Array.isArray(ordersRenderState.rows)) {
                return ordersRenderState.rows.map(order => String(order.id)).filter(Boolean);
            }
            return Array.from(document.querySelectorAll('#ordersTableBody tr[data-order-id]'))
                .map(row => String(row.dataset.orderId || '').trim())
                .filter(Boolean);
        }

        function populateOrdersBulkStatusSelect() {
            const select = document.getElementById('ordersBulkStatus');
            if (!select || select.dataset.ready === 'true') return;
            select.innerHTML = ORDER_STATUS_OPTIONS
                .map(status => `<option value="${esc(status)}">${esc(status)}</option>`)
                .join('');
            select.dataset.ready = 'true';
        }

        function syncOrdersBulkSelectionUi() {
            const validIds = new Set((Array.isArray(orders) ? orders : []).map(order => String(order.id)));
            selectedOrderIds.forEach(id => {
                if (!validIds.has(String(id))) selectedOrderIds.delete(id);
            });

            const selectedIds = getSelectedOrderIds();
            document.querySelectorAll('#ordersTableBody .orders-row-checkbox').forEach(checkbox => {
                checkbox.checked = selectedOrderIds.has(String(checkbox.dataset.orderId));
            });

            const visibleIds = getVisibleOrderIdsForBulk();
            const visibleSelectedCount = visibleIds.filter(id => selectedOrderIds.has(String(id))).length;
            const selectAll = document.getElementById('ordersBulkSelectAll');
            if (selectAll) {
                selectAll.checked = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
                selectAll.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleIds.length;
            }

            populateOrdersBulkStatusSelect();
            const countEl = document.getElementById('ordersBulkCount');
            if (countEl) countEl.textContent = String(selectedIds.length);
            const toolbar = document.getElementById('ordersBulkToolbar');
            if (toolbar) toolbar.style.display = selectedIds.length > 0 ? 'flex' : 'none';
        }

        function toggleOrderBulkSelection(orderId, checked) {
            const id = String(orderId || '').trim();
            if (!id) return;
            if (checked) selectedOrderIds.add(id);
            else selectedOrderIds.delete(id);
            syncOrdersBulkSelectionUi();
        }
        window.toggleOrderBulkSelection = toggleOrderBulkSelection;

        function toggleAllVisibleOrders(checked) {
            getVisibleOrderIdsForBulk().forEach(id => {
                if (checked) selectedOrderIds.add(String(id));
                else selectedOrderIds.delete(String(id));
            });
            syncOrdersBulkSelectionUi();
        }
        window.toggleAllVisibleOrders = toggleAllVisibleOrders;

        function clearOrdersBulkSelection() {
            selectedOrderIds = new Set();
            syncOrdersBulkSelectionUi();
        }
        window.clearOrdersBulkSelection = clearOrdersBulkSelection;

        function getOrdersBulkFieldValue(field) {
            if (field === 'requestDate') return document.getElementById('ordersBulkRequestDate')?.value || '';
            if (field === 'deliveryDate') return document.getElementById('ordersBulkDeliveryDate')?.value || '';
            if (field === 'status') return document.getElementById('ordersBulkStatus')?.value || '';
            return '';
        }

        function getOrdersBulkFieldLabel(field) {
            if (field === 'requestDate') return 'Talep Tarihi';
            if (field === 'deliveryDate') return 'Teslim Tarihi';
            if (field === 'status') return 'Durum';
            return field;
        }

        async function bulkUpdateSelectedOrders(field) {
            const allowedFields = new Set(['requestDate', 'deliveryDate', 'status']);
            if (!allowedFields.has(field)) return;

            let value = getOrdersBulkFieldValue(field);
            if (!value) {
                showToast('Uygulanacak değeri seçin.', 'warning');
                return;
            }
            if (field === 'status') value = normalizeOrderStatus(value);

            const selectedIds = getSelectedOrderIds();
            if (selectedIds.length === 0) {
                showToast('Önce satır seçin.', 'warning');
                return;
            }

            const changedOrderIds = [];
            const rowBaseMeta = {};
            const now = new Date().toISOString();
            const changedBy = getActiveUserParaf('Bilinmiyor');
            const label = getOrdersBulkFieldLabel(field);

            selectedIds.forEach(id => {
                const order = orders.find(item => String(item.id) === String(id));
                if (!order) return;
                const oldValue = field === 'status' ? normalizeOrderStatus(order.status) : (order[field] || '');
                if (String(oldValue || '') === String(value || '')) return;
                rowBaseMeta[id] = getOrderBaseMeta(order);
                if (!Array.isArray(order.changeHistory)) order.changeHistory = [];
                order.changeHistory.push({
                    field: label,
                    oldValue,
                    newValue: value,
                    changedBy,
                    changedAt: now
                });
                order[field] = value;

                if (field === 'requestDate') {
                    const nextPlannedEndDate = addDaysToDateOnly(value, 14);
                    if (nextPlannedEndDate && order.plannedEndDate !== nextPlannedEndDate) {
                        order.changeHistory.push({
                            field: 'Planlanan Bitiş',
                            oldValue: order.plannedEndDate || '',
                            newValue: nextPlannedEndDate,
                            changedBy,
                            changedAt: now
                        });
                        order.plannedEndDate = nextPlannedEndDate;
                    }
                }

                order.lastModifiedBy = changedBy;
                order.lastModifiedAt = now;
                changedOrderIds.push(id);
            });

            if (changedOrderIds.length === 0) {
                showToast('Seçili satırlarda değişiklik yok.', 'info');
                return;
            }

            await saveOrders({
                reason: `request-bulk-${field}`,
                changedOrderIds,
                rowBaseMeta
            });
            renderDashboard();
            applyRequestFilters();
            renderWeekSidebar();
            showToast(`${changedOrderIds.length} talep güncellendi.`, 'success');
        }
        window.bulkUpdateSelectedOrders = bulkUpdateSelectedOrders;

        async function bulkDeleteSelectedOrders() {
            if (!canDeleteData()) {
                showToast('Bu işlem için yetkiniz yok.', 'error');
                return;
            }
            const selectedIds = getSelectedOrderIds();
            if (selectedIds.length === 0) {
                showToast('Önce satır seçin.', 'warning');
                return;
            }
            if (!confirm(`${selectedIds.length} talebi silmek istediğinizden emin misiniz?`)) return;

            const rowBaseMeta = {};
            selectedIds.forEach(id => {
                const order = orders.find(item => String(item.id) === String(id));
                if (order) rowBaseMeta[id] = getOrderBaseMeta(order);
            });
            orders = orders.filter(order => !selectedOrderIds.has(String(order.id)));
            selectedOrderIds = new Set();

            await saveOrders({
                reason: 'request-bulk-delete',
                deletedOrderIds: selectedIds,
                rowBaseMeta
            });
            renderDashboard();
            applyRequestFilters();
            renderWeekSidebar();
            syncOrdersBulkSelectionUi();
            showToast(`${selectedIds.length} talep silindi.`, 'warning');
        }
        window.bulkDeleteSelectedOrders = bulkDeleteSelectedOrders;
        window.syncSalesLinesPayloadToCloud = syncSalesLinesPayloadToCloud;

        async function syncSalesLinesTodayOutputsToCloud(payload, reason = 'sales_lines_today_outputs_update', syncOptions = {}) {
            if (!payload) return false;
            if (isTestLocalSession()) return true;
            if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof firebaseSync !== 'undefined' && typeof firebaseSync.syncSalesLinesTodayOutputs === 'function') {
                try {
                    return await firebaseSync.syncSalesLinesTodayOutputs(payload, { reason, ...syncOptions });
                } catch (error) {
                    console.warn('Bugünün çıkışları Firebase sync hatası:', error);
                    return false;
                }
            }
            return false;
        }
        window.syncSalesLinesTodayOutputsToCloud = syncSalesLinesTodayOutputsToCloud;

        function initEmbeddedSalesLinesFrame() {
            const frame = document.getElementById('salesLinesFrame');
            if (!frame || frame.dataset.embeddedReady === 'true') return;

            frame.loading = 'lazy';
            frame.removeAttribute('src');
            frame.onload = () => {
                let payloadToSend = isTestLocalSession() ? null : lastRemoteSalesLinesPayload;

                if (!payloadToSend && !isTestLocalSession()) {
                    try {
                        const raw = localStorage.getItem(getSalesLinesStorageKey());
                        if (raw) payloadToSend = JSON.parse(raw);
                    } catch (error) {
                        console.warn('Iframe icin satis satiri state okunamadi:', error);
                    }
                }
                if (payloadToSend && !Array.isArray(payloadToSend.allOrders)) {
                    payloadToSend = null;
                }

                if (payloadToSend && frame.contentWindow) {
                    frame.contentWindow.postMessage({ type: 'sales-lines-remote-state', payload: payloadToSend }, '*');
                }
                syncSalesLinesPermissionsToFrame();
            };
    const salesLinesVersion = '20260604-dev-final-stock-aggregate';
    frame.src = `./sales-lines.html?v=${salesLinesVersion}${isTestLocalSession() ? '&testLocal=1' : ''}${isDevEnvironment() ? '&env=dev' : ''}`;
            frame.dataset.embeddedReady = 'true';
        }

        function syncWorkspaceScrollMode(tabId) {
            const lockScroll = tabId === 'sales-lines' || tabId === 'orders' || tabId === 'urgent' || tabId === 'overdue' || tabId === 'delivered' || tabId === 'vcap' || tabId === 'liyofilize' || tabId === 'tube' || tabId === 'unmatched';
            document.body.classList.toggle('workspace-locked', lockScroll);
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            // Auth: render user header and admin panel if session exists
            if (currentUser) {
                renderUserHeader();
                renderAdminPanel();
                updateAdminOnlyElements();
            }

            populateWeekDropdowns();
            renderDashboard();
            renderTableHeader();
            renderWeekSidebar();
            mountUtilitySections();

            // Set initial active tab logic
            const allTabs = document.querySelectorAll('.nav-tab');
            allTabs.forEach(t => t.classList.remove('active'));
            const specificTab = document.querySelector(`.nav-tab[data-tab="${activeTabFilter}"]`);
            if (specificTab) specificTab.classList.add('active');

            if (activeTabFilter === 'new-order') {
                document.getElementById('new-order').classList.add('active');
            } else if (activeTabFilter === 'dashboard') {
                document.getElementById('dashboard').classList.add('active');
            } else if (activeTabFilter === 'backup-tools') {
                document.getElementById('backup-tools').classList.add('active');
            } else if (activeTabFilter === 'admin-tools') {
                document.getElementById('admin-tools').classList.add('active');
            } else if (activeTabFilter === 'product-tree-tools') {
                document.getElementById('product-tree-tools').classList.add('active');
                if (typeof renderManagedProductsList === 'function') renderManagedProductsList();
                if (typeof updateProductTreeStats === 'function') updateProductTreeStats();
            } else if (activeTabFilter === 'final-product-quantities' && canViewFinalProductQuantities()) {
                document.getElementById('final-product-quantities').classList.add('active');
                refreshFinalProductQuantities();
            } else if (activeTabFilter === 'sales-lines') {
                document.getElementById('sales-lines').classList.add('active');
            } else if (activeTabFilter === 'qc-view') {
                document.getElementById('qc-view').classList.add('active');
                renderQcView();
            } else if (activeTabFilter === 'destroyed-view') {
                document.getElementById('destroyed-view').classList.add('active');
                renderDestroyedView();
            } else {
                // Default to orders view logic
                document.getElementById('orders').classList.add('active');

                // Set header title based on active filter
                const title = document.querySelector('#orders .card-title');
                if (title) {
                    if (activeTabFilter === 'urgent') title.textContent = 'Acil Beklenen Talepler';
                    else if (activeTabFilter === 'overdue') title.textContent = 'Geciken Talepler';
                    else if (activeTabFilter === 'delivered') title.textContent = 'Teslim Edilen Talepler';
                    else if (activeTabFilter === 'vcap') title.textContent = 'vCAP Talepleri';
                    else if (activeTabFilter === 'liyofilize') title.textContent = 'Liyofilize Talepleri';
                    else if (activeTabFilter === 'tube') title.textContent = 'Tüp Format Talepleri';
                    else title.textContent = 'Talep Listesi';
                }
            }

            applyRequestFilters();
            setupTabNavigation();
            setupHeaderMenu();
            setupWeekSelectSync();
            setHeaderPrimaryState(activeTabFilter);
            setOrdersViewState(activeTabFilter);
            syncWorkspaceScrollMode(activeTabFilter);
            switchTab(canViewOrders() ? (activeTabFilter || 'dashboard') : 'sales-lines');
            refreshSyncStatusFromRuntime();

            // Startup Toast
            setTimeout(() => showToast('Sistem hazır!', 'success'), 500);
        });

        window.addEventListener('storage', (event) => {
            if (event.key === getSalesLinesStorageKey()) {
                let payload = null;
                try {
                    payload = event.newValue ? JSON.parse(event.newValue) : null;
                } catch (_) {}
                Promise.resolve(cleanupLegacySalesLineOrdersFromPayload(payload, { persist: true })).finally(() => {
                    renderSalesLinesSummary();
                    renderDashboard();
                });
            }
            if (event.key === 'firebase_pending_sync') {
                refreshSyncStatusFromRuntime();
            }
        });

        window.addEventListener('online', refreshSyncStatusFromRuntime);
        window.addEventListener('offline', () => setSyncStatus('offline'));

        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'sales-lines-ready') {
                const frame = document.getElementById('salesLinesFrame');
                if (frame && frame.contentWindow) {
                    let payloadToSend = isTestLocalSession() ? null : lastRemoteSalesLinesPayload;
                    if (!payloadToSend && !isTestLocalSession()) {
                        payloadToSend = readStoredSalesLinesPayload();
                    }
                    if (payloadToSend && Array.isArray(payloadToSend.allOrders)) {
                        frame.contentWindow.postMessage({ type: 'sales-lines-remote-state', payload: payloadToSend }, '*');
                    }
                    syncSalesLinesPermissionsToFrame();
                }
                return;
            }

            if (event.data && event.data.type === 'sales-lines-conflict-count') {
                const count = Number(event.data.count || 0) || 0;
                if (count > 0) {
                    setSyncStatus('conflict', `${count} satış satırı karar bekliyor.`);
                } else if (syncStatusState.state === 'conflict') {
                    refreshSyncStatusFromRuntime();
                }
                return;
            }

            if (!event.data || event.data.type !== 'sales-lines-updated' || !event.data.payload) return;
            if (isTestLocalSession()) {
                renderSalesLinesSummary();
                renderDashboard();
                return;
            }
            Promise.resolve(cleanupLegacySalesLineOrdersFromPayload(event.data.payload, { persist: true })).finally(() => {
                renderSalesLinesSummary();
                renderDashboard();
            });
            syncSalesLinesPayloadToCloud(event.data.payload, 'sales_lines_iframe_update');
        });

        try {
            const storedSalesLinesPayload = JSON.parse(localStorage.getItem(getSalesLinesStorageKey()) || 'null');
            Promise.resolve(cleanupLegacySalesLineOrdersFromPayload(storedSalesLinesPayload, { persist: true })).catch(() => {});
        } catch (_) {}

        // Week Sidebar Logic
        function renderWeekSidebar() {
            const sidebarContainer = document.getElementById('weekSidebarList');
            if (sidebarContainer) {
                const currentWeek = new Date().getWeek();
                let html = `
                    <div class="week-card ${selectedWeekFilter === null ? 'active' : ''}" onclick="filterByWeek(null)">
                        <span>Tümü</span>
                        <span class="week-count">${orders.length}</span>
                    </div>
                `;

                for (let i = 1; i <= 52; i++) {
                    const count = orders.filter(o => parseInt(o.weekNumber) === i).length;
                    const isActive = selectedWeekFilter === i;
                    const isCurrent = currentWeek === i;

                    html += `
                        <div class="week-card ${isActive ? 'active' : ''}" onclick="filterByWeek(${i})">
                            <span>
                                ${isCurrent ? 'Aktif' : 'Hafta'} ${i}. Hafta
                            </span>
                            <span class="week-count">${count}</span>
                        </div>
                    `;
                }
                sidebarContainer.innerHTML = html;
            }

            // Populate week dropdown in toolbar
            populateOrdersWeekDropdown();
        }

        function populateOrdersWeekDropdown() {
            const dropdown = document.getElementById('ordersWeekDropdown');
            if (!dropdown) return;

            const weeks = new Set();
            orders.forEach(o => {
                const w = parseInt(o.weekNumber);
                if (w) weeks.add(w);
            });
            const sortedWeeks = Array.from(weeks).sort((a, b) => a - b);

            let html = '<option value="">Tüm Haftalar</option>';
            sortedWeeks.forEach(w => {
                const count = orders.filter(o => parseInt(o.weekNumber) === w).length;
                html += `<option value="${w}" ${selectedWeekFilter === w ? 'selected' : ''}>Hafta ${w} (${count})</option>`;
            });
            dropdown.innerHTML = html;
        }

        function filterByWeek(week) {
            selectedWeekFilter = week;
            renderWeekSidebar(); // Update active state + dropdown
            applyRequestFilters();

            // Sync to week dropdown
            const weekDropdown = document.getElementById('ordersWeekDropdown');
            if (weekDropdown) {
                weekDropdown.value = week !== null ? week : '';
            }

            // Sidebar seçimi form dropdown'ına da yansısın
            const formSelect = document.getElementById('weekNumber');
            if (formSelect && week !== null) {
                formSelect.value = week;
            } else if (formSelect && week === null) {
                formSelect.value = '';
            }
        }

        function resetWeekSelection() {
            filterByWeek(null);
        }

        function setupWeekSelectSync() {
            const weekSelect = document.getElementById('weekNumber');
            if (!weekSelect) return;
            if (weekSelect.dataset.bound === 'true') return;
            weekSelect.dataset.bound = 'true';

            weekSelect.addEventListener('change', function () {
                const value = this.value;
                if (!value) {
                    selectedWeekFilter = null;
                } else {
                    selectedWeekFilter = parseInt(value, 10);
                }

                renderWeekSidebar();
            });
        }

        function applyRequestFilters() {
            // Save open detail rows before re-render
            const openDetailIds = [];
            document.querySelectorAll('.detail-row.active').forEach(row => {
                const id = row.id.replace('detail-', '');
                openDetailIds.push(id);
            });

            const globalSearchEl = document.getElementById('globalSearch');
            const searchTerm = globalSearchEl ? globalSearchEl.value.trim().toLocaleLowerCase('tr') : '';

            // Gather individual column filters (if we decide to keep them in addition)
            // Currently I removed input fields from headers to clean up, but we can re-add or just use global search.
            // The modified html header removed the <input>s. So we rely on global search + week filter.

            const filtered = orders.filter(order => {
                // 1. Week Filter
                if (selectedWeekFilter !== null) {
                    if (parseInt(order.weekNumber) !== selectedWeekFilter) return false;
                }

                // 3. Tab Format Filter
                const tabBucket = getFormatBucket(order);
                const unmatched = isUnmatchedOrder(order);
                const delivered = isDeliveredRequestOrder(order);
                const searchIsActive = !!searchTerm;

                if (activeTabFilter === 'urgent') {
                    if (!isUrgentExpectedOrder(order)) return false;
                } else if (activeTabFilter === 'overdue') {
                    if (!isOverdueRequestOrder(order)) return false;
                } else if (activeTabFilter === 'delivered') {
                    if (!delivered) return false;
                } else if (activeTabFilter === 'vcap') {
                    if (tabBucket !== 'vcap' || unmatched) return false;
                } else if (activeTabFilter === 'liyofilize') {
                    if (tabBucket !== 'liyofilize' || unmatched) return false;
                } else if (activeTabFilter === 'tube') {
                    if (tabBucket !== 'tube' || unmatched) return false;
                } else if (activeTabFilter === 'unmatched') {
                    if (!unmatched) return false;
                }

                if (delivered && activeTabFilter !== 'delivered' && !searchIsActive) return false;

                // 3.5. Status Multi-Filter
                if (activeStatusFilters.size > 0) {
                    if (!activeStatusFilters.has(normalizeOrderStatus(order.status))) return false;
                }

                // 4. Column Filters
                for (const colKey of Object.keys(activeColFilters)) {
                    const filterVal = activeColFilters[colKey].toLowerCase();
                    if (!filterVal) continue;

                    let cellValue = String(order[colKey] || '').toLowerCase();
                    if (colKey === 'requestDate' || colKey === 'deliveryDate') {
                        cellValue = order[colKey] ? formatDate(order[colKey]).toLowerCase() : '';
                    }

                    if (!cellValue.includes(filterVal)) return false;
                }

                for (const [colKey, selectedValues] of Object.entries(ordersColFilters)) {
                    if (!(selectedValues instanceof Set) || selectedValues.size === 0) continue;

                    const displayValue = getOrderFilterValue(order, colKey);
                    if (!selectedValues.has(displayValue)) return false;
                }

                // 2. Global Search - tüm sütun içeriklerinde arama
                if (searchTerm) {
                    const searchableText = [
                        order.weekNumber,
                        order.orderNo,
                        order.requester,
                        order.catalogNo,
                        order.materialNo,
                        order.rxnName,
                        order.format,
                        order.quantity,
                        order.productionOrderNo,
                        order.producedQty,
                        order.requestDate ? formatDate(order.requestDate) : '',
                        order.deliveryDate ? formatDate(order.deliveryDate) : '',
                        order.requesterNote,
                        order.lotNo,
                        order.producerNote,
                        order.distributionNote,
                        order.producer,
                        order.qcApprover,
                        order.componentLots,
                        order.pcStripContent,
                        order.qcNote,
                        order.status,
                        order.producer
                    ].join(' ').toLocaleLowerCase('tr');

                    if (!searchableText.includes(searchTerm)) return false;
                }

                return true;
            });

            const urgentSorted = activeTabFilter === 'urgent' || activeTabFilter === 'overdue'
                ? [...filtered].sort((a, b) => getOrderExitDateTime(a) - getOrderExitDateTime(b))
                : filtered;

            // Apply sorting
            const sorted = sortOrders(urgentSorted);
            renderOrders(sorted);

            // Restore open detail rows after re-render
            openDetailIds.forEach(id => {
                const detailRow = document.getElementById(`detail-${id}`);
                const icon = document.getElementById(`icon-${id}`);
                if (detailRow) {
                    detailRow.classList.add('active');
                    if (icon) icon.textContent = 'â–¼';
                }
            });
        }

        function handleColFilterChange(colKey, value) {
            activeColFilters[colKey] = value;
            applyRequestFilters();
        }

        function getOrderFilterValue(order, colId) {
            if (!order) return '';

            if (colId === 'requestDate' || colId === 'deliveryDate') {
                return order[colId] ? formatDate(order[colId]) : '';
            }

            if (colId === 'weekNumber') {
                return order[colId] !== undefined && order[colId] !== null && String(order[colId]).trim() !== ''
                    ? String(order[colId])
                    : '';
            }

            if (isQuantityColumn(colId)) {
                return order[colId] !== undefined && order[colId] !== null && String(order[colId]).trim() !== ''
                    ? String(order[colId])
                    : '';
            }

            return String(order[colId] || '');
        }

        function isQuantityColumn(colId) {
            return [
                'quantity',
                'plannedRxnQty',
                'plannedWellQty',
                'producedQty',
                'actualRxnQty',
                'actualWellQty'
            ].includes(colId);
        }

        function compareOrderFilterValues(a, b, colId) {
            const aValue = String(a || '').trim();
            const bValue = String(b || '').trim();

            if (!aValue && bValue) return 1;
            if (aValue && !bValue) return -1;
            if (!aValue && !bValue) return 0;

            if (colId === 'weekNumber' || isQuantityColumn(colId)) {
                const aNum = parseFloat(aValue.replace(',', '.'));
                const bNum = parseFloat(bValue.replace(',', '.'));
                const aIsNum = !Number.isNaN(aNum);
                const bIsNum = !Number.isNaN(bNum);

                if (aIsNum && bIsNum) return aNum - bNum;
                if (aIsNum) return -1;
                if (bIsNum) return 1;
            }

            if (colId === 'requestDate' || colId === 'deliveryDate') {
                const aDate = parseDate(aValue);
                const bDate = parseDate(bValue);
                const aTime = aDate instanceof Date && !isNaN(aDate.getTime()) ? aDate.getTime() : null;
                const bTime = bDate instanceof Date && !isNaN(bDate.getTime()) ? bDate.getTime() : null;

                if (aTime !== null && bTime !== null) return aTime - bTime;
                if (aTime !== null) return -1;
                if (bTime !== null) return 1;
            }

            return aValue.localeCompare(bValue, 'tr', { numeric: true, sensitivity: 'base' });
        }

        function getFilteredOrdersForColumnValues(colId) {
            return orders.filter(order => {
                if (selectedWeekFilter !== null && parseInt(order.weekNumber) !== selectedWeekFilter) return false;

                const tabBucket = getFormatBucket(order);
                const unmatched = isUnmatchedOrder(order);
                const delivered = isDeliveredRequestOrder(order);
                const hasSearch = !!String(document.getElementById('globalSearch')?.value || '').trim();

                if (activeTabFilter === 'urgent') {
                    if (!isUrgentExpectedOrder(order)) return false;
                } else if (activeTabFilter === 'overdue') {
                    if (!isOverdueRequestOrder(order)) return false;
                } else if (activeTabFilter === 'delivered') {
                    if (!delivered) return false;
                } else if (activeTabFilter === 'vcap') {
                    if (tabBucket !== 'vcap' || unmatched) return false;
                } else if (activeTabFilter === 'liyofilize') {
                    if (tabBucket !== 'liyofilize' || unmatched) return false;
                } else if (activeTabFilter === 'tube') {
                    if (tabBucket !== 'tube' || unmatched) return false;
                } else if (activeTabFilter === 'unmatched') {
                    if (!unmatched) return false;
                }
                if (delivered && activeTabFilter !== 'delivered' && !hasSearch) return false;

                if (activeStatusFilters.size > 0 && !activeStatusFilters.has(normalizeOrderStatus(order.status))) return false;

                for (const colKey of Object.keys(activeColFilters)) {
                    const filterVal = String(activeColFilters[colKey] || '').toLocaleLowerCase('tr');
                    if (!filterVal) continue;

                    let cellValue = String(order[colKey] || '').toLocaleLowerCase('tr');
                    if (colKey === 'requestDate' || colKey === 'deliveryDate') {
                        cellValue = order[colKey] ? formatDate(order[colKey]).toLocaleLowerCase('tr') : '';
                    }

                    if (!cellValue.includes(filterVal)) return false;
                }

                for (const [filterColId, selectedValues] of Object.entries(ordersColFilters)) {
                    if (filterColId === colId) continue;
                    if (!(selectedValues instanceof Set) || selectedValues.size === 0) continue;

                    const displayValue = getOrderFilterValue(order, filterColId);
                    if (!selectedValues.has(displayValue)) return false;
                }

                const globalSearchEl = document.getElementById('globalSearch');
                const searchTerm = globalSearchEl ? String(globalSearchEl.value || '').trim().toLocaleLowerCase('tr') : '';
                if (!searchTerm) return true;

                const searchableText = [
                    order.weekNumber,
                    order.orderNo,
                    order.requester,
                    order.catalogNo,
                    order.materialNo,
                    order.rxnName,
                    order.format,
                    order.quantity,
                    order.productionOrderNo,
                    order.producedQty,
                    order.requestDate ? formatDate(order.requestDate) : '',
                    order.deliveryDate ? formatDate(order.deliveryDate) : '',
                    order.requesterNote,
                    order.lotNo,
                    order.producerNote,
                    order.distributionNote,
                    order.producer,
                    order.status,
                    order.lastModifiedBy
                ].join(' ').toLocaleLowerCase('tr');

                return searchableText.includes(searchTerm);
            });
        }

        /**
         * Bir sipariş satırının belirtilen sütun için filtre değerini döndürür.
         * Tarih sütunlarında formatlanmış tarih, diğerlerinde ham değer döner.
         */
        function getOrderFilterValue(order, colId) {
            if (!order) return '';
            if (colId === 'requestDate' || colId === 'deliveryDate') {
                return order[colId] ? formatDate(order[colId]) : '';
            }
            if (colId === 'weekNumber') {
                return order[colId] != null ? String(order[colId]) : '';
            }
            if (colId === 'status') {
                return normalizeOrderStatus(order.status);
            }
            return order[colId] != null ? String(order[colId]) : '';
        }

        /**
         * Bir sütun filtresi açılırken, diğer aktif filtreler uygulanmış
         * sipariş listesini döndürür (açılan sütun hariç).
         */
        function getFilteredOrdersForColumnValues(colId) {
            return orders.filter(order => {
                // Week filter
                if (selectedWeekFilter !== null) {
                    if (parseInt(order.weekNumber) !== selectedWeekFilter) return false;
                }
                // Tab format filter
                const tabBucket = getFormatBucket(order);
                const unmatched = isUnmatchedOrder(order);
                const delivered = isDeliveredRequestOrder(order);
                const hasSearch = !!String(document.getElementById('globalSearch')?.value || '').trim();

                if (activeTabFilter === 'urgent') {
                    if (!isUrgentExpectedOrder(order)) return false;
                } else if (activeTabFilter === 'overdue') {
                    if (!isOverdueRequestOrder(order)) return false;
                } else if (activeTabFilter === 'delivered') {
                    if (!delivered) return false;
                } else if (activeTabFilter === 'vcap') {
                    if (tabBucket !== 'vcap' || unmatched) return false;
                } else if (activeTabFilter === 'liyofilize') {
                    if (tabBucket !== 'liyofilize' || unmatched) return false;
                } else if (activeTabFilter === 'tube') {
                    if (tabBucket !== 'tube' || unmatched) return false;
                } else if (activeTabFilter === 'unmatched') {
                    if (!unmatched) return false;
                }
                if (delivered && activeTabFilter !== 'delivered' && !hasSearch) return false;
                // Status filter
                if (activeStatusFilters.size > 0) {
                    if (!activeStatusFilters.has(normalizeOrderStatus(order.status))) return false;
                }
                // Other column filters (skip the column being opened)
                for (const [key, selectedValues] of Object.entries(ordersColFilters)) {
                    if (key === colId) continue;
                    if (!(selectedValues instanceof Set) || selectedValues.size === 0) continue;
                    const displayValue = getOrderFilterValue(order, key);
                    if (!selectedValues.has(displayValue)) return false;
                }
                return true;
            });
        }

        /**
         * İki filtre değerini karşılaştırarak sıralama yapar.
         * Sayısal ve tarih değerleri için akıllı sıralama uygular.
         */
        function compareOrderFilterValues(a, b, colId) {
            // Boş değerleri sona at
            if (a === '' && b === '') return 0;
            if (a === '') return 1;
            if (b === '') return -1;

            // Hafta numaraları için sayısal karşılaştırma
            if (colId === 'weekNumber' || isQuantityColumn(colId)) {
                const numA = parseFloat(a);
                const numB = parseFloat(b);
                if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            }

            // Tarih sütunları için tarih karşılaştırması
            if (colId === 'requestDate' || colId === 'deliveryDate') {
                // formatDate "DD.MM.YYYY" formatında döner
                const parseFormattedDate = (str) => {
                    const parts = String(str).split('.');
                    if (parts.length === 3) {
                        return new Date(parts[2], parts[1] - 1, parts[0]);
                    }
                    return new Date(str);
                };
                const dateA = parseFormattedDate(a);
                const dateB = parseFormattedDate(b);
                if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
                    return dateA.getTime() - dateB.getTime();
                }
            }

            // Varsayılan: Türkçe metin karşılaştırması
            return String(a).localeCompare(String(b), 'tr');
        }

        function syncOrdersSelectAllState() {
            syncOrdersPopupSelectAllState('ordersCfpSelectAll', 'ordersCfpList');
        }

        function syncOrdersPopupSelectAllState(selectAllId = 'ordersCfpSelectAll', listId = 'ordersCfpList') {
            const selectAll = document.getElementById(selectAllId);
            if (!selectAll) return;

            const visibleCheckboxes = Array.from(document.querySelectorAll(`#${listId} .cfp-item[data-val] input[type=checkbox]`))
                .filter(cb => cb.closest('.cfp-item')?.style.display !== 'none');

            if (visibleCheckboxes.length === 0) {
                selectAll.checked = false;
                selectAll.indeterminate = false;
                return;
            }

            const checkedCount = visibleCheckboxes.filter(cb => cb.checked).length;
            selectAll.checked = checkedCount === visibleCheckboxes.length;
            selectAll.indeterminate = checkedCount > 0 && checkedCount < visibleCheckboxes.length;
        }

        function attachOrdersPopupKeyboardHandlers(popup, applyHandler, closeHandler) {
            if (!popup) return;

            popup.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeHandler();
                    return;
                }

                if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') {
                    event.preventDefault();
                    applyHandler();
                }
            });
        }

        function getOrderColumnFilterValues(colId) {
            const values = new Set();
            orders.forEach(order => {
                values.add(getOrderFilterValue(order, colId));
            });
            return Array.from(values).sort((a, b) => String(a).localeCompare(String(b), 'tr'));
        }

        function filterTable() {
            // Deprecated, mapped to applyRequestFilters for compatibility if needed
            applyRequestFilters();
        }


        // Populate Week Dropdowns
        function populateWeekDropdowns() {
            const currentWeek = new Date().getWeek();
            let options = '';
            for (let i = 1; i <= 52; i++) {
                options += `<option value="${i}">${i}. Hafta</option>`;
            }

            // Hafta Filtresi (Check existence)
            const filterSelect = document.getElementById('weekFilter');
            if (filterSelect) {
                filterSelect.innerHTML = '<option value="">Tümü</option>' + options;
                filterSelect.value = currentWeek;
            }

            // Yeni Talep Formu - otomatik seçim yok, kullanıcı manuel seçmeli
            const formSelect = document.getElementById('weekNumber');
            if (formSelect) {
                formSelect.innerHTML = '<option value="">Seçiniz...</option>' + options;
                // Otomatik hafta semi: DEVRE DI?I - kullanc semek zorunda
            }
        }

        function normalizeSalesStatus(value) {
            return String(value || '').trim().toLocaleLowerCase('tr');
        }

        function isTerminalSalesStatus(value) {
            const status = normalizeSalesStatus(value);
            return status === 'iptal edildi' || status === 'ürün iptal edildi' || status === 'ürün çıktı' || status === 'çekmesi yapıldı';
        }

        // Dashboard
        function renderDashboard() {
            renderSalesLinesSummary();

            // Urgent Expected Orders Logic (1 week threshold)
            const oneWeekFromNow = new Date();
            oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
            const now = new Date();
            now.setHours(0, 0, 0, 0);

            var statusCounts = {};
            var inProductionCount = 0;
            var urgentOrders = [];
            for (var i = 0; i < orders.length; i++) {
                var order = orders[i];
                var s = normalizeOrderStatus(order.status);
                if (s === 'Ürün İşlem Bekliyor') {
                    inProductionCount++;
                } else {
                    statusCounts[s] = (statusCounts[s] || 0) + 1;
                }

                if (!isClosedRequestOrder(order) && order.deliveryDate) {
                    var dDate = new Date(order.deliveryDate);
                    if (!isNaN(dDate.getTime()) && dDate <= oneWeekFromNow) {
                        urgentOrders.push(order);
                    }
                }
            }

            document.getElementById('totalOrders').textContent = orders.length;
            document.getElementById('pendingQC').textContent = statusCounts['Ürün QC ye gitti'] || 0;
            document.getElementById('delivered').textContent = statusCounts['Ürün Teslim Edildi'] || 0;
            document.getElementById('destroyed').textContent = statusCounts['Ürün İptal Edildi'] || 0;
            document.getElementById('distributed').textContent = statusCounts['Ürün Dağıtıldı'] || 0;
            document.getElementById('qcRepeat').textContent = statusCounts['Ürün QC tekrarına gitti'] || 0;
            document.getElementById('labeled').textContent = statusCounts['Ürün Etiketlendi'] || 0;
            document.getElementById('inProduction').textContent = inProductionCount;

            const urgentSalesOrders = getSalesLinesOrders().filter(order => {
                const status = String(order['Ürün Durumu'] || '').trim().toLocaleLowerCase('tr');
                if (isTerminalSalesStatus(status)) return false;
                const deliveryDate = order._teslimTarihi ? new Date(order._teslimTarihi) : new Date(order['Teslim Tarihi']);
                if (isNaN(deliveryDate.getTime())) return false;
                return deliveryDate <= oneWeekFromNow;
            }).sort((a, b) => new Date(a._teslimTarihi || a['Teslim Tarihi']) - new Date(b._teslimTarihi || b['Teslim Tarihi']));

            urgentOrders.sort((a, b) => new Date(a.deliveryDate) - new Date(b.deliveryDate));

            const urgentSalesTable = document.getElementById('urgentSalesOrdersTable');
            const urgentSemiFinishedTable = document.getElementById('urgentSemiFinishedTable');

            if (urgentSalesTable) {
                if (urgentSalesOrders.length === 0) {
                    urgentSalesTable.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">Acil beklenen sipariş bulunmuyor.</td></tr>`;
                } else {
                    urgentSalesTable.innerHTML = urgentSalesOrders.slice(0, 12).map(order => {
                        const deliveryDateValue = order._teslimTarihi || order['Teslim Tarihi'];
                        const deliveryDate = new Date(deliveryDateValue);
                        const diffDays = Math.ceil((deliveryDate - now) / (1000 * 60 * 60 * 24));
                        const daysText = diffDays < 0 ? `${Math.abs(diffDays)} gün gecikti` : diffDays === 0 ? 'Bugün' : `${diffDays} gün kaldı`;
                        const dateColor = diffDays < 0 ? '#dc2626' : '#b45309';

                        return `
                        <tr>
                            <td><strong>${order['Belge No'] || '-'}</strong></td>
                            <td>${order['Açıklama'] || order['No'] || '-'}</td>
                            <td>${order['Müşteri'] || '-'}</td>
                            <td>${order['Bekleyen Miktar'] || order['Miktar'] || '-'}</td>
                            <td style="color:${dateColor}; font-weight:600;">${formatDate(deliveryDateValue)}<br><span style="font-size:0.78em; opacity:0.8;">${daysText}</span></td>
                        </tr>
                    `;
                    }).join('');
                }
            }

            if (urgentSemiFinishedTable) {
                if (urgentOrders.length === 0) {
                    urgentSemiFinishedTable.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">Acil beklenen yarı mamül bulunmuyor.</td></tr>`;
                    return;
                }

                urgentSemiFinishedTable.innerHTML = urgentOrders.slice(0, 12).map(order => {
                    const dDate = new Date(order.deliveryDate);
                    const diffTime = dDate - now;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    let daysText = diffDays < 0 ? `${Math.abs(diffDays)} gün gecikti` : `${diffDays} gün kaldı`;
                    if (diffDays === 0) daysText = "Bugün";

                    const dateColor = diffDays < 0 ? '#ef4444' : (diffDays <= 7 ? '#f59e0b' : 'inherit');

                    return `
                    <tr>
                        <td><strong>${order.rxnName}</strong></td>
                        <td>${order.catalogNo || '-'}</td>
                        <td>${order.requester || '-'}</td>
                        <td>${getStatusBadge(order.status)}</td>
                        <td style="color: ${dateColor}; font-weight: bold;">${formatDate(order.deliveryDate)} <br><span style="font-size: 0.8em; opacity: 0.9;">${daysText}</span></td>
                    </tr>
                `}).join('');
            }
        }

        function renderSalesLinesSummary() {
            const totalEl = document.getElementById('salesSyncTotal');
            const overdueEl = document.getElementById('salesSyncOverdue');
            const summaryEl = document.getElementById('salesSyncSummary');
            if (!totalEl || !overdueEl || !summaryEl) return;

            try {
                const raw = localStorage.getItem(getSalesLinesStorageKey());
                if (!raw) {
                    totalEl.textContent = '0';
                    overdueEl.textContent = '0';
                    summaryEl.textContent = 'Henüz satış satırları verisi yüklenmedi. Yükleme yapıldığında bu özet ana uygulamada da görünür.';
                    return;
                }

                const payload = JSON.parse(raw);
                const salesOrders = Array.isArray(payload.allOrders) ? payload.allOrders : [];
                if (!salesOrders.length && payload.storage === 'indexeddb') {
                    const rowCount = Number(payload.meta?.rowCount || 0) || 0;
                    totalEl.textContent = String(rowCount);
                    overdueEl.textContent = String(Number(payload.meta?.overdueCount || 0) || 0);
                    summaryEl.textContent = rowCount
                        ? `${payload.meta?.latestWeek || '-'}. hafta satış satırları yüklü. Son senkron: ${payload.savedAt ? new Date(payload.savedAt).toLocaleString('tr-TR') : 'bilinmiyor'}.`
                        : 'Henüz satış satırları verisi yüklenmedi. Yükleme yapıldığında bu özet ana uygulamada da görünür.';
                    return;
                }
                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const oneWeekLater = new Date(now);
                oneWeekLater.setDate(oneWeekLater.getDate() + 7);

                const overdueCount = salesOrders.filter(order => {
                    const status = String(order['Ürün Durumu'] || '').trim().toLocaleLowerCase('tr');
                    if (isTerminalSalesStatus(status)) return false;
                    if (!order._teslimTarihi) return false;
                    const deliveryDate = new Date(order._teslimTarihi);
                    if (isNaN(deliveryDate.getTime())) return false;
                    return deliveryDate <= oneWeekLater;
                }).length;

                const weeks = Array.from(new Set(salesOrders.map(order => order['Hafta']).filter(Boolean))).sort((a, b) => Number(a) - Number(b));
                const latestWeek = weeks.length > 0 ? weeks[weeks.length - 1] : '-';
                totalEl.textContent = String(salesOrders.length);
                overdueEl.textContent = String(overdueCount);
                summaryEl.textContent = `${latestWeek}. hafta satış satırları yüklü. Son senkron: ${payload.savedAt ? new Date(payload.savedAt).toLocaleString('tr-TR') : 'bilinmiyor'}.`;
            } catch (error) {
                totalEl.textContent = '0';
                overdueEl.textContent = '0';
                summaryEl.textContent = 'Satış satırları verisi okunamadı.';
            }
        }

        async function cleanupLegacySalesLineOrdersFromPayload(payload, options = {}) {
            if (!Array.isArray(orders) || orders.length === 0) return 0;
            const source = String(payload?.meta?.source || '').trim();
            const shouldPrune = options.force === true || source === 'request-reset' || source === 'reset';
            if (!shouldPrune) return 0;

            const linkedRequestIds = new Set(
                (Array.isArray(payload?.allOrders) ? payload.allOrders : [])
                    .flatMap(order => Array.isArray(order?._linkedRequestIds) ? order._linkedRequestIds : [])
                    .map(id => String(id || '').trim())
                    .filter(Boolean)
            );

            const nextOrders = orders.filter(order => {
                if (!order || order.sourceSystem !== 'sales-lines') return true;
                if (order.salesLineRequestMode === 'manual') return true;
                return linkedRequestIds.has(String(order.id || '').trim());
            });

            const removedCount = orders.length - nextOrders.length;
            if (removedCount <= 0) return 0;

            orders = nextOrders;
            if (options.persist && typeof saveOrders === 'function') {
                await Promise.resolve(saveOrders());
            }
            return removedCount;
        }

        function normalizeOrderFormat(rawFormat) {
            const canonicalRaw = String(rawFormat || '')
                .replace(/TÜP\s*\(MIC\)/gi, 'TUP (MIC)')
                .replace(/TÜP\s*\(MIC\)/gi, 'TUP (MIC)')
                .replace(/TÜP/gi, 'TUP')
                .replace(/TÜP/gi, 'TUP')
                .replace(/Tüp/gi, 'TUP')
                .replace(/LİYOFİLİZE/gi, 'LIYOFILIZE')
                .replace(/LİYOFİLİZE/gi, 'LIYOFILIZE');

            const normalized = canonicalRaw
                .trim()
                .toLocaleUpperCase('tr')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/\s+/g, ' ');

            if (!normalized) return '';
            if (normalized.includes('STRIP MIC') || normalized.includes('TUP (MIC)')) return 'vCAP';
            if (normalized.includes('STRIP BIO')) return 'Liyofilize';
            if (normalized === 'TUP' || normalized === 'UL' || normalized.includes('TUP FORMAT') || normalized.includes('TUBE')) return 'Tup';
            if (normalized === 'VCAP') return 'vCAP';
            if (normalized.includes('LIYOFILIZE')) return 'Liyofilize';
            return '';
        }

        let productTreeFormatIndex = null;
        let productTreeCatalogComponentFormatIndex = null;
        let productTreeFormatSyncPromise = null;

        function getProductTreeSourceComponents() {
            const manager =
                (typeof productTreeExcel !== 'undefined' && productTreeExcel && Array.isArray(productTreeExcel.productTreeData))
                    ? productTreeExcel
                    : (window.productTreeExcel && Array.isArray(window.productTreeExcel.productTreeData) ? window.productTreeExcel : null);

            if (manager && Array.isArray(manager.productTreeData) && manager.productTreeData.length > 0) {
                return manager.productTreeData;
            }

            if (!window.productTree || typeof window.productTree !== 'object') return [];

            const fallbackComponents = [];
            Object.entries(window.productTree).forEach(([catalogNo, components]) => {
                if (!Array.isArray(components)) return;

                components.forEach((component) => {
                    fallbackComponents.push({
                        productTreeNo: catalogNo,
                        componentNo: component?.materialNo || component?.componentNo || '',
                        materialNo: component?.materialNo || component?.componentNo || '',
                        unit: component?.unit || '',
                        format: component?.format || '',
                        description: component?.rxnName || component?.description || ''
                    });
                });
            });

            return fallbackComponents;
        }

        function buildProductTreeFormatIndex() {
            const index = new Map();
            const sourceComponents = getProductTreeSourceComponents();
            if (!Array.isArray(sourceComponents) || sourceComponents.length === 0) return index;

            sourceComponents.forEach((component) => {
                const materialNo = String(component?.materialNo || component?.componentNo || '').trim().toUpperCase();
                const normalizedFormat = normalizeOrderFormat(component?.format || component?.unit || '');
                if (!materialNo || !normalizedFormat) return;

                const existing = index.get(materialNo);
                if (!existing || normalizedFormat === 'Tup' || existing !== 'Tup') {
                    index.set(materialNo, normalizedFormat);
                }
            });

            return index;
        }

        function buildCatalogComponentFormatIndex() {
            const index = new Map();
            const sourceComponents = getProductTreeSourceComponents();
            if (!Array.isArray(sourceComponents) || sourceComponents.length === 0) return index;

            sourceComponents.forEach((component) => {
                const normalizedCatalogNo = String(component?.productTreeNo || component?.catalogNo || '').trim().toUpperCase();
                const materialNo = String(component?.materialNo || component?.componentNo || '').trim().toUpperCase();
                const normalizedFormat = normalizeOrderFormat(component?.format || component?.unit || '');
                if (!normalizedCatalogNo || !materialNo || !normalizedFormat) return;

                index.set(`${normalizedCatalogNo}::${materialNo}`, normalizedFormat);
            });

            return index;
        }

        function buildMaterialComponentLookup() {
            const lookup = new Map();
            const sourceComponents = getProductTreeSourceComponents();
            if (!Array.isArray(sourceComponents) || sourceComponents.length === 0) return lookup;

            sourceComponents.forEach((component) => {
                const materialNo = String(component?.materialNo || component?.componentNo || '').trim().toUpperCase();
                if (!materialNo) return;

                const nextEntry = {
                    materialNo,
                    rxnName: String(component?.description || component?.rxnName || '').trim(),
                    format: resolveComponentFormat(component, component?.productTreeNo || component?.catalogNo || ''),
                    catalogNo: String(component?.productTreeNo || component?.catalogNo || '').trim().toUpperCase()
                };

                if (!lookup.has(materialNo)) {
                    lookup.set(materialNo, nextEntry);
                    return;
                }

                const current = lookup.get(materialNo);
                if (!current.rxnName && nextEntry.rxnName) current.rxnName = nextEntry.rxnName;
                if (!current.format && nextEntry.format) current.format = nextEntry.format;
                if (!current.catalogNo && nextEntry.catalogNo) current.catalogNo = nextEntry.catalogNo;
            });

            return lookup;
        }

        function getMaterialComponentLookup() {
            return buildMaterialComponentLookup();
        }

        function normalizeComponentText(value) {
            return String(value || '')
                .trim()
                .toLocaleUpperCase('tr')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/\s+/g, ' ');
        }

        function buildDescriptionComponentLookup() {
            const byDescription = new Map();
            const materialLookup = getMaterialComponentLookup();

            materialLookup.forEach(item => {
                const key = normalizeComponentText(item.rxnName);
                if (!key) return;
                if (!byDescription.has(key)) {
                    byDescription.set(key, item);
                    return;
                }

                const existing = byDescription.get(key);
                if (existing && existing.materialNo !== item.materialNo) {
                    byDescription.set(key, null);
                }
            });

            return byDescription;
        }

        function completeOrderIdentityFromProductTree(materialNoValue, rxnNameValue) {
            const materialLookup = getMaterialComponentLookup();
            const descriptionLookup = buildDescriptionComponentLookup();
            let materialNo = String(materialNoValue || '').trim().toUpperCase();
            let rxnName = String(rxnNameValue || '').trim();
            let match = materialNo ? materialLookup.get(materialNo) : null;

            if (!match && rxnName) {
                match = descriptionLookup.get(normalizeComponentText(rxnName)) || null;
                if (match && !materialNo) materialNo = match.materialNo || '';
            }

            if (match) {
                if (!rxnName && match.rxnName) rxnName = match.rxnName;
                if (!materialNo && match.materialNo) materialNo = match.materialNo;
            }

            return {
                materialNo,
                rxnName,
                format: match?.format || '',
                catalogNo: match?.catalogNo || ''
            };
        }

        function fillDetailMaterialNoOptions() {
            const dataList = document.getElementById('detailMaterialNoOptions');
            if (!dataList) return;

            dataList.innerHTML = getMaterialComponentOptionsHtml();
        }

        function getMaterialComponentOptionsHtml() {
            const lookup = getMaterialComponentLookup();
            return Array.from(lookup.values())
                .sort((a, b) => a.materialNo.localeCompare(b.materialNo, 'tr'))
                .map(item => {
                    const detail = [item.rxnName, item.format, item.catalogNo].filter(Boolean).join(' | ');
                    return `<option value="${esc(item.materialNo)}" label="${esc(detail)}">${esc(detail)}</option>`;
                })
                .join('');
        }

        function ensureRequestMaterialNoOptions() {
            let dataList = document.getElementById('requestMaterialNoOptions');
            if (!dataList) {
                dataList = document.createElement('datalist');
                dataList.id = 'requestMaterialNoOptions';
                document.body.appendChild(dataList);
            }
            dataList.innerHTML = getMaterialComponentOptionsHtml();
            return dataList;
        }

        function handleDetailMaterialNoInput(value) {
            const lookup = getMaterialComponentLookup();
            const materialNo = String(value || '').trim().toUpperCase();
            const match = lookup.get(materialNo);

            if (!match) return;

            const rxnInput = document.getElementById('detailRxnName');
            const formatInput = document.getElementById('detailFormat');
            const catalogInput = document.getElementById('detailCatalogNo');
            if (rxnInput) rxnInput.value = match.rxnName || '';
            if (formatInput) formatInput.value = match.format || '';
            if (catalogInput && !String(catalogInput.value || '').trim()) catalogInput.value = match.catalogNo || '';
        }

        function applyMaterialLookupToOrder(order, materialNoValue) {
            if (!order) return false;

            const lookup = getMaterialComponentLookup();
            const materialNo = String(materialNoValue || '').trim().toUpperCase();
            if (!materialNo) return false;

            order.materialNo = materialNo;
            const match = lookup.get(materialNo);
            if (!match) return false;

            order.rxnName = match.rxnName || order.rxnName || '';
            order.format = normalizeOrderFormat(match.format || order.format || '');
            if (!String(order.catalogNo || '').trim() && match.catalogNo) {
                order.catalogNo = match.catalogNo;
            }
            return true;
        }

        function invalidateProductTreeFormatIndex() {
            productTreeFormatIndex = null;
            productTreeCatalogComponentFormatIndex = null;
        }

        function resolveOrderFormat(order) {
            if (!productTreeFormatIndex) {
                productTreeFormatIndex = buildProductTreeFormatIndex();
            }

            if (!productTreeCatalogComponentFormatIndex) {
                productTreeCatalogComponentFormatIndex = buildCatalogComponentFormatIndex();
            }

            const materialNo = String(order?.materialNo || '').trim().toUpperCase();
            const catalogCandidates = String(order?.catalogNo || '')
                .split(',')
                .map(item => String(item || '').trim().toUpperCase())
                .filter(Boolean);

            if (materialNo && catalogCandidates.length > 0) {
                for (const catalogNo of catalogCandidates) {
                    const catalogComponentKey = `${catalogNo}::${materialNo}`;
                    if (productTreeCatalogComponentFormatIndex.has(catalogComponentKey)) {
                        return productTreeCatalogComponentFormatIndex.get(catalogComponentKey) || '';
                    }
                }
            }

            if (materialNo && productTreeFormatIndex.has(materialNo)) {
                return productTreeFormatIndex.get(materialNo) || '';
            }

            return normalizeOrderFormat(order?.format || '');
        }

        async function syncOrderFormatsFromProductTree(options = {}) {
            if (productTreeFormatSyncPromise) {
                return productTreeFormatSyncPromise;
            }

            productTreeFormatSyncPromise = (async () => {
                if (!Array.isArray(orders) || orders.length === 0) return 0;

                invalidateProductTreeFormatIndex();

                let changedCount = 0;
                orders.forEach(order => {
                    const resolvedFormat = resolveOrderFormat(order);
                    if (!resolvedFormat) return;

                    const currentFormat = normalizeOrderFormat(order?.format || '');
                    if (currentFormat === resolvedFormat) return;

                    order.format = resolvedFormat;
                    changedCount += 1;
                });

                if (changedCount > 0 && options.persist && typeof saveOrders === 'function') {
                    await saveOrders();
                }

                if (changedCount > 0 && !options.skipRender) {
                    if (typeof renderDashboard === 'function') renderDashboard();
                    if (typeof renderWeekSidebar === 'function') renderWeekSidebar();
                    if (typeof applyRequestFilters === 'function') applyRequestFilters();
                }

                return changedCount;
            })();

            try {
                return await productTreeFormatSyncPromise;
            } finally {
                productTreeFormatSyncPromise = null;
            }
        }

        function getFormatBucket(order) {
            const fmt = resolveOrderFormat(order);
            if (fmt === 'vCAP') return 'vcap';
            if (fmt === 'Liyofilize') return 'liyofilize';
            if (fmt === 'Tup') return 'tube';
            return '';
        }

        function isUnmatchedOrder(order) {
            const note = String(order?.requesterNote || '')
                .toLocaleLowerCase('tr')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
            if (note.includes('karsiligi olmayan')) return true;
            return !getFormatBucket(order);
        }

        function parseRequestDateOnly(value) {
            if (!value) return null;
            if (value instanceof Date && !isNaN(value.getTime())) {
                return new Date(value.getFullYear(), value.getMonth(), value.getDate());
            }

            const text = String(value).trim();
            let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (match) {
                return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            }

            match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
            if (match) {
                return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
            }

            match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (match) {
                return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
            }

            return null;
        }

        function getOrderExitDate(order) {
            if (!order) return null;
            return parseRequestDateOnly(order.deliveryDate);
        }

        function getOrderExitDateTime(order) {
            const date = getOrderExitDate(order);
            return date instanceof Date && !isNaN(date.getTime()) ? date.getTime() : Number.MAX_SAFE_INTEGER;
        }

        function isUrgentExpectedOrder(order) {
            if (!order) return false;
            if (isClosedRequestOrder(order)) return false;

            const exitDate = getOrderExitDate(order);
            if (!(exitDate instanceof Date) || isNaN(exitDate.getTime())) return false;

            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const threeDaysLater = new Date(todayStart);
            threeDaysLater.setDate(todayStart.getDate() + 3);
            const exitStart = new Date(exitDate.getFullYear(), exitDate.getMonth(), exitDate.getDate());

            return exitStart.getTime() <= threeDaysLater.getTime();
        }

        function getRequestStatusKey(order) {
            return normalizeOrderStatus(order?.status).toLocaleLowerCase('tr');
        }

        function isDeliveredRequestOrder(order) {
            const status = getRequestStatusKey(order);
            return status.includes('teslim edildi');
        }

        function isClosedRequestOrder(order) {
            const status = getRequestStatusKey(order);
            return status.includes('teslim edildi')
                || status.includes('iptal edildi')
                || status === 'ürün çıktı'
                || status === 'urun cikti';
        }

        function isExpectedRequestOrder(order) {
            return !!order && !isClosedRequestOrder(order);
        }

        function isOverdueRequestOrder(order) {
            if (!order || isClosedRequestOrder(order)) return false;
            const exitDate = getOrderExitDate(order);
            if (!(exitDate instanceof Date) || isNaN(exitDate.getTime())) return false;
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const exitStart = new Date(exitDate.getFullYear(), exitDate.getMonth(), exitDate.getDate());
            return exitStart.getTime() < todayStart.getTime();
        }

        function getLegacyProductTreeComponentsByCatalog(catalogNo) {
            const manager =
                (typeof productTreeExcel !== 'undefined' && productTreeExcel && productTreeExcel.productTreeIndex)
                    ? productTreeExcel
                    : (window.productTreeExcel && window.productTreeExcel.productTreeIndex ? window.productTreeExcel : null);
            if (!catalogNo || !manager || !manager.productTreeIndex) return [];
            const normalizedCatalogNo = String(catalogNo || '').trim().toUpperCase();
            if (!normalizedCatalogNo) return [];

            const directMatch = manager.productTreeIndex[normalizedCatalogNo];
            if (Array.isArray(directMatch) && directMatch.length > 0) return directMatch;

            const matchedKey = Object.keys(manager.productTreeIndex).find(
                key => String(key).trim().toUpperCase() === normalizedCatalogNo
            );
            if (!matchedKey) return [];

            const matchedComponents = manager.productTreeIndex[matchedKey];
            return Array.isArray(matchedComponents) ? matchedComponents : [];
        }

        function resolveComponentFormat(component, catalogNo = '') {
            const normalizedFromComponent = normalizeOrderFormat(component?.format || component?.unit || '');
            if (normalizedFromComponent) return normalizedFromComponent;

            if (!productTreeCatalogComponentFormatIndex) {
                productTreeCatalogComponentFormatIndex = buildCatalogComponentFormatIndex();
            }

            const normalizedCatalogNo = String(catalogNo || '').trim().toUpperCase();
            const materialNo = String(component?.materialNo || component?.componentNo || '').trim().toUpperCase();
            if (normalizedCatalogNo && materialNo) {
                return productTreeCatalogComponentFormatIndex.get(`${normalizedCatalogNo}::${materialNo}`) || '';
            }

            if (!productTreeFormatIndex) {
                productTreeFormatIndex = buildProductTreeFormatIndex();
            }

            if (materialNo) {
                return productTreeFormatIndex.get(materialNo) || '';
            }

            return '';
        }

        function detectFormatFromComponents(catalogNo, components = []) {
            const candidates = [];

            components.forEach(component => {
                if (!component) return;
                if (component.format) candidates.push(component.format);
                if (component.unit) candidates.push(component.unit);
            });

            const legacyComponents = getLegacyProductTreeComponentsByCatalog(catalogNo);
            legacyComponents.forEach(component => {
                if (!component) return;
                if (component.format) candidates.push(component.format);
                if (component.unit) candidates.push(component.unit);
            });

            let hasVcap = false;
            let hasLiyofilize = false;
            let hasTube = false;

            candidates.forEach(value => {
                const normalized = normalizeOrderFormat(value);
                if (normalized === 'vCAP') hasVcap = true;
                else if (normalized === 'Liyofilize') hasLiyofilize = true;
                else if (normalized === 'Tup') hasTube = true;
            });

            if (hasVcap) return 'vCAP';
            if (hasLiyofilize) return 'Liyofilize';
            if (hasTube) return 'Tup';
            return '';
        }

        function inferSalesLineFormat(catalogNo, description, rawFormat, matchedComponents = null) {
            const explicitFormat = normalizeOrderFormat(rawFormat);
            if (explicitFormat) return explicitFormat;

            const catalogKey = String(catalogNo || '').trim();
            const desc = String(description || '')
                .toLocaleUpperCase('tr')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');

            const formatFromComponents = detectFormatFromComponents(catalogKey, Array.isArray(matchedComponents) ? matchedComponents : []);
            if (formatFromComponents) return formatFromComponents;

            if (catalogKey && window.productTree) {
                const direct = window.productTree[catalogKey] || window.productTree[catalogKey.toUpperCase()];
                if (Array.isArray(direct) && direct.length > 0) {
                    const directFormat = detectFormatFromComponents(catalogKey, direct);
                    if (directFormat) return directFormat;
                }

                const matchedKey = Object.keys(window.productTree).find(key => key.toLowerCase() === catalogKey.toLowerCase());
                if (matchedKey && Array.isArray(window.productTree[matchedKey])) {
                    const matchedFormat = detectFormatFromComponents(catalogKey, window.productTree[matchedKey]);
                    if (matchedFormat) return matchedFormat;
                }
            }

            if (desc.includes('STRIP MIC') || desc.includes('TUP (MIC)')) return 'vCAP';
            if (desc.includes('STRIP BIO')) return 'Liyofilize';
            if (desc.includes('TUP') || desc.includes('UL') || desc.includes('TUBE')) return 'Tup';
            return '';
        }

        function normalizeSalesLineDate(value) {
            if (!value) return '';
            if (value instanceof Date && !isNaN(value.getTime())) {
                return [
                    value.getFullYear(),
                    String(value.getMonth() + 1).padStart(2, '0'),
                    String(value.getDate()).padStart(2, '0')
                ].join('-');
            }
            const direct = String(value).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (direct) {
                return `${direct[1]}-${String(direct[2]).padStart(2, '0')}-${String(direct[3]).padStart(2, '0')}`;
            }
            const date = new Date(value);
            if (isNaN(date.getTime())) return '';
            return [
                date.getFullYear(),
                String(date.getMonth() + 1).padStart(2, '0'),
                String(date.getDate()).padStart(2, '0')
            ].join('-');
        }

        function addDaysToDateOnly(dateText, days) {
            if (!dateText) return '';
            const match = String(dateText).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (!match) return '';
            const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            date.setDate(date.getDate() + days);
            return [
                date.getFullYear(),
                String(date.getMonth() + 1).padStart(2, '0'),
                String(date.getDate()).padStart(2, '0')
            ].join('-');
        }

        function getSalesLineRequestDate(salesOrder) {
            const today = new Date();
            return [
                today.getFullYear(),
                String(today.getMonth() + 1).padStart(2, '0'),
                String(today.getDate()).padStart(2, '0')
            ].join('-');
        }

        function getSalesLinesOrders() {
            try {
                const raw = localStorage.getItem(getSalesLinesStorageKey());
                if (!raw) return [];
                const payload = JSON.parse(raw);
                return Array.isArray(payload.allOrders) ? payload.allOrders : [];
            } catch (error) {
                console.error('Sales lines read error:', error);
                return [];
            }
        }

        let salesLinesSyncPromise = null;

        async function syncSalesLinesToOrders(options = {}) {
            if (!options || options.forceLegacyAutoSync !== true) {
                return 0;
            }
            if (salesLinesSyncPromise) {
                return salesLinesSyncPromise;
            }

            salesLinesSyncPromise = (async () => {
                try {
                    const raw = localStorage.getItem(getSalesLinesStorageKey());
                    if (!raw) return 0;

                    const payload = JSON.parse(raw);
                    return await syncSalesLinesPayloadToOrders(payload, options);
                } catch (error) {
                    console.error('Sales lines to orders sync error:', error);
                    return 0;
                } finally {
                    salesLinesSyncPromise = null;
                }
            })();

            return salesLinesSyncPromise;
        }

        function findProductTreeComponentsByCatalog(catalogNo) {
            if (!catalogNo || !window.productTree) return null;

            const normalizedCatalogNo = String(catalogNo).trim();
            if (!normalizedCatalogNo) return null;

            const directMatch =
                window.productTree[normalizedCatalogNo] ||
                window.productTree[normalizedCatalogNo.toUpperCase()];

            if (Array.isArray(directMatch) && directMatch.length > 0) {
                return directMatch;
            }

            const matchedKey = Object.keys(window.productTree).find(
                key => String(key).trim().toLowerCase() === normalizedCatalogNo.toLowerCase()
            );

            if (!matchedKey) return null;

            const matchedComponents = window.productTree[matchedKey];
            return Array.isArray(matchedComponents) && matchedComponents.length > 0 ? matchedComponents : null;
        }

        function normalizeSalesLineWeekNumber(value) {
            if (value === undefined || value === null || value === '') return '';
            const rawValue = String(value).trim();
            const weekMatch = rawValue.match(/\d+/);
            return weekMatch ? weekMatch[0] : rawValue;
        }

        async function createRequestsFromSalesLine(salesOrder, options = {}) {
            if (!salesOrder || typeof salesOrder !== 'object') {
                return { requestIds: [], message: 'Satış satırı bulunamadı.' };
            }

            if (!window.productTree || Object.keys(window.productTree).length === 0) {
                return { requestIds: [], message: 'Ürün ağacı yüklenmediği için talep oluşturulamadı.' };
            }

            const externalId = salesOrder._id || `${salesOrder['Hafta'] || ''}-${salesOrder['Belge No'] || ''}-${salesOrder['No'] || ''}`;
            const catalogNo = String(salesOrder['No'] || '').trim();
            const description = String(salesOrder['Açıklama'] || salesOrder['Müşteri'] || '').trim();
            const quantity = parseFloat(salesOrder['Bekleyen Miktar'] || salesOrder['Miktar'] || 0) || 1;
            const orderNo = String(salesOrder['Belge No'] || '').trim();
            const weekNumber = normalizeSalesLineWeekNumber(salesOrder['Hafta']);
            const requestDate = getSalesLineRequestDate(salesOrder);
            const deliveryDate = addDaysToDateOnly(requestDate, 21) || '';
            const requester = getActiveUserParaf('Satış');

            if (!externalId || (!catalogNo && !description)) {
                return { requestIds: [], message: 'Bu satış satırı için talep oluşturacak katalog bilgisi yok.' };
            }

            const createdOrders = [];
            let createdUnmatchedOrder = false;
            const matchedComponents = findProductTreeComponentsByCatalog(catalogNo);

            if (Array.isArray(matchedComponents) && matchedComponents.length > 0) {
                matchedComponents.forEach(component => {
                    const materialNo = String(component.materialNo || '').trim();
                    const format = resolveComponentFormat(component, catalogNo);
                    const sourceExternalId = `${externalId}::${materialNo || catalogNo || description}::${format || 'unknown'}`;
                    const createdOrder = createOrderEntry({
                        weekNumber,
                        requestDate,
                        deliveryDate,
                        requester,
                        catalogNo: catalogNo || description,
                        materialNo,
                        rxnName: component.rxnName || description || catalogNo,
                        quantity: '',
                        plannedRxnQty: Math.ceil(quantity * (Number(component.multiplier) || 1)),
                        orderNo,
                        format,
                        requesterNote: '',
                        productionOrderNo: '',
                        linkedSalesOrderIds: [externalId],
                        sourceSystem: 'sales-lines',
                        salesLineRequestMode: 'manual',
                        sourceExternalId
                    });
                    if (createdOrder) createdOrders.push(createdOrder);
                });
            } else {
                const createdOrder = createOrderEntry({
                    weekNumber,
                    requestDate,
                    deliveryDate,
                    requester,
                    catalogNo: catalogNo || description,
                    materialNo: '',
                    rxnName: '',
                    quantity: '',
                    plannedRxnQty: quantity,
                    orderNo,
                    format: '',
                    requesterNote: 'Karşılığı olmayan ürün',
                    productionOrderNo: '',
                    linkedSalesOrderIds: [externalId],
                    sourceSystem: 'sales-lines',
                    salesLineRequestMode: 'manual',
                    sourceExternalId: `${externalId}::${catalogNo || description}::unmatched`
                });
                if (createdOrder) createdOrders.push(createdOrder);
                if (createdOrder) createdUnmatchedOrder = true;
            }

            if (createdOrders.length === 0) {
                return { requestIds: [], message: 'Bu satış satırı için talep oluşturulamadı.' };
            }

            if (!options.deferCommit) {
                dedupeSalesLineOrdersInMemory();
                await Promise.resolve(saveOrders());
                if (typeof updateWeekFilterOptions === 'function') updateWeekFilterOptions();
                if (typeof renderDashboard === 'function') renderDashboard();
                if (typeof renderWeekSidebar === 'function') renderWeekSidebar();
                if (typeof applyRequestFilters === 'function') applyRequestFilters();
                if (typeof renderCurrentView === 'function') renderCurrentView();
                if (typeof renderOrders === 'function') renderOrders();
            }

            return {
                requestIds: createdOrders.map(order => order.id),
                unmatched: createdUnmatchedOrder,
                message: createdOrders.length === 1
                    ? 'Satış satırı için 1 talep oluşturuldu.'
                    : `Satış satırı için ${createdOrders.length} talep oluşturuldu.`
            };
        }

        async function createRequestsFromSalesLinesBulk(salesOrders) {
            if (!Array.isArray(salesOrders) || salesOrders.length === 0) {
                return { results: [], requestIds: [], successCount: 0, skippedCount: 0, message: 'Toplu talep için satır bulunamadı.' };
            }

            const results = [];
            const allRequestIds = [];
            let successCount = 0;
            let skippedCount = 0;

            for (const salesOrder of salesOrders) {
                const result = await createRequestsFromSalesLine(salesOrder, { deferCommit: true });
                const linkedRequestIds = Array.isArray(result?.requestIds)
                    ? result.requestIds.map(id => String(id || '').trim()).filter(Boolean)
                    : [];

                if (linkedRequestIds.length > 0) {
                    successCount += 1;
                    allRequestIds.push(...linkedRequestIds);
                } else {
                    skippedCount += 1;
                }

                results.push({
                    externalId: salesOrder?._id || '',
                    requestIds: linkedRequestIds,
                    unmatched: !!result?.unmatched,
                    message: result?.message || ''
                });
            }

            dedupeSalesLineOrdersInMemory();
            await Promise.resolve(saveOrders());
            if (typeof updateWeekFilterOptions === 'function') updateWeekFilterOptions();
            if (typeof renderDashboard === 'function') renderDashboard();
            if (typeof renderWeekSidebar === 'function') renderWeekSidebar();
            if (typeof applyRequestFilters === 'function') applyRequestFilters();
            if (typeof renderOrders === 'function') renderOrders();

            return {
                results,
                requestIds: allRequestIds,
                successCount,
                skippedCount,
                message: `${successCount} satış satırı için ${allRequestIds.length} talep oluşturuldu.`
            };
        }

        async function resetRequestsFromSalesLine(salesOrder, options = {}) {
            const externalId = String(salesOrder?._id || salesOrder?.id || '').trim();
            const requestIds = Array.isArray(options.requestIds)
                ? options.requestIds.map(id => String(id || '').trim()).filter(Boolean)
                : [];

            if (!externalId && requestIds.length === 0) {
                return { removedCount: 0, message: 'Geri alınacak talep bağlantısı bulunamadı.' };
            }

            const requestIdSet = new Set(requestIds);
            const beforeCount = Array.isArray(orders) ? orders.length : 0;
            orders = (Array.isArray(orders) ? orders : []).filter(order => {
                if (!order || order.sourceSystem !== 'sales-lines') return true;
                const orderId = String(order.id || '').trim();
                const linkedIds = Array.isArray(order.linkedSalesOrderIds)
                    ? order.linkedSalesOrderIds.map(id => String(id || '').trim())
                    : [];
                const sourceExternalId = String(order.sourceExternalId || '').trim();

                if (requestIdSet.has(orderId)) return false;
                if (externalId && linkedIds.includes(externalId)) return false;
                if (externalId && sourceExternalId.startsWith(`${externalId}::`)) return false;
                return true;
            });

            const removedCount = beforeCount - orders.length;
            if (removedCount > 0) {
                await Promise.resolve(saveOrders());
                if (typeof updateWeekFilterOptions === 'function') updateWeekFilterOptions();
                if (typeof renderDashboard === 'function') renderDashboard();
                if (typeof renderWeekSidebar === 'function') renderWeekSidebar();
                if (typeof applyRequestFilters === 'function') applyRequestFilters();
                if (typeof renderOrders === 'function') renderOrders();
            }

            return {
                removedCount,
                message: removedCount > 0
                    ? `${removedCount} talep geri alındı.`
                    : 'Silinecek talep satırı bulunamadı; satış satırı bağlantısı temizlendi.'
            };
        }
        window.resetRequestsFromSalesLine = resetRequestsFromSalesLine;

        let syncPayloadToOrdersPromise = null;

        async function syncSalesLinesPayloadToOrders(payload, options = {}) {
            if (!options || options.forceLegacyAutoSync !== true) {
                return 0;
            }
            const payloadSignature = getSalesLinesPayloadSignature(payload);
            const hasExistingSalesLineOrders = Array.isArray(orders) && orders.some(order => order && order.sourceSystem === 'sales-lines');

            if (payloadSignature && payloadSignature === lastAppliedSalesLinesPayloadSignature && hasExistingSalesLineOrders) {
                return 0;
            }

            // Eş zamanlı çift çağrı koruması: aynı anda iki sync başlamaması için beklet
            if (syncPayloadToOrdersPromise) {
                return syncPayloadToOrdersPromise;
            }

            syncPayloadToOrdersPromise = _doSyncSalesLinesPayloadToOrders(payload, options, payloadSignature);
            try {
                return await syncPayloadToOrdersPromise;
            } finally {
                syncPayloadToOrdersPromise = null;
            }
        }

        async function _doSyncSalesLinesPayloadToOrders(payload, options = {}, payloadSignature = '') {
            try {
                const salesOrders = Array.isArray(payload.allOrders) ? payload.allOrders : [];
                if (!window.productTree || Object.keys(window.productTree).length === 0) {
                    const retryCount = Number(options.retryCount || 0);
                    if (retryCount < 6) {
                        setTimeout(() => {
                            syncSalesLinesPayloadToOrders(payload, { ...options, silent: true, retryCount: retryCount + 1 })
                                .catch(error => console.warn('Sales lines retry hatası:', error));
                        }, 250);
                    }
                    if (!options.silent) {
                        showToast('Ürün ağacı yüklenmediği için satış satırları taleplere çevrilemedi.', 'warning');
                    }
                    return 0;
                }

                orders = orders.filter(order => order.sourceSystem !== 'sales-lines');

                const componentMap = {};
                const formatFallbackMap = {};
                const unmatchedMap = {};

                salesOrders.forEach((salesOrder) => {
                    const externalId = salesOrder._id || `${salesOrder['Hafta'] || ''}-${salesOrder['Belge No'] || ''}-${salesOrder['No'] || ''}`;
                    if (!externalId) return;

                    const catalogNo = String(salesOrder['No'] || '').trim();
                    const quantity = parseFloat(salesOrder['Bekleyen Miktar'] || salesOrder['Miktar'] || 0) || 1;
                    const description = String(salesOrder['Açıklama'] || salesOrder['Açıklama'] || salesOrder['Müşteri'] || salesOrder['Müşteri'] || '').trim();
                    const requester = getActiveUserParaf('Satış');

                    if (!catalogNo && !description) return;

                    const weekNumber = normalizeSalesLineWeekNumber(salesOrder['Hafta']);
                    const requestDate = getSalesLineRequestDate(salesOrder);
                    const deliveryDate = addDaysToDateOnly(requestDate, 21) || '';
                    const orderNo = String(salesOrder['Belge No'] || '').trim();
                    const matchedComponents = findProductTreeComponentsByCatalog(catalogNo);

                    if (!matchedComponents) {
                        const inferredFormat = inferSalesLineFormat(
                            catalogNo,
                            description,
                            salesOrder['Format'] || salesOrder['format'] || salesOrder['Ürün Formatı'] || salesOrder['Urun Formati']
                        );

                        // Gruplama: aynı katalog + aynı hafta tek satırda toplansın
                        const fallbackKey = `${weekNumber || 'none'}::${catalogNo || description}`;
                        if (inferredFormat) {
                            if (!formatFallbackMap[fallbackKey]) {
                                formatFallbackMap[fallbackKey] = {
                                    weekNumber,
                                    requestDate,
                                    deliveryDate,
                                    requester,
                                    catalogNo: catalogNo || description,
                                    quantity: 0,
                                    orderNos: new Set(),
                                    linkedSalesOrderIds: new Set(),
                                    format: inferredFormat
                                };
                            }

                            formatFallbackMap[fallbackKey].quantity += quantity;
                            if (orderNo) formatFallbackMap[fallbackKey].orderNos.add(orderNo);
                            formatFallbackMap[fallbackKey].linkedSalesOrderIds.add(externalId);
                            return;
                        }

                        if (!unmatchedMap[fallbackKey]) {
                            unmatchedMap[fallbackKey] = {
                                weekNumber,
                                requestDate,
                                deliveryDate,
                                requester,
                                catalogNo: catalogNo || description,
                                quantity: 0,
                                orderNos: new Set(),
                                linkedSalesOrderIds: new Set()
                            };
                        }

                        unmatchedMap[fallbackKey].quantity += quantity;
                        if (orderNo) unmatchedMap[fallbackKey].orderNos.add(orderNo);
                        unmatchedMap[fallbackKey].linkedSalesOrderIds.add(externalId);
                        return;
                    }

                    matchedComponents.forEach((component) => {
                        const materialNo = component.materialNo || '';
                        const componentFormat = resolveComponentFormat(component, catalogNo);
                        // Gruplama: aynı hafta + aynı madde no (+format) tek satırda toplansın
                        const groupKey = `${weekNumber || 'none'}::${materialNo || description}::${componentFormat || 'unknown'}`;

                        if (!componentMap[groupKey]) {
                            componentMap[groupKey] = {
                                weekNumber,
                                requestDate,
                                deliveryDate,
                                requesterSet: new Set(),
                                catalogNos: new Set(),
                                orderNos: new Set(),
                                linkedSalesOrderIds: new Set(),
                                materialNo,
                                rxnName: component.rxnName || description || catalogNo,
                                format: componentFormat,
                                quantity: 0
                            };
                        }

                        componentMap[groupKey].quantity += Math.ceil(quantity * (Number(component.multiplier) || 1));
                        componentMap[groupKey].requesterSet.add(requester);
                        if (catalogNo || description) componentMap[groupKey].catalogNos.add(catalogNo || description);
                        if (orderNo) componentMap[groupKey].orderNos.add(orderNo);
                        componentMap[groupKey].linkedSalesOrderIds.add(externalId);
                        if (!componentMap[groupKey].deliveryDate && deliveryDate) componentMap[groupKey].deliveryDate = deliveryDate;
                        if (requestDate && componentMap[groupKey].requestDate > requestDate) componentMap[groupKey].requestDate = requestDate;
                    });
                });

                let addedCount = 0;
                const unmatchedCount = Object.keys(unmatchedMap).length;

                Object.entries(componentMap).forEach(([groupKey, item]) => {
                    createOrderEntry({
                        weekNumber: item.weekNumber,
                        requestDate: item.requestDate,
                        deliveryDate: item.deliveryDate,
                        requester: getActiveUserParaf(''),
                        catalogNo: Array.from(item.catalogNos).join(', '),
                        materialNo: item.materialNo,
                        rxnName: item.rxnName,
                        quantity: '',
                        plannedRxnQty: item.quantity,
                        orderNo: Array.from(item.orderNos).join(', '),
                        format: item.format,
                        requesterNote: '',
                        productionOrderNo: '',
                        linkedSalesOrderIds: Array.from(item.linkedSalesOrderIds),
                        sourceSystem: 'sales-lines',
                        sourceExternalId: groupKey
                    });
                    addedCount++;
                });

                Object.entries(formatFallbackMap).forEach(([groupKey, item]) => {
                    createOrderEntry({
                        weekNumber: item.weekNumber,
                        requestDate: item.requestDate,
                        deliveryDate: item.deliveryDate,
                        requester: getActiveUserParaf(''),
                        catalogNo: item.catalogNo,
                        materialNo: '',
                        rxnName: item.catalogNo,
                        quantity: '',
                        plannedRxnQty: item.quantity,
                        orderNo: Array.from(item.orderNos).join(', '),
                        format: item.format,
                        requesterNote: '',
                        productionOrderNo: '',
                        linkedSalesOrderIds: Array.from(item.linkedSalesOrderIds),
                        sourceSystem: 'sales-lines',
                        sourceExternalId: `${groupKey}::format`
                    });
                    addedCount++;
                });

                Object.entries(unmatchedMap).forEach(([groupKey, item]) => {
                    createOrderEntry({
                        weekNumber: item.weekNumber,
                        requestDate: item.requestDate,
                        deliveryDate: item.deliveryDate,
                        requester: getActiveUserParaf(''),
                        catalogNo: item.catalogNo,
                        materialNo: '',
                        rxnName: '',
                        quantity: '',
                        plannedRxnQty: item.quantity,
                        orderNo: Array.from(item.orderNos).join(', '),
                        format: '',
                        requesterNote: 'Karşılığı olmayan ürün',
                        productionOrderNo: '',
                        linkedSalesOrderIds: Array.from(item.linkedSalesOrderIds),
                        sourceSystem: 'sales-lines',
                        sourceExternalId: `${groupKey}::unmatched`
                    });
                    addedCount++;
                });

                dedupeSalesLineOrdersInMemory();

                if (!options.skipPersist && typeof saveOrders === 'function') {
                    await saveOrders();
                }
                renderWeekSidebar();
                applyRequestFilters();
                renderDashboard();

                if (!options.silent && addedCount > 0) {
                    const unmatchedText = unmatchedCount > 0 ? ` ${unmatchedCount} kayıt karşılığı olmayanlara alındı.` : '';
                    showToast(`Satış satırları ${addedCount} talep satırı olarak işlendi.${unmatchedText}`, 'success');
                }

                if (payloadSignature) {
                    lastAppliedSalesLinesPayloadSignature = payloadSignature;
                }

                return addedCount;
            } catch (error) {
                console.error('Sales lines to orders sync error:', error);
                return 0;
            }
        }

        // Editable Cell Logic
        // Editable Cell Logic - Floating Textarea
        function makeEditable(cell, orderId, colId, type) {
            if (cell.querySelector('.editable-textarea') || cell.querySelector('input') || cell.querySelector('select')) return;

            const editOrder = orders.find(item => String(item.id) === String(orderId));
            if (editOrder) activeRequestEditBaseMeta[String(orderId)] = getOrderBaseMeta(editOrder);
            const currentValue = cell.innerText;
            const isDetailItem = cell.classList.contains('editable-detail');

            if (colId === 'materialNo') {
                ensureRequestMaterialNoOptions();
                cell.style.overflow = 'visible';
                cell.innerHTML = `<input type="text" class="editable-input" list="requestMaterialNoOptions" autocomplete="off" value="${esc(currentValue === '-' ? '' : currentValue)}" style="width: 100%; position: absolute; top:0; left:0; height:100%; z-index:100;">`;
                const input = cell.querySelector('input');
                if (input) {
                    input.addEventListener('blur', () => saveCell(orderId, colId, input.value));
                    input.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            input.blur();
                        }
                    });
                    input.focus();
                    input.select();
                }
                return;
            }

            // For date/number inputs, keep simple inputs but prevent layout shift
            // For text, use expanding textarea

            let isText = (colId !== 'quantity' && colId !== 'weekNumber' && type !== 'date');

            if (isText) {
                // Textarea Logic
                // 1. Allow overflow on cell
                cell.style.overflow = 'visible';

                // 2. Create textarea
                const textarea = document.createElement('textarea');
                textarea.className = isDetailItem ? 'editable-textarea detail-textarea' : 'editable-textarea';
                textarea.value = currentValue === '-' ? '' : currentValue;

                // 3. Auto-expand on input
                textarea.addEventListener('input', function () {
                    this.style.height = 'auto';
                    this.style.height = (this.scrollHeight) + 'px';
                });

                // 4. Save events
                textarea.addEventListener('blur', function () {
                    saveCell(orderId, colId, this.value);
                    cell.style.overflow = 'hidden'; // Restore clip
                });

                textarea.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.blur();
                    }
                });

                if (isDetailItem) {
                    // For detail items, replace content instead of appending overlay
                    cell.textContent = '';
                }
                cell.appendChild(textarea);
                textarea.focus();
                // Initial resize
                textarea.style.height = 'auto';
                textarea.style.height = (textarea.scrollHeight) + 'px';

            } else {
                // Simple Input Logic (Date/Number)
                let inputType = 'text';
                if (type === 'date') inputType = 'date';
                if (isQuantityColumn(colId) || colId === 'weekNumber') inputType = 'number';

                let inputHtml = '';
                if (inputType === 'date') {
                    // Try to parse DD.MM.YYYY
                    const parts = currentValue.split('.');
                    let dateVal = '';
                    if (parts.length === 3) dateVal = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    inputHtml = `<input type="date" class="editable-input" value="${dateVal}" style="width: 100%; position: absolute; top:0; left:0; height:100%; z-index:100;" onblur="saveCell('${orderId}', '${colId}', this.value)" onkeydown="if(event.key==='Enter') this.blur()">`;
                } else {
                    inputHtml = `<input type="${inputType}" class="editable-input" value="${currentValue}" style="width: 100%; position: absolute; top:0; left:0; height:100%; z-index:100;" onblur="saveCell('${orderId}', '${colId}', this.value)" onkeydown="if(event.key==='Enter') this.blur()">`;
                }

                cell.style.overflow = 'visible';
                cell.innerHTML = inputHtml; // Replace content for inputs is fine as they don't overlay
                const input = cell.querySelector('input');
                if (input) input.focus();
            }
        }

        // Detay satırı alanları - bu alanlarda düzenleme yapınca tablo yeniden render olmaz
        const detailFields = ['qcNote', 'qcApprover', 'componentLots', 'pcStripContent'];

        function saveCell(orderId, colId, value) {
            const order = orders.find(o => o.id === orderId);
            if (!order) return;
            const baseMeta = activeRequestEditBaseMeta[String(orderId)] || getOrderBaseMeta(order);
            delete activeRequestEditBaseMeta[String(orderId)];

            // Trim
            const cleanVal = typeof value === 'string' ? value.trim() : value;

            const isDetailField = detailFields.includes(colId);

            // Scroll pozisyonunu kaydet
            const tbody = document.getElementById('ordersTableBody');
            const tableContainer = tbody ? tbody.closest('.table-container') : null;
            const scrollTop = tableContainer ? tableContainer.scrollTop : 0;
            const scrollLeft = tableContainer ? tableContainer.scrollLeft : 0;
            const pageScrollY = window.scrollY;

            // Only save if changed
            if (String(order[colId] || '') === String(cleanVal) && cleanVal !== '') {
                if (isDetailField) {
                    // Detay alanı: sadece span metnini geri yükle, tabloyu yeniden render etme
                    const detailRow = document.getElementById(`detail-${orderId}`);
                    if (detailRow) {
                        const spans = detailRow.querySelectorAll('.editable-detail');
                        spans.forEach(span => {
                            const textarea = span.querySelector('textarea');
                            if (textarea) {
                                span.textContent = cleanVal || '-';
                                span.onclick = function () { event.stopPropagation(); makeEditable(this, orderId, colId, 'text'); };
                            }
                        });
                    }
                } else {
                    if (shouldPatchOrderEditInPlace(colId) && patchRenderedOrderRow(orderId)) {
                        requestAnimationFrame(() => {
                            if (tableContainer) { tableContainer.scrollTop = scrollTop; tableContainer.scrollLeft = scrollLeft; }
                            window.scrollTo(0, pageScrollY);
                        });
                    } else {
                        applyRequestFilters();
                        requestAnimationFrame(() => {
                            if (tableContainer) { tableContainer.scrollTop = scrollTop; tableContainer.scrollLeft = scrollLeft; }
                            window.scrollTo(0, pageScrollY);
                        });
                    }
                }
                return;
            }

            // Değişiklik geçmişi kaydet
            if (!order.changeHistory) order.changeHistory = [];
            const colLabel = (currentColumns.find(c => c.id === colId) || {}).label || colId;
            order.changeHistory.push({
                field: colLabel,
                oldValue: order[colId] || '',
                newValue: cleanVal,
                changedBy: getActiveUserParaf('Bilinmiyor'),
                changedAt: new Date().toISOString()
            });

            order[colId] = cleanVal;

            if (colId === 'materialNo') {
                applyMaterialLookupToOrder(order, cleanVal);
            }

            // Talep tarihi değişince planlanan bitişi otomatik 2 hafta sonrasına al.
            if (colId === 'requestDate' && cleanVal) {
                const newPlannedEndDate = addDaysToDateOnly(cleanVal, 14);
                if (newPlannedEndDate && order.plannedEndDate !== newPlannedEndDate) {
                    order.changeHistory.push({
                        field: 'Planlanan Bitiş',
                        oldValue: order.plannedEndDate || '',
                        newValue: newPlannedEndDate,
                        changedBy: getActiveUserParaf('Sistem'),
                        changedAt: new Date().toISOString()
                    });
                    order.plannedEndDate = newPlannedEndDate;
                }
            }

            order.lastModifiedBy = getActiveUserParaf(order.lastModifiedBy || '');
            order.lastModifiedAt = new Date().toISOString();

            // Save data to storage/Firebase
            scheduleRequestOrderSave(orderId, baseMeta, { reason: 'request-cell-edit' });

            if (isDetailField) {
                // Detay alanı: sadece span metnini güncelle, tabloyu yeniden render etme
                const detailRow = document.getElementById(`detail-${orderId}`);
                if (detailRow) {
                    const spans = detailRow.querySelectorAll('.editable-detail');
                    spans.forEach(span => {
                        const textarea = span.querySelector('textarea');
                        if (textarea) {
                            span.textContent = cleanVal || '-';
                            span.onclick = function () { event.stopPropagation(); makeEditable(this, orderId, colId, 'text'); };
                        }
                    });
                }
            } else {
                if (!(shouldPatchOrderEditInPlace(colId) && patchRenderedOrderRow(orderId))) {
                    applyRequestFilters();
                }
                renderDashboard();
            }

            // Scroll pozisyonunu geri yükle
            requestAnimationFrame(() => {
                const tc = document.getElementById('ordersTableBody')?.closest('.table-container');
                if (tc) { tc.scrollTop = scrollTop; tc.scrollLeft = scrollLeft; }
                window.scrollTo(0, pageScrollY);
            });
        }

        // Render Table Header (Clean - No Inputs)
        // Sort state: { colId: string, direction: 'asc'|'desc'|'none' }
        let activeSortState = { colId: null, direction: 'none' };

        function toggleColumnSort(colId) {
            if (activeSortState.colId === colId) {
                // Cycle: asc -> desc -> none
                if (activeSortState.direction === 'asc') {
                    activeSortState.direction = 'desc';
                } else if (activeSortState.direction === 'desc') {
                    activeSortState.direction = 'none';
                    activeSortState.colId = null;
                } else {
                    activeSortState.direction = 'asc';
                }
            } else {
                activeSortState.colId = colId;
                activeSortState.direction = 'asc';
            }
            renderTableHeader();
            applyRequestFilters();
        }

        function sortOrders(ordersToSort) {
            if (!activeSortState.colId || activeSortState.direction === 'none') return ordersToSort;

            const colId = activeSortState.colId;
            const dir = activeSortState.direction === 'asc' ? 1 : -1;

            return [...ordersToSort].sort((a, b) => {
                let valA = a[colId] || '';
                let valB = b[colId] || '';

                // Check if numeric
                const numA = parseFloat(valA);
                const numB = parseFloat(valB);

                if (!isNaN(numA) && !isNaN(numB)) {
                    return (numA - numB) * dir;
                }

                // Date columns
                if (colId === 'requestDate' || colId === 'deliveryDate') {
                    const dA = new Date(valA || '1970-01-01');
                    const dB = new Date(valB || '1970-01-01');
                    return (dA - dB) * dir;
                }

                // String comparison
                return String(valA).localeCompare(String(valB), 'tr') * dir;
            });
        }

        // Status filter state (multi-select)
        let activeStatusFilters = new Set(); // empty = show all

        function toggleStatusFilter(status) {
            if (activeStatusFilters.has(status)) {
                activeStatusFilters.delete(status);
            } else {
                activeStatusFilters.add(status);
            }
            applyRequestFilters();
            renderTableHeader(); // re-render to update checkbox states
        }

        function clearStatusFilters() {
            activeStatusFilters.clear();
            applyRequestFilters();
            renderTableHeader();
        }

        function openOrdersStatusFilter(event) {
            closeOrdersColFilter();

            const allStatuses = ORDER_STATUS_OPTIONS.map(status => ({ value: status, label: status }));

            const th = event && event.target ? event.target.closest('th') : null;
            if (!th) return;
            const rect = th.getBoundingClientRect();
            const isFiltered = activeStatusFilters.size > 0;

            const popup = document.createElement('div');
            popup.className = 'orders-col-filter-popup';
            popup.id = 'ordersColFilterPopup';

            let left = rect.left;
            if (left + 300 > window.innerWidth) left = Math.max(12, window.innerWidth - 312);
            popup.style.top = (rect.bottom + 4) + 'px';
            popup.style.left = left + 'px';

            popup.innerHTML = `
                <div class="cfp-header">
                    <input class="cfp-search" type="text" placeholder="Ara..." oninput="filterOrdersPopupSearch(this.value)">
                </div>
                <div class="cfp-list" id="ordersCfpList">
                    <div class="cfp-item cfp-select-all">
                        <input type="checkbox" id="ordersStatusCfpSelectAll" onchange="ordersStatusCfpToggleAll(this.checked)" ${!isFiltered ? 'checked' : ''}>
                        <label for="ordersStatusCfpSelectAll">Tümünü Seç</label>
                    </div>
                    ${allStatuses.map((s, i) => {
                        const checked = !isFiltered || activeStatusFilters.has(s.value);
                        return `<div class="cfp-item" data-val="${esc(s.value)}">
                            <input type="checkbox" id="orders_status_cfp_${i}" data-value="${esc(s.value)}" ${checked ? 'checked' : ''} onchange="syncOrdersPopupSelectAllState('ordersStatusCfpSelectAll','ordersCfpList')">
                            <label for="orders_status_cfp_${i}" title="${esc(s.label)}">${esc(s.label)}</label>
                        </div>`;
                    }).join('')}
                </div>
                <div class="cfp-footer">
                    <button class="btn btn-sm btn-primary" onclick="applyOrdersStatusColFilter()">Uygula</button>
                    <button class="btn btn-sm btn-secondary" onclick="clearStatusFilters(); closeOrdersColFilter();">Temizle</button>
                </div>
            `;

            document.body.appendChild(popup);
            activeOrdersFilterPopup = '_status_';
            popup.querySelector('.cfp-search').focus();
            syncOrdersPopupSelectAllState('ordersStatusCfpSelectAll', 'ordersCfpList');
            attachOrdersPopupKeyboardHandlers(
                popup,
                () => applyOrdersStatusColFilter(),
                () => closeOrdersColFilter()
            );
        }

        function ordersStatusCfpToggleAll(checked) {
            document.querySelectorAll('#ordersCfpList .cfp-item[data-val] input[type=checkbox]').forEach(cb => {
                if (cb.closest('.cfp-item').style.display !== 'none') cb.checked = checked;
            });
            syncOrdersPopupSelectAllState('ordersStatusCfpSelectAll', 'ordersCfpList');
        }

        function applyOrdersStatusColFilter() {
            const searchValue = String(document.querySelector('#ordersColFilterPopup .cfp-search')?.value || '').trim();
            const checkboxes = Array.from(document.querySelectorAll('#ordersCfpList .cfp-item[data-val] input[type=checkbox]'))
                .filter(cb => !searchValue || cb.closest('.cfp-item')?.style.display !== 'none');
            const total = checkboxes.length;
            const checked = [];
            checkboxes.forEach(cb => { if (cb.checked) checked.push(cb.dataset.value); });

            activeStatusFilters.clear();
            if (checked.length > 0 && (searchValue || checked.length < total)) {
                checked.forEach(v => activeStatusFilters.add(v));
            }

            closeOrdersColFilter();
            applyRequestFilters();
            renderTableHeader();
        }

        function handleOrdersHeaderFilterClick(event, button) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            }

            if (!button) return;

            const filterType = button.dataset.filterType;
            const colId = button.dataset.filterButton;

            setTimeout(() => {
                const targetEvent = { target: button };
                if (filterType === 'status') openOrdersStatusFilter(targetEvent);
                else openOrdersColFilter(targetEvent, colId);
            }, 0);
        }

        function renderOrdersTableColGroup(safeColumns) {
            const colGroup = document.getElementById('ordersTableColGroup');
            const table = document.querySelector('#orders .excel-table');
            if (!colGroup || !table) return;

            const toPx = value => {
                const parsed = parseInt(String(value || '').replace('px', ''), 10);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
            };
            const widths = [58, ...safeColumns.map(col => toPx(col.width))];
            const totalWidth = widths.reduce((sum, width) => sum + width, 0);
            colGroup.innerHTML = widths.map(width => `<col style="width:${width}px;">`).join('');
            table.style.width = `${totalWidth}px`;
            table.style.minWidth = `${totalWidth}px`;
        }

        function renderTableHeader() {
            const thead = document.querySelector('#orders .excel-table thead');
            const safeColumns = getSafeColumns();
            renderOrdersTableColGroup(safeColumns);

            let html = '<tr class="filter-header-row">';
            html += `
                <th class="select-col" style="width: 58px;">
                    <input type="checkbox" id="ordersBulkSelectAll" class="orders-select-all-checkbox"
                        onclick="event.stopPropagation(); toggleAllVisibleOrders(this.checked)"
                        aria-label="Görünen satırları seç">
                </th>`;

            safeColumns.forEach((col, index) => {
                const modelIndex = currentColumns.findIndex(item => item.id === col.id);
                // Determine if this column has an active filter
                let hasFilter = false;
                if (col.type === 'status') {
                    hasFilter = activeStatusFilters.size > 0;
                } else {
                    hasFilter = ordersColFilters[col.id] instanceof Set && ordersColFilters[col.id].size > 0;
                }
                const filterClass = hasFilter ? 'active-filter' : '';

                html += `
                    <th draggable="true" style="width: ${col.width}" data-col="${col.id}" data-filter-col="${col.id}"
                        ondragstart="dragStart(event, ${modelIndex})"
                        ondragover="dragOver(event, ${modelIndex})"
                        ondragenter="dragEnter(event)"
                        ondragleave="dragLeave(event)"
                        ondrop="drop(event, ${modelIndex})">
                        <div class="orders-th-inner">
                            <span class="th-label orders-sort-trigger" data-sort-col="${col.id}">
                                <span class="orders-sort-label">${col.label}</span>
                            </span>
                            <span class="filter-icon ${filterClass}" data-filter-button="${col.id}" data-filter-type="${col.type || 'text'}" onclick="handleOrdersHeaderFilterClick(event,this)" title="Filtrele" aria-label="${col.label} filtresi" aria-expanded="${(col.type === 'status' && activeOrdersFilterPopup === '_status_') || activeOrdersFilterPopup === col.id ? 'true' : 'false'}">▼</span>
                        </div>
                        <span class="col-resizer" title="Sütun genişliğini değiştir" onmousedown="initResize(event, ${modelIndex})" ondblclick="resetOrderColumnWidth(event, ${modelIndex})"></span>
                    </th>
                `;
            });
            html += '</tr>';
            thead.innerHTML = html;

            thead.querySelectorAll('[data-sort-col]').forEach(trigger => {
                trigger.addEventListener('click', event => {
                    event.stopPropagation();
                    toggleColumnSort(trigger.dataset.sortCol);
                });
            });
            syncOrdersBulkSelectionUi();

        }

        function toggleStatusDropdown() {
            const dd = document.getElementById('statusFilterDropdown');
            if (dd) {
                dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
            }
        }

        function toggleOrdersColumnDropdown(colId) {
            activeOrdersColumnDropdown = activeOrdersColumnDropdown === colId ? null : colId;
            renderTableHeader();
        }

        function filterOrdersDropdownItems(colId, query) {
            const q = String(query || '').toLocaleLowerCase('tr');
            document.querySelectorAll(`.orders-filter-item[data-col="${colId}"]`).forEach(item => {
                const label = item.textContent.toLocaleLowerCase('tr');
                const value = String(item.dataset.value || '').toLocaleLowerCase('tr');
                item.style.display = (label.includes(q) || value.includes(q)) ? 'flex' : 'none';
            });
        }

        function toggleAllOrdersDropdownItems(colId, checked) {
            document.querySelectorAll(`input[type="checkbox"][data-col="${colId}"]`).forEach(cb => {
                const wrapper = cb.closest('.orders-filter-item');
                if (!wrapper || wrapper.style.display !== 'none') cb.checked = checked;
            });
        }

        function applyOrdersDropdownFilter(colId) {
            const checkboxes = document.querySelectorAll(`input[type="checkbox"][data-col="${colId}"]`);
            const total = checkboxes.length;
            const checkedValues = [];
            checkboxes.forEach(cb => {
                if (cb.checked) checkedValues.push(cb.dataset.value || '');
            });

            if (checkedValues.length === 0 || checkedValues.length === total) {
                delete ordersColFilters[colId];
            } else {
                ordersColFilters[colId] = new Set(checkedValues);
            }

            activeOrdersColumnDropdown = null;
            renderTableHeader();
            applyRequestFilters();
        }

        function clearOrdersDropdownFilter(colId) {
            delete ordersColFilters[colId];
            activeOrdersColumnDropdown = null;
            renderTableHeader();
            applyRequestFilters();
        }

        function openOrdersColFilter(event, colId) {
            closeOrdersColFilter();

            const th = event && event.target ? event.target.closest('th') : null;
            if (!th) return;

            const rect = th.getBoundingClientRect();
            const valSet = new Set();
            const candidateOrders = getFilteredOrdersForColumnValues(colId);
            candidateOrders.forEach(order => {
                valSet.add(getOrderFilterValue(order, colId));
            });

            const allValues = Array.from(valSet).sort((a, b) => compareOrderFilterValues(a, b, colId));
            const currentFilter = ordersColFilters[colId] instanceof Set ? ordersColFilters[colId] : new Set();
            const isFiltered = currentFilter.size > 0;

            const popup = document.createElement('div');
            popup.className = 'orders-col-filter-popup';
            popup.id = 'ordersColFilterPopup';

            let left = rect.left;
            if (left + 280 > window.innerWidth) left = Math.max(12, window.innerWidth - 292);
            popup.style.top = (rect.bottom + 4) + 'px';
            popup.style.left = left + 'px';

            popup.innerHTML = `
                <div class="cfp-header">
                    <input class="cfp-search" type="text" placeholder="Ara..." oninput="filterOrdersPopupSearch(this.value)">
                </div>
                <div class="cfp-list" id="ordersCfpList">
                    <div class="cfp-item cfp-select-all">
                        <input type="checkbox" id="ordersCfpSelectAll" onchange="ordersCfpToggleAll(this.checked)" ${!isFiltered ? 'checked' : ''}>
                        <label for="ordersCfpSelectAll">Tümünü Seç</label>
                    </div>
                    ${allValues.map((value, i) => {
                        const checked = !isFiltered || currentFilter.has(value);
                        const display = value || 'Boş';
                        return `<div class="cfp-item" data-val="${esc(String(value))}">
                            <input type="checkbox" id="orders_cfp_${i}" data-value="${esc(String(value))}" ${checked ? 'checked' : ''} onchange="syncOrdersSelectAllState()">
                            <label for="orders_cfp_${i}" title="${esc(String(display))}">${esc(String(display))}</label>
                        </div>`;
                    }).join('')}
                </div>
                <div class="cfp-footer">
                    <button class="btn btn-sm btn-primary" onclick="applyOrdersColFilter('${colId}')">Uygula</button>
                    <button class="btn btn-sm btn-secondary" onclick="clearOrdersColFilter('${colId}')">Temizle</button>
                </div>
            `;

            document.body.appendChild(popup);
            activeOrdersFilterPopup = colId;
            popup.querySelector('.cfp-search').focus();
            syncOrdersSelectAllState();
            attachOrdersPopupKeyboardHandlers(
                popup,
                () => applyOrdersColFilter(colId),
                () => closeOrdersColFilter()
            );
        }

        function filterOrdersPopupSearch(query) {
            const q = String(query || '').toLocaleLowerCase('tr');
            document.querySelectorAll('#ordersCfpList .cfp-item[data-val]').forEach(item => {
                const rawValue = (item.dataset.val || '').toLocaleLowerCase('tr');
                const label = item.querySelector('label')?.textContent?.toLocaleLowerCase('tr') || '';
                item.style.display = (rawValue.includes(q) || label.includes(q)) ? '' : 'none';
            });
            if (activeOrdersFilterPopup === '_status_') syncOrdersPopupSelectAllState('ordersStatusCfpSelectAll', 'ordersCfpList');
            else syncOrdersSelectAllState();
        }

        function ordersCfpToggleAll(checked) {
            document.querySelectorAll('#ordersCfpList .cfp-item[data-val] input[type=checkbox]').forEach(cb => {
                if (cb.closest('.cfp-item').style.display !== 'none') cb.checked = checked;
            });
            syncOrdersSelectAllState();
        }

        function applyOrdersColFilter(colId) {
            const searchValue = String(document.querySelector('#ordersColFilterPopup .cfp-search')?.value || '').trim();
            const checkboxes = Array.from(document.querySelectorAll('#ordersCfpList .cfp-item[data-val] input[type=checkbox]'))
                .filter(cb => !searchValue || cb.closest('.cfp-item')?.style.display !== 'none');
            const total = checkboxes.length;
            const checked = [];
            checkboxes.forEach(cb => {
                if (cb.checked) checked.push(cb.dataset.value || '');
            });

            if (checked.length === 0 || (!searchValue && checked.length === total)) {
                delete ordersColFilters[colId];
            } else {
                ordersColFilters[colId] = new Set(checked);
            }

            closeOrdersColFilter();
            renderTableHeader();
            applyRequestFilters();
        }

        function clearOrdersColFilter(colId) {
            delete ordersColFilters[colId];
            closeOrdersColFilter();
            renderTableHeader();
            applyRequestFilters();
        }

        function closeOrdersColFilter() {
            const popup = document.getElementById('ordersColFilterPopup');
            if (popup) popup.remove();
            activeOrdersFilterPopup = null;
        }

        window.handleOrdersHeaderFilterClick = handleOrdersHeaderFilterClick;
        window.openOrdersColFilter = openOrdersColFilter;
        window.openOrdersStatusFilter = openOrdersStatusFilter;
        window.applyOrdersColFilter = applyOrdersColFilter;
        window.clearOrdersColFilter = clearOrdersColFilter;
        window.applyOrdersStatusColFilter = applyOrdersStatusColFilter;
        window.closeOrdersColFilter = closeOrdersColFilter;
        window.filterOrdersPopupSearch = filterOrdersPopupSearch;
        window.ordersCfpToggleAll = ordersCfpToggleAll;
        window.ordersStatusCfpToggleAll = ordersStatusCfpToggleAll;
        window.syncOrdersSelectAllState = syncOrdersSelectAllState;
        window.syncOrdersPopupSelectAllState = syncOrdersPopupSelectAllState;

        document.addEventListener('click', (event) => {
            if (activeFinalProductFilterPopup && !event.target.closest('#finalProductColFilterPopup') && !event.target.closest('[data-final-product-filter]')) {
                closeFinalProductColFilter();
            }

            const filterButton = event.target.closest('#orders [data-filter-button]');
            if (filterButton) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
                handleOrdersHeaderFilterClick(event, filterButton);
                return;
            }

            const sortTrigger = event.target.closest('#orders [data-sort-col]');
            if (sortTrigger) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
                toggleColumnSort(sortTrigger.dataset.sortCol);
            }
        }, true);

        // Close status dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const dd = document.getElementById('statusFilterDropdown');
            if (dd && dd.style.display === 'block') {
                if (!e.target.closest('.status-filter-dropdown') && !e.target.closest('.col-filter-btn')) {
                    dd.style.display = 'none';
                }
            }

            if (activeOrdersColumnDropdown && !e.target.closest(`[id="ordersFilterDropdown_${activeOrdersColumnDropdown}"]`) && !e.target.closest('.col-filter-btn')) {
                activeOrdersColumnDropdown = null;
                renderTableHeader();
                return;
            }

            if (activeOrdersFilterPopup && !e.target.closest('#ordersColFilterPopup') && !e.target.closest('#orders th[data-filter-col]')) {
                closeOrdersColFilter();
            }
        });

        // Helper to get current col filters (Deprecated/Empty)
        function getFilters() {
            return {};
        }

        // Helper to get current filter values
        function getFilters() {
            const filters = {};
            document.querySelectorAll('.col-filter').forEach(input => {
                filters[input.dataset.col] = input.value;
            });
            return filters;
        }

        // Drag & Drop Functions
        let draggedColIndex = null;

        function dragStart(e, index) {
            if (e.target.closest('.col-resizer') || e.target.closest('.filter-icon')) {
                e.preventDefault();
                return;
            }
            draggedColIndex = index;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
            e.target.closest('th')?.classList.add('dragging');
        }

        function dragOver(e, index) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }

        function dragEnter(e) {
            e.preventDefault();
            e.target.closest('th')?.classList.add('drag-over');
        }

        function dragLeave(e) {
            e.target.closest('th')?.classList.remove('drag-over');
        }

        function drop(e, index) {
            e.preventDefault();
            document.querySelectorAll('#orders .excel-table th').forEach(th => {
                th.classList.remove('dragging');
                th.classList.remove('drag-over');
            });

            if (draggedColIndex === null || draggedColIndex === index) {
                draggedColIndex = null;
                return;
            }

            // Reorder columns
            const movedCol = currentColumns.splice(draggedColIndex, 1)[0];
            currentColumns.splice(index, 0, movedCol);
            draggedColIndex = null;

            // Save and Re-render
            localStorage.setItem('reaksiyon_column_order', JSON.stringify(currentColumns));
            renderTableHeader();
            applyRequestFilters(); // Re-render rows with new order and current filters
            showToast('Sütun yeri değiştirildi', 'info');
        }

        // Column Resizing Logic
        let resizingColIndex = null;
        let startX = 0;
        let startWidth = 0;

        function initResize(e, index) {
            // Prevent drag sorting when resizing
            e.stopPropagation();
            e.preventDefault();

            resizingColIndex = index;
            startX = e.pageX;
            const th = e.target.closest('th');
            startWidth = th.offsetWidth;

            document.addEventListener('mousemove', doResize);
            document.addEventListener('mouseup', stopResize);

            // Add visual class to header
            if (th) th.classList.add('resizing');
        }

        function doResize(e) {
            if (resizingColIndex === null) return;

            const diff = e.pageX - startX;
            const newWidth = Math.max(50, startWidth + diff); // Min width 50px

            // Update model
            currentColumns[resizingColIndex].width = newWidth + 'px';
            const visibleIndex = getSafeColumns().findIndex(col => col.id === currentColumns[resizingColIndex]?.id);

            const ths = document.querySelectorAll('#orders .excel-table th');
            // first th is empty icon col, so index + 1
            const targetTh = ths[visibleIndex + 1];
            if (targetTh) {
                targetTh.style.width = newWidth + 'px';
            }

            const colElement = document.querySelector(`#ordersTableColGroup col:nth-child(${visibleIndex + 2})`);
            if (colElement) colElement.style.width = newWidth + 'px';

            const table = document.querySelector('#orders .excel-table');
            if (table) {
                const widths = [58, ...getSafeColumns().map(col => parseInt(String(col.width || '120px'), 10) || 120)];
                const totalWidth = widths.reduce((sum, width) => sum + width, 0);
                table.style.width = `${totalWidth}px`;
                table.style.minWidth = `${totalWidth}px`;
            }
        }

        function stopResize(e) {
            if (resizingColIndex === null) return;

            document.removeEventListener('mousemove', doResize);
            document.removeEventListener('mouseup', stopResize);

            // Clean up visual class
            const ths = document.querySelectorAll('#orders .excel-table th');
            const visibleIndex = getSafeColumns().findIndex(col => col.id === currentColumns[resizingColIndex]?.id);
            if (ths[visibleIndex + 1]) {
                ths[visibleIndex + 1].classList.remove('resizing');
            }

            resizingColIndex = null;

            // Perist
            localStorage.setItem('reaksiyon_column_order', JSON.stringify(currentColumns));
            writeLocalOrdersColumnPreferences({
                visibleColumns: ordersVisibleColumnSet ? currentColumns.map(col => col.id).filter(id => ordersVisibleColumnSet.has(id)) : currentColumns.map(col => col.id),
                columnOrder: currentColumns.map(col => col.id),
                columnWidths: Object.fromEntries(currentColumns.map(col => [col.id, parseInt(String(col.width || '120px'), 10) || 120]))
            });

            // Full re-render to ensure compatibility
            renderTableHeader();
            applyRequestFilters();
        }

        function resetOrderColumnWidth(event, index) {
            event.preventDefault();
            event.stopPropagation();
            const col = currentColumns[index];
            const defaultCol = col ? defaultColumns.find(item => item.id === col.id) : null;
            if (!col || !defaultCol) return;
            col.width = defaultCol.width;
            localStorage.setItem('reaksiyon_column_order', JSON.stringify(currentColumns));
            writeLocalOrdersColumnPreferences({
                visibleColumns: ordersVisibleColumnSet ? currentColumns.map(item => item.id).filter(id => ordersVisibleColumnSet.has(id)) : currentColumns.map(item => item.id),
                columnOrder: currentColumns.map(item => item.id),
                columnWidths: Object.fromEntries(currentColumns.map(item => [item.id, parseInt(String(item.width || '120px'), 10) || 120]))
            });
            renderTableHeader();
            applyRequestFilters();
        }

        // Excel-like Table Rendering
        const ORDERS_RENDER_BATCH_SIZE = 80;
        let ordersRenderState = {
            rows: [],
            safeColumns: [],
            renderedCount: 0,
            tbody: null,
            scrollBound: false,
            boundContainer: null,
            windowScrollBound: false
        };

        function buildOrderRowHtml(order, safeColumns) {
            return window.ReaksiyonOrdersRenderer.renderRow(order, safeColumns, {
                formatDate,
                resolveOrderFormat,
                formatDateTimeShort,
                normalizeOrderStatus,
                orderStatusOptions: ORDER_STATUS_OPTIONS,
                isOrderBulkSelected
            });
        }

        function updateOrdersRenderCount(totalRows) {
            const resultCountEl = document.getElementById('ordersResultCount');
            if (!resultCountEl) return;
            const shown = Math.min(ordersRenderState.renderedCount || 0, totalRows || 0);
            const renderHint = shown < totalRows ? ` (${shown} görüntüleniyor)` : '';
            resultCountEl.textContent = `${totalRows} / ${orders.length} kayıt${renderHint}`;
            const paginationEl = document.getElementById('paginationContainer');
            if (paginationEl) {
                const suffix = shown < totalRows ? ' - devamı için aşağı kaydırın' : '';
                paginationEl.innerHTML = `<div class="pagination-info">${shown} / ${totalRows} satır${suffix}</div>`;
            }
        }

        function appendNextOrdersBatch() {
            const state = ordersRenderState;
            if (!state.tbody || state.renderedCount >= state.rows.length) return;

            const nextCount = Math.min(state.renderedCount + ORDERS_RENDER_BATCH_SIZE, state.rows.length);
            const htmlParts = [];
            for (let i = state.renderedCount; i < nextCount; i++) {
                htmlParts.push(buildOrderRowHtml(state.rows[i], state.safeColumns));
            }
            state.tbody.insertAdjacentHTML('beforeend', htmlParts.join(''));
            state.renderedCount = nextCount;
            updateOrdersRenderCount(state.rows.length);
            syncOrdersBulkSelectionUi();
        }

        function getOrdersScrollContainer() {
            return document.querySelector('#orders .orders-table-scroll')
                || document.getElementById('ordersTableBody')?.closest('.table-container')
                || null;
        }

        function isNearOrdersScrollEnd(container) {
            if (container && container.scrollHeight > container.clientHeight) {
                return container.scrollTop + container.clientHeight >= container.scrollHeight - 500;
            }

            const doc = document.documentElement;
            const body = document.body;
            const scrollTop = window.scrollY || doc.scrollTop || body.scrollTop || 0;
            const viewport = window.innerHeight || doc.clientHeight || 0;
            const height = Math.max(body.scrollHeight || 0, doc.scrollHeight || 0);
            return scrollTop + viewport >= height - 500;
        }

        function fillOrdersViewportIfNeeded() {
            const container = getOrdersScrollContainer();
            let guard = 0;
            while (
                ordersRenderState.renderedCount < ordersRenderState.rows.length
                && container
                && container.scrollHeight <= container.clientHeight + 40
                && guard < 8
            ) {
                guard += 1;
                appendNextOrdersBatch();
            }
        }

        function handleOrdersInfiniteScroll() {
            if (ordersRenderState.renderedCount >= ordersRenderState.rows.length) return;
            if (isNearOrdersScrollEnd(getOrdersScrollContainer())) appendNextOrdersBatch();
        }

        function setupOrdersVirtualScroll() {
            const container = getOrdersScrollContainer();
            if (!container) return;

            const bindScrollTarget = (target) => {
                let ticking = false;
                target.addEventListener('scroll', () => {
                    if (ticking) return;
                    ticking = true;
                    requestAnimationFrame(() => {
                        ticking = false;
                        handleOrdersInfiniteScroll();
                    });
                }, { passive: true });
            };

            if (ordersRenderState.boundContainer !== container) {
                bindScrollTarget(container);
                ordersRenderState.boundContainer = container;
                ordersRenderState.scrollBound = true;
            }

            if (!ordersRenderState.windowScrollBound) {
                bindScrollTarget(window);
                ordersRenderState.windowScrollBound = true;
            }
        }

        function patchRenderedOrderRow(orderId) {
            const order = orders.find(item => String(item.id) === String(orderId));
            const tbody = document.getElementById('ordersTableBody');
            if (!order || !tbody) return false;

            const escapedId = window.CSS && typeof CSS.escape === 'function'
                ? CSS.escape(String(orderId))
                : String(orderId).replace(/"/g, '\\"');
            const row = tbody.querySelector(`tr[data-order-id="${escapedId}"]`);
            const detailRow = document.getElementById(`detail-${orderId}`);
            if (!row) return false;

            const tempContainer = document.createElement('tbody');
            tempContainer.innerHTML = buildOrderRowHtml(order, getSafeColumns());
            const nextRow = tempContainer.querySelector(`tr[data-order-id="${escapedId}"]`);
            const nextDetailRow = tempContainer.querySelector(`#detail-${escapedId}`);
            if (!nextRow) return false;

            row.replaceWith(nextRow);
            if (detailRow && nextDetailRow) {
                if (detailRow.classList.contains('active')) nextDetailRow.classList.add('active');
                detailRow.replaceWith(nextDetailRow);
            }
            return true;
        }

        function shouldPatchOrderEditInPlace(colId) {
            const hasSearch = !!String(document.getElementById('globalSearch')?.value || '').trim();
            const hasColumnFilters = Object.values(activeColFilters || {}).some(value => String(value || '').trim());
            const hasPopupFilters = Object.values(ordersColFilters || {}).some(value => value instanceof Set && value.size > 0);
            const hasStatusFilters = activeStatusFilters.size > 0;
            const hasSort = !!activeSortState.colId && activeSortState.direction !== 'none';
            const filterSensitiveColumns = new Set(['weekNumber', 'status', 'format', 'requestDate', 'deliveryDate', 'materialNo', 'catalogNo', 'rxnName']);
            return !hasSearch && !hasColumnFilters && !hasPopupFilters && !hasStatusFilters && !hasSort && !filterSensitiveColumns.has(colId);
        }

        function renderOrders(filteredOrders = null) {
            const ordersToShow = filteredOrders || orders;
            const tbody = document.getElementById('ordersTableBody');
            const emptyState = document.getElementById('emptyState');
            const safeColumns = getSafeColumns();

            ordersRenderState.rows = ordersToShow;
            ordersRenderState.safeColumns = safeColumns;
            ordersRenderState.renderedCount = 0;
            ordersRenderState.tbody = tbody;
            setupOrdersVirtualScroll();
            updateOrdersRenderCount(ordersToShow.length);

            if (ordersToShow.length === 0) {
                tbody.innerHTML = '';
                emptyState.style.display = 'block';
                syncOrdersBulkSelectionUi();
                return;
            }

            emptyState.style.display = 'none';
            tbody.innerHTML = '';
            appendNextOrdersBatch();
            fillOrdersViewportIfNeeded();
            syncOrdersBulkSelectionUi();
        }

        // Toggle Detail Row - don't close others
        function toggleDetail(id) {
            const detailRow = document.getElementById(`detail-${id}`);
            const icon = document.getElementById(`icon-${id}`);

            // Toggle current only, don't close others
            if (detailRow) {
                const isActive = detailRow.classList.toggle('active');
                if (icon) {
                    icon.textContent = isActive ? '' : '';
                }
            }
        }

        // Open filtered view from dashboard cards
        function openFilteredView(statusValue) {
            const normalizedStatusValue = normalizeOrderStatus(statusValue);
            if (normalizedStatusValue === 'Ürün QC tekrarına gitti') {
                switchTab('qcrepeat-view');
            } else if (normalizedStatusValue === 'Ürün Etiketlendi') {
                switchTab('etiketlendi-view');
            } else {
                activeStatusFilters.clear();
                activeStatusFilters.add(normalizedStatusValue);
                switchTab('vcap');
                renderTableHeader();
            }
        }

        // Tab Navigation
        function setupTabNavigation() {
            document.querySelectorAll('.nav-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    const tabId = tab.dataset.tab;
                    switchTab(tabId);
                    closeHeaderMenu();
                });
            });
        }

        function setupHeaderMenu() {
            const toggleBtn = document.getElementById('menuToggleBtn');
            const dropdown = document.getElementById('menuDropdown');
            if (!toggleBtn || !dropdown) return;
            if (toggleBtn.dataset.bound === 'true') return;
            toggleBtn.dataset.bound = 'true';

            toggleBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                dropdown.classList.toggle('open');
            });

            document.addEventListener('click', (event) => {
                if (!dropdown.contains(event.target) && event.target !== toggleBtn && !toggleBtn.contains(event.target)) {
                    dropdown.classList.remove('open');
                }
            });
        }

        function closeHeaderMenu() {
            const dropdown = document.getElementById('menuDropdown');
            if (dropdown) {
                dropdown.classList.remove('open');
            }
        }

        function setHeaderPrimaryState(tabId) {
            const primaryKey = tabId === 'dashboard'
                ? 'dashboard'
                : tabId === 'sales-lines'
                    ? 'sales-lines'
                    : 'orders';
            document.querySelectorAll('.header-primary-btn').forEach(button => {
                button.classList.toggle('active', button.dataset.primaryTab === primaryKey);
            });
        }

        function setOrdersViewState(tabId) {
            const ordersView = (tabId === 'urgent' || tabId === 'overdue' || tabId === 'delivered' || tabId === 'vcap' || tabId === 'liyofilize' || tabId === 'tube' || tabId === 'unmatched') ? tabId : 'orders';
            document.querySelectorAll('.orders-view-btn').forEach(button => {
                button.classList.toggle('active', button.dataset.ordersView === ordersView);
            });
        }

        function resetRequestTableFiltersForViewChange() {
            activeColFilters = {};
            ordersColFilters = {};
            activeStatusFilters.clear();
            closeOrdersColFilter();
        }

        function setOrderFormFeedback(message = '', type = 'success') {
            const feedback = document.getElementById('orderFormFeedback');
            const submitButton = document.getElementById('submitOrderBtn');
            if (!feedback || !submitButton) return;

            if (!message) {
                feedback.className = 'form-feedback';
                feedback.innerHTML = '';
                submitButton.textContent = 'Talebi kaydet';
                return;
            }

            feedback.className = `form-feedback is-visible ${type === 'error' ? 'is-error' : ''}`;
            feedback.innerHTML = `<strong>${type === 'error' ? 'Kayıt tamamlanmadı' : 'Talep sisteme eklendi'}</strong><span>${message}</span>`;
            submitButton.textContent = type === 'error' ? 'Tekrar dene' : 'Kaydedildi';
        }

        function moveSectionToMount(sectionId, mountId) {
            const section = document.getElementById(sectionId);
            const mount = document.getElementById(mountId);
            if (!section || !mount || mount.dataset.mounted === 'true') return;

            mount.appendChild(section);
            section.dataset.detachedFromDashboard = 'true';
            section.style.marginTop = '0';
            section.style.display = '';
            mount.dataset.mounted = 'true';
        }

        function mountUtilitySections() {
            moveSectionToMount('backup-panel', 'backupToolsMount');
            moveSectionToMount('adminPanelSection', 'adminToolsMount');
            moveSectionToMount('product-tree-manager', 'productTreeToolsMount');
        }

        function goToUtilitySection(tabId, targetId = null, expandManualProduct = false) {
            if (!isAdmin() && !(tabId === 'final-product-quantities' && canViewFinalProductQuantities())) {
                return;
            }
            switchTab(tabId);
            closeHeaderMenu();

            setTimeout(() => {
                if (expandManualProduct && typeof toggleManualProductForm === 'function') {
                    const panel = document.getElementById('manualProductPanel');
                    if (panel && panel.style.display === 'none') {
                        toggleManualProductForm();
                    }
                }

                const target = document.getElementById(targetId || tabId);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 120);
        }

        function switchTab(tabId) {
            const ordersRestrictedTabs = new Set(['orders', 'new-order', 'urgent', 'overdue', 'delivered', 'vcap', 'liyofilize', 'tube', 'unmatched', 'qc-view', 'islemde-view', 'teslim-view', 'dagitilan-view', 'qcrepeat-view', 'etiketlendi-view', 'destroyed-view', 'dashboard']);
            if (!canViewOrders() && ordersRestrictedTabs.has(tabId)) {
                tabId = 'sales-lines';
            }

            if (!canViewProductTree() && tabId === 'product-tree-tools') {
                tabId = canViewOrders() ? 'orders' : 'sales-lines';
            }

            if (!isAdmin() && (tabId === 'admin-tools' || tabId === 'backup-tools')) {
                tabId = canViewOrders() ? 'orders' : 'sales-lines';
            }

            if (!canViewFinalProductQuantities() && tabId === 'final-product-quantities') {
                tabId = canViewOrders() ? 'orders' : 'sales-lines';
            }

            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

            const targetTab = document.querySelector(`[data-tab="${tabId}"]`);
            if (targetTab) targetTab.classList.add('active');
            setHeaderPrimaryState(tabId);
            setOrdersViewState(tabId);

            if (tabId === 'new-order') {
                document.getElementById('new-order').classList.add('active');
                activeTabFilter = null;
                // Sidebar'da seçili haftayı forma yansıt
                initializeFormValues();
            } else if (tabId === 'dashboard') {
                document.getElementById('dashboard').classList.add('active');
                activeTabFilter = null;
            } else if (tabId === 'backup-tools') {
                document.getElementById('backup-tools').classList.add('active');
                activeTabFilter = null;
            } else if (tabId === 'admin-tools') {
                document.getElementById('admin-tools').classList.add('active');
                activeTabFilter = null;
            } else if (tabId === 'product-tree-tools') {
                document.getElementById('product-tree-tools').classList.add('active');
                activeTabFilter = null;
                if (typeof renderManagedProductsList === 'function') renderManagedProductsList();
                if (typeof updateProductTreeStats === 'function') updateProductTreeStats();
            } else if (tabId === 'final-product-quantities') {
                document.getElementById('final-product-quantities').classList.add('active');
                activeTabFilter = null;
                refreshFinalProductQuantities();
            } else if (tabId === 'sales-lines') {
                document.getElementById('sales-lines').classList.add('active');
                initEmbeddedSalesLinesFrame();
                activeTabFilter = null;
            } else if (tabId === 'qc-view') {
                document.getElementById('qc-view').classList.add('active');
                renderQcView();
                activeTabFilter = null;
            } else if (tabId === 'destroyed-view') {
                document.getElementById('destroyed-view').classList.add('active');
                renderDestroyedView();
                activeTabFilter = null;
            } else if (tabId === 'islemde-view') {
                document.getElementById('islemde-view').classList.add('active');
                renderIslemdeView();
                activeTabFilter = null;
            } else if (tabId === 'teslim-view') {
                document.getElementById('teslim-view').classList.add('active');
                renderTeslimView();
                activeTabFilter = null;
            } else if (tabId === 'dagitilan-view') {
                document.getElementById('dagitilan-view').classList.add('active');
                renderDagitilanView();
                activeTabFilter = null;
            } else if (tabId === 'qcrepeat-view') {
                document.getElementById('qcrepeat-view').classList.add('active');
                renderQcRepeatView();
                activeTabFilter = null;
            } else if (tabId === 'etiketlendi-view') {
                document.getElementById('etiketlendi-view').classList.add('active');
                renderEtiketlendiView();
                activeTabFilter = null;
            } else {
                // Orders Views (urgent, vcap, liyofilize, tube, orders, unmatched)
                document.getElementById('orders').classList.add('active');
                const nextOrdersFilter = (tabId === 'urgent' || tabId === 'overdue' || tabId === 'delivered' || tabId === 'vcap' || tabId === 'liyofilize' || tabId === 'tube' || tabId === 'unmatched')
                    ? tabId
                    : 'orders';

                if (activeTabFilter !== nextOrdersFilter) {
                    resetRequestTableFiltersForViewChange();
                }

                if (tabId === 'urgent' || tabId === 'overdue' || tabId === 'delivered' || tabId === 'vcap' || tabId === 'liyofilize' || tabId === 'tube' || tabId === 'unmatched') {
                    activeTabFilter = nextOrdersFilter;
                } else {
                    activeTabFilter = nextOrdersFilter;
                }

                applyRequestFilters();
                renderTableHeader();

                // Update header text based on context
                const title = document.querySelector('#orders .card-title');
                if (title) {
                    if (activeTabFilter === 'urgent') title.textContent = 'Acil Beklenen Talepler';
                    else if (activeTabFilter === 'overdue') title.textContent = 'Geciken Talepler';
                    else if (activeTabFilter === 'delivered') title.textContent = 'Teslim Edilen Talepler';
                    else if (activeTabFilter === 'vcap') title.textContent = 'vCAP Talepleri';
                    else if (activeTabFilter === 'liyofilize') title.textContent = 'Liyofilize Talepleri';
                    else if (activeTabFilter === 'tube') title.textContent = 'Tüp Format Talepleri';
                    else if (activeTabFilter === 'unmatched') title.textContent = 'Karşılığı Olmayan Ürünler';
                    else title.textContent = 'Talep Listesi';
                }
            }

            // Persist state
            syncWorkspaceScrollMode(tabId);
            localStorage.setItem('reaksiyon_active_tab', tabId);
        }

        // Column-based Filter removed in favor of global search


        // Handle Form Submit
        function handleSubmit(e) {
            e.preventDefault();
            setOrderFormFeedback();

            // Core Fields
            const weekNumber = document.getElementById('weekNumber').value;
            const requestDate = document.getElementById('requestDate').value;
            const requester = document.getElementById('requester').value;
            const catalogNo = document.getElementById('catalogNo').value;
            const quantity = parseFloat(document.getElementById('quantity').value);
            const orderNo = document.getElementById('orderNo').value;
            const deliveryDate = document.getElementById('deliveryDate').value;
            const requesterNote = document.getElementById('requesterNote').value;

            if (!catalogNo || !quantity) {
                setOrderFormFeedback('Katalog no ve miktar alanlarını doldurun.', 'error');
                showToast('Katalog No ve Miktar zorunludur.', 'error');
                return;
            }

            // Look up product tree
            // productTree keys are strings (e.g. "AAV01100").
            let components = productTree[catalogNo] || productTree[String(catalogNo).trim()] || productTree[String(catalogNo).trim().toUpperCase()];

            // Fallback for case-insensitive
            if (!components) {
                const key = Object.keys(productTree).find(k => k.toLowerCase() === catalogNo.toLowerCase());
                if (key) components = productTree[key];
            }

            // NEW: Check if it is a direct Material No (YM-...) order
            // If not found as a Kit, search as a Component
            if (!components && (catalogNo.toUpperCase().startsWith('YM-') || catalogNo.toUpperCase().startsWith('AAV') || catalogNo.toUpperCase().startsWith('ABD'))) { // Heuristic check
                // Search all trees
                for (const key of Object.keys(productTree)) {
                    const found = productTree[key].find(c => c.materialNo && c.materialNo.toUpperCase() === catalogNo.toUpperCase());
                    if (found) {
                        // Found a matching component! Treat as single item order.
                        // Normalize Input
                        components = [found];
                        break;
                    }
                }
            }

            if (!components) {
                setOrderFormFeedback(`"${catalogNo}" için ürün ağacı bulunamadı.`, 'error');
                showToast('Katalog No veya Madde No bulunamadı: ' + catalogNo, 'error');
                return;
            }

            let addedCount = 0;
            components.forEach(comp => {
                createOrderEntry({
                    catalogNo: catalogNo,
                    orderNo: orderNo,
                    quantity: Math.ceil(quantity * (comp.multiplier || 1)),
                    rxnName: comp.rxnName,
                    materialNo: comp.materialNo,
                    format: normalizeOrderFormat(comp.format),
                    requesterNote: requesterNote,
                    // Additional context
                    weekNumber: weekNumber,
                    requestDate: requestDate,
                    requester: requester,
                    deliveryDate: deliveryDate
                });
                addedCount++;
            });

            // Orders created successfully

            saveOrders();
            updateWeekFilterOptions();
            renderDashboard();
            renderWeekSidebar();
            applyRequestFilters();
            resetForm();
            const savedWeekLabel = weekNumber ? `${weekNumber}. hafta` : 'seilen hafta';
            setOrderFormFeedback(`${catalogNo} için ${addedCount} satır ${savedWeekLabel} listesine eklendi.`);
            showToast(`Talep kaydedildi. ${catalogNo} için ${addedCount} satır ${savedWeekLabel} listesine eklendi.`, 'success', 5000);
        }

        // Autocomplete Logic
        function setupAutocomplete(inputId) {
            const input = document.getElementById(inputId);
            const listId = inputId + "-list";
            let currentFocus = -1;

            // Cache keys once productTree is ready
            let keys = [];

            input.addEventListener("focus", function () {
                if (window.productTree) {
                    keys = Object.keys(window.productTree);
                }
            });

            input.addEventListener("input", function (e) {
                const val = this.value;
                const listDiv = document.getElementById(listId);

                closeAllLists();
                if (!val || val.length < 2) return false;

                currentFocus = -1;

                if (window.productTree) keys = Object.keys(window.productTree);

                const matches = [];
                const valUpper = val.toUpperCase();

                // Optimized Search Loop
                const uniqueMatches = new Set();

                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    const components = window.productTree[key] || [];

                    // 1. Check Catalog No (Key)
                    if (key.toUpperCase().includes(valUpper)) {
                        if (!uniqueMatches.has(key)) {
                            matches.push({ key: key });
                            uniqueMatches.add(key);
                        }
                    }

                    // 2. Check Component Material Nos (YM-...)
                    const matMatch = components.find(c => c.materialNo && c.materialNo.toUpperCase().includes(valUpper));
                    if (matMatch) {
                        // Option A: Suggest Parent Kit
                        if (!uniqueMatches.has(key)) {
                            matches.push({ key: key, reason: `(Kit: ${matMatch.materialNo} içerir)` });
                            uniqueMatches.add(key);
                        }

                        // Option B: Suggest The Component Itself (Direct Order)
                        const matNo = matMatch.materialNo;
                        if (!uniqueMatches.has(matNo)) {
                            matches.push({ key: matNo, reason: '(Tek Bileşen)', isDirect: true });
                            uniqueMatches.add(matNo);
                        }
                    }

                    if (matches.length >= 10) break;
                }

                if (matches.length === 0) return;

                listDiv.style.display = "block";

                matches.forEach(matchObj => {
                    const match = matchObj.key;
                    const item = document.createElement("DIV");

                    // Highlight matching part in Key if present
                    const matchIndex = match.toUpperCase().indexOf(valUpper);
                    let displayHtml = match;

                    if (matchIndex >= 0) {
                        displayHtml = match.substr(0, matchIndex) + "<strong>" + match.substr(matchIndex, val.length) + "</strong>" + match.substr(matchIndex + val.length);
                    }

                    // Append reason if matched via material no
                    if (matchObj.reason) {
                        displayHtml += ` <span style='font-size:0.8em; color:#64748b;'>${matchObj.reason}</span>`;
                        // If searched via material no, highlight that part in reason? 
                        // Simple bolding for reason as well if needed, but let's keep it simple.
                        if (matchObj.reason.toUpperCase().includes(valUpper)) {
                            // Basic replace for highlight
                            const regex = new RegExp(val, 'gi');
                            displayHtml = displayHtml.replace(regex, (m) => `<strong>${m}</strong>`);
                        }
                    }

                    item.innerHTML = displayHtml;

                    item.innerHTML += "<input type='hidden' value='" + match + "'>";

                    item.addEventListener("click", function (e) {
                        input.value = this.getElementsByTagName("input")[0].value;
                        closeAllLists();
                        // Optional: trigger change validation or focus next field
                    });

                    listDiv.appendChild(item);
                });
            });

            input.addEventListener("keydown", function (e) {
                let x = document.getElementById(listId);
                if (x) x = x.getElementsByTagName("div");
                if (e.keyCode == 40) { // DOWN
                    currentFocus++;
                    addActive(x);
                } else if (e.keyCode == 38) { // UP
                    currentFocus--;
                    addActive(x);
                } else if (e.keyCode == 13) { // ENTER
                    e.preventDefault();
                    if (currentFocus > -1) {
                        if (x) x[currentFocus].click();
                    }
                }
            });

            function addActive(x) {
                if (!x) return false;
                removeActive(x);
                if (currentFocus >= x.length) currentFocus = 0;
                if (currentFocus < 0) currentFocus = (x.length - 1);
                x[currentFocus].classList.add("autocomplete-active");
            }

            function removeActive(x) {
                for (let i = 0; i < x.length; i++) {
                    x[i].classList.remove("autocomplete-active");
                }
            }

            function closeAllLists(elmnt) {
                const x = document.getElementsByClassName("autocomplete-items");
                for (let i = 0; i < x.length; i++) {
                    if (elmnt != x[i] && elmnt != input) {
                        x[i].innerHTML = "";
                    }
                }
            }

            document.addEventListener("click", function (e) {
                closeAllLists(e.target);
            });
        }

        // QC View Render Logic
        function renderQcView(searchTerm) {
            const tbody = document.getElementById('qcViewBody');
            let pendingOrders = orders.filter(o => isOrderStatus(o, 'Ürün QC ye gitti'));

            // Arama filtresi
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                pendingOrders = pendingOrders.filter(o =>
                    (o.rxnName || '').toLowerCase().includes(term) ||
                    (o.format || '').toLowerCase().includes(term) ||
                    (o.catalogNo || '').toLowerCase().includes(term) ||
                    (o.orderNo || '').toLowerCase().includes(term) ||
                    (o.quantity || '').toString().includes(term)
                );
            }

            if (pendingOrders.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">' +
                    (searchTerm ? 'Aramanızla eşleşen sonuç bulunamadı.' : 'Bekleyen QC kaydı yok.') + '</td></tr>';
            } else {
                // Group by week
                const grouped = {};
                pendingOrders.forEach(o => {
                    const week = o.weekNumber || 'Diğer';
                    if (!grouped[week]) grouped[week] = [];
                    grouped[week].push(o);
                });

                // Render grouped
                let html = '';
                Object.keys(grouped).sort((a, b) => parseInt(b) - parseInt(a)).forEach(week => {
                    html += `<tr class="group-header"><td colspan="7" style="background: rgba(255, 255, 255, 0.05); font-weight: bold; padding: 8px;">${week}. Hafta</td></tr>`;
                    grouped[week].forEach(o => {
                        html += `
                        <tr>
                            <td style="font-weight: bold;">${o.rxnName || '-'}</td>
                            <td>${o.format}</td>
                            <td>${o.quantity}</td>
                            <td>${o.catalogNo}</td>
                            <td>${o.orderNo || '-'}</td>
                            <td>${getStatusBadge(o.status)}</td>
                            <td>
                                <button class="action-btn" onclick="openDetailModal('${o.id}')" title="Düzenle">D</button>
                            </td>
                        </tr>`;
                    });
                });
                tbody.innerHTML = html;
            }
        }

        // QC View arama filtresi
        function filterQcView() {
            const searchInput = document.getElementById('qcViewSearch');
            renderQcView(searchInput ? searchInput.value.trim() : '');
        }

        // Destroyed View Render Logic
        function renderDestroyedView(searchTerm) {
            const tbody = document.getElementById('destroyedViewBody');
            let items = orders.filter(o => isOrderStatus(o, 'Ürün İptal Edildi'));

            // Arama filtresi
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                items = items.filter(o =>
                    (o.rxnName || '').toLowerCase().includes(term) ||
                    (o.format || '').toLowerCase().includes(term) ||
                    (o.catalogNo || '').toLowerCase().includes(term) ||
                    (o.orderNo || '').toLowerCase().includes(term) ||
                    (o.quantity || '').toString().includes(term)
                );
            }

            if (items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">' +
                    (searchTerm ? 'Aramanızla eşleşen sonuç bulunamadı.' : 'İmha edilecek kayıt yok.') + '</td></tr>';
            } else {
                items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                tbody.innerHTML = items.map(o => `
                    <tr>
                        <td style="font-weight: bold;">${o.rxnName || '-'}</td>
                        <td>${o.format}</td>
                        <td>${o.quantity}</td>
                        <td>${o.catalogNo}</td>
                        <td>${o.orderNo || '-'}</td>
                        <td>${getStatusBadge(o.status)}</td>
                    </tr>
                `).join('');
            }
        }

        // Destroyed View arama filtresi
        function filterDestroyedView() {
            const searchInput = document.getElementById('destroyedSearch');
            renderDestroyedView(searchInput ? searchInput.value.trim() : '');
        }

        // Initialize autocomplete when page loads

        // İşlemde View Render Logic
        function renderIslemdeView(searchTerm) {
            const tbody = document.getElementById('islemdeViewBody');
            let items = orders.filter(o => isOrderStatus(o, 'Ürün İşlem Bekliyor'));

            // Arama filtresi
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                items = items.filter(o =>
                    (o.rxnName || '').toLowerCase().includes(term) ||
                    (o.format || '').toLowerCase().includes(term) ||
                    (o.catalogNo || '').toLowerCase().includes(term) ||
                    (o.orderNo || '').toLowerCase().includes(term) ||
                    (o.quantity || '').toString().includes(term)
                );
            }

            if (items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">' +
                    (searchTerm ? 'Aramanızla eşleşen sonuç bulunamadı.' : 'İşlemde olan talep yok.') + '</td></tr>';
            } else {
                items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                tbody.innerHTML = items.map(o => `
                    <tr>
                        <td style="font-weight: bold;">${o.rxnName || '-'}</td>
                        <td>${o.format}</td>
                        <td>${o.quantity}</td>
                        <td>${o.catalogNo}</td>
                        <td>${o.orderNo || '-'}</td>
                        <td>${getStatusBadge(o.status)}</td>
                        <td>
                            <button class="action-btn" onclick="openDetailModal('${o.id}')" title="Düzenle">D</button>
                        </td>
                    </tr>
                `).join('');
            }
        }

        // İşlemde View arama filtresi
        function filterIslemdeView() {
            const searchInput = document.getElementById('islemdeSearch');
            renderIslemdeView(searchInput ? searchInput.value.trim() : '');
        }

        // Teslim Edildi View Render Logic
        function renderTeslimView(searchTerm) {
            const tbody = document.getElementById('teslimViewBody');
            let items = orders.filter(o => isOrderStatus(o, 'Ürün Teslim Edildi'));

            // Arama filtresi
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                items = items.filter(o =>
                    (o.rxnName || '').toLowerCase().includes(term) ||
                    (o.format || '').toLowerCase().includes(term) ||
                    (o.catalogNo || '').toLowerCase().includes(term) ||
                    (o.orderNo || '').toLowerCase().includes(term) ||
                    (o.quantity || '').toString().includes(term)
                );
            }

            if (items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">' +
                    (searchTerm ? 'Aramanızla eşleşen sonuç bulunamadı.' : 'Teslim edilen talep yok.') + '</td></tr>';
            } else {
                items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                tbody.innerHTML = items.map(o => `
                    <tr>
                        <td style="font-weight: bold;">${o.rxnName || '-'}</td>
                        <td>${o.format}</td>
                        <td>${o.quantity}</td>
                        <td>${o.catalogNo}</td>
                        <td>${o.orderNo || '-'}</td>
                        <td>${getStatusBadge(o.status)}</td>
                    </tr>
                `).join('');
            }
        }

        // Teslim View arama filtresi
        function filterTeslimView() {
            const searchInput = document.getElementById('teslimSearch');
            renderTeslimView(searchInput ? searchInput.value.trim() : '');
        }

        // Dağıtılanlar View Render Logic
        function renderDagitilanView(searchTerm) {
            const tbody = document.getElementById('dagitilanViewBody');
            let items = orders.filter(o => isOrderStatus(o, 'Ürün Dağıtıldı'));

            // Arama filtresi
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                items = items.filter(o =>
                    (o.rxnName || '').toLowerCase().includes(term) ||
                    (o.format || '').toLowerCase().includes(term) ||
                    (o.catalogNo || '').toLowerCase().includes(term) ||
                    (o.orderNo || '').toLowerCase().includes(term) ||
                    (o.quantity || '').toString().includes(term)
                );
            }

            if (items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">' +
                    (searchTerm ? 'Aramanızla eşleşen sonuç bulunamadı.' : 'Dağıtılan talep yok.') + '</td></tr>';
            } else {
                items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                tbody.innerHTML = items.map(o => `
                    <tr>
                        <td style="font-weight: bold;">${o.rxnName || '-'}</td>
                        <td>${o.format}</td>
                        <td>${o.quantity}</td>
                        <td>${o.catalogNo}</td>
                        <td>${o.orderNo || '-'}</td>
                        <td>${getStatusBadge(o.status)}</td>
                    </tr>
                `).join('');
            }
        }

        // Dağıtılan View arama filtresi
        function filterDagitilanView() {
            const searchInput = document.getElementById('dagitilanSearch');
            renderDagitilanView(searchInput ? searchInput.value.trim() : '');
        }

        // QC Tekrar View Render Logic
        function renderQcRepeatView(searchTerm) {
            const tbody = document.getElementById('qcRepeatViewBody');
            let items = orders.filter(o => isOrderStatus(o, 'Ürün QC tekrarına gitti'));

            // Arama filtresi
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                items = items.filter(o =>
                    (o.rxnName || '').toLowerCase().includes(term) ||
                    (o.format || '').toLowerCase().includes(term) ||
                    (o.catalogNo || '').toLowerCase().includes(term) ||
                    (o.orderNo || '').toLowerCase().includes(term) ||
                    (o.requester || '').toLowerCase().includes(term) ||
                    (o.quantity || '').toString().includes(term)
                );
            }

            if (items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">' +
                    (searchTerm ? 'Aramanızla eşleşen sonuç bulunamadı.' : 'QC tekrarlanacak talep yok.') + '</td></tr>';
            } else {
                items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                tbody.innerHTML = items.map(o => `
                    <tr>
                        <td style="font-weight: bold;">${o.rxnName || '-'}</td>
                        <td>${o.format}</td>
                        <td>${o.quantity}</td>
                        <td>${o.catalogNo}</td>
                        <td>${o.orderNo || '-'}</td>
                        <td>${o.requester || '-'}</td>
                        <td>${getStatusBadge(o.status)}</td>
                        <td>
                            <button class="action-btn" onclick="openDetailModal('${o.id}')" title="Düzenle">D</button>
                        </td>
                    </tr>
                `).join('');
            }
        }

        // QC Tekrar View arama filtresi
        function filterQcRepeatView() {
            const searchInput = document.getElementById('qcRepeatSearch');
            renderQcRepeatView(searchInput ? searchInput.value.trim() : '');
        }

        // Etiketlendi View Render Logic
        function renderEtiketlendiView(searchTerm) {
            const tbody = document.getElementById('etiketlendiViewBody');
            let items = orders.filter(o => isOrderStatus(o, 'Ürün Etiketlendi'));

            // Arama filtresi
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                items = items.filter(o =>
                    (o.rxnName || '').toLowerCase().includes(term) ||
                    (o.format || '').toLowerCase().includes(term) ||
                    (o.catalogNo || '').toLowerCase().includes(term) ||
                    (o.orderNo || '').toLowerCase().includes(term) ||
                    (o.requester || '').toLowerCase().includes(term) ||
                    (o.quantity || '').toString().includes(term)
                );
            }

            if (items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">' +
                    (searchTerm ? 'Aramanızla eşleşen sonuç bulunamadı.' : 'Etiketlenen talep yok.') + '</td></tr>';
            } else {
                items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                tbody.innerHTML = items.map(o => `
                    <tr>
                        <td style="font-weight: bold;">${o.rxnName || '-'}</td>
                        <td>${o.format}</td>
                        <td>${o.quantity}</td>
                        <td>${o.catalogNo}</td>
                        <td>${o.orderNo || '-'}</td>
                        <td>${o.requester || '-'}</td>
                        <td>${getStatusBadge(o.status)}</td>
                        <td>
                            <button class="action-btn" onclick="openDetailModal('${o.id}')" title="Düzenle">D</button>
                        </td>
                    </tr>
                `).join('');
            }
        }

        // Etiketlendi View arama filtresi
        function filterEtiketlendiView() {
            const searchInput = document.getElementById('etiketlendiSearch');
            renderEtiketlendiView(searchInput ? searchInput.value.trim() : '');
        }

        document.addEventListener('DOMContentLoaded', function () {
            setupAutocomplete("catalogNo");
            initializeFormValues();
            mountUtilitySections();
            setupTabNavigation();
            setupHeaderMenu();
            setupWeekSelectSync();
            setHeaderPrimaryState(localStorage.getItem('reaksiyon_active_tab') || 'dashboard');
            setOrdersViewState(localStorage.getItem('reaksiyon_active_tab') || 'dashboard');
            // ... other inits
        });

        // Reset Form
        function resetForm() {
            const form = document.getElementById('orderForm');
            if (form) form.reset();
            setOrderFormFeedback();
            initializeFormValues(); // Re-apply defaults
        }

        function initializeFormValues() {
            // Hafta seçimi: sidebar'da seçili hafta varsa onu seç, yoksa boş bırak (kullanıcı manuel seçmeli)
            const weekSelect = document.getElementById('weekNumber');
            if (weekSelect) {
                if (typeof selectedWeekFilter !== 'undefined' && selectedWeekFilter !== null) {
                    weekSelect.value = selectedWeekFilter;
                } else {
                    weekSelect.value = ''; // Boş bırak - "Seçiniz..." görünsün
                }
            }

            // Set today's date for Request Date
            const today = new Date();
            const requestDateInput = document.getElementById('requestDate');
            if (requestDateInput) requestDateInput.value = today.toISOString().split('T')[0];

            // Set 4 weeks from today for Delivery Date
            const deliveryDate = new Date(today);
            deliveryDate.setDate(today.getDate() + 28);
            const deliveryDateInput = document.getElementById('deliveryDate');
            if (deliveryDateInput) deliveryDateInput.value = deliveryDate.toISOString().split('T')[0];
        }

        // Loading Overlay Functions
        function showLoading(text = 'İşleniyor...') {
            document.getElementById('loadingText').textContent = text;
            document.getElementById('loadingOverlay').style.display = 'flex';
        }

        function hideLoading() {
            document.getElementById('loadingOverlay').style.display = 'none';
        }

        // Excel Import Logic
        function handleExcelUpload(input) {
            const file = input.files[0];
            if (!file) return;

            const useExcelWeek = input?.dataset?.useExcelWeek === 'true';
            // Hafta seçimi mantığı
            let targetWeek = null;
            if (!useExcelWeek && typeof selectedWeekFilter !== 'undefined' && selectedWeekFilter !== null) {
                targetWeek = selectedWeekFilter;
            } else if (!useExcelWeek) {
                targetWeek = new Date().getWeek();
                const wInput = prompt('Excel verileri hangi haftaya eklensin? (Boş: Mevcut Hafta)', targetWeek);
                if (wInput === null) { console.log('İptal edildi'); input.value = ''; return; } // Cancel
                if (wInput) targetWeek = parseInt(wInput);
            }

            showLoading(useExcelWeek ? 'Excel Okunuyor...' : 'Excel Okunuyor... (Hafta: ' + targetWeek + ')');

            // Small delay to allow UI to render overlay
            setTimeout(async () => {
                const reader = new FileReader();
                reader.onload = async function (e) {
                    try {
                        await ensureSheetJs();
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        // ... rest of logic continues
                        // ... rest of logic continues
                        processExcelData(workbook, input, targetWeek);
                    } catch (err) {
                        console.error(err);
                        showToast('Excel okuma hatası: ' + err.message, 'error');
                        hideLoading();
                        input.value = '';
                    }
                };
                reader.readAsArrayBuffer(file);
            }, 50);
        }

        function processExcelData(workbook, input, targetWeek) {
            showLoading('Veriler İşleniyor...');

            setTimeout(() => {
                try {
                // Read first sheet
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Convert to JSON
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                if (jsonData.length === 0) {
                    showToast('Excel dosyası boş veya okunamadı.', 'error');
                    hideLoading();
                    input.value = '';
                    return;
                }

                if (isDirectOrdersExcelData(jsonData)) {
                    const addedCount = importDirectOrdersExcelData(jsonData, targetWeek);
                    if (addedCount > 0) {
                        saveOrders();
                        renderDashboard();
                        applyRequestFilters();
                        renderWeekSidebar();
                        switchTab('orders');
                        showToast(`${jsonData.length} satır okundu, ${addedCount} talep içe aktarıldı.`, 'success');
                    } else {
                        showToast('İçe aktarılacak yeni talep satırı bulunamadı. Bu dosya daha önce yüklenmiş olabilir.', 'warning');
                    }
                    input.value = '';
                    hideLoading();
                    return;
                }

                // DATA AGGREGATION STEP
                const aggregatedData = {};
                let processedCount = 0;

                jsonData.forEach(row => {
                    processedCount++;
                    // Normalize keys
                    const rowLower = {};
                    Object.keys(row).forEach(k => rowLower[k.trim().toLowerCase()] = row[k]);
                    const rowWeek = input?.dataset?.useExcelWeek === 'true'
                        ? getExcelRowWeek(rowLower, targetWeek)
                        : (targetWeek || new Date().getWeek());

                    // Sipariş numarasını sütun adına göre değil, içeriğine göre bul
                    // Tüm sütun değerlerini tara, "STS" ile başlayanı sipariş numarası olarak al
                    let orderNo = '';
                    Object.values(row).forEach(val => {
                        const strVal = String(val).trim();
                        if (strVal.toUpperCase().startsWith('STS')) {
                            orderNo = strVal;
                        }
                    });

                    const catalogNoRaw = rowLower['no'] || rowLower['katalog no'] || row['No'];
                    const qtyRaw = rowLower['miktar'] || row['Miktar'];

                    if (!catalogNoRaw) return;

                    // Normalization
                    const catalogNo = String(catalogNoRaw).trim();
                    const catLower = catalogNo.toLowerCase();

                    // Exclusion Logic
                    if (catLower.startsWith('zfnae') || catLower.startsWith('hm')) return;

                    const orderQty = parseFloat(qtyRaw) || 0;

                    const aggregateKey = `${rowWeek || ''}::${catalogNo}`;
                    if (!aggregatedData[aggregateKey]) {
                        aggregatedData[aggregateKey] = {
                            qty: 0,
                            orderNos: new Set(),
                            originalRow: row,
                            catalogNo,
                            weekNumber: rowWeek
                        };
                    }

                    aggregatedData[aggregateKey].qty += orderQty;
                    if (orderNo) aggregatedData[aggregateKey].orderNos.add(orderNo);
                    if (!aggregatedData[aggregateKey].weekNumber && rowWeek) aggregatedData[aggregateKey].weekNumber = rowWeek;
                });

                let addedCount = 0;
                let unmatchedCount = 0;
                const catalogKeys = Object.keys(aggregatedData);

                if (catalogKeys.length === 0) {
                    showToast('İşlenecek veri bulunamadı.', 'warning');
                    hideLoading();
                    input.value = '';
                    return;
                }

                // PHASE 1: Expand catalog numbers to components, track unmatched
                // componentMap: week+materialNo -> { qty, orderNos, catalogNos, rxnName, format }
                const componentMap = {};
                const unmatchedProducts = [];

                catalogKeys.forEach(aggregateKey => {
                    const item = aggregatedData[aggregateKey];
                    const catNo = item.catalogNo;
                    const weekNumber = item.weekNumber || targetWeek || new Date().getWeek();
                    const totalQty = item.qty;
                    if (totalQty <= 0) return;

                    // look up in productTree
                    let components = productTree[catNo] || productTree[catNo.toUpperCase()];

                    // Fallback search
                    if (!components) {
                        const key = Object.keys(productTree).find(k => k.toLowerCase() === catNo.toLowerCase());
                        if (key) components = productTree[key];
                    }

                    if (!components) {
                        // Karşılığı olmayan ürün - track it
                        const combinedOrderNo = Array.from(item.orderNos).filter(Boolean).join(', ');
                        unmatchedProducts.push({
                            catalogNo: catNo,
                            orderNo: combinedOrderNo,
                            quantity: totalQty,
                            weekNumber
                        });
                        unmatchedCount++;
                        return;
                    }

                    const orderNosArr = Array.from(item.orderNos).filter(Boolean);

                    // Expand to components and group by materialNo (YM)
                    components.forEach(comp => {
                        const matNo = comp.materialNo || catNo;
                        const componentKey = `${weekNumber || ''}::${matNo}`;
                        const compQty = Math.ceil(totalQty * (comp.multiplier || 1));

                        if (!componentMap[componentKey]) {
                            componentMap[componentKey] = {
                                qty: 0,
                                orderNos: new Set(),
                                catalogNos: new Set(),
                                materialNo: matNo,
                                rxnName: comp.rxnName,
                                format: normalizeOrderFormat(comp.format),
                                weekNumber
                            };
                        }

                        componentMap[componentKey].qty += compQty;
                        orderNosArr.forEach(o => componentMap[componentKey].orderNos.add(o));
                        componentMap[componentKey].catalogNos.add(catNo);
                    });
                });

                // PHASE 2: Create single order entry per unique materialNo (YM)
                Object.keys(componentMap).forEach(componentKey => {
                    const comp = componentMap[componentKey];
                    const combinedOrderNo = Array.from(comp.orderNos).filter(Boolean).join(', ');
                    const combinedCatalogNo = Array.from(comp.catalogNos).filter(Boolean).join(', ');

                    createOrderEntry({
                        catalogNo: combinedCatalogNo,
                        orderNo: combinedOrderNo,
                        quantity: comp.qty,
                        rxnName: comp.rxnName,
                        materialNo: comp.materialNo,
                        format: comp.format,
                        weekNumber: comp.weekNumber || targetWeek || new Date().getWeek()
                    });
                    addedCount++;
                });

                // PHASE 3: Create entries for unmatched products (format boş bırakılır)
                unmatchedProducts.forEach(item => {
                    createOrderEntry({
                        catalogNo: item.catalogNo,
                        orderNo: item.orderNo,
                        quantity: item.quantity,
                        rxnName: '',
                        materialNo: '',
                        format: '',
                        weekNumber: item.weekNumber || targetWeek || new Date().getWeek(),
                        requesterNote: 'Karşılığı olmayan ürün'
                    });
                    addedCount++;
                });

                if (addedCount > 0) {
                    saveOrders();
                    renderDashboard();
                    renderOrders();
                    switchTab('vcap');
                    let msg = `${processedCount} satır okundu, ${Object.keys(componentMap).length} benzersiz bileşen olarak ${addedCount} adet talep oluşturuldu.`;
                    if (unmatchedCount > 0) {
                        msg += ` (${unmatchedCount} ürünün karşılığı bulunamadı)`;
                    }
                    showToast(msg, 'success');
                } else {
                    showToast('Hiçbir talep oluşturulamadı.', 'warning');
                }

                // Reset input
                input.value = '';

                hideLoading();
                } catch (err) {
                    console.error(err);
                    showToast('Veri işleme hatası: ' + err.message, 'error');
                    hideLoading();
                    input.value = '';
                }
            }, 50);
        }

        function normalizeExcelRow(row) {
            const rowLower = {};
            Object.keys(row || {}).forEach(key => {
                rowLower[String(key || '').trim().toLocaleLowerCase('tr')] = row[key];
            });
            return rowLower;
        }

        function getExcelValue(rowLower, keys) {
            for (const key of keys) {
                const normalizedKey = String(key || '').trim().toLocaleLowerCase('tr');
                if (Object.prototype.hasOwnProperty.call(rowLower, normalizedKey)) return rowLower[normalizedKey];
            }
            return '';
        }

        function isBlankExcelValue(value) {
            return value === null || value === undefined || String(value).trim() === '';
        }

        function parseExcelNumber(value) {
            if (isBlankExcelValue(value)) return null;
            if (typeof value === 'number') return value;
            const normalized = String(value).trim().replace(/\./g, '').replace(',', '.');
            const parsed = parseFloat(normalized);
            return Number.isFinite(parsed) ? parsed : null;
        }

        function parseExcelDateOnly(value) {
            if (isBlankExcelValue(value)) return '';
            if (value instanceof Date && !isNaN(value.getTime())) {
                return value.toISOString().split('T')[0];
            }
            if (typeof value === 'number' && Number.isFinite(value)) {
                const utcDays = Math.floor(value - 25569);
                const date = new Date(utcDays * 86400 * 1000);
                if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
            }

            const raw = String(value).trim();
            const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (isoMatch) {
                const [, y, m, d] = isoMatch;
                return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            }
            const trMatch = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
            if (trMatch) {
                const [, d, m, y] = trMatch;
                return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            }
            const parsedDate = new Date(raw);
            if (!isNaN(parsedDate.getTime())) return parsedDate.toISOString().split('T')[0];
            return raw;
        }

        function normalizeImportedStatus(value) {
            const raw = String(value || '').trim();
            if (!raw) return 'Ürün İşlem Bekliyor';
            return normalizeOrderStatus(raw);
        }

        function getImportedStatusValue(rowLower) {
            if (Object.prototype.hasOwnProperty.call(rowLower, 'durum')) {
                return normalizeImportedStatus(getExcelValue(rowLower, ['Durum']));
            }
            return normalizeImportedStatus(getExcelValue(rowLower, ['QC sonuc', 'QC sonuç', 'QC Sonuç']));
        }

        function isDirectOrdersExcelData(jsonData) {
            return Array.isArray(jsonData) && jsonData.some(row => {
                const rowLower = normalizeExcelRow(row);
                return Object.prototype.hasOwnProperty.call(rowLower, 'ürün açıklaması')
                    && (
                        !isBlankExcelValue(getExcelValue(rowLower, ['Madde No']))
                        || !isBlankExcelValue(getExcelValue(rowLower, ['Ürün Açıklaması', 'Urun Aciklamasi']))
                    );
            });
        }

        function importDirectOrdersExcelData(jsonData, targetWeek) {
            let addedCount = 0;

            jsonData.forEach((row, index) => {
                const rowLower = normalizeExcelRow(row);
                const resolvedIdentity = completeOrderIdentityFromProductTree(
                    getExcelValue(rowLower, ['Madde No']),
                    getExcelValue(rowLower, ['Ürün Açıklaması', 'Urun Aciklamasi'])
                );
                const materialNo = resolvedIdentity.materialNo;
                const rxnName = resolvedIdentity.rxnName;
                if (!materialNo && !rxnName) return;

                const weekNumber = getExcelRowWeek(rowLower, targetWeek);
                const requestDate = parseExcelDateOnly(getExcelValue(rowLower, ['Tarih', 'Talep Tarihi'])) || new Date().toISOString().split('T')[0];
                const plannedEndDate = addDaysToDateOnly(requestDate, 14) || '';
                const statusValue = getImportedStatusValue(rowLower);

                const beforeLength = orders.length;
                createOrderEntry({
                    weekNumber,
                    requestDate,
                    materialNo,
                    catalogNo: resolvedIdentity.catalogNo || '',
                    rxnName,
                    format: getExcelValue(rowLower, ['Format']) || resolvedIdentity.format,
                    requesterNote: getExcelValue(rowLower, ['Talep Geçen Not', 'Talep Gecen Not']),
                    distributionNote: getExcelValue(rowLower, ['Dağıtım Yapanın Notu', 'Dagitim Yapanin Notu']),
                    quantity: parseExcelNumber(getExcelValue(rowLower, ['Planlanan Miktar (Rack)'])),
                    plannedRxnQty: parseExcelNumber(getExcelValue(rowLower, ['Planlanan Miktar (Rxn)'])),
                    plannedWellQty: parseExcelNumber(getExcelValue(rowLower, ['Planlanan (well)', 'Planlanan Well'])),
                    requester: '',
                    producer: getExcelValue(rowLower, ['Sorumlu Kişi', 'Sorumlu Kisi']),
                    plannedEndDate,
                    deliveryDate: plannedEndDate,
                    producedQty: parseExcelNumber(getExcelValue(rowLower, ['Gerçekleşen Miktar (Rack)', 'Gerceklesen Miktar (Rack)'])),
                    actualRxnQty: parseExcelNumber(getExcelValue(rowLower, ['Gerçekleşen Miktar (Rxn)', 'Gerceklesen Miktar (Rxn)'])),
                    actualWellQty: parseExcelNumber(getExcelValue(rowLower, ['Gerçekleşen Miktar (well)', 'Gerceklesen Miktar (well)'])),
                    productionOrderNo: getExcelValue(rowLower, ['SBUE No']),
                    lotNo: getExcelValue(rowLower, ['Lot No']),
                    status: statusValue,
                    qcApprover: getExcelValue(rowLower, ['QC Onaylayan']),
                    sourceSystem: 'orders-excel',
                    sourceExternalId: `${weekNumber || ''}|${requestDate}|${materialNo || rxnName}|${index + 1}`
                });
                if (orders.length > beforeLength) addedCount++;
            });

            return addedCount;
        }

        function getExcelRowWeek(rowLower, fallbackWeek = null) {
            const rawWeek = rowLower['hafta']
                ?? rowLower['hafta no']
                ?? rowLower['hafta numarası']
                ?? rowLower['hafta numarasi']
                ?? rowLower['week']
                ?? rowLower['week no'];
            const weekMatch = String(rawWeek ?? '').match(/\d+/);
            if (weekMatch) return parseInt(weekMatch[0], 10);
            return fallbackWeek || new Date().getWeek();
        }

        function buildDeterministicOrderId(data) {
            const rawKey = [
                data.sourceSystem || 'manual',
                data.sourceExternalId || '',
                data.materialNo || '',
                data.catalogNo || '',
                data.weekNumber || ''
            ].join('::');

            let hash = 0;
            for (let i = 0; i < rawKey.length; i++) {
                hash = ((hash << 5) - hash) + rawKey.charCodeAt(i);
                hash |= 0;
            }

            return `ord_${Math.abs(hash)}`;
        }

        function getSalesLineOrderDedupKey(order) {
            if (!order || order.sourceSystem !== 'sales-lines') return '';

            return [
                String(order.sourceExternalId || '').trim(),
                String(order.weekNumber || '').trim(),
                String(order.catalogNo || '').trim(),
                String(order.materialNo || '').trim(),
                String(resolveOrderFormat(order) || order.format || '').trim(),
                String(order.orderNo || '').trim(),
                String(order.quantity || '').trim()
            ].join('::');
        }

        function dedupeSalesLineOrdersInMemory() {
            if (!Array.isArray(orders) || orders.length === 0) return 0;

            const seen = new Set();
            const deduped = [];
            let removedCount = 0;

            for (const order of orders) {
                if (!order || order.sourceSystem !== 'sales-lines') {
                    deduped.push(order);
                    continue;
                }

                const dedupKey = getSalesLineOrderDedupKey(order);
                if (!dedupKey) {
                    deduped.push(order);
                    continue;
                }

                if (seen.has(dedupKey)) {
                    removedCount += 1;
                    continue;
                }

                seen.add(dedupKey);
                deduped.push(order);
            }

            if (removedCount > 0) {
                orders = deduped;
            }

            return removedCount;
        }

        function createOrderEntry(data) {
            const newId = data.sourceExternalId
                ? buildDeterministicOrderId(data)
                : Date.now().toString() + Math.random().toString(36).substr(2, 5);

            // Aynı ID'li kayıt zaten varsa tekrar ekleme (çift sync koruması)
            if (data.sourceExternalId && orders.some(o => o.id === newId)) {
                return orders.find(o => o.id === newId);
            }

            const newOrder = {
                id: newId,
                weekNumber: (data.weekNumber !== undefined && data.weekNumber !== null && data.weekNumber !== '') ? data.weekNumber : new Date().getWeek(),
                requestDate: data.requestDate || new Date().toISOString().split('T')[0],
                requester: Object.prototype.hasOwnProperty.call(data, 'requester') ? data.requester : getActiveUserParaf('Sistem'),
                catalogNo: data.catalogNo,
                materialNo: data.materialNo || '',
                rxnName: data.rxnName || '',
                format: normalizeOrderFormat(data.format),
                quantity: data.quantity,
                plannedRxnQty: data.plannedRxnQty ?? null,
                plannedWellQty: data.plannedWellQty ?? null,
                plannedEndDate: data.plannedEndDate || addDaysToDateOnly(data.requestDate || new Date().toISOString().split('T')[0], 14) || '',
                orderNo: data.orderNo || '',
                country: data.country || '',
                deliveryDate: data.deliveryDate || addDaysToDateOnly(data.requestDate || new Date().toISOString().split('T')[0], 21) || '',
                lotNo: data.lotNo || '',
                status: normalizeOrderStatus(data.status),
                requesterNote: data.requesterNote || '',
                distributionNote: data.distributionNote || '',
                team1Note: data.team1Note || '',
                team2Note: data.team2Note || '',
                producer: data.producer || '',
                producedQty: data.producedQty ?? null,
                actualRxnQty: data.actualRxnQty ?? null,
                actualWellQty: data.actualWellQty ?? null,
                productionOrderNo: data.productionOrderNo || '',
                qcApprover: data.qcApprover || '',
                createdAt: new Date().toISOString(),
                lastModifiedBy: getActiveUserParaf(''),
                lastModifiedAt: new Date().toISOString(),
                changeHistory: [],
                linkedSalesOrderIds: Array.isArray(data.linkedSalesOrderIds) ? data.linkedSalesOrderIds : [],
                sourceSystem: data.sourceSystem || '',
                salesLineRequestMode: data.salesLineRequestMode || '',
                sourceExternalId: data.sourceExternalId || ''
            };
            orders.unshift(newOrder); // Add to top
            return newOrder;
        }

        function createEmptyManualOrder() {
            return {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                weekNumber: selectedWeekFilter || new Date().getWeek(),
                requestDate: new Date().toISOString().split('T')[0],
                requester: getActiveUserParaf(''),
                catalogNo: '',
                materialNo: '',
                rxnName: '',
                format: '',
                quantity: 0,
                plannedRxnQty: null,
                plannedWellQty: null,
                plannedEndDate: addDaysToDateOnly(new Date().toISOString().split('T')[0], 14) || '',
                orderNo: '',
                country: '',
                deliveryDate: '',
                lotNo: '',
                status: 'Ürün İşlem Bekliyor',
                requesterNote: '',
                distributionNote: '',
                team1Note: '',
                team2Note: '',
                producer: '',
                producedQty: null,
                actualRxnQty: null,
                actualWellQty: null,
                productionOrderNo: '',
                qcApprover: '',
                createdAt: new Date().toISOString(),
                lastModifiedBy: getActiveUserParaf(''),
                lastModifiedAt: new Date().toISOString(),
                changeHistory: [],
                linkedSalesOrderIds: [],
                sourceSystem: 'manual'
            };
        }

        function addManualRequestRow() {
            const newOrder = createEmptyManualOrder();
            orders.unshift(newOrder);
            saveOrders();
            renderDashboard();
            applyRequestFilters();
            renderWeekSidebar();
            showToast('Yeni manuel talep satırı eklendi.', 'success');
        }

        // Detail Modal
        function openDetailModal(id) {
            const order = orders.find(o => o.id === id);
            if (!order) return;

            document.getElementById('detailId').value = id;
            const detailModal = document.getElementById('detailModal');
            if (detailModal) {
                const baseMeta = getOrderBaseMeta(order);
                detailModal.dataset.baseVersion = String(baseMeta.version || 0);
                detailModal.dataset.baseUpdatedAt = baseMeta.updatedAt || '';
                detailModal.dataset.baseHistoryLength = String(baseMeta.changeHistoryLength || 0);
            }

            // Populate info grid
            const infoGrid = document.getElementById('detailInfoGrid');
            infoGrid.innerHTML = `
                <div><strong style="color: var(--text-muted);">Hafta:</strong> ${order.weekNumber || '-'}. Hafta</div>
                <div><strong style="color: var(--text-muted);">Talep Tarihi:</strong> ${order.requestDate ? formatDate(order.requestDate) : '-'}</div>
                <div><strong style="color: var(--text-muted);">Talep Eden:</strong> ${order.requester}</div>
                <div><strong style="color: var(--text-muted);">Katalog No:</strong> ${order.catalogNo || '-'}</div>
                <div><strong style="color: var(--text-muted);">Madde No:</strong> ${order.materialNo || '-'}</div>
                <div><strong style="color: var(--text-muted);">Rxn Adı:</strong> ${order.rxnName}</div>
                <div><strong style="color: var(--text-muted);">Format:</strong> ${order.format}</div>
                <div><strong style="color: var(--text-muted);">Talep Edilen Miktar:</strong> ${order.quantity}</div>
                <div><strong style="color: var(--text-muted);">Sipariş No:</strong> ${order.orderNo || '-'}</div>
                <div><strong style="color: var(--text-muted);">Teslim Tarihi:</strong> ${order.deliveryDate ? formatDate(order.deliveryDate) : '-'}</div>
                <div><strong style="color: var(--text-muted);">Lot No:</strong> ${order.lotNo || '-'}</div>
                <div><strong style="color: var(--text-muted);">Talep Eden Not:</strong> ${order.requesterNote || '-'}</div>
                <div style="grid-column: span 2;"><strong style="color: var(--text-muted);">Ekip 1 Not:</strong> ${order.team1Note || '-'}</div>
                <div style="grid-column: span 2;"><strong style="color: var(--text-muted);">Ekip 2 Not:</strong> ${order.team2Note || '-'}</div>
            `;

            // Populate editable fields
            fillDetailMaterialNoOptions();
            document.getElementById('detailWeekNumber').value = order.weekNumber || '';
            document.getElementById('detailRequestDate').value = order.requestDate || '';
            document.getElementById('detailRequester').value = order.requester || '';
            document.getElementById('detailOrderNo').value = order.orderNo || '';
            document.getElementById('detailCatalogNo').value = order.catalogNo || '';
            document.getElementById('detailMaterialNo').value = order.materialNo || '';
            document.getElementById('detailRxnName').value = order.rxnName || '';
            document.getElementById('detailFormat').value = order.format || '';
            document.getElementById('detailQuantity').value = order.quantity ?? '';
            document.getElementById('detailDeliveryDate').value = order.deliveryDate || '';
            document.getElementById('detailLotNo').value = order.lotNo || '';
            document.getElementById('detailRequesterNote').value = order.requesterNote || '';
            document.getElementById('detailProductionOrderNo').value = order.productionOrderNo || '';
            document.getElementById('detailProducer').value = order.producer || '';
            document.getElementById('detailProducedQty').value = order.producedQty || '';
            document.getElementById('detailQcApprover').value = order.qcApprover || '';
            document.getElementById('detailStatus').value = normalizeOrderStatus(order.status);

            document.getElementById('detailModal').classList.add('active');
        }

        function closeDetailModal() {
            document.getElementById('detailModal').classList.remove('active');
        }

        function handleDetailSave(e) {
            e.preventDefault();

            const id = document.getElementById('detailId').value;
            const orderIndex = orders.findIndex(o => o.id === id);

            if (orderIndex === -1) return;

            const order = orders[orderIndex];
            const detailModal = document.getElementById('detailModal');
            const baseMeta = {
                version: Number(detailModal?.dataset.baseVersion || 0) || 0,
                updatedAt: detailModal?.dataset.baseUpdatedAt || '',
                changeHistoryLength: Number(detailModal?.dataset.baseHistoryLength || 0) || 0
            };
            if (!order.changeHistory) order.changeHistory = [];
            const changedBy = getActiveUserParaf('Bilinmiyor');
            const changedAt = new Date().toISOString();

            // Değişiklikleri karşılaştır ve kaydet
            const detailFields = [
                { key: 'weekNumber', label: 'Hafta', el: 'detailWeekNumber' },
                { key: 'requestDate', label: 'Tarih', el: 'detailRequestDate' },
                { key: 'requester', label: 'Talep Eden', el: 'detailRequester' },
                { key: 'orderNo', label: 'Sipariş No', el: 'detailOrderNo' },
                { key: 'catalogNo', label: 'Katalog No', el: 'detailCatalogNo' },
                { key: 'materialNo', label: 'Madde No', el: 'detailMaterialNo' },
                { key: 'rxnName', label: 'Ürün Açıklaması', el: 'detailRxnName' },
                { key: 'format', label: 'Format', el: 'detailFormat' },
                { key: 'deliveryDate', label: 'Teslim Tarihi', el: 'detailDeliveryDate' },
                { key: 'lotNo', label: 'Lot No', el: 'detailLotNo' },
                { key: 'requesterNote', label: 'Talep Geçen Not', el: 'detailRequesterNote' },
                { key: 'productionOrderNo', label: 'SBUE No', el: 'detailProductionOrderNo' },
                { key: 'producer', label: 'Sorumlu Kişi', el: 'detailProducer' },
                { key: 'qcApprover', label: 'QC Onaylayan', el: 'detailQcApprover' },
                { key: 'status', label: 'Durum', el: 'detailStatus' }
            ];
            detailFields.forEach(f => {
                let newVal = document.getElementById(f.el).value;
                if (f.key === 'status') newVal = normalizeOrderStatus(newVal);
                const oldVal = f.key === 'status' ? normalizeOrderStatus(order[f.key]) : order[f.key];
                if (String(oldVal || '') !== String(newVal)) {
                    order.changeHistory.push({
                        field: f.label,
                        oldValue: oldVal || '',
                        newValue: newVal,
                        changedBy, changedAt
                    });
                }
            });
            const newProducedQty = document.getElementById('detailProducedQty').value ?
                parseInt(document.getElementById('detailProducedQty').value) : null;
            if (String(order.producedQty || '') !== String(newProducedQty || '')) {
                order.changeHistory.push({
                    field: 'Üretilen Miktar',
                    oldValue: order.producedQty || '',
                    newValue: newProducedQty || '',
                    changedBy, changedAt
                });
            }
            const newQuantity = document.getElementById('detailQuantity').value
                ? parseInt(document.getElementById('detailQuantity').value, 10)
                : 0;
            if (String(order.quantity || '') !== String(newQuantity)) {
                order.changeHistory.push({
                    field: 'Talep Miktarı',
                    oldValue: order.quantity || '',
                    newValue: newQuantity,
                    changedBy, changedAt
                });
            }

            order.weekNumber = document.getElementById('detailWeekNumber').value || '';
            order.requestDate = document.getElementById('detailRequestDate').value || '';
            order.requester = document.getElementById('detailRequester').value || '';
            order.orderNo = document.getElementById('detailOrderNo').value || '';
            order.catalogNo = document.getElementById('detailCatalogNo').value || '';
            order.materialNo = String(document.getElementById('detailMaterialNo').value || '').trim().toUpperCase();
            handleDetailMaterialNoInput(order.materialNo);
            order.rxnName = document.getElementById('detailRxnName').value || '';
            order.format = normalizeOrderFormat(document.getElementById('detailFormat').value || '');
            order.quantity = newQuantity;
            order.deliveryDate = document.getElementById('detailDeliveryDate').value || '';
            order.lotNo = document.getElementById('detailLotNo').value || '';
            order.requesterNote = document.getElementById('detailRequesterNote').value || '';
            order.productionOrderNo = document.getElementById('detailProductionOrderNo').value;
            order.producer = document.getElementById('detailProducer').value;
            order.producedQty = newProducedQty;
            order.qcApprover = document.getElementById('detailQcApprover').value;
            order.status = normalizeOrderStatus(document.getElementById('detailStatus').value);
            order.lastModifiedBy = getActiveUserParaf(order.lastModifiedBy || '');
            order.lastModifiedAt = new Date().toISOString();

            scheduleRequestOrderSave(id, baseMeta, { reason: 'request-detail-edit' });
            renderDashboard();
            applyRequestFilters();
            closeDetailModal();
            showToast('Talep güncellendi!', 'success');
        }

        // Delete Order
        function deleteOrder(id) {
            if (!canDeleteData()) {
                showToast('Bu işlem için yetkiniz yok.', 'error');
                return;
            }
            if (!confirm('Bu talebi silmek istediğinizden emin misiniz?')) return;

            const order = orders.find(o => String(o.id) === String(id));
            const baseMeta = getOrderBaseMeta(order);
            orders = orders.filter(o => String(o.id) !== String(id));
            selectedOrderIds.delete(String(id));
            saveOrders({
                reason: 'request-delete',
                deletedOrderIds: [String(id)],
                rowBaseMeta: { [String(id)]: baseMeta }
            });
            renderDashboard();
            applyRequestFilters();
            syncOrdersBulkSelectionUi();
            showToast('Talep silindi!', 'warning');
        }

        // Değişiklik Geçmişi Göster
        function showChangeHistory(id) {
            // Menüyü kapat
            document.querySelectorAll('.row-menu-dropdown').forEach(m => m.classList.remove('active'));

            const order = orders.find(o => o.id === id);
            if (!order) return;

            const container = document.getElementById('changeHistoryContent');
            const history = order.changeHistory || [];

            if (history.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                        <p style="font-size: 2rem; margin-bottom: 0.5rem;">Bilgi</p>
                        <p>Bu talep için henüz değişiklik kaydı bulunmuyor.</p>
                    </div>
                `;
            } else {
                // En yeniden en eskiye sırala
                const sortedHistory = [...history].reverse();
                let tableHtml = `
                    <div style="margin-bottom: 1rem; padding: 0.75rem; background: var(--bg-secondary); border-radius: 8px;">
                        <strong>${order.rxnName || order.catalogNo || 'Talep'}</strong>
                        <span style="color: var(--text-muted); margin-left: 0.5rem;">| ${order.materialNo || ''}</span>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                        <thead>
                            <tr style="background: var(--bg-secondary); text-align: left;">
                                <th style="padding: 8px 10px; border-bottom: 2px solid var(--border-color);">Tarih & Saat</th>
                                <th style="padding: 8px 10px; border-bottom: 2px solid var(--border-color);">Değiştiren</th>
                                <th style="padding: 8px 10px; border-bottom: 2px solid var(--border-color);">Alan</th>
                                <th style="padding: 8px 10px; border-bottom: 2px solid var(--border-color);">Eski Değer</th>
                                <th style="padding: 8px 10px; border-bottom: 2px solid var(--border-color);">Yeni Değer</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
                sortedHistory.forEach(h => {
                    const date = new Date(h.changedAt);
                    const dateStr = date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const timeStr = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    tableHtml += `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 8px 10px; white-space: nowrap;">
                                <div style="font-weight: 500;">${dateStr}</div>
                                <div style="color: var(--text-muted); font-size: 0.8rem;">${timeStr}</div>
                            </td>
                            <td style="padding: 8px 10px;"><strong>${h.changedBy}</strong></td>
                            <td style="padding: 8px 10px; color: var(--accent-primary);">${h.field}</td>
                            <td style="padding: 8px 10px; color: #ef4444; text-decoration: line-through;">${h.oldValue || '-'}</td>
                            <td style="padding: 8px 10px; color: #10b981; font-weight: 500;">${h.newValue || '-'}</td>
                        </tr>
                    `;
                });
                tableHtml += '</tbody></table>';
                container.innerHTML = tableHtml;
            }

            document.getElementById('changeHistoryModal').classList.add('active');
        }

        function closeChangeHistoryModal() {
            document.getElementById('changeHistoryModal').classList.remove('active');
        }

        // Inline Status Update
        function updateStatus(id, newStatus) {
            const orderIndex = orders.findIndex(o => o.id === id);
            if (orderIndex === -1) return;
            newStatus = normalizeOrderStatus(newStatus);
            const baseMeta = getOrderBaseMeta(orders[orderIndex]);

            // Scroll pozisyonunu kaydet
            const tbodyEl = document.getElementById('ordersTableBody');
            const tContainer = tbodyEl ? tbodyEl.closest('.table-container') : null;
            const sTop = tContainer ? tContainer.scrollTop : 0;
            const sLeft = tContainer ? tContainer.scrollLeft : 0;
            const pScrollY = window.scrollY;

            // Değişiklik geçmişi kaydet
            if (!orders[orderIndex].changeHistory) orders[orderIndex].changeHistory = [];
            const oldStatus = normalizeOrderStatus(orders[orderIndex].status);
            if (oldStatus !== newStatus) {
                orders[orderIndex].changeHistory.push({
                    field: 'Durum',
                    oldValue: oldStatus,
                    newValue: newStatus,
                    changedBy: getActiveUserParaf('Bilinmiyor'),
                    changedAt: new Date().toISOString()
                });
            }

            orders[orderIndex].status = newStatus;
            orders[orderIndex].lastModifiedBy = getActiveUserParaf(orders[orderIndex].lastModifiedBy || '');
            orders[orderIndex].lastModifiedAt = new Date().toISOString();
            scheduleRequestOrderSave(id, baseMeta, { reason: 'request-status-edit' });
            renderDashboard();
            applyRequestFilters();
            renderWeekSidebar();
            showToast('Durum güncellendi!', 'success');

            // Scroll pozisyonunu geri yükle
            requestAnimationFrame(() => {
                if (tContainer) { tContainer.scrollTop = sTop; tContainer.scrollLeft = sLeft; }
                window.scrollTo(0, pScrollY);
            });
        }

        // Inline Cell Edit
        function editCell(id, field, element) {
            const order = orders.find(o => o.id === id);
            if (!order) return;

            const currentValue = order[field];
            const input = document.createElement('input');
            input.type = 'number';
            input.value = currentValue;
            input.style.cssText = 'width: 60px; padding: 4px; background: var(--bg-tertiary); border: 1px solid var(--accent-primary); border-radius: 4px; color: white;';

            element.innerHTML = '';
            element.appendChild(input);
            input.focus();

            const saveValue = () => {
                const newValue = parseInt(input.value) || currentValue;
                order[field] = newValue;
                saveOrders();
                renderOrders();
                showToast('Miktar güncellendi!', 'success');
            };

            input.onblur = saveValue;
            input.onkeydown = (e) => {
                if (e.key === 'Enter') saveValue();
                if (e.key === 'Escape') renderOrders();
            };
        }

        // Helper Functions
        function getStatusBadge(status) {
            const normalizedStatus = normalizeOrderStatus(status);
            const statusMap = {
                'Ürün İşlem Bekliyor': '',
                'Ürün Oligo Bekliyor': 'qc-bekliyor',
                'Ürün Planlandı': 'qc-bekliyor',
                'Ürün Dağıtıldı': 'qc-gidecek',
                'Ürün QC ye gitti': 'qc-bekliyor',
                'Ürün QC tekrarına gitti': 'qc-tekrar',
                'Ürün QC den Geçmedi': 'imha',
                'Ürün Revizyon bekliyor': 'qc-tekrar',
                'Ürün Etiketlendi': 'qc-gidecek',
                'Ürün Teslim Edildi': 'teslim-edildi',
                'Ürün İptal Edildi': 'imha',
                'Ürün Lojistikte': 'qc-gidecek',
                'Ürün Çıktı': 'teslim-edildi',
                '-': '' // Default neutral style
            };

            const iconMap = {
                'Ürün İşlem Bekliyor': '',
                'Ürün Oligo Bekliyor': '...',
                'Ürün Planlandı': 'P',
                'Ürün Dağıtıldı': 'D',
                'Ürün QC ye gitti': 'QC',
                'Ürün QC tekrarına gitti': '!',
                'Ürün QC den Geçmedi': '!',
                'Ürün Revizyon bekliyor': 'R',
                'Ürün Etiketlendi': 'E',
                'Ürün Teslim Edildi': 'OK',
                'Ürün İptal Edildi': '!',
                'Ürün Lojistikte': 'â†’',
                'Ürün Çıktı': 'OK',
                '-': ''
            };

            return `<span class="status-badge ${statusMap[normalizedStatus] || ''}">${iconMap[normalizedStatus] || ''} ${normalizedStatus}</span>`;
        }

        function formatDate(dateStr) {
            if (!dateStr) return '-';
            const date = new Date(dateStr);
            return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }

        function formatDateTimeShort(dateStr) {
            if (!dateStr) return '-';
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return '-';
            return date.toLocaleString('tr-TR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        function showToast(message, type = 'success', duration = 3000) {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = `toast ${type} `;
            toast.innerHTML = `
            <span>${type === 'success' ? 'âœ…' : type === 'error' ? '' : 'âš '}</span>
                <span>${message}</span>
        `;
            container.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'slideIn 0.3s ease reverse';
                setTimeout(() => toast.remove(), 300);
            }, duration);
        }

        // Close modal on outside click
        document.getElementById('detailModal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                closeDetailModal();
            }
        });

        // Initialize Form Defaults
        document.addEventListener('DOMContentLoaded', () => {
            // Ensure options are populated
            if (typeof populateWeekDropdowns === 'function') populateWeekDropdowns();
            initializeFormValues();
        });

        // Theme Logic
        function toggleTheme() {
            document.body.classList.toggle('light-mode');
            const isLight = document.body.classList.contains('light-mode');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
            updateThemeIcon();
        }

        function updateThemeIcon() {
            const btn = document.getElementById('themeToggleBtn');
            if (btn) btn.textContent = document.body.classList.contains('light-mode') ? 'Açık' : 'Kapalı';
        }

        // Delete All Logic
        async function finalizeDeleteAllOrders() {
            orders = [];
            filteredOrders = [];

            if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof firebaseSync !== 'undefined') {
                if (firebaseSync.ordersRef && typeof firebaseSync.saveToFirebase === 'function') {
                    await firebaseSync.saveToFirebase([]);
                }
            }

            if (typeof saveOrders === 'function') {
                await saveOrders();
            }

            renderSalesLinesSummary();
            renderDashboard();
            applyRequestFilters();
            renderOrders();

            if (document.getElementById('destroyed-view')?.classList.contains('active')) renderDestroyedView();
            if (document.getElementById('islemde-view')?.classList.contains('active')) renderIslemdeView();
            if (document.getElementById('teslim-view')?.classList.contains('active')) renderTeslimView();
            if (document.getElementById('dagitilan-view')?.classList.contains('active')) renderDagitilanView();
            if (document.getElementById('qcrepeat-view')?.classList.contains('active')) renderQcRepeatView();
            if (document.getElementById('etiketlendi-view')?.classList.contains('active')) renderEtiketlendiView();

            renderWeekSidebar();
            showToast('Talepler başarıyla silindi.', 'success');
        }

        function deleteAllOrders() {
            if (!canDeleteData()) {
                showToast('Bu işlem sadece admin tarafından yapılabilir!', 'error');
                return;
            }
            if (orders.length === 0) {
                showToast('Silinecek talep yok.', 'warning');
                return;
            }

            const approved = confirm('DİKKAT: Bu işlem sadece talepleri sıfırlar. Satış siparişleri silinmez.\n\nEmin misiniz?');
            if (!approved) return;

            const confirmed = confirm('Talepler listesini tamamen temizlemek istiyor musunuz?');
            if (!confirmed) return;

            finalizeDeleteAllOrders().catch((error) => {
                console.error('Tum veri sifirlama hatasi:', error);
                showToast('Veriler sifirlanirken hata olustu.', 'error');
            });
        }

        window.finalizeDeleteAllOrders = finalizeDeleteAllOrders;

        // Sidebar Toggle Logic
        function toggleSidebar() {
            const sidebar = document.getElementById('weekSidebar');
            const showBtn = document.getElementById('showSidebarBtn');
            const layout = document.getElementById('ordersLayout');
            const isCollapsed = sidebar.classList.toggle('collapsed');

            if (isCollapsed) {
                showBtn.style.display = 'flex';
                if (layout) layout.classList.add('sidebar-collapsed');
                // Slight delay for animation smoothness
                setTimeout(() => showBtn.style.opacity = '1', 50);
            } else {
                showBtn.style.display = 'none';
                showBtn.style.opacity = '0';
                if (layout) layout.classList.remove('sidebar-collapsed');
            }

            // Save preference
            localStorage.setItem('sidebarCollapsed', isCollapsed);
        }

        // Initialize Sidebar State
        document.addEventListener('DOMContentLoaded', () => {
            const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
            if (isCollapsed) {
                const sidebar = document.getElementById('weekSidebar');
                const showBtn = document.getElementById('showSidebarBtn');
                const layout = document.getElementById('ordersLayout');
                sidebar.classList.add('collapsed');
                showBtn.style.display = 'flex';
                showBtn.style.opacity = '1';
                if (layout) layout.classList.add('sidebar-collapsed');
            }
        });

        function wrapExcelExportText(value, maxLineLength = 24) {
            const text = String(value ?? '').replace(/\s+/g, ' ').trim();
            if (text.length <= maxLineLength) return text;

            const words = text.split(' ');
            const lines = [];
            let currentLine = '';

            words.forEach(word => {
                const parts = word.length > maxLineLength
                    ? word.match(new RegExp(`.{1,${maxLineLength}}`, 'g')) || [word]
                    : [word];

                parts.forEach(part => {
                    if (!currentLine) {
                        currentLine = part;
                        return;
                    }

                    if ((currentLine + ' ' + part).length <= maxLineLength) {
                        currentLine += ' ' + part;
                    } else {
                        lines.push(currentLine);
                        currentLine = part;
                    }
                });
            });

            if (currentLine) lines.push(currentLine);
            return lines.join('\n');
        }

        function shouldWrapExcelExportColumn(label, value) {
            const wrapColumns = new Set([
                'Talep Eden',
                'Rxn Adı',
                'Rxn Ad?',
                'Talep Eden Not',
                'Üretim Yapan Ekibin Notu',
                '?retim Yapan Ekibin Notu',
                'Durum',
                'Değiştiren',
                'De?i?tiren'
            ]);
            const text = String(value ?? '');
            return wrapColumns.has(label) || text.length > 48;
        }

        function getExcelExportLineLength(label) {
            if (label === 'Rxn Adı' || label === 'Rxn Ad?' || label.includes('Not')) return 28;
            return 24;
        }

        function applyExcelExportLayout(ws, headers, exportData) {
            ws['!cols'] = headers.map(header => {
                const hasWrappedValue = exportData.some(row => String(row[header] || '').includes('\n'));
                if (hasWrappedValue) return { wch: 34 };
                const maxLength = exportData.reduce((max, row) => {
                    return Math.max(max, String(row[header] || '').length, String(header).length);
                }, String(header).length);
                return { wch: Math.min(Math.max(maxLength + 2, 10), 24) };
            });
            ws['!rows'] = [{ hpt: 24 }, ...exportData.map(row => {
                const lineCount = Math.max(...headers.map(header => String(row[header] || '').split('\n').length));
                return { hpt: Math.min(Math.max(lineCount * 18, 22), 120) };
            })];

            const range = XLSX.utils.decode_range(ws['!ref']);
            for (let row = range.s.r; row <= range.e.r; row++) {
                for (let col = range.s.c; col <= range.e.c; col++) {
                    const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                    if (!ws[cellAddress]) continue;
                    ws[cellAddress].s = {
                        alignment: { wrapText: true, vertical: row === 0 ? 'center' : 'top' }
                    };
                }
            }
        }

        async function writeStyledExportWorkbook(headers, rows, sheetName, filename) {
            await ensureExcelJs();
            if (typeof ExcelJS === 'undefined') return false;

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet(sheetName);
            worksheet.columns = headers.map(header => {
                const hasWrappedValue = rows.some(row => String(row[header] || '').includes('\n'));
                const maxLength = rows.reduce((max, row) => {
                    return Math.max(max, String(row[header] || '').length, String(header).length);
                }, String(header).length);
                return {
                    header,
                    key: header,
                    width: hasWrappedValue ? 34 : Math.min(Math.max(maxLength + 2, 10), 24)
                };
            });
            worksheet.addRows(rows);
            worksheet.views = [{ state: 'frozen', ySplit: 1 }];

            worksheet.getRow(1).height = 24;
            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };

            rows.forEach((row, index) => {
                const excelRow = worksheet.getRow(index + 2);
                const lineCount = Math.max(...headers.map(header => String(row[header] || '').split('\n').length));
                excelRow.height = Math.min(Math.max(lineCount * 18, 24), 140);
                excelRow.eachCell(cell => {
                    cell.alignment = { vertical: 'top', wrapText: true };
                });
            });

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            link.click();
            URL.revokeObjectURL(link.href);
            return true;
        }

        // Excel Export
        async function exportToExcel() {
            // Determine filename based on context
            let filename = 'Tum_Talepler.xlsx';
            if (activeTabFilter === 'urgent') filename = 'Acil_Beklenen_Talepler.xlsx';
            else if (activeTabFilter === 'overdue') filename = 'Geciken_Talepler.xlsx';
            else if (activeTabFilter === 'delivered') filename = 'Teslim_Edilen_Talepler.xlsx';
            else if (activeTabFilter === 'vcap') filename = 'vCAP_Talepleri.xlsx';
            else if (activeTabFilter === 'liyofilize') filename = 'Liyofilize_Talepleri.xlsx';
            else if (activeTabFilter === 'tube') filename = 'Tup_Talepleri.xlsx';
            else if (activeTabFilter === 'unmatched') filename = 'Karsiligi_Olmayan_Talepler.xlsx';

            const filteredOrders = orders.filter(order => {
                if (selectedWeekFilter !== null) {
                    if (parseInt(order.weekNumber) !== selectedWeekFilter) return false;
                }

                const tabBucket = getFormatBucket(order);
                const unmatched = isUnmatchedOrder(order);

                if (activeTabFilter === 'urgent') {
                    if (!isUrgentExpectedOrder(order)) return false;
                } else if (activeTabFilter === 'overdue') {
                    if (!isOverdueRequestOrder(order)) return false;
                } else if (activeTabFilter === 'delivered') {
                    if (!isDeliveredRequestOrder(order)) return false;
                } else if (activeTabFilter === 'vcap') {
                    if (tabBucket !== 'vcap' || unmatched) return false;
                } else if (activeTabFilter === 'liyofilize') {
                    if (tabBucket !== 'liyofilize' || unmatched) return false;
                } else if (activeTabFilter === 'tube') {
                    if (tabBucket !== 'tube' || unmatched) return false;
                } else if (activeTabFilter === 'unmatched') {
                    if (!unmatched) return false;
                }
                if (isDeliveredRequestOrder(order) && activeTabFilter !== 'delivered') return false;
                return true;
            });

            if (filteredOrders.length === 0) {
                showToast('Dışa aktarılacak veri bulunamadı.', 'warning');
                return;
            }

            // S?tun s?ras?n? kullan?c?n?n d?zenledi?i currentColumns'a g?re belirle
            const colFieldMap = {
                'weekNumber': { label: 'Hafta', wch: 6, format: v => v },
                'requestDate': { label: 'Tarih', wch: 12, format: v => v ? formatDate(v) : '-' },
                'orderNo': { label: 'Sipari? No', wch: 15, format: v => v || '' },
                'requester': { label: 'Talep Eden', wch: 10, format: v => v || '' },
                'catalogNo': { label: 'Katalog No', wch: 12, format: v => v || '' },
                'materialNo': { label: 'Madde No', wch: 12, format: v => v || '' },
                'rxnName': { label: 'Ürün Açıklaması', wch: 25, format: v => v || '' },
                'format': { label: 'Format', wch: 10, format: v => v || '' },
                'requesterNote': { label: 'Talep Geçen Not', wch: 20, format: v => v || '' },
                'quantity': { label: 'Planlanan Miktar (Rack)', wch: 18, format: v => v },
                'plannedRxnQty': { label: 'Planlanan Miktar (Rxn)', wch: 18, format: v => v || '' },
                'plannedWellQty': { label: 'Planlanan (well)', wch: 16, format: v => v || '' },
                'producer': { label: 'Sorumlu Kişi', wch: 14, format: v => v || '' },
                'distributionNote': { label: 'Dağıtım Yapanın Notu', wch: 24, format: v => v || '' },
                'plannedEndDate': { label: 'Planlanan Bitiş', wch: 16, format: v => v ? formatDate(v) : '-' },
                'producedQty': { label: 'Gerçekleşen Miktar (Rack)', wch: 20, format: v => v || '' },
                'actualRxnQty': { label: 'Gerçekleşen Miktar (Rxn)', wch: 20, format: v => v || '' },
                'actualWellQty': { label: 'Gerçekleşen Miktar (well)', wch: 20, format: v => v || '' },
                'lotNo': { label: 'Lot No', wch: 20, format: v => v || '' },
                'productionOrderNo': { label: 'SBUE No', wch: 18, format: v => v || '' },
                'producerNote': { label: '?retim Yapan Ekibin Notu', wch: 25, format: v => v || '' },
                'status': { label: 'Durum', wch: 22, format: v => normalizeOrderStatus(v) },
                'qcApprover': { label: 'QC Onaylayan', wch: 14, format: v => v || '' },
                'lastModifiedBy': { label: 'De?i?tiren', wch: 10, format: v => v || '' }
            };

            // currentColumns s?ras?na g?re export et
            const orderedCols = currentColumns.filter(c => colFieldMap[c.id]);
            orderedCols.push({ id: 'lastModifiedBy' });

            const exportData = filteredOrders.map(o => {
                const row = {};
                orderedCols.forEach(col => {
                    const map = colFieldMap[col.id];
                    if (map) {
                        const value = map.format(o[col.id]);
                        row[map.label] = shouldWrapExcelExportColumn(map.label, value)
                            ? wrapExcelExportText(value, getExcelExportLineLength(map.label))
                            : value;
                    }
                });
                return row;
            });

            const headers = orderedCols.map(col => colFieldMap[col.id]?.label).filter(Boolean);
            if (await writeStyledExportWorkbook(headers, exportData, 'Talepler', filename)) {
                showToast('Excel dosyası indiriliyor...', 'success');
                return;
            }

            await ensureSheetJs();
            const ws = XLSX.utils.json_to_sheet(exportData);
            applyExcelExportLayout(ws, headers, exportData);

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Talepler');
            XLSX.writeFile(wb, filename);
            showToast('Excel dosyas? indiriliyor...', 'success');
        }

        // Adapt pasted row to the active tab's format/filter context
        function adaptRowToActiveTab(row) {
            if (activeTabFilter === 'vcap') {
                if (isUnmatchedOrder(row)) row.requesterNote = '';
                row.format = 'vCAP';
            } else if (activeTabFilter === 'liyofilize') {
                if (isUnmatchedOrder(row)) row.requesterNote = '';
                row.format = 'Liyofilize';
            } else if (activeTabFilter === 'tube') {
                if (isUnmatchedOrder(row)) row.requesterNote = '';
                row.format = 'Tup';
            } else if (activeTabFilter === 'unmatched') {
                row.requesterNote = 'Karsiligi olmayan urun';
                row.format = '';
            }
            // 'orders' tab: no adaptation needed, paste as-is
        }

        // Insert copied row above target row (Excel: "Kopyalanan Hücreleri Ekle")
        function pasteRowAbove(orderId) {
            if (!_copiedRow) {
                showToast('Önce bir satır kopyalayın!', 'error');
                return;
            }

            const newOrder = JSON.parse(JSON.stringify(_copiedRow));
            newOrder.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
            newOrder.createdAt = new Date().toISOString();

            // Adapt to active tab so the row appears in the correct list
            adaptRowToActiveTab(newOrder);
            newOrder.lastModifiedBy = getActiveUserParaf(newOrder.lastModifiedBy || '');
            newOrder.lastModifiedAt = new Date().toISOString();

            const index = orders.findIndex(o => o.id === orderId);
            orders.splice(index, 0, newOrder);

            saveOrders();
            renderDashboard();
            applyRequestFilters();
            showToast('gY"O Kopyalanan satır üste eklendi!', 'success');

            document.querySelectorAll('.row-menu-dropdown').forEach(m => m.classList.remove('active'));
        }

        // Paste copied row data into existing row (overwrites content, keeps id and createdAt)
        function pasteIntoRow(orderId) {
            if (!_copiedRow) {
                showToast('Önce bir satır kopyalayın!', 'error');
                return;
            }

            const order = orders.find(o => o.id === orderId);
            if (!order) return;

            const copiedData = JSON.parse(JSON.stringify(_copiedRow));
            // Keep the target row's id and createdAt, overwrite everything else
            const keepId = order.id;
            const keepCreatedAt = order.createdAt;
            const keepHistory = order.changeHistory || [];

            // Değişiklik geçmişi kaydet
            keepHistory.push({
                field: 'Tümü',
                oldValue: '(önceki veriler)',
                newValue: 'Kopyalanan veri yapıştırıldı',
                changedBy: getActiveUserParaf('Bilinmiyor'),
                changedAt: new Date().toISOString()
            });

            Object.assign(order, copiedData);
            order.id = keepId;
            order.createdAt = keepCreatedAt;
            order.changeHistory = keepHistory;

            // Adapt to active tab so the row stays visible in the current list
            adaptRowToActiveTab(order);
            order.lastModifiedBy = getActiveUserParaf(order.lastModifiedBy || '');
            order.lastModifiedAt = new Date().toISOString();

            saveOrders();
            renderDashboard();
            applyRequestFilters();
            showToast('Kopyalanan veriler bu satıra yapıştırıldı!', 'success');

            // Close menu
            document.querySelectorAll('.row-menu-dropdown').forEach(m => m.classList.remove('active'));
        }

        // Add Empty Row Above Logic
        function addEmptyRowAbove(orderId) {
            // Create empty row
            const newOrder = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                weekNumber: new Date().getWeek(),
                requestDate: new Date().toISOString().split('T')[0],
                requester: '',
                catalogNo: '',
                materialNo: '',
                rxnName: '',
                format: '',
                quantity: 0,
                orderNo: '',
                country: '',
                deliveryDate: '',
                lotNo: '',
                status: '-',
                requesterNote: '',
                team1Note: '',
                team2Note: '',
                producer: '',
                producedQty: null,
                productionOrderNo: '',
                qcApprover: '',
                createdAt: new Date().toISOString(),
                lastModifiedBy: getActiveUserParaf(''),
                lastModifiedAt: new Date().toISOString(),
                changeHistory: []
            };

            const index = orders.findIndex(o => o.id === orderId);
            orders.splice(index, 0, newOrder);

            saveOrders();
            renderDashboard();
            applyRequestFilters();
            showToast('Üste boş satır eklendi!', 'success');

            // Close menu
            document.querySelectorAll('.row-menu-dropdown').forEach(m => m.classList.remove('active'));
        }

        function toggleRowMenu(orderId) {
            // Close all other menus
            document.querySelectorAll('.row-menu-dropdown').forEach(m => {
                if (m.id !== `menu-${orderId}`) m.classList.remove('active');
            });

            const menu = document.getElementById(`menu-${orderId}`);
            if (menu) menu.classList.toggle('active');

            // Close menu when clicking elsewhere
            const closeMenu = (e) => {
                if (!e.target.closest('.row-menu-container')) {
                    menu.classList.remove('active');
                    document.removeEventListener('click', closeMenu);
                }
            };
            document.addEventListener('click', closeMenu);
        }
