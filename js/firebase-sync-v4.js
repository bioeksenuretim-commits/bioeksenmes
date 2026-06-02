console.log('APP firebase-sync-v4 yüklendi');
/**
 * Firebase Realtime Database Sync Module
 * Siparişleri ve ürün ağaçlarını merkezi koleksiyonlarda tutar.
 * Toplu overwrite yerine diff tabanlı tekil create/update/delete yapar.
 */

var firebaseSync = {
    ordersRef: null,
    ordersV2Ref: null,
    ordersRowsRef: null,
    ordersMetaRef: null,
    productTreesRef: null,
    salesLinesRef: null,
    salesLinesV2Ref: null,
    salesLinesRowsRef: null,
    salesLinesEditedLogRef: null,
    salesLinesMetaRef: null,
    salesLinesTodayOutputsRef: null,
    auditLogsRef: null,
    isListening: false,
    isProductTreeListening: false,
    isSalesLinesListening: false,
    lastSyncTimestamp: 0,
    orderCache: new Map(),
    orderRowsCache: new Map(),
    ordersMetaCache: null,
    ordersEmitTimer: null,
    ordersV2HadData: false,
    productTreeCache: new Map(),
    salesLinesCache: '',
    salesLinesPayloadCache: null,
    salesLinesRowsCache: new Map(),
    salesLinesEditedLogCache: new Map(),
    salesLinesMetaCache: null,
    salesLinesTodayOutputsCache: { dateKey: '', rowIds: {}, meta: {} },
    salesLinesEmitTimer: null,
    pendingOrdersSnapshot: null,
    pendingOrdersRenderTimer: null,
    lastOrdersEventAt: 0,
    lastSalesLinesEventAt: 0,
    orderWriteInFlight: false,
    suppressedOrdersSnapshot: null,
    auditPermissionDenied: false,

    init() {
        if (!firebaseReady) {
            console.warn('Firebase hazır değil, sync başlatılamadı.');
            return;
        }

        const dbPath = typeof getFirebaseDbPath === 'function'
            ? getFirebaseDbPath
            : (path) => String(path || '').replace(/^\/+/, '');

        this.ordersRef = firebase.database().ref(dbPath('orders'));
        this.ordersV2Ref = firebase.database().ref(dbPath('ordersV2'));
        this.ordersRowsRef = firebase.database().ref(dbPath('ordersV2/rows'));
        this.ordersMetaRef = firebase.database().ref(dbPath('ordersV2/meta'));
        this.productTreesRef = firebase.database().ref(dbPath('productTrees'));
        this.salesLinesRef = firebase.database().ref(dbPath('salesLines/state'));
        this.salesLinesV2Ref = firebase.database().ref(dbPath('salesLines/v2'));
        this.salesLinesRowsRef = firebase.database().ref(dbPath('salesLines/v2/rows'));
        this.salesLinesEditedLogRef = firebase.database().ref(dbPath('salesLines/v2/editedLog'));
        this.salesLinesMetaRef = firebase.database().ref(dbPath('salesLines/v2/meta'));
        this.salesLinesTodayOutputsRef = firebase.database().ref(dbPath('salesLines/v2/todayOutputs'));
        this.auditLogsRef = firebase.database().ref(dbPath('auditLogs'));
        console.log(`Firebase Sync baslatildi${typeof isDevEnvironment === 'function' && isDevEnvironment() ? ' (DEV)' : ''}`);
    },

    cloneData(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    },

    getComparableString(value) {
        const clonedValue = this.cloneData(value);
        return JSON.stringify(clonedValue === undefined ? null : clonedValue);
    },

    sortOrdersList(orderList) {
        return [...orderList].sort((a, b) => {
            const dateA = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });
    },

    nowIso() {
        return new Date().toISOString();
    },

    getSalesLinesTodayOutputDateKey(date = new Date()) {
        const value = date instanceof Date ? date : new Date(date);
        if (!(value instanceof Date) || isNaN(value.getTime())) return new Date().toISOString().slice(0, 10);
        return [
            value.getFullYear(),
            String(value.getMonth() + 1).padStart(2, '0'),
            String(value.getDate()).padStart(2, '0')
        ].join('-');
    },

    normalizeTodayOutputsPayload(payload = {}) {
        const dateKey = String(payload.dateKey || this.getSalesLinesTodayOutputDateKey()).slice(0, 10);
        const rowIds = {};
        if (Array.isArray(payload.rowIds)) {
            payload.rowIds.forEach(id => {
                const key = String(id || '').trim();
                if (key) rowIds[this.encodeDatabaseKey(key)] = true;
            });
        } else if (payload.rowIds && typeof payload.rowIds === 'object') {
            Object.entries(payload.rowIds).forEach(([id, value]) => {
                if (!value) return;
                const key = String(id || '').trim();
                if (key) rowIds[this.encodeDatabaseKey(key)] = true;
            });
        }
        return {
            dateKey,
            rowIds,
            meta: this.cloneData(payload.meta || {})
        };
    },

    parseTodayOutputsNode(dateKey, value = {}) {
        const rowIds = {};
        Object.entries(value?.rowIds || {}).forEach(([id, enabled]) => {
            if (enabled) rowIds[id] = true;
        });
        return {
            dateKey: String(dateKey || this.getSalesLinesTodayOutputDateKey()),
            rowIds,
            meta: this.cloneData(value?.meta || {})
        };
    },

    getTodayOutputRowIdsFromCache() {
        return Object.entries(this.salesLinesTodayOutputsCache?.rowIds || {})
            .filter(([, enabled]) => !!enabled)
            .map(([id]) => id);
    },

    getOrderTime(order, field = 'updatedAt') {
        const value = order?.[field] || order?.lastModifiedAt || order?.createdAt || '';
        const time = value ? new Date(value).getTime() : 0;
        return Number.isFinite(time) ? time : 0;
    },

    isDeletedOrder(order) {
        return !!(order && order.deleted === true);
    },

    normalizeOrderForWrite(order, previousOrder = null, options = {}) {
        if (!order || !order.id) return null;

        const next = this.cloneData(order);
        const now = options.timestamp || this.nowIso();
        const actor = this.getCurrentActor();
        const previousVersion = Number(previousOrder?._sync?.version || previousOrder?.version || 0);
        const currentVersion = Number(next._sync?.version || next.version || 0);
        const nextVersion = Math.max(previousVersion, currentVersion) + 1;

        next.id = String(next.id);
        next._sync = {
            version: nextVersion,
            updatedAt: now,
            updatedByUid: actor.uid || null,
            updatedByParaf: actor.paraf || actor.uid || 'unknown'
        };
        next.version = nextVersion;
        next.updatedAt = now;
        next.updatedBy = next._sync.updatedByParaf;
        next.updatedByUid = actor.uid || null;
        return next;
    },

    buildOrderTombstone(orderId, previousOrder = null, options = {}) {
        if (!orderId) return null;

        const now = options.timestamp || this.nowIso();
        const actor = this.getCurrentActor();
        const previousVersion = Number(previousOrder?._sync?.version || previousOrder?.version || 0);
        const nextVersion = previousVersion + 1;

        return {
            ...(previousOrder || {}),
            id: String(orderId),
            deleted: true,
            deletedAt: now,
            deletedBy: actor.paraf || actor.uid || 'unknown',
            deletedByUid: actor.uid || null,
            updatedAt: now,
            updatedBy: actor.paraf || actor.uid || 'unknown',
            updatedByUid: actor.uid || null,
            _sync: {
                version: nextVersion,
                updatedAt: now,
                updatedByUid: actor.uid || null,
                updatedByParaf: actor.paraf || actor.uid || 'unknown'
            },
            version: nextVersion
        };
    },

    getOrderSyncMeta(order) {
        const sync = order?._sync && typeof order._sync === 'object' ? order._sync : {};
        return {
            version: Number(sync.version || order?.version || 0) || 0,
            updatedAt: String(sync.updatedAt || order?.updatedAt || order?.lastModifiedAt || ''),
            updatedByUid: sync.updatedByUid || order?.updatedByUid || null,
            updatedByParaf: sync.updatedByParaf || order?.updatedBy || order?.lastModifiedBy || ''
        };
    },

    shouldAcceptOrderWrite(currentOrder, previousOrder) {
        if (!previousOrder) return true;

        const previousVersion = Number(previousOrder.version || 0);
        const currentVersion = Number(currentOrder?.version || 0);
        if (currentVersion && previousVersion && currentVersion < previousVersion) {
            if (typeof setSyncStatus === 'function') {
                setSyncStatus('conflict', `Talep ${currentOrder?.id || previousOrder.id || ''} daha yeni bir sürüme sahip.`);
            }
            return false;
        }

        if (this.isDeletedOrder(previousOrder) && !this.isDeletedOrder(currentOrder)) {
            const currentTime = this.getOrderTime(currentOrder);
            const deletedTime = this.getOrderTime(previousOrder, 'deletedAt');
            if (!currentTime || currentTime < deletedTime) {
                if (typeof setSyncStatus === 'function') {
                    setSyncStatus('conflict', `Talep ${currentOrder?.id || previousOrder.id || ''} silinmiş görünüyor.`);
                }
                return false;
            }
        }

        return true;
    },

    updateLocalOrderFromWrite(order) {
        if (!order || !order.id || typeof orders === 'undefined' || !Array.isArray(orders)) return;

        const index = orders.findIndex(item => String(item?.id) === String(order.id));
        if (index >= 0 && !this.isDeletedOrder(order)) {
            orders[index] = this.cloneData(order);
        }
    },

    mergeRemoteOrdersIntoLocal(canonicalOrders = []) {
        const remoteMap = this.buildOrderMap(canonicalOrders);
        const localMap = this.buildOrderMap(typeof orders !== 'undefined' && Array.isArray(orders) ? orders : []);
        const mergedMap = new Map();

        remoteMap.forEach((remoteOrder, id) => {
            const localOrder = localMap.get(id);
            if (!localOrder) {
                mergedMap.set(id, this.cloneData(remoteOrder));
                return;
            }

            const remoteVersion = Number(remoteOrder.version || 0);
            const localVersion = Number(localOrder.version || 0);
            const remoteTime = this.getOrderTime(remoteOrder);
            const localTime = this.getOrderTime(localOrder);
            const localIsNewer = (localVersion && remoteVersion && localVersion > remoteVersion)
                || (!remoteVersion && localTime && remoteTime && localTime > remoteTime);

            mergedMap.set(id, this.cloneData(localIsNewer ? localOrder : remoteOrder));
        });

        localMap.forEach((localOrder, id) => {
            if (remoteMap.has(id) || this.isDeletedOrder(localOrder)) return;
            const wasKnownRemote = this.orderCache && this.orderCache.has(id);
            if (wasKnownRemote) return;
            const localTime = this.getOrderTime(localOrder);
            const createdTime = localOrder?.createdAt ? new Date(localOrder.createdAt).getTime() : 0;
            const isRecentLocal = Number.isFinite(createdTime) && Date.now() - createdTime < 30000;
            if (localTime || isRecentLocal) {
                mergedMap.set(id, this.cloneData(localOrder));
            }
        });

        return this.sortOrdersList(Array.from(mergedMap.values()).filter(order => !this.isDeletedOrder(order)));
    },

    buildOrderMap(orderList = []) {
        const map = new Map();
        orderList.forEach(order => {
            if (!order || !order.id) return;
            map.set(String(order.id), this.cloneData(order));
        });
        return map;
    },

    getOrderRowKey(orderOrId) {
        const id = typeof orderOrId === 'object' ? orderOrId?.id : orderOrId;
        return this.encodeDatabaseKey(id);
    },

    buildOrderRowEntry(order, index = 0) {
        const row = this.cloneData(order || {});
        const sync = row._sync && typeof row._sync === 'object' ? row._sync : {};
        const updatedAt = sync.updatedAt || row.updatedAt || row.lastModifiedAt || row.createdAt || new Date().toISOString();
        const version = Number(sync.version || row.version || 0) || 1;
        row._sync = {
            version,
            updatedAt,
            updatedByUid: sync.updatedByUid || row.updatedByUid || null,
            updatedByParaf: sync.updatedByParaf || row.updatedBy || row.lastModifiedBy || ''
        };
        row.version = version;
        row.updatedAt = updatedAt;
        row.updatedByUid = row._sync.updatedByUid;
        row.updatedBy = row._sync.updatedByParaf;
        return {
            index,
            orderJson: JSON.stringify(row),
            orderUpdatedAt: updatedAt,
            orderUpdatedBy: row._sync.updatedByParaf || '',
            orderUpdatedByUid: row._sync.updatedByUid || null,
            orderVersion: version
        };
    },

    parseOrderRowEntry(entry) {
        if (!entry) return {};
        if (typeof entry.orderJson === 'string') {
            try {
                return JSON.parse(entry.orderJson);
            } catch (_) {
                return {};
            }
        }
        return this.cloneData(entry.data || entry);
    },

    getOrderRowEntryVersion(entry) {
        const order = this.parseOrderRowEntry(entry);
        const version = Number(entry?.orderVersion || order?._sync?.version || order?.version || 0);
        return Number.isFinite(version) ? version : 0;
    },

    buildOrderConflict(id, type, localOrder, currentEntry, baseMeta = {}) {
        const remoteOrder = this.parseOrderRowEntry(currentEntry);
        return {
            id,
            type,
            localOrder: this.cloneData(localOrder || {}),
            remoteOrder: this.cloneData(remoteOrder || {}),
            baseMeta: this.cloneData(baseMeta || {}),
            remoteMeta: {
                version: this.getOrderRowEntryVersion(currentEntry),
                updatedAt: currentEntry?.orderUpdatedAt || remoteOrder?._sync?.updatedAt || remoteOrder?.updatedAt || remoteOrder?.lastModifiedAt || '',
                updatedBy: currentEntry?.orderUpdatedBy || remoteOrder?._sync?.updatedByParaf || remoteOrder?.updatedBy || remoteOrder?.lastModifiedBy || ''
            },
            conflictedAt: new Date().toISOString()
        };
    },

    buildOrdersSnapshotFromRows(rowsValue = null) {
        const source = rowsValue || Object.fromEntries(this.orderRowsCache || new Map());
        return Object.values(source || {})
            .filter(Boolean)
            .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
            .reduce((acc, entry) => {
                const order = this.parseOrderRowEntry(entry);
                if (order?.id) acc[String(order.id)] = order;
                return acc;
            }, {});
    },

    hydrateOrderRowsCaches(orderList = []) {
        const sortedOrders = this.sortOrdersList(orderList || []);
        this.orderRowsCache = new Map();
        sortedOrders.forEach((order, index) => {
            if (!order?.id) return;
            this.orderRowsCache.set(this.getOrderRowKey(order), this.buildOrderRowEntry(order, index));
        });
        this.orderCache = this.buildOrderMap(sortedOrders);
        this.ordersMetaCache = {
            version: 2,
            savedAt: new Date().toISOString(),
            rowCount: this.orderRowsCache.size
        };
        return sortedOrders;
    },

    normalizeManagedProduct(product) {
        if (!product) return null;

        return {
            catalogNo: String(product.catalogNo || product.productTreeNo || '').trim().toUpperCase(),
            productDescription: String(product.productDescription || product.description || '').trim(),
            hmNo: String(product.hmNo || '').trim().toUpperCase(),
            format: String(product.format || '').trim(),
            source: product.source === 'manual' ? 'manual' : 'excel',
            createdAt: product.createdAt || new Date().toISOString(),
            components: Array.isArray(product.components) ? product.components.map((component, index) => ({
                id: component.id || `cloud-component-${index}`,
                materialNo: String(component.materialNo || component.componentNo || '').trim().toUpperCase(),
                rxnName: String(component.rxnName || component.description || '').trim(),
                quantity: Number(component.quantity) || Number(component.multiplier) || 1,
                unit: String(component.unit || '').trim(),
                format: String(component.format || '').trim()
            })) : []
        };
    },

    encodeProductTreeKey(catalogNo) {
        return String(catalogNo || '')
            .trim()
            .replace(/[.#$\[\]\/]/g, char => `_x${char.charCodeAt(0).toString(16)}_`);
    },

    encodeDatabaseKey(value) {
        return String(value || '')
            .trim()
            .replace(/[.#$[\]/]/g, char => `_x${char.charCodeAt(0).toString(16)}_`) || 'empty';
    },

    normalizeSalesLineIdentityValue(value) {
        return String(value ?? '').trim().toLocaleUpperCase('tr-TR');
    },

    getSalesLineIdentityField(row, aliases) {
        for (const key of aliases) {
            const value = row?.[key];
            if (value !== undefined && value !== null && String(value).trim() !== '') return value;
        }
        return '';
    },

    simpleSalesLineHash(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    },

    isGeneratedSalesLineId(id) {
        const value = String(id || '').trim();
        return !value || /^row_\d+$/i.test(value);
    },

    buildStableSalesLineId(row, index = 0) {
        const existingId = String(row?._id || row?.id || '').trim();
        if (existingId && !this.isGeneratedSalesLineId(existingId)) return existingId;

        const belgeNo = this.getSalesLineIdentityField(row, ['Belge No', 'BELGE NO', 'Document No', 'Order No']);
        const lineNo = this.getSalesLineIdentityField(row, ['Satır No', 'Satir No', 'Line No', 'Sıra No', 'Sira No', 'Sıra', 'Sira']);
        const itemNo = this.getSalesLineIdentityField(row, ['No', 'NO', 'Katalog No', 'Madde No', 'Stok Kodu', 'Ürün No', 'Urun No']);
        const quantity = this.getSalesLineIdentityField(row, ['Miktar', 'MIKTAR', 'Quantity']);
        const date = this.getSalesLineIdentityField(row, ['Sevk Tarihi', 'Termin Tarihi', 'Teslim Tarihi', 'Talep edilen teslim tarihi']);
        let raw = '';

        if (belgeNo && lineNo) {
            raw = [belgeNo, lineNo].map(value => this.normalizeSalesLineIdentityValue(value)).join('|');
        } else if (belgeNo && itemNo && (quantity || date)) {
            raw = [belgeNo, itemNo, quantity, date].map(value => this.normalizeSalesLineIdentityValue(value)).join('|');
        } else if (itemNo && (quantity || date)) {
            raw = [itemNo, quantity, date].map(value => this.normalizeSalesLineIdentityValue(value)).join('|');
        }

        if (raw.replace(/\|/g, '')) return `sl_${this.simpleSalesLineHash(raw)}`;
        if (existingId) return `sl_${this.simpleSalesLineHash(`existing|${existingId}`)}`;
        return `sl_manual_${Date.now()}_${index}`;
    },

    normalizeSalesLineIdentities(orders, editedLogMap = {}, meta = {}) {
        const seen = new Map();
        const idMap = new Map();
        const normalizedOrders = (Array.isArray(orders) ? orders : []).map((order, index) => {
            const previousId = String(order?._id || order?.id || '').trim();
            const baseId = this.buildStableSalesLineId(order, index);
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
        const normalizedMeta = { ...(meta || {}) };
        ['changedRowIds', 'deletedRowIds', 'todayOutputOrderIds'].forEach(key => {
            if (Array.isArray(normalizedMeta[key])) {
                normalizedMeta[key] = normalizedMeta[key]
                    .map(id => idMap.get(String(id || '').trim()) || String(id || '').trim())
                    .filter(Boolean);
            }
        });
        if (normalizedMeta.rowBaseMeta && typeof normalizedMeta.rowBaseMeta === 'object') {
            const nextBaseMeta = {};
            Object.entries(normalizedMeta.rowBaseMeta).forEach(([id, value]) => {
                nextBaseMeta[idMap.get(String(id)) || String(id)] = value;
            });
            normalizedMeta.rowBaseMeta = nextBaseMeta;
        }
        if (normalizedMeta.changedColumnsByRow && typeof normalizedMeta.changedColumnsByRow === 'object') {
            const nextChangedColumnsByRow = {};
            Object.entries(normalizedMeta.changedColumnsByRow).forEach(([id, value]) => {
                nextChangedColumnsByRow[idMap.get(String(id)) || String(id)] = value;
            });
            normalizedMeta.changedColumnsByRow = nextChangedColumnsByRow;
        }
        return { orders: normalizedOrders, editedLog: normalizedEditedLog, meta: normalizedMeta };
    },

    buildProductTreeMap(products = []) {
        const map = new Map();
        products.forEach(product => {
            const normalized = this.normalizeManagedProduct(product);
            if (!normalized || !normalized.catalogNo) return;
            map.set(normalized.catalogNo, normalized);
        });
        return map;
    },

    normalizeSalesLinesPayload(payload) {
        const identityState = this.normalizeSalesLineIdentities(
            Array.isArray(payload?.allOrders) ? payload.allOrders : [],
            payload?.editedLog || {},
            payload?.meta || {}
        );
        const normalizedPayload = {
            version: payload?.version || 1,
            savedAt: payload?.savedAt || new Date().toISOString(),
            meta: identityState.meta,
            editedLog: identityState.editedLog,
            columnOrder: Array.isArray(payload?.columnOrder) ? payload.columnOrder : [],
            allOrders: identityState.orders
        };

        return this.cloneData(normalizedPayload);
    },

    encodeSalesLinesPayload(payload) {
        const normalizedPayload = this.normalizeSalesLinesPayload(payload);
        return {
            version: normalizedPayload.version,
            savedAt: normalizedPayload.savedAt,
            payloadJson: JSON.stringify(normalizedPayload)
        };
    },

    decodeSalesLinesPayload(payload) {
        if (!payload) return null;

        if (typeof payload.payloadJson === 'string') {
            try {
                return this.normalizeSalesLinesPayload(JSON.parse(payload.payloadJson));
            } catch (error) {
                console.error('Sales lines payload parse hatasi:', error);
                return null;
            }
        }

        return this.normalizeSalesLinesPayload(payload);
    },

    getSalesLineRowKey(order, index = 0) {
        return this.encodeDatabaseKey(this.buildStableSalesLineId(order, index));
    },

    parseSalesLineRowEntry(entry) {
        if (!entry) return {};
        if (typeof entry.rowJson === 'string') {
            try {
                return JSON.parse(entry.rowJson);
            } catch (_) {
                return {};
            }
        }
        return this.cloneData(entry.data || entry);
    },

    getSalesLineRowEntryTime(entry) {
        const row = this.parseSalesLineRowEntry(entry);
        const sync = row?._sync && typeof row._sync === 'object' ? row._sync : {};
        const value = entry?.rowUpdatedAt || sync.updatedAt || row?._rowUpdatedAt || '';
        const time = value ? new Date(value).getTime() : 0;
        return Number.isFinite(time) ? time : 0;
    },

    getSalesLineRowEntryVersion(entry) {
        const row = this.parseSalesLineRowEntry(entry);
        const sync = row?._sync && typeof row._sync === 'object' ? row._sync : {};
        const version = Number(entry?.rowVersion || sync.version || row?._rowVersion || 0);
        return Number.isFinite(version) ? version : 0;
    },

    normalizeSalesLineColumnList(columns) {
        return Array.from(new Set((Array.isArray(columns) ? columns : [])
            .map(col => String(col || '').trim())
            .filter(Boolean)));
    },

    getSalesLineChangedColumnsBetween(baseRow = {}, nextRow = {}) {
        if (!baseRow || !nextRow || typeof baseRow !== 'object' || typeof nextRow !== 'object') return [];
        const ignored = new Set(['_sync', '_rowVersion', '_rowUpdatedAt', '_rowUpdatedByUid', '_rowUpdatedBy', '_baseRowVersion', '_baseRowUpdatedAt', '_searchIndex']);
        return this.normalizeSalesLineColumnList(Object.keys({ ...baseRow, ...nextRow })
            .filter(col => !ignored.has(col))
            .filter(col => this.getComparableString(baseRow[col]) !== this.getComparableString(nextRow[col])));
    },

    salesLineColumnsIntersect(left = [], right = []) {
        const rightSet = new Set(this.normalizeSalesLineColumnList(right));
        return this.normalizeSalesLineColumnList(left).some(col => rightSet.has(col));
    },

    buildMergedSalesLineRow(remoteRow, localRow, localChangedColumns = []) {
        const merged = this.cloneData(remoteRow || {});
        this.normalizeSalesLineColumnList(localChangedColumns).forEach(col => {
            if (Object.prototype.hasOwnProperty.call(localRow || {}, col)) {
                merged[col] = this.cloneData(localRow[col]);
            } else {
                delete merged[col];
            }
        });
        return merged;
    },

    buildSalesLineConflict(id, type, localOrder, currentEntry, baseMeta = {}, key = '', extra = {}) {
        const remoteRow = this.parseSalesLineRowEntry(currentEntry);
        return {
            id,
            key,
            type,
            localRow: this.cloneData(localOrder || {}),
            remoteRow: this.cloneData(remoteRow || {}),
            baseMeta: this.cloneData(baseMeta || {}),
            localChangedColumns: this.normalizeSalesLineColumnList(extra.localChangedColumns || []),
            remoteChangedColumns: this.normalizeSalesLineColumnList(extra.remoteChangedColumns || []),
            remoteMeta: {
                updatedAt: currentEntry?.rowUpdatedAt || remoteRow?._sync?.updatedAt || remoteRow?._rowUpdatedAt || '',
                version: this.getSalesLineRowEntryVersion(currentEntry),
                updatedBy: currentEntry?.rowUpdatedBy || remoteRow?._sync?.updatedByParaf || remoteRow?._rowUpdatedBy || '',
                updatedByUid: currentEntry?.rowUpdatedByUid || remoteRow?._sync?.updatedByUid || remoteRow?._rowUpdatedByUid || null
            },
            conflictedAt: new Date().toISOString()
        };
    },

    getSalesLinePatchRowIds(payload, key) {
        const ids = payload?.meta?.[key];
        return Array.isArray(ids) ? ids.map(id => String(id || '').trim()).filter(Boolean) : [];
    },

    sanitizeSalesLinesMetaForStorage(meta = {}) {
        const sanitized = { ...(meta || {}) };
        delete sanitized.syncMode;
        delete sanitized.changedRowIds;
        delete sanitized.deletedRowIds;
        delete sanitized.rowBaseMeta;
        delete sanitized.changedColumnsByRow;
        delete sanitized.todayOutputOrderIds;
        delete sanitized.todayOutputsDate;
        delete sanitized.todayOutputsMeta;
        return sanitized;
    },

    buildSalesLineRowEntry(order, index = 0) {
        const row = this.cloneData(order || {});
        const sync = row._sync && typeof row._sync === 'object' ? row._sync : {};
        const rowUpdatedAt = sync.updatedAt || row._rowUpdatedAt || new Date().toISOString();
        const rowVersion = Number(sync.version || row._rowVersion || 0) || 1;
        row._sync = {
            version: rowVersion,
            updatedAt: rowUpdatedAt,
            updatedByUid: sync.updatedByUid || row._rowUpdatedByUid || null,
            updatedByParaf: sync.updatedByParaf || row._rowUpdatedBy || ''
        };
        row._rowVersion = rowVersion;
        row._rowUpdatedAt = rowUpdatedAt;
        row._rowUpdatedByUid = row._sync.updatedByUid;
        row._rowUpdatedBy = row._sync.updatedByParaf;
        return {
            index,
            rowJson: JSON.stringify(row),
            rowUpdatedAt,
            rowUpdatedBy: row._sync.updatedByParaf || '',
            rowUpdatedByUid: row._sync.updatedByUid || null,
            rowVersion
        };
    },

    buildSalesLinesV2Payload(meta = {}, rowsValue = {}, editedLogValue = {}) {
        const rowEntries = Object.values(rowsValue || {})
            .filter(Boolean)
            .sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
        const allOrders = rowEntries.map(entry => {
            if (typeof entry.rowJson === 'string') {
                try {
                    return JSON.parse(entry.rowJson);
                } catch (_) {
                    return {};
                }
            }
            return this.cloneData(entry.data || entry);
        });
        const editedLog = {};

        Object.entries(editedLogValue || {}).forEach(([key, value]) => {
            const row = rowsValue?.[key];
            let rowData = row?.data || null;
            if (!rowData && typeof row?.rowJson === 'string') {
                try {
                    rowData = JSON.parse(row.rowJson);
                } catch (_) {}
            }
            const rowId = rowData?._id || rowData?.id || key;
            if (value != null) {
                if (typeof value.logJson === 'string') {
                    try {
                        editedLog[rowId] = JSON.parse(value.logJson);
                    } catch (_) {
                        editedLog[rowId] = [];
                    }
                } else {
                    editedLog[rowId] = this.cloneData(value);
                }
            }
        });

        const todayOutputIds = this.getTodayOutputRowIdsFromCache();
        return this.normalizeSalesLinesPayload({
            version: meta?.version || 2,
            savedAt: meta?.savedAt || new Date().toISOString(),
            meta: {
                ...this.sanitizeSalesLinesMetaForStorage(meta?.meta || {}),
                todayOutputOrderIds: todayOutputIds,
                todayOutputsDate: this.salesLinesTodayOutputsCache?.dateKey || this.getSalesLinesTodayOutputDateKey(),
                todayOutputsMeta: this.cloneData(this.salesLinesTodayOutputsCache?.meta || {})
            },
            columnOrder: Array.isArray(meta?.columnOrder) ? meta.columnOrder : [],
            editedLog,
            allOrders
        });
    },

    hydrateSalesLinesV2Caches(payload) {
        const normalizedPayload = this.normalizeSalesLinesPayload(payload);
        this.salesLinesPayloadCache = normalizedPayload;
        this.salesLinesMetaCache = {
            version: normalizedPayload.version || 2,
            savedAt: normalizedPayload.savedAt,
            meta: normalizedPayload.meta || {},
            columnOrder: Array.isArray(normalizedPayload.columnOrder) ? normalizedPayload.columnOrder : [],
            rowCount: Array.isArray(normalizedPayload.allOrders) ? normalizedPayload.allOrders.length : 0
        };
        this.salesLinesRowsCache = new Map();
        (normalizedPayload.allOrders || []).forEach((order, index) => {
            this.salesLinesRowsCache.set(this.getSalesLineRowKey(order, index), this.buildSalesLineRowEntry(order, index));
        });
        this.salesLinesEditedLogCache = new Map();
        Object.entries(normalizedPayload.editedLog || {}).forEach(([rowId, logs]) => {
            this.salesLinesEditedLogCache.set(this.encodeDatabaseKey(rowId), {
                logJson: JSON.stringify(this.cloneData(logs))
            });
        });
        this.salesLinesCache = this.getComparableString(normalizedPayload);
        return normalizedPayload;
    },

    buildSalesLinesPayloadFromCaches() {
        const rowsValue = {};
        const logsValue = {};
        this.salesLinesRowsCache.forEach((value, key) => { rowsValue[key] = value; });
        this.salesLinesEditedLogCache.forEach((value, key) => { logsValue[key] = value; });
        return this.buildSalesLinesV2Payload(this.salesLinesMetaCache || {}, rowsValue, logsValue);
    },

    getCurrentActor() {
        const actor = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : (window.currentUser || null);
        return {
            uid: actor?.uid || actor?.userId || null,
            paraf: actor?.paraf || actor?.fullName || 'anonymous',
            role: actor?.role || 'anonymous'
        };
    },

    canWriteProductTrees() {
        if (typeof hasMatchingFirebaseAuthSession === 'function') {
            return hasMatchingFirebaseAuthSession() && currentUser && currentUser.role === 'admin';
        }
        return false;
    },

    encodeAuditValue(value) {
        if (value === undefined || value === null) return null;

        try {
            return JSON.stringify(this.cloneData(value));
        } catch (error) {
            console.warn('Audit value serialize edilemedi:', error);
            return JSON.stringify({ error: 'serialization_failed' });
        }
    },

    async writeAuditLog(entry) {
        if (!this.auditLogsRef || this.auditPermissionDenied) return;

        try {
            await this.auditLogsRef.push({
                actor: this.getCurrentActor(),
                entityType: entry.entityType,
                entityId: entry.entityId,
                action: entry.action,
                reason: entry.reason || '',
                beforeJson: this.encodeAuditValue(entry.before === undefined ? null : entry.before),
                afterJson: this.encodeAuditValue(entry.after === undefined ? null : entry.after),
                createdAt: new Date().toISOString()
            });
        } catch (error) {
            if (error && (error.code === 'PERMISSION_DENIED' || String(error.message || '').toLowerCase().includes('permission denied'))) {
                this.auditPermissionDenied = true;
                console.warn('Audit log yetkisi yok, audit yazimi devre disi birakildi.');
                return;
            }
            console.warn('Audit log yazılamadı:', error);
        }
    },

    async applyRemoteOrders(snapshotValue) {
        const remoteOrders = snapshotValue ? Object.values(snapshotValue).filter(Boolean) : [];
        const sortedOrders = this.sortOrdersList(remoteOrders);

        const canonicalMap = new Map();
        sortedOrders.forEach(order => {
            const key = order?.sourceSystem === 'sales-lines'
                ? String(order?.sourceExternalId || order?.id || '').trim()
                : String(order?.id || '').trim();
            if (!key) return;
            canonicalMap.set(key, order);
        });
        const canonicalOrders = Array.from(canonicalMap.values());
        orders = this.mergeRemoteOrdersIntoLocal(canonicalOrders);

        if (typeof syncOrderFormatsFromProductTree === 'function') {
            try {
                await syncOrderFormatsFromProductTree({ persist: false, skipRender: true });
            } catch (error) {
                console.warn('Remote sipariş format eşleme hatası:', error);
            }
        }

        this.orderCache = this.buildOrderMap(canonicalOrders);
        this.hydrateOrderRowsCaches(canonicalOrders);

        if (typeof storage !== 'undefined' && storage.saveAll) {
            storage.saveAll(orders).catch(error => console.warn('IndexedDB cache hatası:', error));
        }

        try {
            if (typeof renderDashboard === 'function') renderDashboard();
            if (typeof renderWeekSidebar === 'function') renderWeekSidebar();
            if (typeof renderCurrentView === 'function') {
                renderCurrentView();
            } else if (typeof applyFilters === 'function') {
                applyFilters();
            }
        } catch (error) {
            console.warn('UI render hatası:', error);
        }

        // Sales-lines türevi kayıtları her Firebase değer güncellemesinde
        // yeniden üretmek kümülatif artışa yol açabildiği için burada
        // otomatik reconcile tetiklenmiyor.
    },

    scheduleRemoteOrdersApply(snapshotValue, delay = 180) {
        this.pendingOrdersSnapshot = snapshotValue || {};

        if (this.pendingOrdersRenderTimer) {
            clearTimeout(this.pendingOrdersRenderTimer);
        }

        this.pendingOrdersRenderTimer = setTimeout(() => {
            const latestSnapshot = this.pendingOrdersSnapshot;
            this.pendingOrdersRenderTimer = null;
            this.pendingOrdersSnapshot = null;
            this.applyRemoteOrders(latestSnapshot);
        }, delay);
    },

    flushSuppressedOrdersSnapshot() {
        if (!this.suppressedOrdersSnapshot) return;
        const suppressedSnapshot = this.suppressedOrdersSnapshot;
        this.suppressedOrdersSnapshot = null;
        this.scheduleRemoteOrdersApply(suppressedSnapshot, 0);
    },

    startListening() {
        if (this.ordersRowsRef && !this.isListening) {
            this.isListening = true;
            const scheduleEmit = () => {
                this.lastOrdersEventAt = Date.now();
                if (typeof setSyncStatus === 'function' && typeof navigator !== 'undefined' && navigator.onLine !== false) {
                    setSyncStatus('live');
                }
                if (this.orderWriteInFlight) {
                    this.suppressedOrdersSnapshot = this.buildOrdersSnapshotFromRows();
                    return;
                }
                if (this.ordersEmitTimer) clearTimeout(this.ordersEmitTimer);
                this.ordersEmitTimer = setTimeout(() => {
                    this.ordersEmitTimer = null;
                    this.scheduleRemoteOrdersApply(this.buildOrdersSnapshotFromRows(), 0);
                }, 150);
            };

            if (this.ordersMetaRef) {
                this.ordersMetaRef.on('value', snapshot => {
                    const meta = snapshot.val();
                    if (!meta) return;
                    this.ordersV2HadData = true;
                    this.ordersMetaCache = meta;
                    scheduleEmit();
                });
            }

            this.ordersRowsRef.on('child_added', snapshot => {
                if (!snapshot.key || this.orderRowsCache.has(snapshot.key)) return;
                this.ordersV2HadData = true;
                this.orderRowsCache.set(snapshot.key, snapshot.val());
                scheduleEmit();
            });
            this.ordersRowsRef.on('child_changed', snapshot => {
                if (!snapshot.key) return;
                this.ordersV2HadData = true;
                this.orderRowsCache.set(snapshot.key, snapshot.val());
                scheduleEmit();
            });
            this.ordersRowsRef.on('child_removed', snapshot => {
                if (!snapshot.key) return;
                this.orderRowsCache.delete(snapshot.key);
                scheduleEmit();
            });

            if (this.ordersRef) {
                this.ordersRef.on('value', snapshot => {
                    if (this.ordersV2HadData || (this.orderRowsCache && this.orderRowsCache.size > 0)) return;
                    this.lastOrdersEventAt = Date.now();
                    this.scheduleRemoteOrdersApply(snapshot.val());
                });
            }

            console.log('Firebase siparis row-based dinleme baslatildi');
            return;
        }

        if (!this.ordersRef || this.isListening) return;

        this.isListening = true;
        this.ordersRef.on('value', snapshot => {
            this.lastOrdersEventAt = Date.now();
            console.log('Firebase real-time sipariş güncellemesi alındı');
            if (typeof setSyncStatus === 'function' && typeof navigator !== 'undefined' && navigator.onLine !== false) {
                setSyncStatus('live');
            }
            if (this.orderWriteInFlight) {
                this.suppressedOrdersSnapshot = snapshot.val();
                return;
            }
            this.scheduleRemoteOrdersApply(snapshot.val());
        });

        console.log('Firebase sipariş dinleme başlatıldı');
    },

    stopListening() {
        if (this.ordersMetaRef) this.ordersMetaRef.off();
        if (this.ordersRowsRef) this.ordersRowsRef.off();
        if (this.ordersEmitTimer) {
            clearTimeout(this.ordersEmitTimer);
            this.ordersEmitTimer = null;
        }
        if (this.ordersRef) {
            this.ordersRef.off('value');
        }
        if (this.pendingOrdersRenderTimer) {
            clearTimeout(this.pendingOrdersRenderTimer);
            this.pendingOrdersRenderTimer = null;
        }
        this.pendingOrdersSnapshot = null;
        this.isListening = false;
    },

    async syncOrderDiff(orderList = [], options = {}) {
        if (!this.ordersRowsRef && !this.ordersRef) return false;
        if (typeof setSyncStatus === 'function') setSyncStatus('syncing');

        const currentMap = this.buildOrderMap(orderList);
        const previousMap = this.orderCache || new Map();
        const upserts = [];
        const deletions = [];

        currentMap.forEach((currentOrder, id) => {
            const previousOrder = previousMap.get(id);
            if (!this.shouldAcceptOrderWrite(currentOrder, previousOrder)) {
                return;
            }

            if (options.force || !previousOrder || this.getComparableString(previousOrder) !== this.getComparableString(currentOrder)) {
                const after = this.normalizeOrderForWrite(currentOrder, previousOrder, options);
                if (after) upserts.push({ id, before: previousOrder || null, after });
            }
        });

        previousMap.forEach((previousOrder, id) => {
            if (!currentMap.has(id) && !this.isDeletedOrder(previousOrder)) {
                const after = this.buildOrderTombstone(id, previousOrder, options);
                if (after) deletions.push({ id, before: previousOrder, after });
            }
        });

        if (upserts.length === 0 && deletions.length === 0) {
            this.orderCache = currentMap;
            if (typeof setSyncStatus === 'function') {
                setSyncStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'live');
            }
            return true;
        }

        const batchedUpdates = {};
        upserts.forEach(item => {
            batchedUpdates[this.getOrderRowKey(item.id)] = this.buildOrderRowEntry(item.after);
        });
        deletions.forEach(item => {
            batchedUpdates[this.getOrderRowKey(item.id)] = this.buildOrderRowEntry(item.after);
        });

        this.orderWriteInFlight = true;
        try {
            if (this.ordersRowsRef) {
                await this.ordersRowsRef.update(batchedUpdates);
                if (this.ordersMetaRef) {
                    await this.ordersMetaRef.set({
                        version: 2,
                        savedAt: new Date().toISOString(),
                        rowCount: currentMap.size,
                        updatedAt: new Date().toISOString()
                    });
                }
            } else {
                const legacyUpdates = {};
                upserts.forEach(item => { legacyUpdates[item.id] = item.after; });
                deletions.forEach(item => { legacyUpdates[item.id] = item.after; });
                await this.ordersRef.update(legacyUpdates);
            }
        } finally {
            this.orderWriteInFlight = false;
            this.flushSuppressedOrdersSnapshot();
        }

        for (const item of upserts) {
            await this.writeAuditLog({
                entityType: 'order',
                entityId: item.id,
                action: item.before ? 'update' : 'create',
                before: item.before,
                after: item.after,
                reason: options.reason || 'sync_order_diff'
            });
        }

        for (const item of deletions) {
            await this.writeAuditLog({
                entityType: 'order',
                entityId: item.id,
                action: 'delete',
                before: item.before,
                after: item.after,
                reason: options.reason || 'sync_order_diff'
            });
        }

        const nextCache = new Map(previousMap);
        upserts.forEach(item => {
            nextCache.set(item.id, item.after);
            this.orderRowsCache.set(this.getOrderRowKey(item.id), this.buildOrderRowEntry(item.after));
            this.updateLocalOrderFromWrite(item.after);
        });
        deletions.forEach(item => {
            nextCache.set(item.id, item.after);
            this.orderRowsCache.set(this.getOrderRowKey(item.id), this.buildOrderRowEntry(item.after));
        });
        this.orderCache = nextCache;
        this.lastSyncTimestamp = Date.now();
        if (typeof setSyncStatus === 'function') setSyncStatus('live');
        return true;
    },

    async pushOrders(orderList) {
        return this.syncOrderDiff(orderList, { force: false, reason: 'push_orders_compat' });
    },

    async syncOrderRowsPatch(orderList = [], options = {}) {
        if ((!this.ordersRowsRef && !this.ordersRef) || !Array.isArray(orderList)) return false;
        if (typeof setSyncStatus === 'function') setSyncStatus('syncing');

        const changedOrderIds = Array.from(new Set((options.changedOrderIds || [])
            .map(id => String(id || '').trim())
            .filter(Boolean)));
        const deletedOrderIds = Array.from(new Set((options.deletedOrderIds || [])
            .map(id => String(id || '').trim())
            .filter(Boolean)));
        const orderMap = this.buildOrderMap(orderList);
        const rowBaseMeta = options.rowBaseMeta || {};
        const conflicts = [];
        let changedRows = 0;
        const successfulUpserts = [];
        const successfulDeletes = [];

        this.orderWriteInFlight = true;
        try {
            for (const id of changedOrderIds) {
                const currentOrder = orderMap.get(id);
                if (!currentOrder) continue;
                const baseMeta = rowBaseMeta[id] || this.getOrderSyncMeta(this.orderCache?.get(id) || null);
                const before = this.orderCache.get(id) || null;
                const after = this.normalizeOrderForWrite(currentOrder, before, options);
                if (!after) continue;
                const key = this.getOrderRowKey(id);

                if (this.ordersRowsRef) {
                    let rejected = false;
                    let conflictCurrent = null;
                    await this.ordersRowsRef.child(key).transaction(current => {
                        conflictCurrent = current;
                        if (options.forceConflictOverwrite) return this.buildOrderRowEntry(after);
                        if (!current && Number(baseMeta.version || 0) > 0) {
                            rejected = true;
                            return;
                        }
                        const currentVersion = this.getOrderRowEntryVersion(current);
                        const baseVersion = Number(baseMeta.version || 0) || 0;
                        if (current && currentVersion !== baseVersion) {
                            rejected = true;
                            return;
                        }
                        return this.buildOrderRowEntry(after);
                    });
                    if (rejected) {
                        conflicts.push(this.buildOrderConflict(id, 'update', currentOrder, conflictCurrent, baseMeta));
                        continue;
                    }
                } else {
                    await this.ordersRef.child(id).set(after);
                }

                changedRows += 1;
                successfulUpserts.push({ id, before, after });
            }

            for (const id of deletedOrderIds) {
                const before = this.orderCache.get(id) || null;
                const baseMeta = rowBaseMeta[id] || this.getOrderSyncMeta(before);
                const after = this.buildOrderTombstone(id, before, options);
                if (!after) continue;
                const key = this.getOrderRowKey(id);

                if (this.ordersRowsRef) {
                    let rejected = false;
                    let conflictCurrent = null;
                    await this.ordersRowsRef.child(key).transaction(current => {
                        conflictCurrent = current;
                        if (options.forceConflictOverwrite) return this.buildOrderRowEntry(after);
                        const currentVersion = this.getOrderRowEntryVersion(current);
                        const baseVersion = Number(baseMeta.version || 0) || 0;
                        if (current && currentVersion !== baseVersion) {
                            rejected = true;
                            return;
                        }
                        return this.buildOrderRowEntry(after);
                    });
                    if (rejected) {
                        conflicts.push(this.buildOrderConflict(id, 'delete', null, conflictCurrent, baseMeta));
                        continue;
                    }
                } else {
                    await this.ordersRef.child(id).set(after);
                }

                changedRows += 1;
                successfulDeletes.push({ id, before, after });
            }

            if (this.ordersMetaRef && changedRows > 0) {
                await this.ordersMetaRef.update({
                    version: 2,
                    savedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }
        } finally {
            this.orderWriteInFlight = false;
            this.flushSuppressedOrdersSnapshot();
        }

        for (const item of successfulUpserts) {
            this.orderCache.set(item.id, item.after);
            this.orderRowsCache.set(this.getOrderRowKey(item.id), this.buildOrderRowEntry(item.after));
            this.updateLocalOrderFromWrite(item.after);
            await this.writeAuditLog({
                entityType: 'order',
                entityId: item.id,
                action: item.before ? 'update' : 'create',
                before: item.before,
                after: item.after,
                reason: options.reason || 'sync_order_rows_patch'
            });
        }

        for (const item of successfulDeletes) {
            this.orderCache.set(item.id, item.after);
            this.orderRowsCache.set(this.getOrderRowKey(item.id), this.buildOrderRowEntry(item.after));
            await this.writeAuditLog({
                entityType: 'order',
                entityId: item.id,
                action: 'delete',
                before: item.before,
                after: item.after,
                reason: options.reason || 'sync_order_rows_patch'
            });
        }

        if (conflicts.length && typeof setSyncStatus === 'function') {
            setSyncStatus('conflict', `${conflicts.length} talep satırı karar bekliyor.`);
        } else if (typeof setSyncStatus === 'function') {
            setSyncStatus('live');
        }

        return {
            ok: conflicts.length === 0,
            changedRows,
            conflicts
        };
    },

    async pushSingleOrder(order, options = {}) {
        if ((!this.ordersRowsRef && !this.ordersRef) || !order?.id) return false;
        if (typeof setSyncStatus === 'function') setSyncStatus('syncing');

        const id = String(order.id);
        const before = this.orderCache.get(id) || null;
        if (!this.shouldAcceptOrderWrite(order, before)) return false;

        const after = this.normalizeOrderForWrite(order, before, options);
        if (!after) return false;

        this.orderWriteInFlight = true;
        try {
            if (this.ordersRowsRef) {
                await this.ordersRowsRef.child(this.getOrderRowKey(id)).set(this.buildOrderRowEntry(after));
                if (this.ordersMetaRef) {
                    await this.ordersMetaRef.update({
                        version: 2,
                        savedAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                }
            } else {
                await this.ordersRef.child(id).set(after);
            }
        } finally {
            this.orderWriteInFlight = false;
            this.flushSuppressedOrdersSnapshot();
        }
        this.orderCache.set(id, after);
        this.orderRowsCache.set(this.getOrderRowKey(id), this.buildOrderRowEntry(after));
        this.updateLocalOrderFromWrite(after);
        if (typeof setSyncStatus === 'function') setSyncStatus('live');

        await this.writeAuditLog({
            entityType: 'order',
            entityId: id,
            action: before ? 'update' : 'create',
            before,
            after,
            reason: options.reason || 'push_single_order'
        });

        return true;
    },

    async removeOrder(orderId, options = {}) {
        if ((!this.ordersRowsRef && !this.ordersRef) || !orderId) return false;

        const id = String(orderId);
        const before = this.orderCache.get(id) || null;
        const after = this.buildOrderTombstone(id, before, options);
        if (!after) return false;

        this.orderWriteInFlight = true;
        try {
            if (this.ordersRowsRef) {
                await this.ordersRowsRef.child(this.getOrderRowKey(id)).set(this.buildOrderRowEntry(after));
                if (this.ordersMetaRef) {
                    await this.ordersMetaRef.update({
                        version: 2,
                        savedAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                }
            } else {
                await this.ordersRef.child(id).set(after);
            }
        } finally {
            this.orderWriteInFlight = false;
            this.flushSuppressedOrdersSnapshot();
        }
        this.orderCache.set(id, after);
        this.orderRowsCache.set(this.getOrderRowKey(id), this.buildOrderRowEntry(after));

        await this.writeAuditLog({
            entityType: 'order',
            entityId: id,
            action: 'delete',
            before,
            after,
            reason: options.reason || 'remove_order'
        });

        return true;
    },

    async clearAll() {
        if (!this.ordersRowsRef && !this.ordersRef) return false;

        const existing = this.orderRowsCache && this.orderRowsCache.size > 0
            ? this.buildOrdersSnapshotFromRows()
            : ((await this.ordersRef.once('value')).val() || {});
        try {
            if (this.ordersV2Ref) {
                await this.ordersV2Ref.set({
                    meta: {
                        version: 2,
                        savedAt: new Date().toISOString(),
                        rowCount: 0,
                        clearedAt: new Date().toISOString()
                    }
                });
            } else {
                await this.ordersRef.remove();
            }
        } catch (error) {
            const orderIds = Object.keys(existing);
            const chunkSize = 50;
            for (let i = 0; i < orderIds.length; i += chunkSize) {
                const chunk = orderIds.slice(i, i + chunkSize);
                await Promise.all(chunk.map(orderId => this.ordersRowsRef.child(this.getOrderRowKey(orderId)).remove()));
            }
        }

        this.orderCache = new Map();
        this.orderRowsCache = new Map();
        this.ordersV2HadData = true;

        await this.writeAuditLog({
            entityType: 'order',
            entityId: 'ALL',
            action: 'clear_all',
            before: existing,
            after: null,
            reason: 'clear_all_orders'
        });

        return true;
    },

    async getAll() {
        if (!this.ordersRowsRef && !this.ordersRef) return null;

        try {
            if (this.ordersRowsRef) {
                const [metaSnapshot, rowsSnapshot] = await Promise.all([
                    this.ordersMetaRef ? this.ordersMetaRef.once('value') : Promise.resolve({ val: () => null }),
                    this.ordersRowsRef.once('value')
                ]);
                const rows = rowsSnapshot.val() || {};
                const meta = metaSnapshot.val();
                if (meta || Object.keys(rows).length > 0) {
                    this.ordersV2HadData = true;
                    this.ordersMetaCache = meta || null;
                    this.orderRowsCache = new Map(Object.entries(rows));
                    const result = Object.values(this.buildOrdersSnapshotFromRows());
                    this.orderCache = this.buildOrderMap(result);
                    return result;
                }
            }

            const snapshot = await this.ordersRef.once('value');
            const data = snapshot.val();
            const result = data ? Object.values(data) : [];
            this.orderCache = this.buildOrderMap(result);
            this.hydrateOrderRowsCaches(result);
            return result;
        } catch (error) {
            console.error('Firebase sipariş okuma hatası:', error);
            return null;
        }
    },

    async syncProductTrees(productList = [], options = {}) {
        if (!this.productTreesRef) return false;
        if (!this.canWriteProductTrees()) return false;

        const currentMap = this.buildProductTreeMap(productList);
        const previousMap = this.productTreeCache || new Map();
        const upserts = [];
        const deletions = [];

        currentMap.forEach((currentProduct, catalogNo) => {
            const previousProduct = previousMap.get(catalogNo);
            if (options.force || !previousProduct || this.getComparableString(previousProduct) !== this.getComparableString(currentProduct)) {
                upserts.push({ catalogNo, before: previousProduct || null, after: currentProduct });
            }
        });

        previousMap.forEach((previousProduct, catalogNo) => {
            if (!currentMap.has(catalogNo)) {
                deletions.push({ catalogNo, before: previousProduct });
            }
        });

        if (upserts.length === 0 && deletions.length === 0) {
            this.productTreeCache = currentMap;
            return true;
        }

        for (const item of upserts) {
            await this.productTreesRef.child(this.encodeProductTreeKey(item.catalogNo)).set(item.after);
            await this.writeAuditLog({
                entityType: 'productTree',
                entityId: item.catalogNo,
                action: item.before ? 'update' : 'create',
                before: item.before,
                after: item.after,
                reason: options.reason || 'sync_product_trees'
            });
        }

        for (const item of deletions) {
            await this.productTreesRef.child(this.encodeProductTreeKey(item.catalogNo)).remove();
            await this.writeAuditLog({
                entityType: 'productTree',
                entityId: item.catalogNo,
                action: 'delete',
                before: item.before,
                after: null,
                reason: options.reason || 'sync_product_trees'
            });
        }

        this.productTreeCache = currentMap;
        return true;
    },

    async getAllProductTrees() {
        if (!this.productTreesRef) return null;

        try {
            const snapshot = await this.productTreesRef.once('value');
            const data = snapshot.val();
            const products = data ? Object.values(data) : [];
            this.productTreeCache = this.buildProductTreeMap(products);
            return products;
        } catch (error) {
            console.error('Firebase ürün ağacı okuma hatası:', error);
            return null;
        }
    },

    async migrateProductTrees(localProducts = []) {
        if (!this.productTreesRef) return null;

        const remoteProducts = await this.getAllProductTrees();
        if (Array.isArray(remoteProducts) && remoteProducts.length > 0) {
            return remoteProducts;
        }

        if (Array.isArray(localProducts) && localProducts.length > 0) {
            if (this.canWriteProductTrees()) {
                try {
                    await this.syncProductTrees(localProducts, { force: true, reason: 'local_excel_authoritative' });
                } catch (error) {
                    console.warn('Ürün ağacı cloud senkronu atlandı, yerel Excel verisi kullanılacak:', error);
                }
                return localProducts;
            }

            return localProducts;
        }

        return remoteProducts;
    },

    startProductTreeListening(onChange) {
        if (!this.productTreesRef || this.isProductTreeListening) return;

        this.isProductTreeListening = true;
        this.productTreesRef.on('value', snapshot => {
            const data = snapshot.val();
            const remoteProducts = data
                ? Object.values(data)
                    .filter(item => String(item?.catalogNo || '').trim())
                    .sort((a, b) => String(a.catalogNo || '').localeCompare(String(b.catalogNo || ''), 'tr'))
                : [];

            this.productTreeCache = this.buildProductTreeMap(remoteProducts);

            if (typeof onChange === 'function') {
                onChange(remoteProducts);
            }
        });

        console.log('Firebase ürün ağacı dinleme başlatıldı');
    },

    stopProductTreeListening() {
        if (this.productTreesRef) {
            this.productTreesRef.off('value');
        }
        this.isProductTreeListening = false;
    },

    async syncSalesLinesTodayOutputs(payload = {}, options = {}) {
        if (!this.salesLinesTodayOutputsRef) return false;
        const normalized = this.normalizeTodayOutputsPayload(payload);
        const actor = this.getCurrentActor();
        const now = new Date().toISOString();
        let nextNode = null;
        await this.salesLinesTodayOutputsRef.child(normalized.dateKey).transaction(current => {
            const currentMeta = current && typeof current === 'object' && current.meta && !normalized.meta?.resetMeta
                ? current.meta
                : {};
            const nextMeta = {
                ...currentMeta,
                ...(normalized.meta || {}),
                updatedAt: now,
                updatedByUid: actor.uid || null,
                updatedByParaf: actor.paraf || ''
            };
            delete nextMeta.resetMeta;
            if (!nextMeta.createdAt) nextMeta.createdAt = now;
            if (!nextMeta.createdBy && actor.paraf) nextMeta.createdBy = actor.paraf;
            if (!nextMeta.createdByUid && actor.uid) nextMeta.createdByUid = actor.uid;
            nextNode = {
                rowIds: normalized.rowIds,
                meta: nextMeta
            };
            return nextNode;
        });
        this.salesLinesTodayOutputsCache = this.parseTodayOutputsNode(normalized.dateKey, nextNode || {});

        await this.writeAuditLog({
            entityType: 'salesLinesTodayOutputs',
            entityId: normalized.dateKey,
            action: options.action || normalized.meta?.action || 'update',
            before: null,
            after: {
                dateKey: normalized.dateKey,
                rowCount: Object.keys(normalized.rowIds).length,
                meta: nextNode?.meta || {}
            },
            reason: options.reason || 'sync_sales_lines_today_outputs'
        });

        return true;
    },

    async syncSalesLinesMetaPayload(payload, options = {}) {
        if (!this.salesLinesMetaRef) return false;
        const normalizedPayload = this.normalizeSalesLinesPayload(payload);
        const incomingMeta = this.sanitizeSalesLinesMetaForStorage(normalizedPayload.meta || {});
        const now = new Date().toISOString();
        await this.salesLinesMetaRef.transaction(current => {
            const currentMeta = current && typeof current === 'object' ? current : {};
            return {
                ...currentMeta,
                version: 2,
                savedAt: normalizedPayload.savedAt,
                meta: {
                    ...this.sanitizeSalesLinesMetaForStorage(currentMeta.meta || {}),
                    ...incomingMeta
                },
                columnOrder: Array.isArray(normalizedPayload.columnOrder) ? normalizedPayload.columnOrder : (currentMeta.columnOrder || []),
                rowCount: currentMeta.rowCount || (Array.isArray(normalizedPayload.allOrders) ? normalizedPayload.allOrders.length : 0),
                updatedAt: now
            };
        });
        if (this.salesLinesRef) {
            await this.salesLinesRef.set({
                version: 2,
                storage: 'row-based',
                savedAt: normalizedPayload.savedAt,
                updatedAt: now
            });
        }
        return true;
    },

    async syncSalesLinesRowsPatch(payload, options = {}) {
        if (!this.salesLinesV2Ref || !this.salesLinesRowsRef || !this.salesLinesEditedLogRef || !this.salesLinesMetaRef) return false;

        const normalizedPayload = this.normalizeSalesLinesPayload(payload);
        const changedRowIds = this.getSalesLinePatchRowIds(normalizedPayload, 'changedRowIds');
        const deletedRowIds = this.getSalesLinePatchRowIds(normalizedPayload, 'deletedRowIds');
        const rowBaseMeta = normalizedPayload.meta?.rowBaseMeta || {};
        const changedColumnsByRow = normalizedPayload.meta?.changedColumnsByRow || {};
        const ordersById = new Map();
        (normalizedPayload.allOrders || []).forEach((order, index) => {
            const id = String(order?._id || order?.id || '').trim();
            if (id) ordersById.set(id, { order, index });
        });

        let changedRows = 0;
        const conflicts = [];

        for (const id of changedRowIds) {
            const item = ordersById.get(id);
            if (!item) continue;
            const key = this.getSalesLineRowKey(item.order, item.index);
            const incomingEntry = this.buildSalesLineRowEntry(item.order, item.index);
            const incomingTime = this.getSalesLineRowEntryTime(incomingEntry);
            const baseTime = Date.parse(rowBaseMeta[id]?.updatedAt || '') || 0;
            const baseVersion = Number(rowBaseMeta[id]?.version || 0) || 0;
            const baseRowSnapshot = rowBaseMeta[id]?.rowSnapshot || null;
            const localChangedColumns = this.normalizeSalesLineColumnList(changedColumnsByRow[id] || []);
            let remoteChangedColumns = [];
            let rejected = false;
            let autoMerged = false;
            let conflictCurrent = null;

            await this.salesLinesRowsRef.child(key).transaction(current => {
                conflictCurrent = current;
                if (options.forceConflictOverwrite) {
                    return incomingEntry;
                }
                if (!current && baseVersion > 0) {
                    rejected = true;
                    return;
                }
                const currentVersion = this.getSalesLineRowEntryVersion(current);
                const currentTime = this.getSalesLineRowEntryTime(current);
                const versionConflict = current && currentVersion !== baseVersion;
                const timeConflict = (baseTime && currentTime && currentTime > baseTime)
                    || (!baseTime && currentTime && incomingTime && currentTime > incomingTime);
                if (versionConflict || timeConflict) {
                    const remoteRow = this.parseSalesLineRowEntry(current);
                    remoteChangedColumns = this.getSalesLineChangedColumnsBetween(baseRowSnapshot, remoteRow);
                    if (baseRowSnapshot && localChangedColumns.length > 0 && !this.salesLineColumnsIntersect(localChangedColumns, remoteChangedColumns)) {
                        const mergedRow = this.buildMergedSalesLineRow(remoteRow, item.order, localChangedColumns);
                        const mergedEntry = this.buildSalesLineRowEntry({
                            ...mergedRow,
                            _sync: {
                                ...(mergedRow._sync || {}),
                                version: Number(currentVersion || baseVersion || 0) + 1,
                                updatedAt: new Date().toISOString(),
                                updatedByUid: item.order?._sync?.updatedByUid || item.order?._rowUpdatedByUid || null,
                                updatedByParaf: item.order?._sync?.updatedByParaf || item.order?._rowUpdatedBy || ''
                            }
                        }, item.index);
                        autoMerged = true;
                        return mergedEntry;
                    }
                    rejected = true;
                    return;
                }
                return incomingEntry;
            });

            if (rejected) {
                conflicts.push(this.buildSalesLineConflict(id, 'update', item.order, conflictCurrent, rowBaseMeta[id], key, {
                    localChangedColumns,
                    remoteChangedColumns
                }));
                continue;
            }
            changedRows += 1;
            if (autoMerged && typeof showToast === 'function') {
                showToast('FarklÄ± alanlar deÄŸiÅŸtiÄŸi iÃ§in satÄ±r otomatik birleÅŸtirildi.', 'info');
            }
            if (normalizedPayload.editedLog && Object.prototype.hasOwnProperty.call(normalizedPayload.editedLog, id)) {
                await this.salesLinesEditedLogRef.child(this.encodeDatabaseKey(id)).set({
                    logJson: JSON.stringify(this.cloneData(normalizedPayload.editedLog[id] || []))
                });
            }
        }

        for (const id of deletedRowIds) {
            const baseTime = Date.parse(rowBaseMeta[id]?.updatedAt || '') || 0;
            const baseVersion = Number(rowBaseMeta[id]?.version || 0) || 0;
            const key = this.encodeDatabaseKey(id);
            let rejected = false;
            let conflictCurrent = null;
            await this.salesLinesRowsRef.child(key).transaction(current => {
                conflictCurrent = current;
                if (options.forceConflictOverwrite) {
                    return null;
                }
                const currentVersion = this.getSalesLineRowEntryVersion(current);
                if (current && currentVersion !== baseVersion) {
                    rejected = true;
                    return;
                }
                const currentTime = this.getSalesLineRowEntryTime(current);
                if (baseTime && currentTime && currentTime > baseTime) {
                    rejected = true;
                    return;
                }
                return null;
            });
            if (rejected) {
                conflicts.push(this.buildSalesLineConflict(id, 'delete', null, conflictCurrent, rowBaseMeta[id], key));
                continue;
            }
            changedRows += 1;
            await this.salesLinesEditedLogRef.child(key).remove();
        }

        if (conflicts.length === 0) {
            await this.syncSalesLinesMetaPayload(normalizedPayload, options);
        }
        if (conflicts.length && typeof setSyncStatus === 'function') {
            setSyncStatus('conflict', `${conflicts.length} satış satırı karar bekliyor.`);
        }
        await this.writeAuditLog({
            entityType: 'salesLines',
            entityId: 'rows',
            action: 'patch',
            before: null,
            after: {
                savedAt: normalizedPayload.savedAt,
                changedRows,
                conflicts: conflicts.length
            },
            reason: options.reason || 'sync_sales_lines_rows_patch'
        });
        return {
            ok: conflicts.length === 0,
            changedRows,
            conflicts
        };
    },

    async syncSalesLinesPayload(payload, options = {}) {
        if (!this.salesLinesV2Ref || !this.salesLinesRowsRef || !this.salesLinesEditedLogRef || !this.salesLinesMetaRef) return false;

        const normalizedPayload = this.normalizeSalesLinesPayload(payload);
        const syncMode = String(normalizedPayload.meta?.syncMode || '').trim();
        if (syncMode === 'row-patch') {
            return this.syncSalesLinesRowsPatch(normalizedPayload, options);
        }
        if (syncMode === 'meta-only') {
            return this.syncSalesLinesMetaPayload(normalizedPayload, options);
        }
        if (!options.force && syncMode !== 'full' && !normalizedPayload.meta?.sourceFile && !normalizedPayload.meta?.reset) {
            return this.syncSalesLinesMetaPayload(normalizedPayload, options);
        }
        const nextComparable = this.getComparableString(normalizedPayload);
        if (!options.force && this.salesLinesCache === nextComparable) {
            return true;
        }

        const before = this.salesLinesPayloadCache || (this.salesLinesCache ? JSON.parse(this.salesLinesCache) : null);
        const previousRows = this.salesLinesRowsCache || new Map();
        const previousLogs = this.salesLinesEditedLogCache || new Map();
        const nextRows = new Map();
        const nextLogs = new Map();
        const updates = {};

        (normalizedPayload.allOrders || []).forEach((order, index) => {
            const key = this.getSalesLineRowKey(order, index);
            nextRows.set(key, this.buildSalesLineRowEntry(order, index));
        });

        Object.entries(normalizedPayload.editedLog || {}).forEach(([rowId, logs]) => {
            nextLogs.set(this.encodeDatabaseKey(rowId), { logJson: JSON.stringify(this.cloneData(logs)) });
        });

        const meta = {
            version: 2,
            savedAt: normalizedPayload.savedAt,
            meta: this.sanitizeSalesLinesMetaForStorage(normalizedPayload.meta || {}),
            columnOrder: Array.isArray(normalizedPayload.columnOrder) ? normalizedPayload.columnOrder : [],
            rowCount: nextRows.size,
            updatedAt: new Date().toISOString()
        };
        updates['meta'] = meta;

        nextRows.forEach((value, key) => {
            const previous = previousRows.get(key);
            if (options.force || !previous || this.getComparableString(previous) !== this.getComparableString(value)) {
                updates[`rows/${key}`] = value;
            }
        });
        previousRows.forEach((_, key) => {
            if (!nextRows.has(key)) updates[`rows/${key}`] = null;
        });

        nextLogs.forEach((value, key) => {
            const previous = previousLogs.get(key);
            if (options.force || !previous || this.getComparableString(previous) !== this.getComparableString(value)) {
                updates[`editedLog/${key}`] = value;
            }
        });
        previousLogs.forEach((_, key) => {
            if (!nextLogs.has(key)) updates[`editedLog/${key}`] = null;
        });

        await this.salesLinesV2Ref.update(updates);
        if (this.salesLinesRef) {
            await this.salesLinesRef.set({
                version: 2,
                storage: 'row-based',
                savedAt: normalizedPayload.savedAt,
                rowCount: nextRows.size,
                updatedAt: meta.updatedAt
            });
        }

        this.salesLinesRowsCache = nextRows;
        this.salesLinesEditedLogCache = nextLogs;
        this.salesLinesMetaCache = meta;
        this.salesLinesPayloadCache = normalizedPayload;
        this.salesLinesCache = nextComparable;

        await this.writeAuditLog({
            entityType: 'salesLines',
            entityId: 'state',
            action: before ? 'update' : 'create',
            before: before ? {
                savedAt: before.savedAt || '',
                rowCount: Array.isArray(before.allOrders) ? before.allOrders.length : 0
            } : null,
            after: {
                savedAt: normalizedPayload.savedAt,
                rowCount: nextRows.size,
                changedRows: Object.keys(updates).filter(key => key.startsWith('rows/')).length,
                changedLogs: Object.keys(updates).filter(key => key.startsWith('editedLog/')).length
            },
            reason: options.reason || 'sync_sales_lines'
        });

        return true;
    },

    async getSalesLinesPayload() {
        if (!this.salesLinesRef && !this.salesLinesV2Ref) return null;

        try {
            if (this.salesLinesV2Ref) {
                const todayKey = this.getSalesLinesTodayOutputDateKey();
                const [metaSnapshot, rowsSnapshot, logsSnapshot, todayOutputsSnapshot] = await Promise.all([
                    this.salesLinesMetaRef.once('value'),
                    this.salesLinesRowsRef.once('value'),
                    this.salesLinesEditedLogRef.once('value'),
                    this.salesLinesTodayOutputsRef ? this.salesLinesTodayOutputsRef.child(todayKey).once('value') : Promise.resolve({ val: () => null })
                ]);
                const meta = metaSnapshot.val();
                const rows = rowsSnapshot.val() || {};
                const logs = logsSnapshot.val() || {};
                this.salesLinesTodayOutputsCache = this.parseTodayOutputsNode(todayKey, todayOutputsSnapshot.val() || {});
                if (meta || Object.keys(rows).length > 0) {
                    return this.hydrateSalesLinesV2Caches(this.buildSalesLinesV2Payload(meta || {}, rows, logs));
                }
            }

            const snapshot = await this.salesLinesRef.once('value');
            const payload = snapshot.val();
            if (!payload) return null;
            const normalizedPayload = this.decodeSalesLinesPayload(payload);
            if (!normalizedPayload) return null;
            return this.hydrateSalesLinesV2Caches(normalizedPayload);
        } catch (error) {
            console.error('Firebase satis satirlari okuma hatasi:', error);
            return null;
        }
    },

    startSalesLinesListening(onChange) {
        if (!this.salesLinesV2Ref || !this.salesLinesRowsRef || !this.salesLinesEditedLogRef || !this.salesLinesMetaRef || this.isSalesLinesListening) return;

        this.isSalesLinesListening = true;
        const todayOutputsDateKey = this.getSalesLinesTodayOutputDateKey();
        const scheduleEmit = () => {
            this.lastSalesLinesEventAt = Date.now();
            if (this.salesLinesEmitTimer) clearTimeout(this.salesLinesEmitTimer);
            this.salesLinesEmitTimer = setTimeout(() => {
                this.salesLinesEmitTimer = null;
                const normalizedPayload = this.buildSalesLinesPayloadFromCaches();
                this.salesLinesPayloadCache = normalizedPayload;
                this.salesLinesCache = this.getComparableString(normalizedPayload);
                if (typeof onChange === 'function') onChange(normalizedPayload);
            }, 150);
        };

        this.salesLinesMetaRef.on('value', snapshot => {
            const meta = snapshot.val();
            if (meta) {
                this.salesLinesMetaCache = meta;
                scheduleEmit();
            }
        });

        this.salesLinesRowsRef.on('child_added', snapshot => {
            const key = snapshot.key;
            if (!key || this.salesLinesRowsCache.has(key)) return;
            this.salesLinesRowsCache.set(key, snapshot.val());
            scheduleEmit();
        });
        this.salesLinesRowsRef.on('child_changed', snapshot => {
            if (!snapshot.key) return;
            this.salesLinesRowsCache.set(snapshot.key, snapshot.val());
            scheduleEmit();
        });
        this.salesLinesRowsRef.on('child_removed', snapshot => {
            if (!snapshot.key) return;
            this.salesLinesRowsCache.delete(snapshot.key);
            scheduleEmit();
        });

        this.salesLinesEditedLogRef.on('child_added', snapshot => {
            const key = snapshot.key;
            if (!key || this.salesLinesEditedLogCache.has(key)) return;
            this.salesLinesEditedLogCache.set(key, snapshot.val());
            scheduleEmit();
        });
        this.salesLinesEditedLogRef.on('child_changed', snapshot => {
            if (!snapshot.key) return;
            this.salesLinesEditedLogCache.set(snapshot.key, snapshot.val());
            scheduleEmit();
        });
        this.salesLinesEditedLogRef.on('child_removed', snapshot => {
            if (!snapshot.key) return;
            this.salesLinesEditedLogCache.delete(snapshot.key);
            scheduleEmit();
        });

        if (this.salesLinesTodayOutputsRef) {
            this.salesLinesTodayOutputsRef.child(todayOutputsDateKey).on('value', snapshot => {
                this.salesLinesTodayOutputsCache = this.parseTodayOutputsNode(todayOutputsDateKey, snapshot.val() || {});
                scheduleEmit();
            });
        }

        if (this.salesLinesRef) {
            this.salesLinesRef.on('value', snapshot => {
                const payload = snapshot.val();
                if (!payload || payload.storage === 'row-based') return;
                const normalizedPayload = this.decodeSalesLinesPayload(payload);
                if (!normalizedPayload) return;
                this.hydrateSalesLinesV2Caches(normalizedPayload);
                scheduleEmit();
            });
        }

        console.log('Firebase satis satirlari satir bazli dinleme baslatildi');
    },

    stopSalesLinesListening() {
        if (this.salesLinesMetaRef) this.salesLinesMetaRef.off();
        if (this.salesLinesRowsRef) this.salesLinesRowsRef.off();
        if (this.salesLinesEditedLogRef) this.salesLinesEditedLogRef.off();
        if (this.salesLinesTodayOutputsRef) this.salesLinesTodayOutputsRef.off();
        if (this.salesLinesRef) this.salesLinesRef.off('value');
        if (this.salesLinesEmitTimer) {
            clearTimeout(this.salesLinesEmitTimer);
            this.salesLinesEmitTimer = null;
        }
        this.isSalesLinesListening = false;
    },

    async copyLiveDataToDev() {
        if (!firebaseReady) return false;
        const db = firebase.database();
        const paths = ['orders', 'ordersV2', 'productTrees', 'salesLines'];
        const updates = {};
        const snapshots = await Promise.all(paths.map(path => db.ref(path).once('value')));
        snapshots.forEach((snapshot, index) => {
            updates[`dev/${paths[index]}`] = snapshot.val() || null;
        });
        updates['dev/meta/copiedFromLiveAt'] = new Date().toISOString();
        await db.ref().update(updates);
        return true;
    },

    async clearDevEnvironmentData() {
        if (!firebaseReady) return false;
        await firebase.database().ref('dev').remove();
        return true;
    }
};

var offlineManager = {
    pendingSync: false,
    queueStorageKey: 'firebase_pending_order_ops',

    init() {
        window.addEventListener('online', () => this.onOnline());
        window.addEventListener('offline', () => this.onOffline());

        if (localStorage.getItem('firebase_pending_sync') === 'true' && navigator.onLine) {
            this.syncPendingData();
        }
    },

    onOnline() {
        if (typeof setSyncStatus === 'function') setSyncStatus('syncing', 'Bekleyen değişiklikler kontrol ediliyor.');
        if (typeof showToast === 'function') {
            showToast('İnternet bağlantısı kuruldu. Merkezi veri ile senkronize ediliyor...', 'success');
        }
        this.syncPendingData();
    },

    onOffline() {
        if (typeof setSyncStatus === 'function') setSyncStatus('offline');
        if (typeof showToast === 'function') {
            showToast('İnternet bağlantısı kesildi. Yerel önbellek kullanılacak.', 'warning');
        }
    },

    markPendingSync() {
        this.pendingSync = true;
        localStorage.setItem('firebase_pending_sync', 'true');
        if (typeof setSyncStatus === 'function') setSyncStatus('pending');
    },

    getPendingOps() {
        try {
            const raw = localStorage.getItem(this.queueStorageKey);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    },

    savePendingOps(ops) {
        localStorage.setItem(this.queueStorageKey, JSON.stringify(Array.isArray(ops) ? ops : []));
        localStorage.setItem('firebase_pending_sync', 'true');
        this.pendingSync = true;
        if (typeof setSyncStatus === 'function') setSyncStatus('pending');
    },

    queueOrderOp(op) {
        if (!op || !op.id || !op.type) return;

        const ops = this.getPendingOps().filter(existing => String(existing.id) !== String(op.id));
        ops.push({
            ...op,
            id: String(op.id),
            queuedAt: new Date().toISOString()
        });
        this.savePendingOps(ops);
    },

    queueOrderUpsert(order) {
        if (!order || !order.id || order.sourceSystem === 'sales-lines') return;
        const cachedOrder = firebaseSync?.orderCache?.get(String(order.id)) || null;
        this.queueOrderOp({
            type: 'upsert',
            id: order.id,
            baseVersion: cachedOrder?.version || 0,
            order: firebaseSync && typeof firebaseSync.cloneData === 'function'
                ? firebaseSync.cloneData(order)
                : JSON.parse(JSON.stringify(order))
        });
    },

    queueOrderDelete(orderId) {
        if (!orderId) return;
        const cachedOrder = firebaseSync?.orderCache?.get(String(orderId)) || null;
        this.queueOrderOp({
            type: 'delete',
            id: orderId,
            baseVersion: cachedOrder?.version || 0
        });
    },

    async syncPendingData() {
        if (!firebaseReady) return;
        if (typeof setSyncStatus === 'function') setSyncStatus('syncing');

        try {
            const pendingOps = this.getPendingOps();
            if ((firebaseSync.ordersRowsRef || firebaseSync.ordersRef) && pendingOps.length > 0) {
                await firebaseSync.getAll();

                for (const op of pendingOps) {
                    const remoteOrder = firebaseSync.orderCache.get(String(op.id));
                    const remoteVersion = Number(remoteOrder?.version || 0);
                    const baseVersion = Number(op.baseVersion || 0);
                    if (remoteVersion > baseVersion) {
                        console.warn('Offline islem atlandi, kayit daha yeni bir versiyona sahip:', op.id);
                        if (typeof setSyncStatus === 'function') {
                            setSyncStatus('conflict', `Talep ${op.id} siz çevrimdışıyken değişmiş.`);
                        }
                        continue;
                    }

                    if (op.type === 'delete') {
                        await firebaseSync.removeOrder(op.id, { reason: 'offline_queue_delete', timestamp: op.queuedAt });
                    } else if (op.type === 'upsert' && op.order) {
                        await firebaseSync.pushSingleOrder(op.order, { reason: 'offline_queue_upsert', timestamp: op.queuedAt });
                    }
                }
            }

            if (firebaseSync.productTreesRef && typeof productTreeExcel !== 'undefined') {
                await firebaseSync.migrateProductTrees(productTreeExcel.getManagedProducts());
            }

            this.pendingSync = false;
            localStorage.removeItem(this.queueStorageKey);
            localStorage.removeItem('firebase_pending_sync');
            if (typeof refreshSyncStatusFromRuntime === 'function') refreshSyncStatusFromRuntime();
            if (typeof showToast === 'function') {
                showToast('Veriler başarıyla senkronize edildi.', 'success');
            }
        } catch (error) {
            console.error('Bekleyen senkronizasyon hatası:', error);
            if (typeof setSyncStatus === 'function') setSyncStatus('pending', 'Bekleyen değişiklikler gönderilemedi.');
        }
    }
};

var dataMigration = {
    async migrateToFirebase() {
        if (!firebaseReady || !firebaseSync.ordersRef) return;

        try {
            const firebaseOrders = await firebaseSync.getAll();

            if (firebaseOrders && firebaseOrders.length > 0 && !firebaseSync.ordersV2HadData && firebaseSync.ordersRowsRef) {
                console.log(`${firebaseOrders.length} siparis ordersV2 yapisina aktariliyor...`);
                await firebaseSync.syncOrderDiff(firebaseOrders, { force: true, reason: 'migrate_orders_v2' });
                await firebaseSync.applyRemoteOrders(
                    firebaseOrders.reduce((acc, order) => {
                        acc[String(order.id)] = order;
                        return acc;
                    }, {})
                );
            } else if ((!firebaseOrders || firebaseOrders.length === 0) && orders.length > 0) {
                console.log(`${orders.length} sipariş Firebase'e aktarılıyor...`);
                await firebaseSync.syncOrderDiff(orders, { force: true, reason: 'initial_order_migration' });
                if (typeof showToast === 'function') {
                    showToast(`${orders.length} mevcut sipariş merkezi veritabanına aktarıldı.`, 'success');
                }
            } else if (firebaseOrders && firebaseOrders.length > 0) {
                await firebaseSync.applyRemoteOrders(
                    firebaseOrders.reduce((acc, order) => {
                        acc[String(order.id)] = order;
                        return acc;
                    }, {})
                );
                console.log(`Firebase'den ${orders.length} sipariş yüklendi.`);
            }
        } catch (error) {
            console.error('Sipariş migrasyon hatası:', error);
        }
    }
};

