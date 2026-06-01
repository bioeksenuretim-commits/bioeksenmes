let allOrders = [];
let filteredOrders = [];
let currentSort = { col: null, asc: true };
let currentPage = 1;
const pageSize = 200;
const renderBatchSize = 250;
let renderedRowLimit = renderBatchSize;
let pendingFile = null;
let colFilters = {};
let editedLog = {}; // { orderId: [ {col, oldVal, newVal, time} ] }
let salesLineRequestPending = {};
const SALES_LINES_TEST_LOCAL_MODE = new URLSearchParams(window.location.search).get('testLocal') === '1';
const SALES_LINES_STORAGE_KEY = SALES_LINES_TEST_LOCAL_MODE ? 'reaksiyon_test_sales_lines_data_v1' : 'reaksiyon_sales_lines_data_v1';
const SALES_LINES_CLOUD_URL = 'https://reaksiyontalep-default-rtdb.europe-west1.firebasedatabase.app/salesLines/state.json';
const SALES_LINES_V2_CLOUD_URL = 'https://reaksiyontalep-default-rtdb.europe-west1.firebasedatabase.app/salesLines/v2.json';
const SALES_LINES_TODAY_OUTPUTS_CLOUD_BASE_URL = 'https://reaksiyontalep-default-rtdb.europe-west1.firebasedatabase.app/salesLines/v2/todayOutputs';
const PRODUCT_TREES_CLOUD_URL = 'https://reaksiyontalep-default-rtdb.europe-west1.firebasedatabase.app/productTrees.json';
const SALES_LINES_CACHE_DB_NAME = SALES_LINES_TEST_LOCAL_MODE ? 'ReaksiyonTestSalesLinesCache' : 'ReaksiyonSalesLinesCache';
const SALES_LINES_CACHE_DB_VERSION = 2;
const SALES_LINES_CACHE_STORE = 'payloads';
const SALES_LINES_PENDING_PATCHES_KEY = 'sales_lines_pending_patches_v1';
const SALES_LINES_CACHE_ID = 'current';
let salesLinesCacheDbPromise = null;
let suppressSalesLinesParentPost = false;
let embeddedPermissionState = {
    canManageSalesLineRequests: null,
    canCreateManualSalesLines: null,
    canDeleteSalesLines: null,
    currentUser: null
};
let cloudSyncPollTimer = null;
let cloudSyncInFlight = false;
let lastCloudPayloadSignature = '';
let remoteProductTreeProducts = [];
let remoteProductTreeLoadPromise = null;
const SALES_LINES_POLL_VISIBLE_MS = 60000;
const SALES_LINES_POLL_HIDDEN_MS = 300000;
const SALES_LINES_REALTIME_FRESH_MS = 45000;
const SALES_LINES_SAVE_DEBOUNCE_MS = 800;
let pendingSalesLinesCloudPayload = null;
let pendingSalesLinesCloudTimer = null;
let pendingSalesLinesCloudResolvers = [];
let scheduledSalesLinesSaveTimer = null;
let scheduledSalesLinesSaveMeta = {};
let scheduledSalesLinesSaveOptions = {};
let scheduledSalesLinesSaveResolvers = [];
let lastSalesLinesLocalSaveTime = 0;
let lastPersistedSalesLinesPayloadTime = 0;
let lastPersistedSalesLinesPayloadSignature = '';
let lastPersistedSalesLinesPayloadRows = 0;
let queuedSalesLinesRemotePayload = null;
let queuedSalesLinesRemoteOptions = null;
let queuedSalesLinesTableRender = false;
let salesLinesPendingFlushInFlight = false;
const trackedCols = ['Teslim Tarihi', 'Miktar', 'No'];
const CUSTOMER_MARKET_COLUMN = 'Yurti\u00e7i/Yurtd\u0131\u015f\u0131';
const CUSTOMER_MARKET_OPTIONS = ['YURT \u0130\u00c7\u0130', 'YURT DI\u015eI'];
const ACTION_COLUMN = 'Talep Geç';
const EDITED_LIST_EXCLUDED_COLUMNS = [ACTION_COLUMN, 'Ürün Durumu', 'Lot No', 'Üretimin Notları'];
const EXTRACTION_KIT_PRODUCTS = [
    ['YM-P-01686', 'Elution Buffer-125 mL'],
    ['YM-P-01510', 'Wash Buffer-15 mL'],
    ['YM-P-01685', 'Wash Buffer-125 mL'],
    ['YM-P-01627', 'Proteinaz K (20mg/mL ) - 1 mL'],
    ['YM-P-01683', 'Proteinase K-37,5 mL'],
    ['YM-P-01506', 'STL-B 8 ML'],
    ['YM-P-01438', 'EB (MGW)-1L'],
    ['YM-P-01534', 'MGW-8 mL']
];
const EXTRACTION_KIT_PRODUCT_NOS = new Set(EXTRACTION_KIT_PRODUCTS.map(([productNo]) => productNo.toLocaleUpperCase('tr')));
const DEFAULT_SALES_LINE_COLUMN_ORDER = [ACTION_COLUMN, 'Hafta', 'Temsilci', 'Sipariş Tarihi', 'Belge Açıklaması', 'Belge No', 'Müşteri',
                   'No', 'Açıklama', 'Konum Kodu', 'Miktar', 'Ölçü Birimi',
                   'Teslim Tarihi', 'Lot No', 'Satışın Notları', 'Üretimin Notları', 'Ürün Durumu'];
if (!DEFAULT_SALES_LINE_COLUMN_ORDER.includes(CUSTOMER_MARKET_COLUMN)) {
    const customerColIndex = DEFAULT_SALES_LINE_COLUMN_ORDER.indexOf('No');
    DEFAULT_SALES_LINE_COLUMN_ORDER.splice(customerColIndex >= 0 ? customerColIndex : 7, 0, CUSTOMER_MARKET_COLUMN);
}
let columnOrder = [...DEFAULT_SALES_LINE_COLUMN_ORDER];
let todayOutputOrderIds = new Set();
let pendingChangedSalesLineRowIds = new Set();
let pendingDeletedSalesLineRowIds = new Set();
let pendingSalesLineRowBaseMeta = {};
let salesLineConflictQueue = [];
let serializedSalesLineOrderCache = new Map();
const SALES_LINES_COLUMN_WIDTHS_KEY = 'sales_lines_column_widths_v1';
const SALES_LINES_COLUMN_PREFS_LOCAL_KEY = 'salesLines.columnPrefs';

function getEmbeddedParentWindow() {
    try {
        return window.parent && window.parent !== window ? window.parent : null;
    } catch (_) {
        return null;
    }
}

function getParentFirebaseSyncBridge() {
    const parentWindow = getEmbeddedParentWindow();
    try {
        return parentWindow?.firebaseSync || null;
    } catch (_) {
        return null;
    }
}

function isEmbeddedSalesLinesFrame() {
    return !!getEmbeddedParentWindow();
}

function getSalesLinesTabUserKey() {
    const user = getParentSessionUser() || {};
    return String(user.uid || user.userId || user.paraf || 'anonymous').trim().toLowerCase() || 'anonymous';
}

function updateSalesLinesReadonlyUi() {
    document.body.classList.toggle('sales-lines-readonly', salesLinesTabReadonly);
    const banner = document.getElementById('salesLinesReadonlyBanner');
    if (banner) banner.style.display = salesLinesTabReadonly ? 'flex' : 'none';
}

function setSalesLinesTabReadonly(readonly, peer = null) {
    const next = !!readonly;
    const changed = salesLinesTabReadonly !== next;
    salesLinesTabReadonly = next;
    salesLinesActivePeer = peer || salesLinesActivePeer;
    updateSalesLinesReadonlyUi();
    if (changed && Array.isArray(allOrders) && allOrders.length > 0) {
        if (typeof clearBulkSelection === 'function') clearBulkSelection();
        if (typeof renderTableWhenEditIsIdle === 'function') renderTableWhenEditIsIdle();
    }
}

function postSalesLinesTabMessage(type, extra = {}) {
    if (!salesLinesTabChannel) return;
    try {
        salesLinesTabChannel.postMessage({
            type,
            tabId: salesLinesTabId,
            openedAt: salesLinesTabOpenedAt,
            userKey: getSalesLinesTabUserKey(),
            ...extra
        });
    } catch (_) {}
}

function focusActiveSalesLinesTab() {
    postSalesLinesTabMessage('SALES_LINES_TAB_FOCUS_REQUEST');
    showToast('Aktif sekmeye geÃ§meniz iÃ§in sinyal gÃ¶nderildi.', 'info');
}

function reactivateSalesLinesTab() {
    setSalesLinesTabReadonly(false, { tabId: salesLinesTabId, openedAt: salesLinesTabOpenedAt });
    postSalesLinesTabMessage('SALES_LINES_TAB_ACTIVE', { takeover: true });
    showToast('Bu sekme yeniden aktif edildi. DiÄŸer sekmeler salt okunur moda alÄ±ndÄ±.', 'success');
}

function ensureSalesLinesWritable(message = 'Bu sekme salt okunur modda. Yazma yapmak iÃ§in bu sekmeyi yeniden aktif yapÄ±n.') {
    if (!salesLinesTabReadonly) return true;
    showToast(message, 'warning');
    return false;
}

function initSalesLinesTabCoordinator() {
    if (!('BroadcastChannel' in window)) return;
    try {
        salesLinesTabChannel = new BroadcastChannel(SALES_LINES_TAB_CHANNEL_NAME);
    } catch (_) {
        return;
    }

    salesLinesTabChannel.onmessage = event => {
        const message = event.data || {};
        if (!message.type || message.tabId === salesLinesTabId) return;
        if (String(message.userKey || '') !== getSalesLinesTabUserKey()) return;

        if (message.type === 'SALES_LINES_TAB_ACTIVE') {
            const peerOpenedAt = Number(message.openedAt || 0);
            if (message.takeover || peerOpenedAt >= salesLinesTabOpenedAt) {
                setSalesLinesTabReadonly(true, { tabId: message.tabId, openedAt: peerOpenedAt });
            }
            return;
        }

        if (message.type === 'SALES_LINES_TAB_PING') {
            if (!salesLinesTabReadonly) postSalesLinesTabMessage('SALES_LINES_TAB_ACTIVE');
            return;
        }

        if (message.type === 'SALES_LINES_TAB_FOCUS_REQUEST' && !salesLinesTabReadonly) {
            try { window.focus(); } catch (_) {}
            showToast('DiÄŸer sekme buraya geÃ§mek istiyor.', 'info');
        }
    };

    postSalesLinesTabMessage('SALES_LINES_TAB_ACTIVE');
    setTimeout(() => postSalesLinesTabMessage('SALES_LINES_TAB_PING'), 250);
    window.addEventListener('beforeunload', () => {
        try { salesLinesTabChannel?.close(); } catch (_) {}
    });
}
const SALES_LINES_VISIBLE_COLUMNS_KEY_PREFIX = 'sales_lines_visible_columns_v1_';
const SALES_LINES_VISIBLE_HEADERS_KEY_PREFIX = 'sales_lines_visible_headers_v1_';
const SALES_LINES_COLUMN_ORDER_KEY_PREFIX = 'sales_lines_column_order_v1_';
const SALES_LINES_TAB_CHANNEL_NAME = 'bioeksenmes-sales-lines';
const salesLinesTabId = (window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID()
    : `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const salesLinesTabOpenedAt = Date.now();
let visibleColumnSet = null;
let visibleDashboardActionSet = null;
let accountPersonalizationLoaded = false;
let accountColumnOrderLoaded = false;
let lastAccountPersonalizationSignature = '';
let lastPermissionUiSignature = '';
let lastLoadedSalesLinesPayloadSignature = '';
let applyFiltersTimer = null;
let dashboardRenderTimer = null;
let salesLinesTabChannel = null;
let salesLinesTabReadonly = false;
let salesLinesActivePeer = null;
const DASHBOARD_ACTIONS = [
    { key: 'edited', label: 'Değişiklikler' },
    { key: 'overdue', label: 'Geciken' },
    { key: 'upcoming', label: 'Yaklaşan' },
    { key: 'output', label: 'Çıkış' },
    { key: 'cancelled', label: 'İptal' },
    { key: 'todayOutputs', label: 'Bugün Çıkan Ürünler' },
    { key: 'extractionKits', label: 'Ekstraksiyon Kitleri' }
];
const DEFAULT_SALES_LINE_COLUMN_WIDTHS = {
    [ACTION_COLUMN]: 140,
    'Hafta': 86,
    'Temsilci': 130,
    'Sipariş Tarihi': 128,
    'Belge Açıklaması': 190,
    'Belge No': 132,
    'Müşteri': 230,
    'No': 132,
    'Açıklama': 240,
    'Konum Kodu': 110,
    'Miktar': 100,
    'Ölçü Birimi': 120,
    'Teslim Tarihi': 128,
    'Lot No': 150,
    'Satışın Notları': 220,
    'Üretimin Notları': 220,
    'Ürün Durumu': 210
};
DEFAULT_SALES_LINE_COLUMN_WIDTHS[CUSTOMER_MARKET_COLUMN] = 170;

function loadColumnWidths() {
    try {
        const prefs = JSON.parse(localStorage.getItem(SALES_LINES_COLUMN_PREFS_LOCAL_KEY) || 'null');
        if (prefs?.columnWidths && typeof prefs.columnWidths === 'object') return prefs.columnWidths;
        const parsed = JSON.parse(localStorage.getItem(SALES_LINES_COLUMN_WIDTHS_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

let columnWidths = loadColumnWidths();
let activeColumnResize = null;
let selectedSalesLineIds = new Set();

const colLabels = {
    'Talep Geç': 'Talep Geç',
    'Hafta': 'Hafta', 'Temsilci': 'Temsilci', 'Sipariş Tarihi': 'Sipariş Tarihi',
    'Belge Açıklaması': 'Belge Açıklaması', 'Belge No': 'Belge No', 'Müşteri': 'Müşteri',
    'No': 'Ürün No', 'Açıklama': 'Açıklama',
    'Konum Kodu': 'Konum', 'Miktar': 'Miktar', 'Ölçü Birimi': 'Ölçü Birimi',
    'Teslim Tarihi': 'Teslim Tarihi', 'Lot No': 'Lot No', 'Satışın Notları': 'Satışın Notları',
    'Üretimin Notları': 'Üretimin Notları', 'Ürün Durumu': 'Ürün Durumu'
};
colLabels[CUSTOMER_MARKET_COLUMN] = 'Yurti\u00e7i/Yurtd\u0131\u015f\u0131';

function normalizeSalesLineColumnOrder(order) {
    const requested = Array.isArray(order) ? order : [];
    const allowed = new Set(DEFAULT_SALES_LINE_COLUMN_ORDER);
    const normalized = [];

    if (!normalized.includes(ACTION_COLUMN)) normalized.push(ACTION_COLUMN);
    requested.forEach(col => {
        if (col === 'Belge Türü' || col === 'Belge Turu') return;
        const normalizedCol = col;
        if (allowed.has(normalizedCol) && !normalized.includes(normalizedCol)) {
            normalized.push(normalizedCol);
        }
    });

    DEFAULT_SALES_LINE_COLUMN_ORDER.forEach(col => {
        if (!normalized.includes(col)) normalized.push(col);
    });

    return normalized;
}

function isDocumentTypeValue(value) {
    const normalized = String(value || '').trim().toLocaleLowerCase('tr');
    return ['teklif', 'sipariş', 'siparis', 'order', 'quote'].includes(normalized);
}

function sanitizeBelgeAciklamasi(order, rawRow = null, rowKeys = []) {
    const descKey = rowKeys.find(key => ['Belge Açıklaması', 'Belge Aciklamasi'].includes(String(key || '').trim()));
    if (rawRow && descKey) {
        order['Belge Açıklaması'] = rawRow[descKey] !== undefined ? rawRow[descKey] : '';
        return order;
    }

    if (isDocumentTypeValue(order['Belge Açıklaması'])) {
        order['Belge Açıklaması'] = '';
    }
    return order;
}

function toDateOnlyString(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function normalizeSalesLineIdentityValue(value) {
    return String(value ?? '').trim().toLocaleUpperCase('tr-TR');
}

function getSalesLineIdentityField(row, aliases) {
    for (const key of aliases) {
        const value = row?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return '';
}

function simpleSalesLineHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function isGeneratedSalesLineId(id) {
    const value = String(id || '').trim();
    return !value || /^row_\d+$/i.test(value);
}

function buildStableSalesLineId(row, index = 0) {
    const existingId = String(row?._id || row?.id || '').trim();
    if (existingId && !isGeneratedSalesLineId(existingId)) return existingId;

    const belgeNo = getSalesLineIdentityField(row, ['Belge No', 'BELGE NO', 'Document No', 'Order No']);
    const lineNo = getSalesLineIdentityField(row, ['Satır No', 'Satir No', 'Line No', 'Sıra No', 'Sira No', 'Sıra', 'Sira']);
    const itemNo = getSalesLineIdentityField(row, ['No', 'NO', 'Katalog No', 'Madde No', 'Stok Kodu', 'Ürün No', 'Urun No']);
    const quantity = getSalesLineIdentityField(row, ['Miktar', 'MIKTAR', 'Quantity']);
    const date = getSalesLineIdentityField(row, ['Sevk Tarihi', 'Termin Tarihi', 'Teslim Tarihi', 'Talep edilen teslim tarihi']);
    let raw = '';

    if (belgeNo && lineNo) {
        raw = [belgeNo, lineNo].map(normalizeSalesLineIdentityValue).join('|');
    } else if (belgeNo && itemNo && (quantity || date)) {
        raw = [belgeNo, itemNo, quantity, date].map(normalizeSalesLineIdentityValue).join('|');
    } else if (itemNo && (quantity || date)) {
        raw = [itemNo, quantity, date].map(normalizeSalesLineIdentityValue).join('|');
    }

    if (raw.replace(/\|/g, '')) return `sl_${simpleSalesLineHash(raw)}`;
    if (existingId) return `sl_${simpleSalesLineHash(`existing|${existingId}`)}`;
    return `sl_manual_${Date.now()}_${index}`;
}

function normalizeSalesLineIdentities(orders, editedLogMap = {}) {
    const seen = new Map();
    const idMap = new Map();
    const normalizedOrders = (Array.isArray(orders) ? orders : []).map((order, index) => {
        const previousId = String(order?._id || order?.id || '').trim();
        const baseId = buildStableSalesLineId(order, index);
        const count = seen.get(baseId) || 0;
        seen.set(baseId, count + 1);
        const nextId = count === 0 ? baseId : `${baseId}_${count + 1}`;
        if (previousId && previousId !== nextId) idMap.set(previousId, nextId);
        return { ...(order || {}), _id: nextId };
    });

    const normalizedEditedLog = {};
    Object.entries(editedLogMap || {}).forEach(([id, logs]) => {
        const nextId = idMap.get(String(id)) || String(id);
        normalizedEditedLog[nextId] = logs;
    });

    return { orders: normalizedOrders, editedLog: normalizedEditedLog, idMap };
}

function serializeSalesLineOrder(order) {
    const { _searchIndex, _baseRowVersion, _baseRowUpdatedAt, ...persistedOrder } = order || {};
    if (!persistedOrder._sync || typeof persistedOrder._sync !== 'object') {
        persistedOrder._sync = {
            version: Number(persistedOrder._rowVersion || 0) || 0,
            updatedAt: String(persistedOrder._rowUpdatedAt || ''),
            updatedByUid: persistedOrder._rowUpdatedByUid || null,
            updatedByParaf: persistedOrder._rowUpdatedBy || ''
        };
    }
    return {
        ...persistedOrder,
        _siparisTarihi: toDateOnlyString(order._siparisTarihi),
        _teslimTarihi: toDateOnlyString(order._teslimTarihi)
    };
}

function getSalesLineSerializedCacheKey(order) {
    return String(order?._id || order?.id || '');
}

function serializeSalesLineOrderCached(order, force = false) {
    const key = getSalesLineSerializedCacheKey(order);
    if (!key) return serializeSalesLineOrder(order);
    if (!force && serializedSalesLineOrderCache.has(key)) {
        return serializedSalesLineOrderCache.get(key);
    }
    const serialized = serializeSalesLineOrder(order);
    serializedSalesLineOrderCache.set(key, serialized);
    return serialized;
}

function rebuildSerializedSalesLineOrderCache() {
    serializedSalesLineOrderCache = new Map();
    allOrders.forEach(order => {
        const key = getSalesLineSerializedCacheKey(order);
        if (key) serializedSalesLineOrderCache.set(key, serializeSalesLineOrder(order));
    });
}

function normalizePreviousSalesOrderNos(value) {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    const normalized = [];
    list.forEach(item => {
        const text = String(item || '').trim();
        if (text && !normalized.includes(text)) normalized.push(text);
    });
    return normalized;
}

function updatePreviousSalesOrderNos(order, oldValue, newValue) {
    if (!order) return;
    const oldText = String(oldValue || '').trim();
    const newText = String(newValue || '').trim();
    let previousNos = normalizePreviousSalesOrderNos(order._previousBelgeNos);
    if (oldText && oldText !== newText && !previousNos.includes(oldText)) {
        previousNos.unshift(oldText);
    }
    previousNos = previousNos.filter(item => item && item !== newText);
    order._previousBelgeNos = previousNos.slice(0, 5);
}

function syncPreviousSalesOrderNosFromEditedLog(order) {
    if (!order || !order._id) return;
    const logs = Array.isArray(editedLog[order._id]) ? editedLog[order._id] : [];
    logs.forEach(log => {
        if (log?.col === 'Belge No') {
            updatePreviousSalesOrderNos(order, log.oldVal, order['Belge No']);
        }
    });
}

function getSalesOrderNoFilterValues(order) {
    const values = [];
    const current = String(order?.['Belge No'] || '').trim();
    if (current) values.push(current);
    normalizePreviousSalesOrderNos(order?._previousBelgeNos).forEach(value => {
        if (!values.includes(value)) values.push(value);
    });
    return values;
}

function buildSalesLineSearchIndex(order) {
    if (!order) return '';
    const values = columnOrder.map(col => {
        if (col === CUSTOMER_MARKET_COLUMN) return getSalesLineCustomerMarket(order);
        if (col === 'Sipariş Tarihi' && order._siparisTarihi) return formatDate(order._siparisTarihi);
        if (col === 'Teslim Tarihi' && order._teslimTarihi) return formatDate(order._teslimTarihi);
        return String(order[col] || '');
    });
    values.push(...normalizePreviousSalesOrderNos(order._previousBelgeNos));
    return values.join(' ').toLocaleLowerCase('tr');
}

function refreshSalesLineSearchIndex(order) {
    if (order) order._searchIndex = buildSalesLineSearchIndex(order);
    return order;
}

function deserializeSalesLineOrder(order) {
    const migratedOrder = { ...order };
    sanitizeBelgeAciklamasi(migratedOrder);
    if (!migratedOrder._sync || typeof migratedOrder._sync !== 'object') {
        migratedOrder._sync = {
            version: Number(migratedOrder._rowVersion || 0) || 0,
            updatedAt: String(migratedOrder._rowUpdatedAt || ''),
            updatedByUid: migratedOrder._rowUpdatedByUid || null,
            updatedByParaf: migratedOrder._rowUpdatedBy || ''
        };
    }
    return refreshSalesLineSearchIndex({
        ...migratedOrder,
        _linkedRequestIds: Array.isArray(migratedOrder._linkedRequestIds) ? migratedOrder._linkedRequestIds : [],
        _previousBelgeNos: normalizePreviousSalesOrderNos(migratedOrder._previousBelgeNos),
        _siparisTarihi: migratedOrder._siparisTarihi ? parseDate(migratedOrder._siparisTarihi) : null,
        _teslimTarihi: migratedOrder._teslimTarihi ? parseDate(migratedOrder._teslimTarihi) : null
    });
}

function getLinkedRequestIdsFromSalesOrder(salesOrder) {
    return Array.isArray(salesOrder?._linkedRequestIds)
        ? salesOrder._linkedRequestIds.map(id => String(id || '').trim()).filter(Boolean)
        : [];
}

function getParentSessionUser() {
    if (embeddedPermissionState.currentUser) {
        return embeddedPermissionState.currentUser;
    }

    try {
        if (window.parent && window.parent !== window && window.parent.currentUser) {
            return window.parent.currentUser;
        }
    } catch (_) {}

    return null;
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

function isSalesLineAdmin() {
    const user = getParentSessionUser() || {};
    return String(user.role || '').trim().toLowerCase() === 'admin';
}

function canManageTodayOutputs() {
    const user = getParentSessionUser() || {};
    const role = String(user.role || '').trim().toLowerCase();
    const department = normalizeDepartmentName(user.department);
    return role === 'admin' || department === 'lojistik' || department === 'logistics';
}

function canUseColumnPersonalization() {
    return true;
}

function getColumnPersonalizationStorageKey() {
    const user = getParentSessionUser() || {};
    const userKey = String(user.paraf || user.uid || user.userId || 'test').trim().toLowerCase() || 'test';
    return `${SALES_LINES_VISIBLE_COLUMNS_KEY_PREFIX}${userKey}`;
}

function getHeaderPersonalizationStorageKey() {
    const user = getParentSessionUser() || {};
    const userKey = String(user.paraf || user.uid || user.userId || 'test').trim().toLowerCase() || 'test';
    return `${SALES_LINES_VISIBLE_HEADERS_KEY_PREFIX}${userKey}`;
}

function getColumnOrderPersonalizationStorageKey() {
    const user = getParentSessionUser() || {};
    const userKey = String(user.paraf || user.uid || user.userId || 'test').trim().toLowerCase() || 'test';
    return `${SALES_LINES_COLUMN_ORDER_KEY_PREFIX}${userKey}`;
}

function normalizePersonalizationColumns(columns) {
    if (!Array.isArray(columns)) return [];
    const allowed = new Set(DEFAULT_SALES_LINE_COLUMN_ORDER);
    return columns.map(col => String(col || '').trim()).filter(col => allowed.has(col));
}

function normalizePersonalizationColumnOrder(order) {
    if (!Array.isArray(order)) return [];
    return normalizeSalesLineColumnOrder(order);
}

function normalizePersonalizationColumnWidths(widths) {
    if (!widths || typeof widths !== 'object') return {};
    const allowed = new Set(DEFAULT_SALES_LINE_COLUMN_ORDER);
    const normalized = {};
    Object.entries(widths).forEach(([col, width]) => {
        const key = String(col || '').trim();
        const value = Math.max(70, Math.min(Number(width) || 0, 600));
        if (allowed.has(key) && Number.isFinite(value) && value > 0) normalized[key] = value;
    });
    return normalized;
}

function normalizePersonalizationActions(actions) {
    if (!Array.isArray(actions)) return [];
    const allowed = new Set(DASHBOARD_ACTIONS.map(action => action.key));
    return actions.map(action => String(action || '').trim()).filter(action => allowed.has(action));
}

function loadLocalColumnPreferences() {
    try {
        const parsed = JSON.parse(localStorage.getItem(SALES_LINES_COLUMN_PREFS_LOCAL_KEY) || 'null');
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        return null;
    }
}

function loadLocalVisibleColumns() {
    try {
        const prefs = loadLocalColumnPreferences();
        const parsed = prefs?.visibleColumns || JSON.parse(localStorage.getItem(getColumnPersonalizationStorageKey()) || 'null');
        const selected = normalizePersonalizationColumns(parsed);
        return selected.length > 0 ? new Set(selected) : null;
    } catch (_) {
        return null;
    }
}

function loadVisibleColumnSet() {
    if (!canUseColumnPersonalization()) return null;
    return loadLocalVisibleColumns();
}

function getVisibleColumnOrder() {
    if (!visibleColumnSet) visibleColumnSet = loadVisibleColumnSet();
    if (!visibleColumnSet || visibleColumnSet.size === 0) return columnOrder;
    const visible = columnOrder.filter(col => visibleColumnSet.has(col));
    return visible.length > 0 ? visible : columnOrder;
}

function loadLocalVisibleDashboardActions() {
    try {
        const prefs = loadLocalColumnPreferences();
        const parsed = prefs?.dashboardActions || JSON.parse(localStorage.getItem(getHeaderPersonalizationStorageKey()) || 'null');
        const selected = normalizePersonalizationActions(parsed);
        return selected.length > 0 ? new Set(selected) : null;
    } catch (_) {
        return null;
    }
}

function loadVisibleDashboardActionSet() {
    if (!canUseColumnPersonalization()) return null;
    return loadLocalVisibleDashboardActions();
}

function loadLocalColumnOrder() {
    try {
        const prefs = loadLocalColumnPreferences();
        const parsed = prefs?.columnOrder || JSON.parse(localStorage.getItem(getColumnOrderPersonalizationStorageKey()) || 'null');
        const order = normalizePersonalizationColumnOrder(parsed);
        return order.length > 0 ? order : null;
    } catch (_) {
        return null;
    }
}

function writeLocalPersonalization(preferences) {
    if (!preferences) {
        localStorage.removeItem(SALES_LINES_COLUMN_PREFS_LOCAL_KEY);
        localStorage.removeItem(getColumnPersonalizationStorageKey());
        localStorage.removeItem(getHeaderPersonalizationStorageKey());
        localStorage.removeItem(getColumnOrderPersonalizationStorageKey());
        localStorage.removeItem(SALES_LINES_COLUMN_WIDTHS_KEY);
        return;
    }
    const columns = normalizePersonalizationColumns(preferences.visibleColumns);
    const actions = normalizePersonalizationActions(preferences.dashboardActions);
    const order = normalizePersonalizationColumnOrder(preferences.columnOrder);
    const widths = normalizePersonalizationColumnWidths(preferences.columnWidths || columnWidths);
    localStorage.setItem(SALES_LINES_COLUMN_PREFS_LOCAL_KEY, JSON.stringify({
        visibleColumns: columns,
        dashboardActions: actions,
        columnOrder: order,
        columnWidths: widths,
        updatedAt: preferences.updatedAt || new Date().toISOString()
    }));
    localStorage.removeItem(getColumnPersonalizationStorageKey());
    localStorage.removeItem(getHeaderPersonalizationStorageKey());
    localStorage.removeItem(getColumnOrderPersonalizationStorageKey());
    localStorage.removeItem(SALES_LINES_COLUMN_WIDTHS_KEY);
}

function applyPersonalizationPreferences(preferences) {
    const columns = normalizePersonalizationColumns(preferences?.visibleColumns);
    const actions = normalizePersonalizationActions(preferences?.dashboardActions);
    const order = normalizePersonalizationColumnOrder(preferences?.columnOrder);
    const widths = normalizePersonalizationColumnWidths(preferences?.columnWidths);
    visibleColumnSet = columns.length > 0 ? new Set(columns) : null;
    visibleDashboardActionSet = actions.length > 0 ? new Set(actions) : null;
    if (order.length > 0) {
        columnOrder = order;
        accountColumnOrderLoaded = true;
    }
    if (Object.keys(widths).length > 0) columnWidths = widths;
    writeLocalPersonalization(preferences);
}

function applyLocalPersonalizationPreferences() {
    const localColumnOrder = loadLocalColumnOrder();
    if (localColumnOrder) {
        columnOrder = localColumnOrder;
        accountColumnOrderLoaded = true;
    }
    columnWidths = normalizePersonalizationColumnWidths(loadLocalColumnPreferences()?.columnWidths || loadColumnWidths());
    visibleColumnSet = loadVisibleColumnSet();
    visibleDashboardActionSet = loadVisibleDashboardActionSet();
}

function getCurrentPersonalizationPreferences() {
    const visibleColumns = visibleColumnSet
        ? columnOrder.filter(col => visibleColumnSet.has(col))
        : [...columnOrder];
    const dashboardActions = visibleDashboardActionSet
        ? DASHBOARD_ACTIONS.map(action => action.key).filter(key => visibleDashboardActionSet.has(key))
        : DASHBOARD_ACTIONS.map(action => action.key);
    return {
        visibleColumns: normalizePersonalizationColumns(visibleColumns),
        dashboardActions: normalizePersonalizationActions(dashboardActions),
        columnOrder: normalizePersonalizationColumnOrder(columnOrder),
        columnWidths: normalizePersonalizationColumnWidths(columnWidths),
        updatedAt: new Date().toISOString()
    };
}

async function loadAccountPersonalizationPreferences() {
    if (!canUseColumnPersonalization() || SALES_LINES_TEST_LOCAL_MODE) return false;
    const parentWindow = getEmbeddedParentWindow();
    const reader = parentWindow?.getSalesLineAccountPreferences;
    if (typeof reader !== 'function') return false;
    try {
        const preferences = await Promise.resolve(reader());
        accountPersonalizationLoaded = true;
        const nextSignature = JSON.stringify({
            visibleColumns: normalizePersonalizationColumns(preferences?.visibleColumns),
            dashboardActions: normalizePersonalizationActions(preferences?.dashboardActions),
            columnOrder: normalizePersonalizationColumnOrder(preferences?.columnOrder),
            columnWidths: normalizePersonalizationColumnWidths(preferences?.columnWidths)
        });
        if (nextSignature === lastAccountPersonalizationSignature) return !!preferences;
        lastAccountPersonalizationSignature = nextSignature;
        if (preferences) {
            applyPersonalizationPreferences(preferences);
            updateDashboardActionVisibility();
            renderTableWhenEditIsIdle();
            scheduleDashboardRender();
        }
        return !!preferences;
    } catch (error) {
        console.warn('Hesap kişiselleştirmesi okunamadı:', error);
        return false;
    }
}

async function saveAccountPersonalizationPreferences(preferences) {
    if (SALES_LINES_TEST_LOCAL_MODE) return false;
    const parentWindow = getEmbeddedParentWindow();
    const writer = parentWindow?.saveSalesLineAccountPreferences;
    if (typeof writer !== 'function') return false;
    return !!await Promise.resolve(writer(preferences));
}

function updateDashboardActionVisibility() {
    if (!canUseColumnPersonalization()) {
        document.querySelectorAll('[data-dashboard-action]').forEach(button => { button.style.display = ''; });
        return;
    }
    if (!visibleDashboardActionSet) visibleDashboardActionSet = loadVisibleDashboardActionSet();
    document.querySelectorAll('[data-dashboard-action]').forEach(button => {
        const action = button.dataset.dashboardAction;
        button.style.display = (!visibleDashboardActionSet || visibleDashboardActionSet.has(action)) ? '' : 'none';
    });
}

function updateColumnPersonalizationButton() {
    const button = document.getElementById('customizeSalesColumnsBtn');
    if (button) button.style.display = canUseColumnPersonalization() ? 'inline-flex' : 'none';
}

function isSalesLineInlineEditActive() {
    const active = document.activeElement;
    if (activeSalesStatusMenu && document.body.contains(activeSalesStatusMenu)) return true;
    const interactiveSelector = [
        '#tableBody td.editing',
        '#detailBody td.editing',
        '#tableBody select',
        '#detailBody select',
        '#tableBody .status-menu-trigger',
        '#detailBody .status-menu-trigger',
        '.status-menu-popover'
    ].join(',');
    return !!(
        active &&
        active.closest &&
        active.closest(interactiveSelector)
    );
}

function renderTableWhenEditIsIdle() {
    if (isSalesLineInlineEditActive()) {
        queuedSalesLinesTableRender = true;
        return false;
    }
    renderTable();
    return true;
}

function queueSalesLinesRemotePayload(payload, options = {}) {
    queuedSalesLinesRemotePayload = payload;
    queuedSalesLinesRemoteOptions = { ...options, forceDuringEdit: true };
}

function flushQueuedSalesLinesAfterEdit() {
    if (isSalesLineInlineEditActive()) return;

    if (queuedSalesLinesRemotePayload) {
        const payload = queuedSalesLinesRemotePayload;
        const options = queuedSalesLinesRemoteOptions || {};
        queuedSalesLinesRemotePayload = null;
        queuedSalesLinesRemoteOptions = null;
        loadSalesLinesStateFromPayload(payload, options);
        return;
    }

    if (queuedSalesLinesTableRender) {
        queuedSalesLinesTableRender = false;
        renderTable();
    }
}

function openColumnPersonalizationModal() {
    if (!canUseColumnPersonalization()) return;
    visibleColumnSet = loadVisibleColumnSet();
    const selected = visibleColumnSet || new Set(DEFAULT_SALES_LINE_COLUMN_ORDER);
    const list = document.getElementById('columnPersonalizationList');
    if (list) {
        list.innerHTML = columnOrder.map((col, index) => {
            const label = colLabels[col] || col;
            const checked = selected.has(col) ? ' checked' : '';
            return `<div class="personalization-item">
                <input type="checkbox" id="personal_col_${index}" data-col="${esc(col)}"${checked}>
                <label for="personal_col_${index}">${esc(label)}</label>
            </div>`;
        }).join('');
    }
    visibleDashboardActionSet = loadVisibleDashboardActionSet();
    const selectedHeaders = visibleDashboardActionSet || new Set(DASHBOARD_ACTIONS.map(action => action.key));
    const headerList = document.getElementById('headerPersonalizationList');
    if (headerList) {
        headerList.innerHTML = DASHBOARD_ACTIONS.map((action, index) => {
            const checked = selectedHeaders.has(action.key) ? ' checked' : '';
            return `<div class="personalization-item">
                <input type="checkbox" id="personal_header_${index}" data-action="${esc(action.key)}"${checked}>
                <label for="personal_header_${index}">${esc(action.label)}</label>
            </div>`;
        }).join('');
    }
    document.getElementById('columnPersonalizationModal')?.classList.add('active');
}

function closeColumnPersonalizationModal() {
    document.getElementById('columnPersonalizationModal')?.classList.remove('active');
}

function selectAllPersonalizationColumns() {
    document.querySelectorAll('#columnPersonalizationList input[type=checkbox], #headerPersonalizationList input[type=checkbox]').forEach(input => {
        input.checked = true;
    });
}

async function resetPersonalizationColumns() {
    writeLocalPersonalization(null);
    visibleColumnSet = null;
    visibleDashboardActionSet = null;
    columnOrder = [...DEFAULT_SALES_LINE_COLUMN_ORDER];
    columnWidths = {};
    accountColumnOrderLoaded = false;
    closeColumnPersonalizationModal();
    updateDashboardActionVisibility();
    renderTable();
    const saved = await saveAccountPersonalizationPreferences(null).catch(error => {
        console.warn('Hesap kişiselleştirmesi sıfırlanamadı:', error);
        return false;
    });
    showToast(saved ? 'Sütun görünümü hesabınızda varsayılana döndü' : 'Sütun görünümü bu cihazda varsayılana döndü', saved ? 'success' : 'warning');
}

async function savePersonalizationColumns() {
    const selected = Array.from(document.querySelectorAll('#columnPersonalizationList input[type=checkbox]'))
        .filter(input => input.checked)
        .map(input => input.dataset.col)
        .filter(Boolean);
    if (selected.length === 0) {
        showToast('En az bir sütun seçin.', 'warning');
        return;
    }
    const selectedHeaders = Array.from(document.querySelectorAll('#headerPersonalizationList input[type=checkbox]'))
        .filter(input => input.checked)
        .map(input => input.dataset.action)
        .filter(Boolean);
    if (selectedHeaders.length === 0) {
        showToast('En az bir başlık seçin.', 'warning');
        return;
    }
    const preferences = {
        visibleColumns: normalizePersonalizationColumns(selected),
        dashboardActions: normalizePersonalizationActions(selectedHeaders),
        columnOrder: normalizePersonalizationColumnOrder(columnOrder),
        columnWidths: normalizePersonalizationColumnWidths(columnWidths),
        updatedAt: new Date().toISOString()
    };
    applyPersonalizationPreferences(preferences);
    closeColumnPersonalizationModal();
    updateDashboardActionVisibility();
    renderTable();
    const saved = await saveAccountPersonalizationPreferences(preferences).catch(error => {
        console.warn('Hesap kişiselleştirmesi kaydedilemedi:', error);
        return false;
    });
    showToast(saved ? 'Sütun görünümü hesabınıza kaydedildi' : 'Sütun görünümü bu cihazda kaydedildi', saved ? 'success' : 'warning');
}

function canUseSalesLineRequestButton() {
    if (typeof embeddedPermissionState.canManageSalesLineRequests === 'boolean') {
        return embeddedPermissionState.canManageSalesLineRequests;
    }

    try {
        if (window.parent && window.parent !== window && typeof window.parent.canManageSalesLineRequests === 'function') {
            return !!window.parent.canManageSalesLineRequests();
        }
        const user = getParentSessionUser() || {};
        const role = String(user.role || '').trim().toLowerCase();
        const department = normalizeDepartmentName(user.department);
        return role === 'admin' || department === 'uretim';
    } catch (_) {
        return false;
    }
}

function canUseManualSalesLineButton() {
    if (typeof embeddedPermissionState.canCreateManualSalesLines === 'boolean') {
        return embeddedPermissionState.canCreateManualSalesLines;
    }

    try {
        if (window.parent && window.parent !== window && typeof window.parent.canCreateManualSalesLines === 'function') {
            return !!window.parent.canCreateManualSalesLines();
        }
        const user = getParentSessionUser() || {};
        const role = String(user.role || '').trim().toLowerCase();
        const department = normalizeDepartmentName(user.department);
        return role === 'admin' || department === 'uretim' || department === 'satis';
    } catch (_) {
        return false;
    }
}

function canViewSalesLineLinkedRequests() {
    return canUseSalesLineRequestButton();
}

function getLinkedRequestsSnapshotForSalesOrder(salesOrder) {
    if (!salesOrder || !window.parent || !Array.isArray(window.parent.orders)) return [];

    const linkedIds = getLinkedRequestIdsFromSalesOrder(salesOrder);
    if (linkedIds.length > 0) {
        const linkedById = window.parent.orders.filter(order => linkedIds.includes(String(order.id || '').trim()));
        if (linkedById.length > 0) return linkedById;
    }

    const salesOrderId = String(salesOrder._id || '').trim();
    if (!salesOrderId) return [];

    return window.parent.orders.filter(order =>
        Array.isArray(order.linkedSalesOrderIds) && order.linkedSalesOrderIds.includes(salesOrderId)
    );
}

function hasPassedRequestForSalesOrder(salesOrder) {
    if (getLinkedRequestIdsFromSalesOrder(salesOrder).length > 0) return true;
    return getLinkedRequestsSnapshotForSalesOrder(salesOrder).length > 0;
}

function isUnmatchedLinkedRequest(order) {
    const note = String(order?.requesterNote || '')
        .toLocaleLowerCase('tr')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const sourceExternalId = String(order?.sourceExternalId || '').toLocaleLowerCase('tr');
    return note.includes('karsiligi olmayan') || sourceExternalId.includes('::unmatched');
}

function hasUnmatchedRequestForSalesOrder(salesOrder) {
    if (salesOrder?._requestStatus === 'unmatched' || salesOrder?._requestUnmatched === true) return true;
    return getLinkedRequestsSnapshotForSalesOrder(salesOrder).some(isUnmatchedLinkedRequest);
}

function salesLineHasCatalogComponents(order) {
    const catalogNo = String(order?.['No'] || '').trim();
    if (!catalogNo) return false;

    if (window.parent && typeof window.parent.findProductTreeComponentsByCatalog === 'function') {
        const components = window.parent.findProductTreeComponentsByCatalog(catalogNo);
        return Array.isArray(components) && components.length > 0;
    }

    const tree = window.productTree || {};
    return Array.isArray(tree[catalogNo]) || Array.isArray(tree[catalogNo.toUpperCase()]);
}

async function passSalesLineRequest(salesOrderId) {
    if (!ensureSalesLinesWritable()) return;
    if (!canUseSalesLineRequestButton()) {
        showToast('Talep geçme yetkiniz yok.', 'warning');
        return;
    }

    const salesOrder = allOrders.find(order => order._id === salesOrderId);
    if (!salesOrder) return;

    if (hasPassedRequestForSalesOrder(salesOrder)) {
        showToast('Bu satır için talep zaten geçilmiş.', 'info');
        return;
    }

    if (!window.parent || typeof window.parent.createRequestsFromSalesLine !== 'function') {
        showToast('Talep oluşturma servisine ulaşılamadı.', 'error');
        return;
    }

    try {
        salesLineRequestPending[salesOrderId] = true;
        renderTable();
        const result = await Promise.resolve(window.parent.createRequestsFromSalesLine(serializeSalesLineOrder(salesOrder)));
        const linkedRequestIds = Array.isArray(result?.requestIds)
            ? result.requestIds.map(id => String(id || '').trim()).filter(Boolean)
            : [];

        if (linkedRequestIds.length === 0) {
            showToast(result?.message || 'Bu satır için talep oluşturulamadı.', 'warning');
            return;
        }

        salesOrder._linkedRequestIds = linkedRequestIds;
        salesOrder._requestPassedAt = new Date().toISOString();
        if (result?.unmatched) {
            salesOrder._requestStatus = 'unmatched';
            salesOrder._requestUnmatched = true;
            recordSalesLineChange(salesOrderId, ACTION_COLUMN, 'Bekliyor', 'Karşılığı Yok');
        } else {
            delete salesOrder._requestStatus;
            delete salesOrder._requestUnmatched;
                recordSalesLineChange(salesOrderId, ACTION_COLUMN, 'Bekliyor', 'Talep Geçildi');
            }
        queueSalesLineRowChange(salesOrder);
        saveSalesLinesState({ source: 'manual-request', salesOrderId }, { immediate: true });
        renderTable();
        renderDashboard();

        const label = linkedRequestIds.length === 1
            ? '1 talep oluşturuldu'
            : `${linkedRequestIds.length} talep oluşturuldu`;
        showToast(result?.message || label, 'success');
    } catch (error) {
        console.error('Satış satırı talep oluşturma hatası:', error);
        showToast(error?.message || 'Talep oluşturulurken hata oluştu.', 'error');
    } finally {
        delete salesLineRequestPending[salesOrderId];
        renderTable();
    }
}

async function resetSalesLineRequest(salesOrderId) {
    if (!ensureSalesLinesWritable()) return;
    if (!canUseSalesLineRequestButton()) {
        showToast('Talep geri alma yetkiniz yok.', 'warning');
        return;
    }

    const salesOrder = allOrders.find(order => order._id === salesOrderId);
    if (!salesOrder) return;

    if (!hasPassedRequestForSalesOrder(salesOrder)) {
        showToast('Bu satır için geri alınacak talep yok.', 'info');
        return;
    }

    if (!window.parent || typeof window.parent.resetRequestsFromSalesLine !== 'function') {
        showToast('Talep geri alma servisine ulaşılamadı.', 'error');
        return;
    }

    if (!confirm('Bu satış satırından oluşturulan talep satırları silinsin mi?')) return;

    try {
        salesLineRequestPending[salesOrderId] = true;
        renderTable();

        const linkedRequestIds = getLinkedRequestIdsFromSalesOrder(salesOrder);
        const result = await Promise.resolve(window.parent.resetRequestsFromSalesLine(
            serializeSalesLineOrder(salesOrder),
            { requestIds: linkedRequestIds }
        ));

        salesOrder._linkedRequestIds = [];
        delete salesOrder._requestPassedAt;
        delete salesOrder._requestStatus;
        delete salesOrder._requestUnmatched;
        salesOrder._requestResetAt = new Date().toISOString();

        recordSalesLineChange(salesOrderId, ACTION_COLUMN, 'Talep Geçildi', 'Bekliyor');
        queueSalesLineRowChange(salesOrder);
        await saveSalesLinesState({ source: 'request-reset', salesOrderId }, { immediate: true });
        renderTable();
        renderDashboard();
        showToast(result?.message || 'Talep geri alındı.', 'success');
    } catch (error) {
        console.error('Satış satırı talep geri alma hatası:', error);
        showToast(error?.message || 'Talep geri alınırken hata oluştu.', 'error');
    } finally {
        delete salesLineRequestPending[salesOrderId];
        renderTable();
    }
}

async function bulkPassSalesLineRequestsByWeek() {
    if (!ensureSalesLinesWritable()) return;
    if (!canUseSalesLineRequestButton()) {
        showToast('Toplu talep geçme yetkiniz yok.', 'warning');
        return;
    }

    const modal = document.getElementById('bulkRequestWeekModal');
    const input = document.getElementById('bulkRequestWeekInput');
    if (!modal || !input) return;

    input.value = '';
    modal.classList.add('active');
    setTimeout(() => input.focus(), 80);
}

function closeBulkRequestWeekModal() {
    document.getElementById('bulkRequestWeekModal')?.classList.remove('active');
}

async function confirmBulkPassSalesLineRequests() {
    if (!ensureSalesLinesWritable()) {
        closeBulkRequestWeekModal();
        return;
    }
    if (!canUseSalesLineRequestButton()) {
        closeBulkRequestWeekModal();
        showToast('Toplu talep geçme yetkiniz yok.', 'warning');
        return;
    }

    const input = document.getElementById('bulkRequestWeekInput');
    const week = String(input?.value || '').match(/\d+/)?.[0] || '';
    if (!week || Number(week) < 1 || Number(week) > 52) {
        showToast('Lütfen 1 ile 52 arasında geçerli bir hafta girin.', 'warning');
        return;
    }
    closeBulkRequestWeekModal();

    const candidates = allOrders.filter(order => {
        const orderWeek = String(order['Hafta'] || '').match(/\d+/)?.[0] || '';
        if (orderWeek !== week) return false;
        if (isTerminalSalesStatus(order['Ürün Durumu'])) return false;
        if (hasPassedRequestForSalesOrder(order)) return false;
        return true;
    });

    if (candidates.length === 0) {
        showToast(`${week}. hafta için talebi geçilecek uygun sipariş bulunamadı.`, 'info');
        return;
    }

    if (!window.parent || typeof window.parent.createRequestsFromSalesLinesBulk !== 'function') {
        showToast('Toplu talep oluşturma servisine ulaşılamadı.', 'error');
        return;
    }

    candidates.forEach(order => { salesLineRequestPending[order._id] = true; });
    renderTable();

    let successCount = 0;
    let skippedCount = 0;
    try {
        const result = await Promise.resolve(window.parent.createRequestsFromSalesLinesBulk(candidates.map(serializeSalesLineOrder)));
        const results = Array.isArray(result?.results) ? result.results : [];

        candidates.forEach((order, index) => {
            const itemResult = results[index] || {};
            const linkedRequestIds = Array.isArray(itemResult.requestIds)
                ? itemResult.requestIds.map(id => String(id || '').trim()).filter(Boolean)
                : [];

            if (linkedRequestIds.length > 0) {
                order._linkedRequestIds = linkedRequestIds;
                order._requestPassedAt = new Date().toISOString();
                if (itemResult.unmatched) {
                    order._requestStatus = 'unmatched';
                    order._requestUnmatched = true;
                    recordSalesLineChange(order._id, ACTION_COLUMN, 'Bekliyor', 'Karşılığı Yok');
                } else {
                    delete order._requestStatus;
                    delete order._requestUnmatched;
                    recordSalesLineChange(order._id, ACTION_COLUMN, 'Bekliyor', 'Talep Geçildi');
                }
                queueSalesLineRowChange(order);
                successCount += 1;
            } else {
                skippedCount += 1;
            }
        });

        saveSalesLinesState({ source: 'bulk-request', week, count: successCount }, { immediate: true });
    } catch (error) {
        console.error('Toplu satış satırı talep oluşturma hatası:', error);
        showToast(error?.message || 'Toplu talep oluşturulurken hata oluştu.', 'error');
        return;
    } finally {
        candidates.forEach(order => { delete salesLineRequestPending[order._id]; });
    }

    applyFilters();
    renderDashboard();
    showToast(`${week}. hafta toplu talep geçme tamamlandı: ${successCount} başarılı${skippedCount ? `, ${skippedCount} atlandı` : ''}.`, successCount ? 'success' : 'warning');
}

function getSalesLinesPayloadSignature(payload) {
    if (!payload) return '';

    try {
        const meta = payload.meta || {};
        const syncMode = String(meta.syncMode || '').trim();
        const rowCount = getSalesLinesPayloadRowCount(payload);

        if (syncMode === 'row-patch') {
            return JSON.stringify({
                version: payload.version || 1,
                savedAt: payload.savedAt || '',
                syncMode,
                rowCount,
                changedRowIds: Array.isArray(meta.changedRowIds) ? meta.changedRowIds : [],
                deletedRowIds: Array.isArray(meta.deletedRowIds) ? meta.deletedRowIds : [],
                rowBaseMeta: meta.rowBaseMeta || {}
            });
        }

        if (syncMode === 'meta-only') {
            return JSON.stringify({
                version: payload.version || 1,
                savedAt: payload.savedAt || '',
                syncMode,
                rowCount,
                meta: {
                    source: meta.source || '',
                    action: meta.action || '',
                    todayOutputsDate: meta.todayOutputsDate || '',
                    todayOutputOrderIds: Array.isArray(meta.todayOutputOrderIds)
                        ? meta.todayOutputOrderIds
                        : []
                }
            });
        }

        return JSON.stringify({
            version: payload.version || 1,
            savedAt: payload.savedAt || '',
            syncMode,
            rowCount,
            source: meta.source || '',
            sourceFile: meta.sourceFile || '',
            reset: !!meta.reset,
            fullSync: !!meta.fullSync
        });
    } catch (error) {
        console.warn('Sales lines signature üretilemedi:', error);
        return String(payload?.savedAt || '');
    }
}

function getSalesLinesPayloadTime(payload) {
    const time = Date.parse(payload?.savedAt || '');
    return Number.isFinite(time) ? time : 0;
}

function readLocalSalesLinesPayload() {
    try {
        const payload = JSON.parse(localStorage.getItem(SALES_LINES_STORAGE_KEY) || 'null');
        return payload && typeof payload === 'object' ? payload : null;
    } catch (_) {
        return null;
    }
}

function openSalesLinesCacheDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (salesLinesCacheDbPromise) return salesLinesCacheDbPromise;

    salesLinesCacheDbPromise = new Promise(resolve => {
        const request = indexedDB.open(SALES_LINES_CACHE_DB_NAME, SALES_LINES_CACHE_DB_VERSION);
        request.onerror = () => {
            console.warn('Sales lines IndexedDB cache acilamadi:', request.error);
            resolve(null);
        };
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(SALES_LINES_CACHE_STORE)) {
                db.createObjectStore(SALES_LINES_CACHE_STORE, { keyPath: 'id' });
            }
        };
    });

    return salesLinesCacheDbPromise;
}

async function saveSalesLinesPayloadToIndexedDb(payload) {
    const db = await openSalesLinesCacheDb();
    if (!db) return false;

    return new Promise(resolve => {
        const transaction = db.transaction([SALES_LINES_CACHE_STORE], 'readwrite');
        transaction.objectStore(SALES_LINES_CACHE_STORE).put({
            id: SALES_LINES_CACHE_ID,
            savedAt: payload?.savedAt || new Date().toISOString(),
            payload
        });
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => {
            console.warn('Sales lines IndexedDB cache yazilamadi:', transaction.error);
            resolve(false);
        };
    });
}

async function loadSalesLinesPayloadFromIndexedDb() {
    const db = await openSalesLinesCacheDb();
    if (!db) return null;

    return new Promise(resolve => {
        const transaction = db.transaction([SALES_LINES_CACHE_STORE], 'readonly');
        const request = transaction.objectStore(SALES_LINES_CACHE_STORE).get(SALES_LINES_CACHE_ID);
        request.onsuccess = () => resolve(request.result?.payload || null);
        request.onerror = () => {
            console.warn('Sales lines IndexedDB cache okunamadi:', request.error);
            resolve(null);
        };
    });
}

async function clearSalesLinesIndexedDbCache() {
    const db = await openSalesLinesCacheDb();
    if (!db) return false;

    return new Promise(resolve => {
        const transaction = db.transaction([SALES_LINES_CACHE_STORE], 'readwrite');
        transaction.objectStore(SALES_LINES_CACHE_STORE).delete(SALES_LINES_CACHE_ID);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
    });
}

function readPendingSalesLinesPatches() {
    try {
        const parsed = JSON.parse(localStorage.getItem(SALES_LINES_PENDING_PATCHES_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function writePendingSalesLinesPatches(patches) {
    try {
        localStorage.setItem(
            SALES_LINES_PENDING_PATCHES_KEY,
            JSON.stringify(Array.isArray(patches) ? patches : [])
        );
        return true;
    } catch (error) {
        console.warn('Bekleyen satis satiri patch kuyrugu yazilamadi:', error);
        return false;
    }
}

async function queuePendingSalesLinesPatch(payload, changedRowIds = [], deletedRowIds = []) {
    if (!payload) return false;

    const patches = readPendingSalesLinesPatches();

    patches.push({
        queuedAt: new Date().toISOString(),
        changedRowIds: Array.isArray(changedRowIds) ? changedRowIds : [],
        deletedRowIds: Array.isArray(deletedRowIds) ? deletedRowIds : [],
        payload
    });

    writePendingSalesLinesPatches(patches);

    if (typeof showToast === 'function') {
        showToast('Satis satiri degisikligi baglanti gelince tekrar gonderilecek.', 'warning');
    }

    return true;
}

async function flushPendingSalesLinesPatches() {
    if (salesLinesPendingFlushInFlight) return false;

    const patches = readPendingSalesLinesPatches();
    if (patches.length === 0) return true;

    salesLinesPendingFlushInFlight = true;
    const remaining = [];
    let sentCount = 0;

    try {
        for (const patch of patches) {
            try {
                const result = await flushSalesLinesCloudSave(patch.payload);

                if (Array.isArray(result?.conflicts) && result.conflicts.length > 0) {
                    addSalesLineConflicts(result.conflicts);
                    sentCount += 1;
                    continue;
                }

                if (isSalesLinesCloudSaveSuccessful(result)) {
                    sentCount += 1;
                    continue;
                }

                remaining.push(patch);
            } catch (error) {
                console.warn('Bekleyen satis satiri patch gonderilemedi:', error);
                remaining.push(patch);
            }
        }

        writePendingSalesLinesPatches(remaining);

        if (sentCount > 0 && typeof showToast === 'function') {
            showToast(`${sentCount} bekleyen satis satiri degisikligi merkeze gonderildi.`, 'success');
        }

        return remaining.length === 0;
    } finally {
        salesLinesPendingFlushInFlight = false;
    }
}

window.readPendingSalesLinesPatches = readPendingSalesLinesPatches;
window.writePendingSalesLinesPatches = writePendingSalesLinesPatches;
window.queuePendingSalesLinesPatch = queuePendingSalesLinesPatch;
window.flushPendingSalesLinesPatches = flushPendingSalesLinesPatches;

try {
    const parentWindow = getEmbeddedParentWindow();
    if (parentWindow) {
        parentWindow.readPendingSalesLinesPatches = readPendingSalesLinesPatches;
        parentWindow.writePendingSalesLinesPatches = writePendingSalesLinesPatches;
        parentWindow.queuePendingSalesLinesPatch = queuePendingSalesLinesPatch;
        parentWindow.flushPendingSalesLinesPatches = flushPendingSalesLinesPatches;
    }
} catch (_) {}

function isStorageQuotaError(error) {
    return error && (
        error.name === 'QuotaExceededError' ||
        error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        error.code === 22 ||
        error.code === 1014
    );
}

function persistSalesLinesPayloadLocally(payload) {
    lastPersistedSalesLinesPayloadTime = getSalesLinesPayloadTime(payload);
    lastPersistedSalesLinesPayloadSignature = getSalesLinesPayloadSignature(payload);
    lastPersistedSalesLinesPayloadRows = getSalesLinesPayloadRowCount(payload);

    saveSalesLinesPayloadToIndexedDb(payload).catch(error => {
        console.warn('Sales lines IndexedDB cache kaydi basarisiz:', error);
    });

    const cacheMarker = {
        version: payload?.version || 1,
        savedAt: payload?.savedAt || new Date().toISOString(),
        meta: {
            ...(payload?.meta || {}),
            rowCount: Array.isArray(payload?.allOrders) ? payload.allOrders.length : 0
        },
        columnOrder: Array.isArray(payload?.columnOrder) ? payload.columnOrder : [],
        storage: 'indexeddb'
    };

    try {
        localStorage.setItem(SALES_LINES_STORAGE_KEY, JSON.stringify(cacheMarker));
        return true;
    } catch (error) {
        if (isStorageQuotaError(error)) {
            try { localStorage.removeItem(SALES_LINES_STORAGE_KEY); } catch (_) {}
            console.warn('Sales lines payload localStorage kotasini asti; bulut senkronu devam edecek.', error);
            return false;
        }
        throw error;
    }
}

function getSalesLinesPayloadRowCount(payload) {
    if (Array.isArray(payload?.allOrders)) return payload.allOrders.length;
    return Number(payload?.meta?.rowCount || 0) || 0;
}

function getCurrentSalesLineActor() {
    try {
        const user = getParentSessionUser() || {};
        return {
            uid: user.uid || user.userId || null,
            paraf: user.paraf || user.fullName || user.username || 'unknown'
        };
    } catch (_) {
        return { uid: null, paraf: 'unknown' };
    }
}

function getSalesLinesTodayOutputDateKey(date = new Date()) {
    const value = date instanceof Date ? date : new Date(date);
    if (!(value instanceof Date) || isNaN(value.getTime())) return new Date().toISOString().slice(0, 10);
    return [
        value.getFullYear(),
        String(value.getMonth() + 1).padStart(2, '0'),
        String(value.getDate()).padStart(2, '0')
    ].join('-');
}

function buildTodayOutputsCloudPayload(meta = {}) {
    const actor = getCurrentSalesLineActor();
    const now = new Date().toISOString();
    const dateKey = String(meta.dateKey || getSalesLinesTodayOutputDateKey()).slice(0, 10);
    return {
        dateKey,
        rowIds: Array.from(todayOutputOrderIds || []),
        meta: {
            action: meta.action || meta.source || 'today-outputs-update',
            createdAt: meta.createdAt || now,
            createdBy: meta.createdBy || actor.paraf || '',
            createdByUid: meta.createdByUid || actor.uid || null,
            ...meta
        }
    };
}

function getSalesLineEditedLogLength(id) {
    return Array.isArray(editedLog?.[id]) ? editedLog[id].length : 0;
}

function getSalesLineRowSyncMeta(order) {
    const sync = order?._sync && typeof order._sync === 'object' ? order._sync : {};
    return {
        updatedAt: String(sync.updatedAt || order?._rowUpdatedAt || ''),
        updatedByUid: sync.updatedByUid || order?._rowUpdatedByUid || null,
        updatedByParaf: sync.updatedByParaf || order?._rowUpdatedBy || '',
        version: Number(sync.version || order?._rowVersion || 0) || 0,
        editedLogLength: getSalesLineEditedLogLength(String(order?._id || order?.id || ''))
    };
}

function setSalesLineRowSyncMeta(order, meta = {}) {
    if (!order) return;
    const version = Number(meta.version || 0) || 1;
    const updatedAt = String(meta.updatedAt || new Date().toISOString());
    const updatedByUid = meta.updatedByUid || null;
    const updatedByParaf = meta.updatedByParaf || meta.updatedBy || '';
    order._sync = {
        version,
        updatedAt,
        updatedByUid,
        updatedByParaf
    };
    order._rowVersion = version;
    order._rowUpdatedAt = updatedAt;
    order._rowUpdatedByUid = updatedByUid;
    order._rowUpdatedBy = updatedByParaf;
}

function trimSalesLineEditedLogToBaseMeta(id, baseMeta = {}) {
    const key = String(id || '').trim();
    if (!key || !Array.isArray(editedLog?.[key])) return;
    const baseLength = Number(baseMeta.editedLogLength);
    if (!Number.isFinite(baseLength) || baseLength < 0) return;
    editedLog[key] = editedLog[key].slice(0, baseLength);
    if (editedLog[key].length === 0) delete editedLog[key];
}

function getSalesLineConflictLabel(row) {
    return [
        row?.['Belge No'],
        row?.['Müşteri'],
        row?.['No'],
        row?.['Açıklama']
    ].map(value => String(value || '').trim()).filter(Boolean).slice(0, 3).join(' / ') || 'Satış satırı';
}

function getSalesLineConflictIds(result) {
    return Array.isArray(result?.conflicts)
        ? result.conflicts.map(item => String(item?.id || '').trim()).filter(Boolean)
        : [];
}

function isSalesLinesCloudSaveSuccessful(result) {
    if (result === true) return true;
    if (result && typeof result === 'object') return result.ok !== false || Array.isArray(result.conflicts);
    return false;
}

function addSalesLineConflicts(conflicts) {
    const incoming = Array.isArray(conflicts) ? conflicts : [];
    if (incoming.length === 0) return;
    const byId = new Map(salesLineConflictQueue.map(item => [String(item.id), item]));
    incoming.forEach(item => {
        const id = String(item?.id || '').trim();
        if (!id) return;
        byId.set(id, {
            ...item,
            id,
            localRow: item.localRow || allOrders.find(order => String(order._id) === id) || {},
            remoteRow: item.remoteRow || {},
            conflictedAt: item.conflictedAt || new Date().toISOString()
        });
    });
    salesLineConflictQueue = Array.from(byId.values());
    incoming.forEach(item => {
        const id = String(item?.id || '').trim();
        if (id) trimSalesLineEditedLogToBaseMeta(id, item?.baseMeta || {});
    });
    try { persistSalesLinesPayloadLocally(window.getSalesLinesBackupPayload()); } catch (_) {}
    updateSalesLineConflictUi();
    showToast(incoming.length === 1
        ? 'Bu satır başka biri tarafından güncellendi. Çakışma çözümü gerekiyor.'
        : `${incoming.length} satır başka kullanıcılar tarafından güncellendi. Çakışma çözümü gerekiyor.`, 'warning');
    openSalesLineConflictModal();
}

function removeSalesLineConflict(id) {
    const key = String(id || '').trim();
    salesLineConflictQueue = salesLineConflictQueue.filter(item => String(item.id) !== key);
    updateSalesLineConflictUi();
    renderSalesLineConflictModal();
}

function updateSalesLineConflictUi() {
    const count = salesLineConflictQueue.length;
    const button = document.getElementById('salesLineConflictBtn');
    const countEl = document.getElementById('salesLineConflictCount');
    if (button) button.style.display = count > 0 ? 'inline-flex' : 'none';
    if (countEl) countEl.textContent = String(count);
    getEmbeddedParentWindow()?.postMessage?.({
        type: 'sales-lines-conflict-count',
        count
    }, '*');
}

function renderSalesLineConflictModal() {
    const body = document.getElementById('salesLineConflictBody');
    if (!body) return;
    if (salesLineConflictQueue.length === 0) {
        body.innerHTML = '<div class="linked-request-empty">Çözülecek satış satırı çakışması yok.</div>';
        return;
    }
    body.innerHTML = salesLineConflictQueue.map(item => {
        const localRow = item.localRow || {};
        const remoteRow = item.remoteRow || {};
        const label = getSalesLineConflictLabel(localRow) || getSalesLineConflictLabel(remoteRow);
        const safeIdArg = JSON.stringify(String(item.id || '')).replace(/"/g, '&quot;');
        return `
            <div class="conflict-card">
                <div class="conflict-card-title">${esc(label)}</div>
                <div class="conflict-card-meta">
                    <div><strong>Merkez versiyon:</strong> ${esc(String(item.remoteMeta?.version || remoteRow._sync?.version || remoteRow._rowVersion || '-'))}</div>
                    <div><strong>Sizin temel versiyon:</strong> ${esc(String(item.baseMeta?.version || '-'))}</div>
                    <div><strong>Merkez güncelleyen:</strong> ${esc(String(item.remoteMeta?.updatedBy || remoteRow._sync?.updatedByParaf || remoteRow._rowUpdatedBy || '-'))}</div>
                    <div><strong>İşlem:</strong> ${item.type === 'delete' ? 'Silme' : 'Güncelleme'}</div>
                </div>
                <div class="conflict-card-warning">Merkezdeki satır siz düzenlerken değişmiş. Otomatik üzerine yazılmadı.</div>
                <div class="conflict-card-actions">
                    <button class="btn btn-sm" type="button" onclick="resolveSalesLineConflictUseRemote(${safeIdArg})">Merkezi veriyi kullan</button>
                    <button class="btn btn-sm btn-danger" type="button" onclick="resolveSalesLineConflictUseMine(${safeIdArg})">Benim değişikliğimi uygula</button>
                </div>
            </div>
        `;
    }).join('');
}

function openSalesLineConflictModal() {
    renderSalesLineConflictModal();
    document.getElementById('salesLineConflictOverlay')?.classList.add('active');
}

function closeSalesLineConflictModal() {
    document.getElementById('salesLineConflictOverlay')?.classList.remove('active');
}

function buildSalesLinesPayloadForRows(rowIds, meta = {}, options = {}) {
    const normalizedRowIds = Array.from(new Set(rowIds.map(id => String(id || '').trim()).filter(Boolean)));
    const rowBaseMeta = {};
    normalizedRowIds.forEach(id => {
        rowBaseMeta[id] = options.rowBaseMeta?.[id] || pendingSalesLineRowBaseMeta[id] || {};
    });
    return {
        version: 1,
        savedAt: new Date().toISOString(),
        meta: {
            source: 'conflict-resolution',
            syncMode: 'row-patch',
            changedRowIds: normalizedRowIds,
            deletedRowIds: [],
            rowBaseMeta,
            ...meta
        },
        editedLog,
        columnOrder: [],
        allOrders: allOrders.map(order => {
            const id = String(order?._id || order?.id || '').trim();
            return serializeSalesLineOrderCached(order, normalizedRowIds.includes(id));
        })
    };
}

function replaceSalesLineOrderFromRemote(remoteRow) {
    const id = String(remoteRow?._id || remoteRow?.id || '').trim();
    if (!id) return false;
    const index = allOrders.findIndex(order => String(order._id || order.id || '') === id);
    const nextOrder = deserializeSalesLineOrder(remoteRow);
    if (index >= 0) allOrders[index] = nextOrder;
    else allOrders.push(nextOrder);
    serializedSalesLineOrderCache.delete(id);
    pendingChangedSalesLineRowIds.delete(id);
    pendingDeletedSalesLineRowIds.delete(id);
    delete pendingSalesLineRowBaseMeta[id];
    return true;
}

function resolveSalesLineConflictUseRemote(id) {
    const conflict = salesLineConflictQueue.find(item => String(item.id) === String(id));
    if (!conflict || !conflict.remoteRow) return;
    replaceSalesLineOrderFromRemote(conflict.remoteRow);
    persistSalesLinesPayloadLocally(window.getSalesLinesBackupPayload());
    applyFilters({ preservePage: true, preserveScroll: true });
    renderDashboard();
    removeSalesLineConflict(id);
    showToast('Merkezi satır kullanıldı', 'success');
}

async function resolveSalesLineConflictUseMine(id) {
    const conflict = salesLineConflictQueue.find(item => String(item.id) === String(id));
    if (!conflict) return;
    if (!confirm('Merkezdeki güncel satır sizin satırınızla değiştirilecek. Emin misiniz?')) return;
    const order = allOrders.find(item => String(item._id || item.id || '') === String(id));
    if (!order) return;
    const actor = getCurrentSalesLineActor();
    setSalesLineRowSyncMeta(order, {
        version: Number(conflict.remoteMeta?.version || order._rowVersion || 0) + 1,
        updatedAt: new Date().toISOString(),
        updatedByUid: actor.uid,
        updatedByParaf: actor.paraf
    });
    serializedSalesLineOrderCache.delete(String(id));
    const payload = buildSalesLinesPayloadForRows([id], { source: 'conflict-force-overwrite' }, {
        rowBaseMeta: {
            [id]: {
                version: Number(conflict.remoteMeta?.version || 0) || 0,
                updatedAt: String(conflict.remoteMeta?.updatedAt || '')
            }
        }
    });
    const result = await flushSalesLinesCloudSave(payload, { forceConflictOverwrite: true });
    if (Array.isArray(result?.conflicts) && result.conflicts.length > 0) {
        addSalesLineConflicts(result.conflicts);
        showToast('Satır hâlâ çakışıyor. Merkezi veriyi kontrol edin.', 'warning');
        return;
    }
    pendingChangedSalesLineRowIds.delete(String(id));
    delete pendingSalesLineRowBaseMeta[String(id)];
    removeSalesLineConflict(id);
    showToast('Sizin değişikliğiniz merkeze uygulandı', 'success');
}

function queueSalesLineRowChange(order, baseMeta = null) {
    if (!order || !order._id) return;
    const id = String(order._id);
    const previousMeta = {
        ...getSalesLineRowSyncMeta(order),
        ...(baseMeta || {})
    };
    if (!pendingSalesLineRowBaseMeta[id]) {
        pendingSalesLineRowBaseMeta[id] = previousMeta;
    }
    order._baseRowVersion = previousMeta.version || 0;
    order._baseRowUpdatedAt = previousMeta.updatedAt || '';
    const actor = getCurrentSalesLineActor();
    setSalesLineRowSyncMeta(order, {
        version: Number(previousMeta.version || 0) + 1,
        updatedAt: new Date().toISOString(),
        updatedByUid: actor.uid,
        updatedByParaf: actor.paraf
    });
    pendingChangedSalesLineRowIds.add(id);
    pendingDeletedSalesLineRowIds.delete(id);
}

function queueSalesLineRowDelete(order) {
    if (!order || !order._id) return;
    const id = String(order._id);
    if (!pendingSalesLineRowBaseMeta[id]) {
        pendingSalesLineRowBaseMeta[id] = getSalesLineRowSyncMeta(order);
    }
    order._baseRowVersion = pendingSalesLineRowBaseMeta[id].version || 0;
    order._baseRowUpdatedAt = pendingSalesLineRowBaseMeta[id].updatedAt || '';
    pendingChangedSalesLineRowIds.delete(id);
    pendingDeletedSalesLineRowIds.add(id);
}

function parseSalesLinesV2Payload(raw) {
    if (!raw) return null;
    const rows = raw.rows || {};
    const editedLogRaw = raw.editedLog || {};
    const allOrders = Object.values(rows)
        .filter(Boolean)
        .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
        .map(entry => {
            if (typeof entry.rowJson === 'string') {
                try { return JSON.parse(entry.rowJson); } catch (_) { return {}; }
            }
            return entry.data || entry;
        });
    const editedLog = {};
    Object.entries(editedLogRaw).forEach(([key, value]) => {
        const row = rows[key];
        let rowData = row?.data || null;
        if (!rowData && typeof row?.rowJson === 'string') {
            try { rowData = JSON.parse(row.rowJson); } catch (_) {}
        }
        const rowId = rowData?._id || rowData?.id || key;
        if (typeof value?.logJson === 'string') {
            try { editedLog[rowId] = JSON.parse(value.logJson); } catch (_) { editedLog[rowId] = []; }
        } else if (value != null) {
            editedLog[rowId] = value;
        }
    });
    return {
        version: raw.meta?.version || 2,
        savedAt: raw.meta?.savedAt || new Date().toISOString(),
        meta: raw.meta?.meta || {},
        editedLog,
        columnOrder: Array.isArray(raw.meta?.columnOrder) ? raw.meta.columnOrder : [],
        allOrders
    };
}

function shouldApplyIncomingSalesLinesPayload(payload, options = {}) {
    if (!payload || options.force) return !!payload;

    const incomingTime = getSalesLinesPayloadTime(payload);
    const incomingSignature = getSalesLinesPayloadSignature(payload);
    if (incomingSignature && incomingSignature === lastLoadedSalesLinesPayloadSignature) return false;

    const pendingPayload = pendingSalesLinesCloudPayload;
    const pendingTime = getSalesLinesPayloadTime(pendingPayload);
    const pendingSignature = getSalesLinesPayloadSignature(pendingPayload);

    if (pendingTime && incomingTime && incomingTime < pendingTime) return false;
    if (pendingTime && incomingTime === pendingTime && pendingSignature && incomingSignature !== pendingSignature) return false;

    const localPayload = readLocalSalesLinesPayload();
    const localPayloadHasRows = Array.isArray(localPayload?.allOrders);
    const localTime = localPayloadHasRows
        ? getSalesLinesPayloadTime(localPayload)
        : lastPersistedSalesLinesPayloadTime;
    const localSignature = localPayloadHasRows
        ? getSalesLinesPayloadSignature(localPayload)
        : lastPersistedSalesLinesPayloadSignature;
    const incomingRows = getSalesLinesPayloadRowCount(payload);
    const localRows = localPayloadHasRows
        ? getSalesLinesPayloadRowCount(localPayload)
        : (lastPersistedSalesLinesPayloadRows || getSalesLinesPayloadRowCount(localPayload));

    if (incomingRows > 0 && localRows === 0) return true;

    if (localTime && incomingTime && incomingTime < localTime) return false;
    if (localTime && incomingTime === localTime && localSignature && incomingSignature !== localSignature) return false;

    if (lastSalesLinesLocalSaveTime && Date.now() - lastSalesLinesLocalSaveTime < 5000 && localSignature && incomingSignature !== localSignature) {
        return false;
    }

    return true;
}

async function flushSalesLinesCloudSave(payload, options = {}) {
    if (SALES_LINES_TEST_LOCAL_MODE) {
        lastCloudPayloadSignature = getSalesLinesPayloadSignature(payload);
        return true;
    }

    const cloudSaveAttempts = [];

    if (!suppressSalesLinesParentPost && window.parent && window.parent !== window) {
        if (typeof window.parent.syncSalesLinesPayloadToCloud === 'function') {
            cloudSaveAttempts.push(Promise.resolve(
                window.parent.syncSalesLinesPayloadToCloud(payload, 'sales_lines_iframe_debounced', options)
            ).catch(error => {
                console.warn('Dogrudan cloud sync hatasi:', error);
                return false;
            }));
        } else {
            window.parent.postMessage({ type: 'sales-lines-updated', payload }, '*');
        }
    }

    if (cloudSaveAttempts.length === 0 && isEmbeddedSalesLinesFrame()) {
        getEmbeddedParentWindow()?.postMessage?.({ type: 'sales-lines-updated', payload }, '*');
    }

    if (cloudSaveAttempts.length === 0 && !isEmbeddedSalesLinesFrame()) {
        const cloudState = {
            version: payload.version || 1,
            savedAt: payload.savedAt || new Date().toISOString(),
            payloadJson: JSON.stringify(payload)
        };

        cloudSaveAttempts.push(fetch(SALES_LINES_CLOUD_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cloudState),
            cache: 'no-store'
        }).then(async response => {
            if (response.ok) return true;

            const responseText = await response.text().catch(() => '');
            console.warn('Iframe direct Firebase write failed:', response.status, responseText);
            return false;
        }).catch(error => {
            console.warn('Iframe direct Firebase write error:', error);
            return false;
        }));
    }

    const cloudResults = await Promise.all(cloudSaveAttempts);
    const conflictResult = cloudResults.find(result => result && typeof result === 'object' && Array.isArray(result.conflicts) && result.conflicts.length > 0);
    if (conflictResult) {
        addSalesLineConflicts(conflictResult.conflicts);
        lastCloudPayloadSignature = getSalesLinesPayloadSignature(payload);
        return conflictResult;
    }
    const savedToCloud = cloudResults.some(isSalesLinesCloudSaveSuccessful);
    if (savedToCloud) {
        lastCloudPayloadSignature = getSalesLinesPayloadSignature(payload);
    } else if (!suppressSalesLinesParentPost) {
        showToast('Veri bu cihazda yuklendi ancak buluta kaydedilemedi. Diger kullanicilarda gorunmeyebilir.', 'warning');
    }

    return savedToCloud;
}

function scheduleSalesLinesCloudSave(payload, immediate = false) {
    pendingSalesLinesCloudPayload = payload;

    if (pendingSalesLinesCloudTimer) {
        clearTimeout(pendingSalesLinesCloudTimer);
        pendingSalesLinesCloudTimer = null;
    }

    const promise = new Promise(resolve => pendingSalesLinesCloudResolvers.push(resolve));
    const run = async () => {
        const nextPayload = pendingSalesLinesCloudPayload;
        const resolvers = pendingSalesLinesCloudResolvers.splice(0);
        pendingSalesLinesCloudPayload = null;
        pendingSalesLinesCloudTimer = null;

        let result = false;
        try {
            result = await flushSalesLinesCloudSave(nextPayload);
        } catch (error) {
            console.warn('Sales lines cloud kaydi basarisiz:', error);
        }
        resolvers.forEach(resolve => resolve(result));
    };

    if (immediate) {
        run();
    } else {
        pendingSalesLinesCloudTimer = setTimeout(run, SALES_LINES_SAVE_DEBOUNCE_MS);
    }

    return promise;
}

function scheduleSalesLinesSave(meta = {}, options = {}) {
    const normalizedMeta = (meta && typeof meta === 'object') ? meta : {};
    const normalizedOptions = (options && typeof options === 'object') ? options : {};
    const immediate = !!(normalizedOptions.immediate || normalizedMeta.sourceFile || normalizedMeta.reset || normalizedOptions.fullSync);

    if (immediate) {
        return saveSalesLinesState(normalizedMeta, { ...normalizedOptions, immediate: true });
    }

    scheduledSalesLinesSaveMeta = {
        ...scheduledSalesLinesSaveMeta,
        ...normalizedMeta,
        source: normalizedMeta.source || scheduledSalesLinesSaveMeta.source || 'local-edit'
    };
    scheduledSalesLinesSaveOptions = {
        ...scheduledSalesLinesSaveOptions,
        ...normalizedOptions
    };

    if (scheduledSalesLinesSaveTimer) {
        clearTimeout(scheduledSalesLinesSaveTimer);
        scheduledSalesLinesSaveTimer = null;
    }

    const promise = new Promise(resolve => scheduledSalesLinesSaveResolvers.push(resolve));
    scheduledSalesLinesSaveTimer = setTimeout(async () => {
        const nextMeta = scheduledSalesLinesSaveMeta;
        const nextOptions = scheduledSalesLinesSaveOptions;
        const resolvers = scheduledSalesLinesSaveResolvers.splice(0);

        scheduledSalesLinesSaveTimer = null;
        scheduledSalesLinesSaveMeta = {};
        scheduledSalesLinesSaveOptions = {};

        let result = false;
        try {
            result = await saveSalesLinesState(nextMeta, nextOptions);
        } catch (error) {
            console.warn('Sales lines scheduled save failed:', error);
        }
        resolvers.forEach(resolve => resolve(result));
    }, Number(normalizedOptions.delay || SALES_LINES_SAVE_DEBOUNCE_MS));

    return promise;
}

async function saveTodayOutputsState(meta = {}, options = {}) {
    try {
        if (!ensureSalesLinesWritable()) return false;
        const payload = buildTodayOutputsCloudPayload(meta);
        const reason = meta.source || meta.action || 'sales_lines_today_outputs_update';
        let saved = false;

        if (!suppressSalesLinesParentPost && window.parent && window.parent !== window) {
            if (typeof window.parent.syncSalesLinesTodayOutputsToCloud === 'function') {
                saved = await Promise.resolve(window.parent.syncSalesLinesTodayOutputsToCloud(payload, reason, options));
            } else if (window.parent.firebaseSync && typeof window.parent.firebaseSync.syncSalesLinesTodayOutputs === 'function') {
                saved = await Promise.resolve(window.parent.firebaseSync.syncSalesLinesTodayOutputs(payload, { reason, ...options }));
            }
        }

        if (!saved && !isEmbeddedSalesLinesFrame()) {
            const rowIds = {};
            payload.rowIds.forEach(id => {
                const key = String(id || '').trim();
                if (key) rowIds[key] = true;
            });
            const response = await fetch(`${SALES_LINES_TODAY_OUTPUTS_CLOUD_BASE_URL}/${payload.dateKey}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rowIds, meta: payload.meta }),
                cache: 'no-store'
            });
            saved = response.ok;
        }

        persistSalesLinesPayloadLocally(window.getSalesLinesBackupPayload());
        return !!saved;
    } catch (error) {
        console.warn('Bugünün çıkışları kaydedilemedi:', error);
        showToast('Bugünün çıkışları kaydedilirken hata oluştu.', 'warning');
        return false;
    }
}

async function saveSalesLinesState(meta = {}, options = {}) {
    let scheduledResolversForImmediate = [];
    try {
        if (!ensureSalesLinesWritable()) return false;
        if (options && options.immediate && scheduledSalesLinesSaveTimer) {
            clearTimeout(scheduledSalesLinesSaveTimer);
            scheduledSalesLinesSaveTimer = null;
            scheduledSalesLinesSaveMeta = {};
            scheduledSalesLinesSaveOptions = {};
            scheduledResolversForImmediate = scheduledSalesLinesSaveResolvers.splice(0);
        }
        const normalizedMeta = (meta && typeof meta === 'object') ? { ...meta } : {};
        if (!normalizedMeta.source) normalizedMeta.source = 'local-edit';
        const fullSync = !!(normalizedMeta.sourceFile || normalizedMeta.reset || options.fullSync);
        const changedRowIds = fullSync ? [] : Array.from(new Set([
            ...(Array.isArray(options.changedRowIds) ? options.changedRowIds : []),
            ...pendingChangedSalesLineRowIds
        ].map(id => String(id || '').trim()).filter(Boolean)));
        const deletedRowIds = fullSync ? [] : Array.from(new Set([
            ...(Array.isArray(options.deletedRowIds) ? options.deletedRowIds : []),
            ...pendingDeletedSalesLineRowIds
        ].map(id => String(id || '').trim()).filter(Boolean)));
        const rowBaseMeta = {};
        [...changedRowIds, ...deletedRowIds].forEach(id => {
            rowBaseMeta[id] = pendingSalesLineRowBaseMeta[id] || {};
        });
        if (!fullSync) {
            if (changedRowIds.length || deletedRowIds.length) {
                normalizedMeta.syncMode = 'row-patch';
                normalizedMeta.changedRowIds = changedRowIds;
                normalizedMeta.deletedRowIds = deletedRowIds;
                normalizedMeta.rowBaseMeta = rowBaseMeta;
            } else {
                normalizedMeta.syncMode = 'meta-only';
            }
        } else {
            normalizedMeta.syncMode = 'full';
        }
        const payload = {
            version: 1,
            savedAt: new Date().toISOString(),
            meta: normalizedMeta,
            editedLog,
            columnOrder: [],
            allOrders: allOrders.map(order => {
                const id = String(order?._id || order?.id || '').trim();
                return serializeSalesLineOrderCached(order, fullSync || changedRowIds.includes(id) || deletedRowIds.includes(id));
            })
        };
        persistSalesLinesPayloadLocally(payload);
        lastSalesLinesLocalSaveTime = Date.now();
        const immediate = !!(options.immediate || meta.sourceFile);
        const saved = await scheduleSalesLinesCloudSave(payload, immediate);
        scheduledResolversForImmediate.forEach(resolve => resolve(saved));
        if (!isSalesLinesCloudSaveSuccessful(saved)) {
            if (typeof queuePendingSalesLinesPatch === 'function') {
                await queuePendingSalesLinesPatch(payload, changedRowIds, deletedRowIds);
            }
            return saved;
        }
        const conflictIds = new Set(getSalesLineConflictIds(saved));
        changedRowIds.forEach(id => {
            if (!conflictIds.has(id)) pendingChangedSalesLineRowIds.delete(id);
        });
        deletedRowIds.forEach(id => {
            if (!conflictIds.has(id)) pendingDeletedSalesLineRowIds.delete(id);
        });
        [...changedRowIds, ...deletedRowIds].forEach(id => {
            if (!conflictIds.has(id)) delete pendingSalesLineRowBaseMeta[id];
        });
        return saved;
    } catch (error) {
        console.error('Sales lines state save error:', error);
        showToast('Satış satırları kaydedilirken hata oluştu.', 'warning');
        scheduledResolversForImmediate.forEach(resolve => resolve(false));
        return false;
    }
}

window.getSalesLinesBackupPayload = function () {
    return {
        version: 1,
        savedAt: new Date().toISOString(),
        meta: {
            source: 'sales-lines-frame-backup',
            rowCount: Array.isArray(allOrders) ? allOrders.length : 0
        },
        todayOutputs: {
            dateKey: getSalesLinesTodayOutputDateKey(),
            rowIds: Array.from(todayOutputOrderIds || [])
        },
        editedLog,
        columnOrder: [],
        allOrders: Array.isArray(allOrders)
            ? allOrders.map(order => serializeSalesLineOrderCached(order, true))
            : []
    };
};

function loadSalesLinesStateFromPayload(payload, options = {}) {
    try {
        if (!options.forceDuringEdit && isSalesLineInlineEditActive()) {
            queueSalesLinesRemotePayload(payload, options);
            return false;
        }

        if (!shouldApplyIncomingSalesLinesPayload(payload, options)) {
            return false;
        }

        const incomingSignature = getSalesLinesPayloadSignature(payload);
        const preserveView = !!(options.preserveView || options.silent || options.skipParentPost);
        const previousSort = { ...currentSort };
        const previousPage = currentPage;
        const previousColFilters = colFilters;

        if (!options.skipLocalPersist) {
            try {
                persistSalesLinesPayloadLocally(payload);
            } catch (storageError) {
                console.warn('Sales lines payload localStorage kaydi basarisiz:', storageError);
            }
        }

        filteredOrders = [];
        const normalizedIdentityState = normalizeSalesLineIdentities(
            Array.isArray(payload.allOrders) ? payload.allOrders.map(deserializeSalesLineOrder) : [],
            payload.editedLog || {}
        );
        editedLog = normalizedIdentityState.editedLog;
        const incomingTodayOutputIds = Array.isArray(payload.meta?.todayOutputOrderIds)
            ? payload.meta.todayOutputOrderIds
            : (Array.isArray(payload.todayOutputs?.rowIds) ? payload.todayOutputs.rowIds : []);
        todayOutputOrderIds = new Set(Array.isArray(incomingTodayOutputIds)
            ? incomingTodayOutputIds
                .map(id => normalizedIdentityState.idMap.get(String(id || '').trim()) || String(id || '').trim())
                .filter(Boolean)
            : []);
        allOrders = normalizedIdentityState.orders;
        rebuildSerializedSalesLineOrderCache();
        if (!accountColumnOrderLoaded) applyLocalPersonalizationPreferences();
        if (editedLog && Object.keys(editedLog).length > 0) {
            allOrders.forEach(syncPreviousSalesOrderNosFromEditedLog);
        }
        currentSort = preserveView ? previousSort : { col: null, asc: true };
        currentPage = preserveView ? previousPage : 1;
        colFilters = preserveView ? previousColFilters : {};

        if (allOrders.length === 0) {
            document.getElementById('mainContent').classList.remove('active');
            document.getElementById('loading').classList.remove('active');
            document.getElementById('uploadSection').style.display = 'block';
            lastLoadedSalesLinesPayloadSignature = incomingSignature;
            lastCloudPayloadSignature = incomingSignature;
            return true;
        }

        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('loading').classList.remove('active');
        document.getElementById('mainContent').classList.add('active');

        populateFilter('weekFilter', Array.from(new Set(allOrders.map(o => o['Hafta']).filter(Boolean))).sort((a, b) => a - b));
        populateFilter('repFilter', Array.from(new Set(allOrders.map(o => o['Temsilci']).filter(Boolean))).sort());
        populateFilter('locationFilter', Array.from(new Set(allOrders.map(o => o['Konum Kodu']).filter(Boolean))).sort());
        applyFilters({ preservePage: preserveView, preserveScroll: preserveView, skipDashboard: true });
        renderDashboard();
        if (!options.skipParentPost && window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'sales-lines-updated',
                payload: {
                    version: 1,
                    savedAt: payload.savedAt || new Date().toISOString(),
                    meta: payload.meta || {},
                    editedLog,
                    columnOrder: [],
                    allOrders: allOrders.map(order => serializeSalesLineOrderCached(order))
                }
            }, '*');
        }
        if (!options.silent && allOrders.length > 0) {
            showToast('Kayitli satis satirlari verisi yuklendi', 'success');
        }
        lastLoadedSalesLinesPayloadSignature = incomingSignature;
        lastCloudPayloadSignature = incomingSignature;
        return true;
    } catch (error) {
        console.error('Sales lines state load error:', error);
        return false;
    }
}

async function loadSalesLinesState() {
    try {
        const indexedPayload = await loadSalesLinesPayloadFromIndexedDb();
        if (indexedPayload && Array.isArray(indexedPayload.allOrders)) {
            return loadSalesLinesStateFromPayload(indexedPayload, { skipParentPost: true });
        }

        const raw = localStorage.getItem(SALES_LINES_STORAGE_KEY);
        if (!raw) return false;

        const payload = JSON.parse(raw);
        if (!Array.isArray(payload?.allOrders)) return false;
        await saveSalesLinesPayloadToIndexedDb(payload);
        persistSalesLinesPayloadLocally(payload);
        return loadSalesLinesStateFromPayload(payload, { skipParentPost: true });
    } catch (error) {
        console.error('Sales lines state load error:', error);
        return false;
    }
}

async function fetchCloudSalesLinesState() {
    if (SALES_LINES_TEST_LOCAL_MODE) return;
    if (cloudSyncInFlight) return;
    if (isParentSalesLinesRealtimeFresh()) return;

    cloudSyncInFlight = true;
    try {
        const parentSync = getParentFirebaseSyncBridge();
        let payload = null;

        if (parentSync && typeof parentSync.getSalesLinesPayload === 'function') {
            payload = await parentSync.getSalesLinesPayload();
        }

        if (!payload && isEmbeddedSalesLinesFrame()) {
            const parentWindow = getEmbeddedParentWindow();
            parentWindow?.postMessage?.({ type: 'sales-lines-ready' }, '*');
            return;
        }

        if (payload) {
            if (!shouldApplyIncomingSalesLinesPayload(payload, { silent: true })) {
                const localPayload = readLocalSalesLinesPayload();
                if (localPayload) lastCloudPayloadSignature = getSalesLinesPayloadSignature(localPayload);
                return;
            }

            const parentRemoteSignature = getSalesLinesPayloadSignature(payload);
            if (!parentRemoteSignature || parentRemoteSignature === lastCloudPayloadSignature) return;

            suppressSalesLinesParentPost = true;
            try {
                loadSalesLinesStateFromPayload(payload, { skipParentPost: true, silent: true });
            } finally {
                suppressSalesLinesParentPost = false;
            }
            return;
        }

        const response = await fetch(`${SALES_LINES_CLOUD_URL}?t=${Date.now()}`, {
            method: 'GET',
            cache: 'no-store'
        });
        if (!response.ok) return;

        const raw = await response.json();
        if (raw && typeof raw.payloadJson === 'string') {
            payload = JSON.parse(raw.payloadJson);
        } else if (raw && raw.storage === 'row-based') {
            const v2Response = await fetch(`${SALES_LINES_V2_CLOUD_URL}?t=${Date.now()}`, {
                method: 'GET',
                cache: 'no-store'
            });
            if (v2Response.ok) {
                payload = parseSalesLinesV2Payload(await v2Response.json());
            }
        } else if (raw && Array.isArray(raw.allOrders)) {
            payload = raw;
        }
        if (!payload) return;

        if (!shouldApplyIncomingSalesLinesPayload(payload, { silent: true })) {
            const localPayload = readLocalSalesLinesPayload();
            if (localPayload) lastCloudPayloadSignature = getSalesLinesPayloadSignature(localPayload);
            return;
        }

        const remoteSignature = getSalesLinesPayloadSignature(payload);
        if (!remoteSignature || remoteSignature === lastCloudPayloadSignature) return;

        suppressSalesLinesParentPost = true;
        try {
            loadSalesLinesStateFromPayload(payload, { skipParentPost: true, silent: true });
        } finally {
            suppressSalesLinesParentPost = false;
        }
    } catch (error) {
        console.warn('Sales lines cloud poll hatasi:', error);
    } finally {
        cloudSyncInFlight = false;
    }
}

function isParentSalesLinesRealtimeFresh() {
    try {
        const parentSync = window.parent && window.parent !== window ? window.parent.firebaseSync : null;
        const lastEventAt = Number(parentSync?.lastSalesLinesEventAt || 0);
        return !!lastEventAt && (Date.now() - lastEventAt < SALES_LINES_REALTIME_FRESH_MS);
    } catch (_) {
        return false;
    }
}

function getSalesLinesPollDelay() {
    return document.hidden ? SALES_LINES_POLL_HIDDEN_MS : SALES_LINES_POLL_VISIBLE_MS;
}

function startCloudSalesLinesPolling() {
    if (SALES_LINES_TEST_LOCAL_MODE) return;
    if (cloudSyncPollTimer) return;
    fetchCloudSalesLinesState();
    const scheduleNextPoll = () => {
        cloudSyncPollTimer = setTimeout(async () => {
            cloudSyncPollTimer = null;
            await fetchCloudSalesLinesState();
            scheduleNextPoll();
        }, getSalesLinesPollDelay());
    };
    scheduleNextPoll();
}

document.addEventListener('visibilitychange', () => {
    if (!cloudSyncPollTimer) return;
    clearTimeout(cloudSyncPollTimer);
    cloudSyncPollTimer = null;
    startCloudSalesLinesPolling();
});

window.addEventListener('online', () => {
    flushPendingSalesLinesPatches();
});

if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    setTimeout(() => flushPendingSalesLinesPatches(), 1500);
}

// Upload handling
