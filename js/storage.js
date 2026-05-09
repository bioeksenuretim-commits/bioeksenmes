/**
 * Storage Module - Veri saklama ve yedekleme yönetimi
 * IndexedDB ve LocalStorage desteği ile gelişmiş veri yönetimi
 */

class StorageManager {
    constructor() {
        this.DEFAULT_DB_NAME = 'ReaksiyonDB';
        this.TEST_DB_NAME = 'ReaksiyonTestDB';
        this.DB_NAME = this.isTestLocalMode() ? this.TEST_DB_NAME : this.DEFAULT_DB_NAME;
        this.DB_VERSION = 1;
        this.STORE_NAME = 'orders';
        this.BACKUP_KEY = 'reaksiyon_backup';
        this.db = null;
        this.fallbackToLocalStorage = false;
        this.initPromise = null;
    }

    isTestLocalMode() {
        try {
            const session = JSON.parse(sessionStorage.getItem('reaksiyon_test_session') || 'null');
            return session?.authProvider === 'test-local';
        } catch (_) {
            return false;
        }
    }

    setTestLocalMode(enabled) {
        const nextName = enabled ? this.TEST_DB_NAME : this.DEFAULT_DB_NAME;
        if (this.DB_NAME === nextName && !this.initPromise) return;
        if (this.db) {
            try { this.db.close(); } catch (_) {}
        }
        this.DB_NAME = nextName;
        this.db = null;
        this.fallbackToLocalStorage = false;
        this.initPromise = null;
    }

    /**
     * IndexedDB'yi başlat
     */
    async init() {
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => {
                console.warn('IndexedDB açılamadı, LocalStorage kullanılacak');
                this.fallbackToLocalStorage = true;
                this.migrateFromLocalStorage();
                resolve();
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('IndexedDB başarıyla başlatıldı');
                this.migrateFromLocalStorage();
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const objectStore = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                    objectStore.createIndex('weekNumber', 'weekNumber', { unique: false });
                    objectStore.createIndex('status', 'status', { unique: false });
                    objectStore.createIndex('requestDate', 'requestDate', { unique: false });
                }
            };
        });

        return this.initPromise;
    }

    async ensureReady() {
        if (this.fallbackToLocalStorage || this.db) return;
        if (this.initPromise) {
            await this.initPromise;
            return;
        }

        this.fallbackToLocalStorage = true;
    }

    /**
     * LocalStorage'dan IndexedDB'ye veri aktarımı
     */
    async migrateFromLocalStorage() {
        if (this.fallbackToLocalStorage) return;

        const oldData = localStorage.getItem('reaksiyon_orders');
        if (oldData) {
            try {
                const orders = JSON.parse(oldData);
                await this.saveAll(orders);
                console.log(`${orders.length} sipariş LocalStorage'dan IndexedDB'ye aktarıldı`);
                // Yedek al ve LocalStorage'ı temizle
                localStorage.setItem(this.BACKUP_KEY + '_migrated', oldData);
                localStorage.removeItem('reaksiyon_orders');
            } catch (error) {
                console.error('Migration hatası:', error);
            }
        }
    }

    /**
     * Tüm siparişleri getir
     */
    async getAll() {
        await this.ensureReady();

        if (this.fallbackToLocalStorage) {
            const data = localStorage.getItem('reaksiyon_orders');
            return data ? JSON.parse(data) : [];
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const objectStore = transaction.objectStore(this.STORE_NAME);
            const request = objectStore.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Tek bir sipariş getir
     */
    async getById(id) {
        await this.ensureReady();

        if (this.fallbackToLocalStorage) {
            const orders = await this.getAll();
            return orders.find(o => o.id === id);
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const objectStore = transaction.objectStore(this.STORE_NAME);
            const request = objectStore.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Sipariş kaydet/güncelle
     */
    async save(order) {
        await this.ensureReady();

        if (this.fallbackToLocalStorage) {
            const orders = await this.getAll();
            const index = orders.findIndex(o => o.id === order.id);
            if (index >= 0) {
                orders[index] = order;
            } else {
                orders.push(order);
            }
            localStorage.setItem('reaksiyon_orders', JSON.stringify(orders));
            return order;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(this.STORE_NAME);
            const request = objectStore.put(order);

            request.onsuccess = () => resolve(order);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Toplu kaydet
     */
    async saveAll(orders) {
        await this.ensureReady();

        if (this.fallbackToLocalStorage) {
            localStorage.setItem('reaksiyon_orders', JSON.stringify(orders));
            return orders;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(this.STORE_NAME);
            const clearRequest = objectStore.clear();

            clearRequest.onerror = () => reject(clearRequest.error);
            clearRequest.onsuccess = () => {
                orders.forEach(order => objectStore.put(order));
            };

            transaction.oncomplete = () => resolve(orders);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Sipariş sil
     */
    async delete(id) {
        await this.ensureReady();

        if (this.fallbackToLocalStorage) {
            const orders = await this.getAll();
            const filtered = orders.filter(o => o.id !== id);
            localStorage.setItem('reaksiyon_orders', JSON.stringify(filtered));
            return;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(this.STORE_NAME);
            const request = objectStore.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Haftaya göre filtrele
     */
    async getByWeek(weekNumber) {
        const orders = await this.getAll();
        return orders.filter(o => o.weekNumber === weekNumber);
    }

    /**
     * Duruma göre filtrele
     */
    async getByStatus(status) {
        const orders = await this.getAll();
        return orders.filter(o => o.status === status);
    }

    /**
     * JSON olarak export et
     */
    async exportToJSON() {
        const orders = await this.getAll();
        const data = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            totalOrders: orders.length,
            orders: orders
        };
        return JSON.stringify(data, null, 2);
    }

    /**
     * JSON'dan import et
     */
    async importFromJSON(jsonString) {
        try {
            const data = JSON.parse(jsonString);

            if (!data.orders || !Array.isArray(data.orders)) {
                throw new Error('Geçersiz veri formatı');
            }

            await this.saveAll(data.orders);
            return data.orders.length;
        } catch (error) {
            throw new Error('Import hatası: ' + error.message);
        }
    }

    /**
     * Otomatik yedekleme (günlük)
     */
    async autoBackup() {
        const lastBackup = localStorage.getItem('last_backup_date');
        const today = new Date().toDateString();

        if (lastBackup !== today) {
            try {
                const orders = await this.getAll();

                if (JSON.stringify(orders).length > 2000000) {
                    localStorage.removeItem(this.BACKUP_KEY);
                    localStorage.setItem('last_backup_date', today);
                    console.warn('Otomatik yedekleme atlandı: veri boyutu localStorage sınırını aşıyor.');
                    return false;
                }

                const backup = await this.exportToJSON();
                localStorage.setItem(this.BACKUP_KEY, backup);
                localStorage.setItem('last_backup_date', today);
                console.log('Otomatik yedekleme tamamlandı:', today);
                return true;
            } catch (error) {
                if (error && (error.name === 'QuotaExceededError' || String(error.message || '').toLowerCase().includes('quota'))) {
                    localStorage.removeItem(this.BACKUP_KEY);
                    localStorage.setItem('last_backup_date', today);
                    console.warn('Otomatik yedekleme alan yetersizliği nedeniyle atlandı.');
                    return false;
                }

                throw error;
            }
        }
        return false;
    }

    /**
     * Yedeği geri yükle
     */
    async restoreBackup() {
        const backup = localStorage.getItem(this.BACKUP_KEY);
        if (backup) {
            return await this.importFromJSON(backup);
        }
        throw new Error('Yedek bulunamadı');
    }

    /**
     * Veritabanını temizle
     */
    async clear() {
        await this.ensureReady();

        if (this.fallbackToLocalStorage) {
            localStorage.removeItem('reaksiyon_orders');
            return;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(this.STORE_NAME);
            const request = objectStore.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

// Global instance
const storage = new StorageManager();
