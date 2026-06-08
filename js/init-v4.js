const APP_BUILD_VERSION = '20260608-stock-kit-identity-import';
window.APP_BUILD_VERSION = APP_BUILD_VERSION;
console.log('APP_BUILD v4 aktif', APP_BUILD_VERSION);
/**
 * Initialization Module - Uygulamayi baslat ve modulleri entegre et
 */

if (typeof orders === 'undefined') {
    var orders = [];
}
let filteredOrders = [];

function isDerivedSalesLineOrder(order) {
    if (!order || order.sourceSystem !== 'sales-lines') return false;
    return order.salesLineRequestMode !== 'manual';
}

function getPersistableOrders() {
    return Array.isArray(orders)
        ? orders.filter(order => !isDerivedSalesLineOrder(order))
        : [];
}

async function cleanupDerivedOrdersPersistence() {
    const persistableOrders = getPersistableOrders();

    await storage.saveAll(persistableOrders);

    if (typeof firebaseReady !== 'undefined' && firebaseReady && firebaseSync && firebaseSync.ordersRef) {
        if (navigator.onLine) {
            await firebaseSync.syncOrderDiff(Array.isArray(orders) ? orders : persistableOrders, { reason: 'cleanup_sales_lines_derived' });
        } else if (typeof offlineManager !== 'undefined') {
            offlineManager.markPendingSync();
        }
    }
}

function remoteProductTreesHaveComponentUnits(products = []) {
    return Array.isArray(products) && products.some(product =>
        Array.isArray(product?.components) && product.components.some(component => String(component?.unit || '').trim())
    );
}

async function reconcileSalesLinesDerivedOrders() {
    return;
}

let liveSyncPollTimer = null;
let liveSyncInFlight = false;
let lastPolledSalesLinesSignature = '';
let lastPolledOrdersSignature = '';
let lastOrdersPollAt = 0;
let lastSalesPollAt = 0;
const FIREBASE_DB_REST_BASE_URL = 'https://reaksiyontalep-default-rtdb.europe-west1.firebasedatabase.app';
function buildInitFirebaseRestUrl(path) {
    const cleanPath = String(path || '').replace(/^\/+/, '');
    const dbPath = typeof getFirebaseDbPath === 'function' ? getFirebaseDbPath(cleanPath) : cleanPath;
    return `${FIREBASE_DB_REST_BASE_URL}/${dbPath}.json`;
}
const SALES_LINES_STATE_URL = buildInitFirebaseRestUrl('salesLines/state');
const ORDERS_FALLBACK_VISIBLE_MS = 60000;
const ORDERS_FALLBACK_HIDDEN_MS = 300000;
const SALES_LINES_FALLBACK_VISIBLE_MS = 60000;
const SALES_LINES_FALLBACK_HIDDEN_MS = 300000;
const ORDERS_REALTIME_FRESH_MS = 45000;
const SALES_LINES_REALTIME_FRESH_MS = 45000;
let buildVersionListenerStarted = false;
let buildVersionRef = null;
let manualNotificationsPanelBound = false;
const manualNotifications = [];

function isManualNotificationUser() {
    const user = window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
    if (typeof canCreateManualSalesLines === 'function') return canCreateManualSalesLines();
    const role = String(user?.role || '').trim().toLowerCase();
    const department = String(user?.department || '')
        .trim()
        .toLocaleLowerCase('tr')
        .replace(/ı/g, 'i')
        .replace(/ş/g, 's')
        .replace(/ü/g, 'u');
    return role === 'admin' || role === 'dev' || role === 'manual' || role === 'manuel' || department === 'uretim' || department === 'satis';
}

function escapeNotificationText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function addDevNotification(notification = {}) {
    const id = String(notification.id || '').trim();
    if (!id || manualNotifications.some(item => item.id === id)) return;
    manualNotifications.unshift({
        id,
        type: notification.type || 'info',
        title: notification.title || 'Bildirim',
        message: notification.message || '',
        remoteVersion: notification.remoteVersion || '',
        createdAt: notification.createdAt || new Date().toISOString()
    });
    renderDevNotifications();
}

function closeDevNotificationsPanel() {
    document.getElementById('devNotificationPanel')?.classList.remove('open');
}

function toggleDevNotificationsPanel(event) {
    event?.stopPropagation?.();
    if (!isManualNotificationUser()) return;
    const panel = document.getElementById('devNotificationPanel');
    if (!panel) return;
    panel.classList.toggle('open');
    renderDevNotifications();
}

function renderDevNotifications() {
    const wrapper = document.getElementById('devNotificationWrapper');
    const list = document.getElementById('devNotificationList');
    const dot = document.getElementById('devNotificationDot');
    if (!wrapper || !list || !dot) return;

    const visible = isManualNotificationUser();
    wrapper.style.display = visible ? 'inline-flex' : 'none';
    if (!visible) {
        closeDevNotificationsPanel();
        return;
    }

    dot.style.display = manualNotifications.length > 0 ? '' : 'none';
    if (manualNotifications.length === 0) {
        list.innerHTML = '<div class="notification-empty">Yeni bildirim yok.</div>';
        return;
    }

    list.innerHTML = manualNotifications.map(item => `
        <div class="notification-item" data-notification-id="${escapeNotificationText(item.id)}">
            <div class="notification-item-title">${escapeNotificationText(item.title)}</div>
            <div class="notification-item-message">${escapeNotificationText(item.message)}</div>
            ${item.type === 'update'
                ? '<button type="button" class="notification-refresh-btn" onclick="window.location.reload()">Yenile</button>'
                : ''}
        </div>
    `).join('');

    if (!manualNotificationsPanelBound) {
        manualNotificationsPanelBound = true;
        document.addEventListener('click', event => {
            const wrapperEl = document.getElementById('devNotificationWrapper');
            if (wrapperEl && !wrapperEl.contains(event.target)) closeDevNotificationsPanel();
        });
    }
}

window.isManualNotificationUser = isManualNotificationUser;
window.addDevNotification = addDevNotification;
window.renderDevNotifications = renderDevNotifications;
window.toggleDevNotificationsPanel = toggleDevNotificationsPanel;

function showUpdateAvailableBanner(remoteVersion) {
    if (remoteVersion) {
        addDevNotification({
            id: `update-${remoteVersion}`,
            type: 'update',
            title: 'Yeni güncelleme var',
            message: 'Lütfen sayfayı yenileyin.',
            remoteVersion,
            createdAt: new Date().toISOString()
        });
    }
    if (document.getElementById('updateAvailableBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'updateAvailableBanner';
    banner.className = 'update-available-banner';
    banner.innerHTML = `
        <span>Yeni g&uuml;ncelleme var. L&uuml;tfen sayfay&imath; yenileyin.</span>
        <button type="button" class="update-available-refresh-btn">Yenile</button>
    `;
    banner.dataset.remoteVersion = String(remoteVersion || '');
    banner.querySelector('.update-available-refresh-btn')?.addEventListener('click', () => {
        window.location.reload();
    });
    document.body.appendChild(banner);
}

function startBuildVersionListener() {
    if (buildVersionListenerStarted) return;
    if (typeof firebaseReady === 'undefined' || !firebaseReady) return;
    if (typeof firebase === 'undefined' || !firebase.database) return;

    const dbPath = typeof getFirebaseDbPath === 'function'
        ? getFirebaseDbPath('appMeta/buildVersion')
        : 'appMeta/buildVersion';

    try {
        buildVersionListenerStarted = true;
        buildVersionRef = firebase.database().ref(dbPath);
        buildVersionRef.on('value', snapshot => {
            const remoteVersion = String(snapshot.val() || '').trim();
            if (!remoteVersion) return;
            if (remoteVersion !== APP_BUILD_VERSION) {
                showUpdateAvailableBanner(remoteVersion);
            }
        }, () => {});
    } catch (_) {
        buildVersionListenerStarted = false;
        buildVersionRef = null;
    }
}

function hasOrdersAccess() {
    return typeof canViewOrders !== 'function' || canViewOrders();
}

function buildOrdersSignature(orderList = []) {
    try {
        const normalized = (orderList || [])
            .map(order => ({
                id: String(order?.id || ''),
                status: String(order?.status || ''),
                quantity: order?.quantity ?? '',
                producedQty: order?.producedQty ?? '',
                format: String(order?.format || ''),
                orderNo: String(order?.orderNo || ''),
                requesterNote: String(order?.requesterNote || ''),
                team1Note: String(order?.team1Note || ''),
                team2Note: String(order?.team2Note || ''),
                deliveryDate: String(order?.deliveryDate || ''),
                lastModifiedBy: String(order?.lastModifiedBy || ''),
                createdAt: String(order?.createdAt || '')
            }))
            .sort((a, b) => a.id.localeCompare(b.id, 'tr'));
        return JSON.stringify(normalized);
    } catch (_) {
        return '';
    }
}

async function pollCloudStateFallback() {
    if (liveSyncInFlight) return;
    if (typeof firebaseReady === 'undefined' || !firebaseReady) return;
    if (typeof firebaseSync === 'undefined' || !firebaseSync) return;

    const now = Date.now();
    const hasFreshOrdersRealtime = !!(firebaseSync.lastOrdersEventAt && (now - firebaseSync.lastOrdersEventAt < ORDERS_REALTIME_FRESH_MS));
    const hasFreshSalesRealtime = !!(firebaseSync.lastSalesLinesEventAt && (now - firebaseSync.lastSalesLinesEventAt < SALES_LINES_REALTIME_FRESH_MS));
    const ordersFallbackInterval = document.hidden ? ORDERS_FALLBACK_HIDDEN_MS : ORDERS_FALLBACK_VISIBLE_MS;
    const salesFallbackInterval = document.hidden ? SALES_LINES_FALLBACK_HIDDEN_MS : SALES_LINES_FALLBACK_VISIBLE_MS;

    liveSyncInFlight = true;
    try {
        if (hasOrdersAccess() && !hasFreshOrdersRealtime && (now - lastOrdersPollAt >= ordersFallbackInterval) && firebaseSync.ordersRef && typeof firebaseSync.getAll === 'function' && typeof firebaseSync.applyRemoteOrders === 'function') {
            lastOrdersPollAt = now;
            const remoteOrders = await firebaseSync.getAll();
            if (Array.isArray(remoteOrders)) {
                const signature = buildOrdersSignature(remoteOrders);
                if (signature && signature !== lastPolledOrdersSignature) {
                    const snapshotValue = remoteOrders.reduce((acc, order) => {
                        if (order?.id) acc[String(order.id)] = order;
                        return acc;
                    }, {});
                    await firebaseSync.applyRemoteOrders(snapshotValue);
                    lastPolledOrdersSignature = signature;
                }
            }
        }

        if (!hasFreshSalesRealtime && (now - lastSalesPollAt >= salesFallbackInterval) && firebaseSync.salesLinesRef && typeof firebaseSync.getSalesLinesPayload === 'function') {
            lastSalesPollAt = now;
            let payload = await firebaseSync.getSalesLinesPayload();
            if (!payload) {
                try {
                    const response = await fetch(SALES_LINES_STATE_URL, { method: 'GET' });
                    if (response.ok) {
                        const rawState = await response.json();
                        if (rawState && typeof rawState.payloadJson === 'string') {
                            payload = JSON.parse(rawState.payloadJson);
                        } else if (rawState && Array.isArray(rawState.allOrders)) {
                            payload = rawState;
                        }
                    }
                } catch (error) {
                    console.warn('Sales lines REST fallback okuma hatası:', error);
                }
            }

            if (payload) {
                const payloadSignature = typeof getSalesLinesPayloadSignature === 'function'
                    ? getSalesLinesPayloadSignature(payload)
                    : JSON.stringify({ savedAt: payload.savedAt || '', count: Array.isArray(payload.allOrders) ? payload.allOrders.length : 0 });

                if (payloadSignature && payloadSignature !== lastPolledSalesLinesSignature) {
                    if (typeof window.applyRemoteSalesLinesPayload === 'function') {
                        await window.applyRemoteSalesLinesPayload(payload, { silent: true });
                    }
                    lastPolledSalesLinesSignature = payloadSignature;
                }
            }
        }
    } catch (error) {
        console.warn('Canlı senkron fallback poll hatası:', error);
    } finally {
        liveSyncInFlight = false;
    }
}

function startLiveSyncFallbackPolling() {
    if (typeof isTestLocalSession === 'function' && isTestLocalSession()) return;
    if (liveSyncPollTimer) return;
    liveSyncPollTimer = setInterval(() => {
        pollCloudStateFallback();
    }, 5000);
}

async function initializeApp() {
    console.log('Uygulama baslatiliyor...');

    try {
        await storage.init();
        console.log('Storage baslatildi');

        if (typeof isTestLocalSession === 'function' && isTestLocalSession()) {
            orders = await storage.getAll();
            console.log(`${orders.length} siparis yuklendi (test modu)`);
        } else if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof firebaseSync !== 'undefined') {
            if (!firebaseSync.ordersRef) {
                firebaseSync.init();
            }
            startBuildVersionListener();

            if (hasOrdersAccess() && typeof dataMigration !== 'undefined') {
                const localOrders = await storage.getAll();
                if (localOrders && localOrders.length > 0) {
                    orders = localOrders;
                }
                await dataMigration.migrateToFirebase();
            }

            if (hasOrdersAccess() && !firebaseSync.isListening) {
                firebaseSync.startListening();
            }

            if (typeof productTreeExcel !== 'undefined') {
                await firebaseSync.migrateProductTrees(productTreeExcel.getManagedProducts());

                if (!firebaseSync.isProductTreeListening) {
                    firebaseSync.startProductTreeListening((remoteProducts) => {
                        const hasLocalUnits = Array.isArray(productTreeExcel?.productTreeData)
                            && productTreeExcel.productTreeData.some(component => String(component?.unit || '').trim());
                        const hasRemoteUnits = remoteProductTreesHaveComponentUnits(remoteProducts);

                        if (hasLocalUnits && !hasRemoteUnits) {
                            console.warn('Eksik cloud ürün ağacı verisi atlandı, yerel Excel ölçü birimleri korunuyor.');
                            return;
                        }

                        productTreeExcel.replaceAllManagedProducts(remoteProducts, {
                            skipCloud: true,
                            reason: 'firebase_product_tree_listener'
                        });

                        if (typeof renderManagedProductsList === 'function') {
                            renderManagedProductsList();
                        }

                        if (typeof updateProductTreeStats === 'function') {
                            updateProductTreeStats();
                        }

                        if (typeof syncOrderFormatsFromProductTree === 'function') {
                            syncOrderFormatsFromProductTree({ persist: true, skipRender: false })
                                .catch(error => console.warn('Ürün ağacı format senkron hatası:', error));
                        }
                    });
                }
            }

            if (!firebaseSync.isSalesLinesListening) {
                const applySalesLinesPayload = async (payload) => {
                    if (typeof window.applyRemoteSalesLinesPayload === 'function') {
                        await window.applyRemoteSalesLinesPayload(payload, { silent: true, skipPersist: true });
                    }
                };

                const initialSalesLinesPayload = await firebaseSync.getSalesLinesPayload();
                if (initialSalesLinesPayload) {
                    await applySalesLinesPayload(initialSalesLinesPayload);
                }

                firebaseSync.startSalesLinesListening((payload) => {
                    applySalesLinesPayload(payload).catch(error =>
                        console.warn('Sales lines canlı uygulama hatası:', error)
                    );
                });
            }

            if (typeof offlineManager !== 'undefined') {
                offlineManager.init();
            }

            startLiveSyncFallbackPolling();

            console.log(`${orders.length} siparis yuklendi (Firebase merkezli)`);
        } else {
            orders = await storage.getAll();
            console.log(`${orders.length} siparis yuklendi (IndexedDB)`);
        }

        pagination = new PaginationManager({
            itemsPerPage: 80,
            onPageChange: () => {
                renderCurrentView();
            }
        });

        backupManager = new BackupManager(storage);
        window.backupManager = backupManager;

        advancedFilters.onFilterChange = () => {
            applyFiltersWithPagination();
        };

        renderBackupUI();
        renderBulkActionsUI();
        await backupManager.checkAutoBackup();
        overrideRenderOrders();

        renderDashboard();
        renderWeekSidebar();
        applyFilters();

        if (typeof syncOrderFormatsFromProductTree === 'function') {
            await syncOrderFormatsFromProductTree({ persist: true, skipRender: true });
        }

        setTimeout(() => {
            reconcileSalesLinesDerivedOrders();
        }, 300);

        console.log('Uygulama basariyla baslatildi');
    } catch (error) {
        console.error('Uygulama baslatma hatasi:', error);
        showToast('Uygulama baslatilirken hata olustu: ' + error.message, 'error');
    }
}

function overrideRenderOrders() {
    const originalRenderOrders = window.renderOrders;

    window.renderOrders = function (filteredOrdersParam = null) {
        const ordersToRender = filteredOrdersParam || filteredOrders || orders;
        if (pagination) pagination.setTotalItems(ordersToRender.length);
        originalRenderOrders(ordersToRender);
        addCheckboxListeners();
    };
}

function getInitNormalizedStatus(order) {
    return String(order?.status || '').trim().toLocaleLowerCase('tr');
}

function isInitDeliveredOrder(order) {
    const status = getInitNormalizedStatus(order);
    return status === 'teslim edildi' || status.includes('teslim edildi');
}

function isInitClosedOrder(order) {
    const status = getInitNormalizedStatus(order);
    return status === 'teslim edildi' || status === 'iptal edildi';
}

function getInitDeliveryDateOnly(order) {
    if (!order?.deliveryDate) return null;
    const date = new Date(order.deliveryDate);
    if (isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isInitExpectedOrder(order) {
    return !!order && !isInitClosedOrder(order);
}

function isInitOverdueOrder(order) {
    const date = getInitDeliveryDateOnly(order);
    if (!date || isInitClosedOrder(order)) return false;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return date.getTime() < todayStart.getTime();
}

function renderCurrentView() {
    const activeTab = document.querySelector('.nav-tab.active');
    if (!activeTab) return;

    const tabId = activeTab.getAttribute('data-tab');

    if (tabId === 'urgent' || tabId === 'overdue' || tabId === 'delivered' || tabId === 'vcap' || tabId === 'liyofilize' || tabId === 'tube' || tabId === 'orders') {
        applyFiltersWithPagination();
    } else if (tabId === 'dashboard') {
        renderDashboard();
    } else if (tabId === 'qc-view') {
        renderQcView();
    } else if (tabId === 'destroyed-view') {
        renderDestroyedView();
    }
}

// Use the shared format normalization helpers from index.html so tab filters
// stay aligned with product-tree based format inference.
function applyFiltersWithPagination() {
    let baseOrders = orders;

    if (typeof activeTabFilter !== 'undefined') {
        const getBucket = (order) => {
            if (typeof getFormatBucket === 'function') return getFormatBucket(order);

            const formatValue = String(order?.format || '').trim().toLocaleLowerCase('tr');
            if (formatValue === 'vcap') return 'vcap';
            if (formatValue.includes('liyo')) return 'liyofilize';
            if (formatValue.includes('tüp') || formatValue.includes('tup') || formatValue.includes('tube')) return 'tube';
            return '';
        };

        const isUnmatched = (order) => {
            if (typeof isUnmatchedOrder === 'function') return isUnmatchedOrder(order);

            const note = String(order?.requesterNote || '').toLocaleLowerCase('tr');
            return note.includes('karşılığı olmayan') || note.includes('karsiligi olmayan');
        };

        const hasSearch = !!String(document.getElementById('globalSearch')?.value || '').trim();

        if (activeTabFilter === 'urgent') {
            baseOrders = orders.filter(order => typeof isUrgentExpectedOrder === 'function' ? isUrgentExpectedOrder(order) : isInitExpectedOrder(order));
        } else if (activeTabFilter === 'overdue') {
            baseOrders = orders.filter(order => isInitOverdueOrder(order));
        } else if (activeTabFilter === 'delivered') {
            baseOrders = orders.filter(order => isInitDeliveredOrder(order));
        } else if (activeTabFilter === 'vcap') {
            baseOrders = orders.filter(order => getBucket(order) === 'vcap' && !isUnmatched(order));
        } else if (activeTabFilter === 'liyofilize') {
            baseOrders = orders.filter(order => getBucket(order) === 'liyofilize' && !isUnmatched(order));
        } else if (activeTabFilter === 'tube') {
            baseOrders = orders.filter(order => getBucket(order) === 'tube' && !isUnmatched(order));
        } else if (activeTabFilter === 'unmatched') {
            baseOrders = orders.filter(order => isUnmatched(order));
        } else if (!hasSearch) {
            baseOrders = orders.filter(order => !isInitDeliveredOrder(order));
        }
    }

    filteredOrders = advancedFilters.filterData(baseOrders);
    renderOrders(filteredOrders);
}

function renderBackupUI() {
    backupManager.renderBackupUI('backupContainer');
}

function renderBulkActionsUI() {
    advancedFilters.renderBulkActionsPanel('bulkActionsPanelContainer');
}

function addCheckboxListeners() {
    document.querySelectorAll('.row-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const orderId = e.target.dataset.orderId;
            advancedFilters.toggleRowSelection(orderId);
        });
    });

    const selectAllCheckbox = document.querySelector('.select-all-checkbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', () => {
            const pageData = pagination.getCurrentPageData(filteredOrders || orders);
            const orderIds = pageData.map(order => order.id);
            advancedFilters.toggleAllRows(orderIds);
        });
    }
}

const originalSaveOrders = window.saveOrders;
window.saveOrders = async function (options = {}) {
    const persistableOrders = getPersistableOrders();
    await storage.saveAll(persistableOrders);

    if (typeof isTestLocalSession === 'function' && isTestLocalSession()) {
        if (pagination) pagination.setTotalItems(orders.length);
        return;
    }

    if (typeof firebaseReady !== 'undefined' && firebaseReady && firebaseSync && firebaseSync.ordersRef) {
        if (navigator.onLine) {
            try {
                if (typeof setSyncStatus === 'function') setSyncStatus('syncing');
                if ((Array.isArray(options.changedOrderIds) && options.changedOrderIds.length > 0)
                    || (Array.isArray(options.deletedOrderIds) && options.deletedOrderIds.length > 0)) {
                    const result = await firebaseSync.syncOrderRowsPatch(Array.isArray(orders) ? orders : persistableOrders, {
                        reason: options.reason || 'save_orders_patch',
                        changedOrderIds: options.changedOrderIds || [],
                        deletedOrderIds: options.deletedOrderIds || [],
                        rowBaseMeta: options.rowBaseMeta || {}
                    });
                    if (result && typeof result === 'object' && Array.isArray(result.conflicts) && result.conflicts.length > 0) {
                        if (typeof handleOrderSyncConflicts === 'function') handleOrderSyncConflicts(result.conflicts);
                    }
                } else {
                    await firebaseSync.syncOrderDiff(Array.isArray(orders) ? orders : persistableOrders, { reason: options.reason || 'save_orders' });
                }
            } catch (error) {
                if (typeof offlineManager !== 'undefined') {
                    const cache = firebaseSync.orderCache || new Map();
                    persistableOrders.forEach(order => {
                        const cachedOrder = cache.get(String(order.id));
                        if (!cachedOrder || firebaseSync.getComparableString(cachedOrder) !== firebaseSync.getComparableString(order)) {
                            offlineManager.queueOrderUpsert(order);
                        }
                    });
                }
                if (typeof setSyncStatus === 'function') setSyncStatus('pending', 'Merkezi kayıt başarısız, değişiklik yerelde bekliyor.');
                throw error;
            }
        } else if (typeof offlineManager !== 'undefined') {
            const cache = firebaseSync.orderCache || new Map();
            persistableOrders.forEach(order => {
                const cachedOrder = cache.get(String(order.id));
                if (!cachedOrder || firebaseSync.getComparableString(cachedOrder) !== firebaseSync.getComparableString(order)) {
                    offlineManager.queueOrderUpsert(order);
                }
            });
        }
    }

    if (pagination) pagination.setTotalItems(orders.length);
};

window.addOrderToList = async function (order) {
    const now = new Date().toISOString();
    order.createdAt = order.createdAt || now;
    order.updatedAt = now;
    order.updatedBy = getActiveUserParaf(order.updatedBy || '');
    orders.push(order);
    if (!isDerivedSalesLineOrder(order)) {
        await storage.save(order);
    }
    await window.saveOrders();
};

window.updateOrder = async function (orderId, updates) {
    const order = orders.find(o => o.id === orderId);
    if (order) {
        Object.assign(order, updates);
        order.updatedAt = new Date().toISOString();
        order.updatedBy = getActiveUserParaf(order.updatedBy || '');
        if (!isDerivedSalesLineOrder(order)) {
            await storage.save(order);
        }
        await window.saveOrders();
    }
};

window.deleteOrder = async function (orderId) {
    const index = orders.findIndex(o => o.id === orderId);
    if (index >= 0) {
        const [removedOrder] = orders.splice(index, 1);
        if (!isDerivedSalesLineOrder(removedOrder)) {
            await storage.delete(orderId);
        }

        if (typeof firebaseReady !== 'undefined' && firebaseReady && firebaseSync && firebaseSync.ordersRef && navigator.onLine) {
            await firebaseSync.removeOrder(orderId, { reason: 'delete_order' });
        } else {
            if (typeof offlineManager !== 'undefined') {
                offlineManager.queueOrderDelete(orderId);
            } else {
                await window.saveOrders();
            }
        }

        if (pagination) pagination.setTotalItems(orders.length);
    }
};

const originalExportToExcel = window.exportToExcel;
window.exportToExcel = async function () {
    if (typeof originalExportToExcel === 'function') {
        originalExportToExcel();
        return;
    }

    if (backupManager && typeof backupManager.downloadExcel === 'function') {
        await backupManager.downloadExcel();
        return;
    }

    showToast('Excel aktarımı hazır değil. Sayfayı yenileyip tekrar deneyin.', 'warning');
};

const originalSwitchTab = window.switchTab;
window.switchTab = function (tabId) {
    if (pagination) {
        pagination.currentPage = 1;
    }

    if (advancedFilters) {
        advancedFilters.clearSelection();
    }

    if (originalSwitchTab) {
        originalSwitchTab(tabId);
    }

    setTimeout(() => renderCurrentView(), 100);
};

const originalApplyFilters = window.applyFilters;
window.applyFilters = function () {
    const searchInput = document.getElementById('globalSearch');
    if (searchInput) {
        advancedFilters.setFilter('search', searchInput.value);
    }

    if (originalApplyFilters) {
        originalApplyFilters();
    } else {
        applyFiltersWithPagination();
    }
};

document.addEventListener('DOMContentLoaded', async function () {
    setTimeout(async () => {
        await initializeApp();
    }, 100);
});

setInterval(async () => {
    if (backupManager) {
        await backupManager.checkAutoBackup();
    }
}, 60 * 60 * 1000);

console.log('%cReaksiyon Strip Takip Sistemi', 'color: #4f46e5; font-size: 16px; font-weight: bold;');
console.log('%cMerkezi veri ve offline cache aktif', 'color: #10b981; font-size: 14px; font-weight: bold;');

window.deleteAllOrders = async function () {
    const confirmed = confirm('Dikkat: Tum talepler kalici olarak silinecek. Bu islem geri alinamaz. Emin misiniz?');
    if (!confirmed) return;

    const doubleConfirmed = confirm('Gercekten tum talepleri sifirlamak istiyor musunuz?');
    if (!doubleConfirmed) return;

    try {
        if (typeof showLoading === 'function') showLoading('Talepler siliniyor...');

        if (typeof window.finalizeDeleteAllOrders === 'function') {
            await Promise.resolve(window.finalizeDeleteAllOrders());
        } else {
            if (typeof orders !== 'undefined') {
                orders.length = 0;
            }

            if (typeof saveOrders === 'function') {
                await saveOrders();
            }

            if (typeof renderDashboard === 'function') renderDashboard();
            if (typeof renderCurrentView === 'function') {
                renderCurrentView();
            }
            if (typeof renderWeekSidebar === 'function') {
                renderWeekSidebar();
            }
        }

        if (typeof updateProductTreeStats === 'function') {
            updateProductTreeStats();
        }

        if (typeof hideLoading === 'function') hideLoading();
    } catch (error) {
        if (typeof hideLoading === 'function') hideLoading();
        console.error('Silme hatasi:', error);
        if (typeof showToast === 'function') {
            showToast('Veriler silinirken hata olustu: ' + error.message, 'error');
        } else {
            alert('Hata: ' + error.message);
        }
    }
};

