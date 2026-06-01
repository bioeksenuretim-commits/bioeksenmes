/**
 * Firebase Authentication Manager
 * Paraf + sifre sistemini Firebase Auth ile calistirir.
 */

const FirebaseAuthManager = {
    EMAIL_DOMAIN: '@reaksiyon.local',
    async ensureTabScopedPersistence() {
        if (!firebaseReady || !firebase.auth?.Auth?.Persistence) return;
        await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION);
    },

    promiseTimeout(promise, timeoutMs = 20000, message = 'Islem zaman asimina ugradi.') {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))
        ]);
    },

    parafToEmail(paraf) {
        return this.normalizeParafKey(paraf) + this.EMAIL_DOMAIN;
    },

    normalizeParafKey(paraf) {
        return String(paraf || '')
            .trim()
            .toLowerCase()
            .replace(/ı/g, 'i')
            .replace(/ğ/g, 'g')
            .replace(/ü/g, 'u')
            .replace(/ş/g, 's')
            .replace(/ö/g, 'o')
            .replace(/ç/g, 'c')
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '');
    },

    async getAuthEmailForParaf(paraf) {
        const key = this.normalizeParafKey(paraf);
        if (!key || !firebaseReady) return '';

        try {
            const snapshot = await firebase.database().ref('parafAliases/' + key).once('value');
            const alias = snapshot.val();
            return alias?.authEmail || '';
        } catch (error) {
            return '';
        }
    },

    async login(paraf, password) {
        if (!firebaseReady) {
            throw new Error('Firebase baglantisi yok. Cevrimdisi modda giris yapiliyor.');
        }

        await this.ensureTabScopedPersistence();
        const email = await this.getAuthEmailForParaf(paraf) || this.parafToEmail(paraf);
        const userCredential = await this.promiseTimeout(
            firebase.auth().signInWithEmailAndPassword(email, password),
            30000,
            'Giris istegi zaman asimina ugradi.'
        );
        const profile = await this.promiseTimeout(
            this.getUserProfile(userCredential.user.uid),
            15000,
            'Kullanici profili okunurken zaman asimi olustu.'
        );

        if (!profile) {
            throw new Error('Kullanici profili bulunamadi.');
        }

        if (profile.disabled) {
            throw new Error('Bu hesap devre disi birakilmis.');
        }

        if (profile.role !== 'admin' && profile.role !== 'dev' && profile.isApproved === false) {
            throw new Error('Hesabiniz henuz onaylanmadi. Lutfen admin onayi bekleyin.');
        }

        return {
            uid: userCredential.user.uid,
            fullName: profile.fullName,
            paraf: profile.paraf,
            role: profile.role || 'user',
            department: profile.department || '',
            isApproved: profile.isApproved,
            permissions: profile.permissions || null
        };
    },

    async register(fullName, paraf, password, department = '') {
        if (!firebaseReady) {
            throw new Error('Firebase baglantisi yok.');
        }

        const email = this.parafToEmail(paraf);
        const existingUser = await this.findUserByParaf(paraf);
        if (existingUser) {
            throw new Error('Bu paraf zaten kullaniliyor.');
        }

        await this.ensureTabScopedPersistence();
        const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
        const profileData = {
            fullName,
            paraf,
            role: 'user',
            department: String(department || '').trim().toLowerCase(),
            isApproved: false,
            disabled: false,
            authEmail: email,
            createdAt: new Date().toISOString()
        };

        const aliasKey = this.normalizeParafKey(paraf);
        await firebase.database().ref().update({
            ['users/' + userCredential.user.uid]: profileData,
            ['parafAliases/' + aliasKey]: {
                uid: userCredential.user.uid,
                authEmail: email
            }
        });
        await firebase.auth().signOut();

        return {
            uid: userCredential.user.uid,
            ...profileData
        };
    },

    async changeOwnPassword(paraf, currentPassword, newPassword) {
        if (!firebaseReady) {
            throw new Error('Firebase baglantisi yok.');
        }

        await this.ensureTabScopedPersistence();
        const email = await this.getAuthEmailForParaf(paraf) || this.parafToEmail(paraf);
        const userCredential = await this.promiseTimeout(
            firebase.auth().signInWithEmailAndPassword(email, currentPassword),
            30000,
            'Mevcut sifre dogrulanirken zaman asimi olustu.'
        );

        const user = userCredential.user || firebase.auth().currentUser;
        if (!user) {
            throw new Error('Kullanici oturumu dogrulanamadi.');
        }

        await this.promiseTimeout(
            user.updatePassword(newPassword),
            30000,
            'Yeni sifre kaydedilirken zaman asimi olustu.'
        );

        await firebase.database().ref('users/' + user.uid).update({
            passwordChangedAt: new Date().toISOString()
        });

        await firebase.auth().signOut();
        return true;
    },

    async changeOwnParaf(currentParaf, currentPassword, newParaf) {
        if (!firebaseReady) {
            throw new Error('Firebase baglantisi yok.');
        }

        const cleanCurrentParaf = String(currentParaf || '').trim();
        const cleanNewParaf = String(newParaf || '').trim();
        if (!cleanCurrentParaf || !currentPassword || !cleanNewParaf) {
            throw new Error('Paraf ve mevcut sifre gerekli.');
        }

        const oldKey = this.normalizeParafKey(cleanCurrentParaf);
        const newKey = this.normalizeParafKey(cleanNewParaf);
        if (oldKey === newKey) {
            throw new Error('Yeni paraf mevcut paraf ile ayni.');
        }

        await this.ensureTabScopedPersistence();
        const oldEmail = await this.getAuthEmailForParaf(cleanCurrentParaf) || this.parafToEmail(cleanCurrentParaf);
        const userCredential = await this.promiseTimeout(
            firebase.auth().signInWithEmailAndPassword(oldEmail, currentPassword),
            30000,
            'Mevcut sifre dogrulanirken zaman asimi olustu.'
        );
        const user = userCredential.user || firebase.auth().currentUser;
        if (!user) {
            throw new Error('Kullanici oturumu dogrulanamadi.');
        }

        const existingAliasSnapshot = await firebase.database().ref('parafAliases/' + newKey).once('value');
        const existingAlias = existingAliasSnapshot.val();
        if (existingAlias && existingAlias.uid !== user.uid) {
            throw new Error('Bu paraf zaten kullaniliyor.');
        }

        await firebase.database().ref('users/' + user.uid + '/pendingParafChange').set({
            currentParaf: cleanCurrentParaf,
            requestedParaf: cleanNewParaf,
            currentKey: oldKey,
            requestedKey: newKey,
            authEmail: oldEmail,
            requestedAt: new Date().toISOString(),
            status: 'pending'
        });

        return {
            uid: user.uid,
            paraf: cleanCurrentParaf,
            requestedParaf: cleanNewParaf,
            pendingApproval: true
        };
    },

    async approveParafChange(uid) {
        if (!firebaseReady) return;

        const userSnapshot = await firebase.database().ref('users/' + uid).once('value');
        const profile = userSnapshot.val();
        const pending = profile?.pendingParafChange;
        if (!profile || !pending || pending.status !== 'pending') {
            throw new Error('Onay bekleyen paraf değişikliği bulunamadı.');
        }

        const currentParaf = String(profile.paraf || pending.currentParaf || '').trim();
        const requestedParaf = String(pending.requestedParaf || '').trim();
        const currentKey = this.normalizeParafKey(currentParaf);
        const requestedKey = this.normalizeParafKey(requestedParaf);
        if (!requestedKey || currentKey === requestedKey) {
            throw new Error('Paraf değişikliği geçerli değil.');
        }

        const existingAliasSnapshot = await firebase.database().ref('parafAliases/' + requestedKey).once('value');
        const existingAlias = existingAliasSnapshot.val();
        if (existingAlias && existingAlias.uid !== uid) {
            throw new Error('Bu paraf başka bir kullanıcı tarafından kullanılıyor.');
        }

        const authEmail = pending.authEmail || profile.authEmail || await this.getAuthEmailForParaf(currentParaf) || this.parafToEmail(currentParaf);
        await firebase.database().ref().update({
            ['users/' + uid + '/paraf']: requestedParaf,
            ['users/' + uid + '/authEmail']: authEmail,
            ['users/' + uid + '/parafChangedAt']: new Date().toISOString(),
            ['users/' + uid + '/pendingParafChange/status']: 'approved',
            ['users/' + uid + '/pendingParafChange/approvedAt']: new Date().toISOString(),
            ['parafAliases/' + currentKey]: null,
            ['parafAliases/' + requestedKey]: {
                uid,
                authEmail
            }
        });
    },

    async rejectParafChange(uid) {
        if (!firebaseReady) return;

        await firebase.database().ref('users/' + uid + '/pendingParafChange').update({
            status: 'rejected',
            rejectedAt: new Date().toISOString()
        });
    },

    async approveUser(uid) {
        if (!firebaseReady) return;

        await firebase.database().ref('users/' + uid).update({
            isApproved: true,
            approvedAt: new Date().toISOString()
        });
    },

    async logout() {
        if (firebaseReady) {
            await firebase.auth().signOut();
        }
    },

    async getUserProfile(uid) {
        if (!firebaseReady) return null;

        try {
            const snapshot = await firebase.database().ref('users/' + uid).once('value');
            return snapshot.val();
        } catch (error) {
            console.error('Profil okuma hatasi:', error);
            return null;
        }
    },

    async findUserByParaf(paraf) {
        if (!firebaseReady) return null;

        try {
            const key = this.normalizeParafKey(paraf);
            const aliasSnapshot = await firebase.database().ref('parafAliases/' + key).once('value');
            const alias = aliasSnapshot.val();
            if (!alias) return null;
            return { [alias.uid]: alias };
        } catch (error) {
            return null;
        }
    },

    async getAllUsers() {
        if (!firebaseReady) return [];

        try {
            const snapshot = await firebase.database().ref('users').once('value');
            const data = snapshot.val();
            if (!data) return [];

            return Object.entries(data).map(([uid, profile]) => ({
                id: uid,
                ...profile
            }));
        } catch (error) {
            console.error('Kullanici listesi hatasi:', error);
            return [];
        }
    },

    async disableUser(uid) {
        if (!firebaseReady) return;

        await firebase.database().ref('users/' + uid).update({
            disabled: true,
            disabledAt: new Date().toISOString()
        });
    },

    async deleteUserProfile(uid) {
        if (!firebaseReady) return;
        await firebase.database().ref('users/' + uid).remove();
    },

    async deleteAllNonAdminUsers() {
        if (!firebaseReady) return;

        try {
            const snapshot = await firebase.database().ref('users').once('value');
            const data = snapshot.val();
            if (!data) return;

            const updates = {};
            for (const [uid, profile] of Object.entries(data)) {
                if (profile.role !== 'admin' && profile.role !== 'dev') {
                    updates['users/' + uid] = null;
                }
            }

            if (Object.keys(updates).length > 0) {
                await firebase.database().ref().update(updates);
            }
        } catch (error) {
            console.error('Kullanici silme hatasi:', error);
        }
    },

    async resetUsersAndCreateAdmin() {
        throw new Error('Client tarafindan admin bootstrap desteklenmiyor. Admin kurulumu Firebase Console veya guvenli backend uzerinden yapilmalidir.');
    },

    async ensureAdminExists() {
        throw new Error('Admin bootstrap client tarafinda kapatildi. Admin kullanicisini Firebase Console veya guvenli backend uzerinden olusturun.');
    },

    onAuthStateChanged(callback) {
        if (!firebaseReady) {
            callback(null);
            return;
        }

        this.ensureTabScopedPersistence()
            .catch(error => {
                console.warn('Auth kaliciligi sekme moduna alinamadi:', error);
            })
            .finally(() => {
                firebase.auth().onAuthStateChanged(callback);
            });
    }
};
