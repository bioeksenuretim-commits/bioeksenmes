function scheduleDashboardRender(options = {}) {
    if (options.immediate === true) {
        renderDashboard();
        return;
    }
    if (dashboardRenderTimer) clearTimeout(dashboardRenderTimer);
    dashboardRenderTimer = setTimeout(() => {
        dashboardRenderTimer = null;
        renderDashboard();
    }, Number(options.delay || 400));
}

function parseSalesLineDateValue(value) {
    if (!value) return null;

    if (value instanceof Date && !isNaN(value.getTime())) {
        return value;
    }

    const str = String(value).trim();
    if (!str) return null;

    let match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (match) {
        return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    }

    match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
        return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    }

    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed;
}

function getSalesLineDayStart(value) {
    const date = parseSalesLineDateValue(value);
    if (!date) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function renderDashboard() {
    if (dashboardRenderTimer) {
        clearTimeout(dashboardRenderTimer);
        dashboardRenderTimer = null;
    }
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const oneWeekLater = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const counts = {
        edited: 0,
        overdue: 0,
        upcoming: 0,
        output: 0,
        cancelled: 0,
        todayOutputs: 0,
        extractionKits: 0
    };

    allOrders.forEach(order => {
        if (!matchesToolbarFilters(order, { includeTerminal: true })) return;
        const status = normalizeSalesStatus(order['Ürün Durumu']);
        const isTerminal = isTerminalSalesStatus(status);
        const deliveryDateRaw = order._teslimTarihi || order['Teslim Tarihi'];

        if (getEditedListChanges(order).length > 0) counts.edited += 1;
        if (isTodayOutputStatus(status)) counts.output += 1;
        if (status === 'iptal edildi' || status === 'ürün iptal edildi') counts.cancelled += 1;
        if (isTodayOutputOrder(order)) counts.todayOutputs += 1;
        if (isExtractionKitOrder(order)) counts.extractionKits += 1;

        if (!isTerminal && deliveryDateRaw) {
            const deliveryDate = getSalesLineDayStart(deliveryDateRaw);
            if (!deliveryDate) return;
            const deliveryTime = deliveryDate.getTime();
            if (deliveryTime < todayStart.getTime()) counts.overdue += 1;
            else if (deliveryTime <= oneWeekLater.getTime()) counts.upcoming += 1;
        }
    });

    const setCount = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };
    setCount('dashBtnEdited', counts.edited);
    setCount('dashBtnOverdue', counts.overdue);
    setCount('dashBtnUpcoming', counts.upcoming);
    setCount('dashBtnOutput', counts.output);
    setCount('dashBtnCancelled', counts.cancelled);
    setCount('dashBtnTodayOutputs', counts.todayOutputs);
    setCount('dashBtnExtractionKits', counts.extractionKits);
    startStockKitDashboardSync().catch(error => {
        console.warn('Stok kit özeti yüklenemedi:', error);
    });
    updateDashboardActionVisibility();
}

let stockKitRows = [];
let stockKitItemsRef = null;
let stockKitSyncPromise = null;
let stockKitSyncError = '';

function getStockKitTotalQuantity(rows = stockKitRows) {
    return rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
}

function formatStockKitQuantity(value) {
    const quantity = Number(value) || 0;
    return quantity.toLocaleString('tr-TR', { maximumFractionDigits: 3 });
}

function formatStockKitDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getStockKitSourceLabel(source) {
    const labels = {
        ready_with_extra_stock: 'Ürün Hazır ve Stok Toplandı',
        revert_stock_to_order: 'Stoktan Verilecek Geri Alma',
        ready_with_extra_stock_pick_repair: 'Çekme Öncesi Otomatik Onarım'
    };
    const key = String(source || '').trim();
    return labels[key] || key || '-';
}

function updateStockKitDashboardCount() {
    const count = document.getElementById('dashBtnStockKits');
    if (count) count.textContent = formatStockKitQuantity(getStockKitTotalQuantity());
}

function setStockKitRows(snapshotValue) {
    stockKitRows = Object.entries(snapshotValue || {})
        .map(([key, item]) => ({ id: item?.id || key, ...(item || {}) }))
        .filter(item => String(item.bin || '') === FINAL_PRODUCT_STOCK_BIN)
        .filter(item => (Number(item.quantity) || 0) > 0)
        .sort((a, b) => {
            const productCompare = String(a.productNo || '').localeCompare(String(b.productNo || ''), 'tr');
            if (productCompare !== 0) return productCompare;
            return String(a.lotNo || '').localeCompare(String(b.lotNo || ''), 'tr');
        });
    stockKitSyncError = '';
    updateStockKitDashboardCount();
    if (document.getElementById('stockKitsOverlay')?.classList.contains('active')) {
        renderStockKitsPopup();
    }
}

function startStockKitDashboardSync() {
    if (stockKitItemsRef) return Promise.resolve();
    if (stockKitSyncPromise) return stockKitSyncPromise;

    stockKitSyncPromise = (async () => {
        if (!await ensureFinalProductStockAuth()) {
            throw new Error('Firebase oturumu doğrulanamadı.');
        }
        stockKitItemsRef = getFinalProductStockDbRef('items');
        stockKitItemsRef.on(
            'value',
            snapshot => setStockKitRows(snapshot.val()),
            error => {
                stockKitSyncError = error?.message || 'Stok kit kayıtları okunamadı.';
                stockKitItemsRef = null;
                stockKitSyncPromise = null;
                renderStockKitsPopup();
            }
        );
    })().catch(error => {
        stockKitSyncError = error?.message || 'Stok kit kayıtları okunamadı.';
        stockKitSyncPromise = null;
        throw error;
    });
    return stockKitSyncPromise;
}

function renderStockKitsPopup() {
    const body = document.getElementById('stockKitsBody');
    const summary = document.getElementById('stockKitsSummary');
    if (!body || !summary) return;

    if (stockKitSyncError) {
        summary.textContent = 'Stok kit kayıtları yüklenemedi';
        body.innerHTML = `<tr><td colspan="7" class="stock-kits-empty">${esc(stockKitSyncError)}</td></tr>`;
        return;
    }

    const query = String(document.getElementById('stockKitsSearch')?.value || '')
        .trim()
        .toLocaleLowerCase('tr');
    const visibleRows = query
        ? stockKitRows.filter(row => [
            row.productNo,
            row.description,
            row.lotNo,
            getStockKitSourceLabel(row.source),
            row.updatedBy
        ].some(value => String(value || '').toLocaleLowerCase('tr').includes(query)))
        : stockKitRows;

    summary.textContent = `${stockKitRows.length} kayıt • ${formatStockKitQuantity(getStockKitTotalQuantity())} toplam kit`;
    if (visibleRows.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="stock-kits-empty">${query ? 'Aramayla eşleşen stok kit bulunamadı.' : 'Stok kit bulunamadı.'}</td></tr>`;
        return;
    }

    body.innerHTML = visibleRows.map(row => `
        <tr>
            <td><strong>${esc(row.productNo || '-')}</strong></td>
            <td>${esc(row.description || '-')}</td>
            <td>${esc(row.lotNo || '-')}</td>
            <td><span class="stock-kits-quantity">${esc(formatStockKitQuantity(row.quantity))}</span></td>
            <td><span class="stock-kits-source">${esc(getStockKitSourceLabel(row.source))}</span></td>
            <td>${esc(formatStockKitDate(row.updatedAt || row.createdAt))}</td>
            <td>${esc(row.updatedBy || row.createdBy || '-')}</td>
        </tr>
    `).join('');
}

async function openStockKitsPopup() {
    const overlay = document.getElementById('stockKitsOverlay');
    if (!overlay) return;
    overlay.classList.add('active');
    renderStockKitsPopup();
    try {
        await startStockKitDashboardSync();
    } catch (error) {
        console.error('Stok kit popup verisi yüklenemedi:', error);
        renderStockKitsPopup();
    }
}

function closeStockKitsPopup() {
    const overlay = document.getElementById('stockKitsOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.classList.remove('modal-fullscreen');
}

let todayOutputsMidnightRefreshTimer = null;

function scheduleTodayOutputsMidnightRefresh() {
    if (todayOutputsMidnightRefreshTimer) clearTimeout(todayOutputsMidnightRefreshTimer);
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    todayOutputsMidnightRefreshTimer = setTimeout(() => {
        renderDashboard();
        if (currentDetailType === 'todayOutputs') openDetail('todayOutputs');
        scheduleTodayOutputsMidnightRefresh();
    }, Math.max(1000, nextMidnight.getTime() - now.getTime()));
}

function getOverdueOrders() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return allOrders.filter(o => {
        if (!matchesToolbarFilters(o, { includeTerminal: true })) return false;
        const d = o._teslimTarihi || o['Teslim Tarihi'];
        if (!d) return false;
        const deliveryDate = getSalesLineDayStart(d);
        if (!deliveryDate) return false;
        if (isTerminalSalesStatus(o['Ürün Durumu'])) return false;
        return deliveryDate.getTime() < todayStart.getTime();
    });
}

function getUpcomingOrders() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const oneWeekLater = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    return allOrders.filter(o => {
        if (!matchesToolbarFilters(o, { includeTerminal: true })) return false;
        const d = o._teslimTarihi || o['Teslim Tarihi'];
        if (!d) return false;
        const deliveryDate = getSalesLineDayStart(d);
        if (!deliveryDate) return false;
        if (isTerminalSalesStatus(o['Ürün Durumu'])) return false;
        return deliveryDate.getTime() >= todayStart.getTime() && deliveryDate.getTime() <= oneWeekLater.getTime();
    });
}

function getCompletedOrCancelledOrders() {
    return allOrders.filter(o => isTerminalSalesStatus(o['Ürün Durumu']) && matchesToolbarFilters(o, { includeTerminal: true }));
}

function getOutputOrders() {
    return allOrders.filter(o => {
        if (!matchesToolbarFilters(o, { includeTerminal: true })) return false;
        const status = normalizeSalesStatus(o['Ürün Durumu']);
        return isTodayOutputStatus(status);
    });
}

function getCancelledOrders() {
    return allOrders.filter(o => {
        if (!matchesToolbarFilters(o, { includeTerminal: true })) return false;
        const status = normalizeSalesStatus(o['Ürün Durumu']);
        return status === 'iptal edildi' || status === 'ürün iptal edildi';
    });
}

function getTodayOutputOrders() {
    return allOrders.filter(o => isTodayOutputOrder(o) && matchesToolbarFilters(o, { includeTerminal: true }));
}

function parseSalesLineChangeDate(entry) {
    if (!entry) return null;
    if (entry.changedAt) {
        const parsed = new Date(entry.changedAt);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const atText = String(entry.at || '').trim();
    const match = atText.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const parsed = new Date(year, month, day, hour, minute);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameLocalDay(a, b) {
    return a instanceof Date && b instanceof Date
        && a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function becameOutputToday(order) {
    const logs = Array.isArray(editedLog[order?._id]) ? editedLog[order._id] : [];
    const today = new Date();
    return logs.some(entry => {
        if (entry?.col !== 'Ürün Durumu') return false;
        if (!isTodayOutputStatus(entry.newVal)) return false;
        const changedAt = parseSalesLineChangeDate(entry);
        return changedAt && isSameLocalDay(changedAt, today);
    });
}

function isTodayOutputStatus(value) {
    const status = normalizeSalesStatus(value);
    return status === 'ürün çıktı' || status === 'ürün parçalı çıktı';
}

function formatSalesLineDateTime(value) {
    const date = value instanceof Date ? value : new Date(value || '');
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getSalesLineOutputDate(order) {
    const logs = Array.isArray(editedLog[order?._id]) ? editedLog[order._id] : [];
    const latest = logs
        .filter(entry => entry?.col === 'Ürün Durumu' && isTodayOutputStatus(entry.newVal))
        .map(entry => parseSalesLineChangeDate(entry))
        .filter(Boolean)
        .sort((a, b) => b - a)[0];

    if (latest) return formatSalesLineDateTime(latest);
    if (isTodayOutputStatus(order?.['Ürün Durumu'])) {
        return formatSalesLineDateTime(order?._sync?.updatedAt || order?._rowUpdatedAt);
    }
    return '';
}

function getPartialOutputQuantity(order) {
    if (!isPartialOutputStatus(order?.['Ürün Durumu'])) return String(order?.['Miktar'] || '');
    const outputText = String(order?._partialOutputQty || '').trim();
    return outputText || String(order?.['Miktar'] || '');
}

function getDetailQuantityValue(order, type = currentDetailType) {
    if ((type === 'output' || type === 'todayOutputs') && isPartialOutputStatus(order?.['Ürün Durumu'])) {
        return getPartialOutputQuantity(order);
    }
    return getPartialOutputRemainingQuantity(order);
}

function isTodayOutputOrder(order) {
    if (!isTodayOutputStatus(order?.['Ürün Durumu'])) return false;
    return becameOutputToday(order);
}

function isFullOutputSalesLine(order) {
    return getCanonicalSalesStatus(order?.['Ürün Durumu']) === 'Ürün Çıktı';
}

function normalizeExtractionProductNo(value) {
    return String(value || '').trim().toLocaleUpperCase('tr');
}

function normalizeExtractionDescription(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('tr');
}

function isExtractionKitOrder(order) {
    const productNo = normalizeExtractionProductNo(order?.['No']);
    const description = normalizeExtractionDescription(order?.['Açıklama']);
    return EXTRACTION_KIT_PRODUCT_NOS.has(productNo)
        || EXTRACTION_KIT_DESCRIPTIONS.has(description);
}

function getExtractionKitOrders() {
    return allOrders.filter(o => matchesToolbarFilters(o, { includeTerminal: true }) && isExtractionKitOrder(o));
}

function isEditedListChange(order, entry) {
    const col = String(entry?.col || '');
    if (!trackedCols.includes(col)) return false;
    if (EDITED_LIST_EXCLUDED_COLUMNS.includes(col)) return false;

    if (order?._manual && !String(entry?.oldVal ?? '').trim()) {
        return false;
    }

    return true;
}

function getEditedListChanges(order) {
    if (isFullOutputSalesLine(order)) return [];
    const logs = editedLog[order?._id];
    if (!Array.isArray(logs)) return [];
    return logs.filter(entry => isEditedListChange(order, entry));
}

function getEditedOrders() {
    return allOrders.filter(o => {
        if (!matchesToolbarFilters(o, { includeTerminal: true })) return false;
        return getEditedListChanges(o).length > 0;
    });
}

function getCurrentEditorName() {
    const embeddedUser = getParentSessionUser();
    if (embeddedUser && embeddedUser.paraf) return String(embeddedUser.paraf).trim();
    try {
        if (window.parent && window.parent !== window) {
            const parentUser = window.parent.currentUser;
            if (parentUser && parentUser.paraf) return String(parentUser.paraf).trim();
        }
    } catch (_) {}
    return 'Bilinmiyor';
}

function recordSalesLineChange(id, col, oldVal, newVal) {
    if (String(oldVal ?? '').trim() === String(newVal ?? '').trim()) return;

    const now = new Date();
    if (!editedLog[id]) editedLog[id] = [];
    editedLog[id].push({
        col,
        oldVal: oldVal ?? '',
        newVal: newVal ?? '',
        by: getCurrentEditorName(),
        at: now.toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }),
        changedAt: now.toISOString(),
        time: now.toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' })
    });
}

function openSalesLineHistoryModal(orderId) {
    const order = allOrders.find(item => item._id === orderId);
    if (!order) return;

    const logs = Array.isArray(editedLog[orderId]) ? [...editedLog[orderId]].reverse() : [];
    const subtitle = document.getElementById('salesLineHistorySubtitle');
    const body = document.getElementById('salesLineHistoryBody');
    const orderNo = String(order['Belge No'] || '-').trim() || '-';
    const productNo = String(order['No'] || order['Açıklama'] || '-').trim() || '-';

    subtitle.textContent = `${orderNo} / ${productNo} satırının değişiklik geçmişi`;

    if (logs.length === 0) {
        body.innerHTML = `<div class="linked-request-empty">Bu satış satırı için henüz kayıtlı bir değişiklik yok.</div>`;
        document.getElementById('salesLineHistoryOverlay').classList.add('active');
        return;
    }

    body.innerHTML = `
        <div class="linked-request-list">
            ${logs.map((log, index) => `
                <div class="linked-request-card">
                    <div class="linked-request-card-header">
                        <div class="linked-request-card-title">Değişiklik ${logs.length - index}</div>
                        <div style="font-size:12px;color:var(--text-secondary);">${esc(String(log.at || '-'))}</div>
                    </div>
                    <div class="linked-request-card-grid">
                        <div><strong>Alan:</strong> ${esc(String(colLabels[log.col] || log.col || '-'))}</div>
                        <div><strong>Değiştiren:</strong> ${esc(String(log.by || 'Bilinmiyor'))}</div>
                        <div><strong>Eski Değer:</strong> ${esc(String(log.oldVal ?? '(boş)'))}</div>
                        <div><strong>Yeni Değer:</strong> ${esc(String(log.newVal ?? '(boş)'))}</div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    document.getElementById('salesLineHistoryOverlay').classList.add('active');
}

function closeSalesLineHistoryModal() {
    const overlay = document.getElementById('salesLineHistoryOverlay');
    overlay.classList.remove('active');
    overlay.classList.remove('modal-fullscreen');
}

function setModalFullscreen(overlayId, enabled) {
    const overlay = document.getElementById(overlayId);
    if (!overlay) return false;
    overlay.classList.toggle('modal-fullscreen', !!enabled);
    return true;
}

function toggleModalFullscreen(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (!overlay) return;
    setModalFullscreen(overlayId, !overlay.classList.contains('modal-fullscreen'));
}

function exitActiveModalFullscreen() {
    const fullscreenOverlay = document.querySelector('.modal-fullscreen.active');
    if (!fullscreenOverlay) return false;
    fullscreenOverlay.classList.remove('modal-fullscreen');
    return true;
}

let currentDetailType = '';
const detailSearchByType = {};
const detailFilterByType = {};
let detailRowValuesById = new Map();
let todayOutputOrderNoIndexCache = null;
let todayOutputOrderNoIndexSignature = '';
let detailRowsFilterTimer = null;
const TODAY_OUTPUT_COLUMNS = ['Sipariş Tarihi','Belge No','Müşteri','No','Açıklama','Konum Kodu','Miktar','Ölçü Birimi','Teslim Tarihi','Ürün Durumu'];
const TODAY_OUTPUT_EXCEL_COLUMNS = TODAY_OUTPUT_COLUMNS.filter(col => col !== 'Ürün Durumu');
const DEFAULT_DETAIL_COLUMNS = ['Belge No','Müşteri','No','Açıklama','Miktar','Ölçü Birimi','Teslim Tarihi','Lot No','Ürün Durumu'];
const OUTPUT_DETAIL_COLUMNS = ['Temsilci','Belge No','Müşteri','No','Açıklama','Miktar','Ölçü Birimi','Teslim Tarihi','Lot No','Çıkış Tarihi','Ürün Durumu'];

function getPersonalizedDetailColumns(baseColumns) {
    if (!canUseColumnPersonalization()) return baseColumns;
    if (!visibleColumnSet) visibleColumnSet = loadVisibleColumnSet();
    if (!visibleColumnSet || visibleColumnSet.size === 0) return baseColumns;
    const visible = baseColumns.filter(col => visibleColumnSet.has(col));
    return visible.length > 0 ? visible : baseColumns;
}

function getDetailConfig(type) {
    let orders = [];
    let title = '';
    const isEdited = type === 'edited';
    const isTodayOutputs = type === 'todayOutputs';
    const showHistoryButton = isTodayOutputs || type === 'output';
    if (isEdited) {
        orders = getEditedOrders();
        title = 'Değişiklik Yapılan Siparişler';
    } else if (type === 'overdue') {
        orders = getOverdueOrders();
        title = 'Geciken Siparişler';
    } else if (type === 'upcoming') {
        orders = getUpcomingOrders();
        title = 'Yaklaşan Siparişler';
    } else if (type === 'output') {
        orders = getOutputOrders();
        title = 'Çıkışı Yapılan Siparişler';
    } else if (type === 'cancelled') {
        orders = getCancelledOrders();
        title = 'İptal Edilen Siparişler';
    } else if (type === 'completedOrCancelled') {
        orders = getCompletedOrCancelledOrders();
        title = 'Çıkışı Yapılan ya da İptal Edilen Siparişler';
    } else if (type === 'todayOutputs') {
        orders = getTodayOutputOrders();
        title = 'Bugün Çıkan Ürünler';
    } else if (type === 'extractionKits') {
        orders = getExtractionKitOrders();
        title = 'Ekstraksiyon Kitleri';
    }
    const baseCols = type === 'todayOutputs'
        ? TODAY_OUTPUT_COLUMNS
        : (type === 'output' ? OUTPUT_DETAIL_COLUMNS : DEFAULT_DETAIL_COLUMNS);
    let cols = getPersonalizedDetailColumns(baseCols);
    if (type === 'output' && !cols.includes('Çıkış Tarihi')) {
        const statusIndex = cols.indexOf('Ürün Durumu');
        cols = [...cols];
        if (statusIndex >= 0) cols.splice(statusIndex, 0, 'Çıkış Tarihi');
        else cols.push('Çıkış Tarihi');
    }
    const filterCols = isEdited ? [...cols, '__changes'] : cols;
    return { orders, title, isEdited, isTodayOutputs, showHistoryButton, cols, filterCols };
}

function getDetailCellText(order, col, type = currentDetailType) {
    if (col === 'Teslim Tarihi') return order._teslimTarihi ? formatDate(order._teslimTarihi) : '';
    if (col === 'Sipariş Tarihi') return order._siparisTarihi ? formatDate(order._siparisTarihi) : '';
    if (col === 'Çıkış Tarihi') return getSalesLineOutputDate(order);
    if (col === 'Ürün Durumu') return getCanonicalSalesStatus(order['Ürün Durumu'] || '');
    if (col === 'Miktar') {
        return getDetailQuantityValue(order, type);
    }
    if (col === '__changes') {
        return getEditedListChanges(order).map(ch => {
            const label = colLabels[ch.col] || ch.col || '';
            return `${label} ${ch.oldVal || ''} ${ch.newVal || ''} ${ch.by || ''} ${ch.at || ch.time || ''}`.trim();
        }).filter(Boolean).join(' | ');
    }
    return String(order[col] || '');
}

function getTodayOutputOrderNoIndex() {
    const signature = `${allOrders.length}|${allOrders[0]?._id || ''}|${allOrders[allOrders.length - 1]?._id || ''}`;
    if (todayOutputOrderNoIndexCache && todayOutputOrderNoIndexSignature === signature) {
        return todayOutputOrderNoIndexCache;
    }

    const index = new Map();
    allOrders.forEach(order => {
        const orderNo = String(order['Belge No'] || '').trim();
        if (!orderNo) return;
        if (!index.has(orderNo)) index.set(orderNo, []);
        index.get(orderNo).push(order);
    });
    todayOutputOrderNoIndexCache = index;
    todayOutputOrderNoIndexSignature = signature;
    return index;
}

function renderTodayOutputTools() {
    const button = document.getElementById('detailExcelBtn');
    if (!button) return;
    const canExportDetail = currentDetailType === 'output' || currentDetailType === 'todayOutputs';
    button.style.display = canExportDetail ? '' : 'none';
}

function getDetailRowSearchText(order, cols, type = currentDetailType, isEdited = false) {
    const searchParts = cols.map(col => getDetailCellText(order, col, type) || '');
    if (isEdited) {
        getEditedListChanges(order).forEach(ch => {
            searchParts.push(colLabels[ch.col] || ch.col || '');
            searchParts.push(ch.oldVal || '');
            searchParts.push(ch.newVal || '');
            searchParts.push(ch.by || '');
            searchParts.push(ch.at || ch.time || '');
        });
    }
    return searchParts.join(' ');
}

function getVisibleDetailExportOrders(type, cols, filterCols, isEdited = false) {
    const { orders } = getDetailConfig(type);
    const filtered = orders.filter(order => detailOrderMatchesFilters(order, filterCols));
    const visibleIds = getVisibleDetailSalesLineIds();
    if (visibleIds.length > 0) {
        const orderById = new Map(filtered.map(order => [String(order._id || ''), order]));
        return visibleIds.map(id => orderById.get(String(id))).filter(Boolean);
    }

    const query = String(detailSearchByType[type] || document.getElementById('detailSearch')?.value || '').trim().toLocaleLowerCase('tr');
    if (!query) return filtered;
    return filtered.filter(order => getDetailRowSearchText(order, cols, type, isEdited).toLocaleLowerCase('tr').includes(query));
}

function buildDetailExportRows(type, orders, cols) {
    return orders.map(order => {
        const row = {};
        cols.forEach(col => {
            const label = col === 'No' ? 'Katalog No' : (colLabels[col] || col);
            const value = getDetailCellText(order, col, type);
            row[label] = shouldWrapExcelColumn(label, value) ? wrapExcelCellText(value, getExcelWrapLineLength(label)) : value;
        });
        return row;
    });
}

async function exportDetailExcel(type) {
    const detailType = type || currentDetailType;
    if (detailType !== 'output' && detailType !== 'todayOutputs') return;

    const { isEdited, cols, filterCols } = getDetailConfig(detailType);
    const orders = getVisibleDetailExportOrders(detailType, cols, filterCols, isEdited);
    if (orders.length === 0) {
        showToast('Dışa aktarılacak veri yok', 'warning');
        return;
    }

    const headers = cols.map(col => col === 'No' ? 'Katalog No' : (colLabels[col] || col));
    const rows = buildDetailExportRows(detailType, orders, cols);
    const dateKey = new Date().toISOString().slice(0, 10);
    const filename = detailType === 'todayOutputs'
        ? `bugun_cikan_urunler_${dateKey}.xlsx`
        : `cikis_yapilan_siparisler_${dateKey}.xlsx`;
    const sheetName = detailType === 'todayOutputs' ? 'Bugün Çıkan Ürünler' : 'Çıkış';

    if (await writeStyledExcelFile(headers, rows, sheetName, filename)) {
        showToast('Excel indirildi', 'success');
        return;
    }

    await ensureSheetJs();
    const ws = XLSX.utils.json_to_sheet(rows);
    applyExcelWrapStyle(ws, headers, rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
    showToast('Excel indirildi', 'success');
}

function exportActiveDetailExcel() {
    return exportDetailExcel(currentDetailType);
}

function getActiveDetailFilters() {
    if (!currentDetailType) return {};
    if (!detailFilterByType[currentDetailType]) detailFilterByType[currentDetailType] = {};
    return detailFilterByType[currentDetailType];
}

function detailOrderMatchesFilters(order, filterCols) {
    const filters = getActiveDetailFilters();
    return filterCols.every(col => {
        const selected = filters[col];
        if (!selected || selected.size === 0) return true;
        return selected.has(getDetailCellText(order, col, currentDetailType));
    });
}

function openDetail(type) {
    currentDetailType = type;
    const { orders, title, isEdited, showHistoryButton, cols, filterCols } = getDetailConfig(type);
    const visibleOrders = orders.filter(order => detailOrderMatchesFilters(order, filterCols));

    document.getElementById('detailTitle').textContent = title;
    document.getElementById('detailCount').textContent = visibleOrders.length + ' satır';
    renderTodayOutputTools();

    let hHtml = '';
    const visibleIds = visibleOrders.map(order => order._id).filter(Boolean);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedSalesLineIds.has(id));
    hHtml += `<th class="select-col"><input type="checkbox" class="row-select-checkbox" title="Görünen satırları seç" onchange="toggleVisibleDetailSelection(this.checked)"${allVisibleSelected ? ' checked' : ''}></th>`;
    const filters = getActiveDetailFilters();
    cols.forEach(c => {
        const label = c === 'No' ? 'Katalog No' : (colLabels[c] || c);
        const filterClass = filters[c] && filters[c].size > 0 ? 'active-filter' : '';
        hHtml += `<th data-detail-col="${esc(c)}">${esc(label)} <span class="filter-icon ${filterClass}" onclick="event.stopPropagation();openDetailColFilter(event,'${esc(c)}')" title="Filtrele">▼</span></th>`;
    });
    if (isEdited) {
        const filterClass = filters.__changes && filters.__changes.size > 0 ? 'active-filter' : '';
        hHtml += `<th style="min-width:220px;" data-detail-col="__changes">Değişiklikler <span class="filter-icon ${filterClass}" onclick="event.stopPropagation();openDetailColFilter(event,'__changes')" title="Filtrele">▼</span></th>`;
    }
    if (showHistoryButton) {
        hHtml += `<th style="min-width:120px;">Değişiklikler</th>`;
    }
    document.getElementById('detailHeader').innerHTML = hHtml;

    const colSpan = cols.length + 1 + (isEdited ? 1 : 0) + (showHistoryButton ? 1 : 0);
    let bHtml = '';
    detailRowValuesById = new Map();
    if (visibleOrders.length === 0) {
        bHtml = `<tr><td colspan="${colSpan}" style="text-align:center;padding:32px;color:var(--text-tertiary);">Kayıt bulunamadı</td></tr>`;
    } else {
        visibleOrders.forEach(o => {
            const rowValues = {};
            filterCols.forEach(c => { rowValues[c] = getDetailCellText(o, c, type); });
            detailRowValuesById.set(String(o._id || ''), rowValues);
            const searchParts = cols.map(c => rowValues[c] || '');
            const editedListChanges = isEdited ? getEditedListChanges(o) : [];
            if (isEdited && editedListChanges.length > 0) {
                editedListChanges.forEach(ch => {
                    searchParts.push(colLabels[ch.col] || ch.col || '');
                    searchParts.push(ch.oldVal || '');
                    searchParts.push(ch.newVal || '');
                    searchParts.push(ch.by || '');
                    searchParts.push(ch.at || ch.time || '');
                });
            }
            const safeIdArg = JSON.stringify(String(o._id || '')).replace(/"/g, '&quot;');
            const checked = selectedSalesLineIds.has(o._id) ? ' checked' : '';
            bHtml += `<tr data-row-id="${esc(o._id)}" data-detail-search="${encodeURIComponent(searchParts.join(' '))}">`;
            bHtml += `<td class="select-col" data-id="${esc(o._id)}" data-col="__select"><input type="checkbox" class="row-select-checkbox" onchange="toggleSalesLineSelection(${safeIdArg}, this.checked)" onclick="event.stopPropagation()"${checked}></td>`;
            cols.forEach(c => {
                let val = '';
                if (c === 'Teslim Tarihi') val = o._teslimTarihi ? formatDate(o._teslimTarihi) : '';
                else if (c === 'Sipariş Tarihi') val = o._siparisTarihi ? formatDate(o._siparisTarihi) : '';
                else if (c === 'Çıkış Tarihi') val = esc(getSalesLineOutputDate(o));
                else if (c === 'Ürün Durumu') val = renderSalesStatusSelect(o, type);
                else if (c === 'Miktar') val = type === 'output' || type === 'todayOutputs'
                    ? esc(getDetailQuantityValue(o, type))
                    : renderSalesQuantityCell(o);
                else val = esc(String(o[c] || ''));
                const editable = (c === 'Ürün Durumu' || c === 'Çıkış Tarihi') ? '' : ' class="editable" ondblclick="startDetailEdit(this)"';
                bHtml += `<td${editable} data-id="${esc(o._id)}" data-col="${esc(c)}">${val}</td>`;
            });
            if (isEdited && editedListChanges.length > 0) {
                const changes = editedListChanges;
                const parts = changes.map(ch => {
                    const label = colLabels[ch.col] || ch.col;
                    const old = ch.oldVal || '(boş)';
                    const who = ch.by || 'Bilinmiyor';
                    const when = ch.at || ch.time || '-';
                    return `<div style="margin-bottom:3px;"><span style="color:var(--text-secondary);font-size:11px;">${esc(label)}</span> <span style="text-decoration:line-through;color:#ef4444;font-size:11px;">${esc(old)}</span> → <span style="color:var(--accent);font-weight:600;font-size:11px;">${esc(ch.newVal || '(boş)')}</span> <span style="color:var(--text-tertiary);font-size:10px;">${esc(who)} • ${esc(when)}</span></div>`;
                });
                bHtml += `<td style="white-space:normal;max-width:300px;">${parts.join('')}</td>`;
            }
            if (showHistoryButton) {
                const changeCount = Array.isArray(editedLog[o._id]) ? editedLog[o._id].length : 0;
                const disabled = changeCount > 0 ? '' : ' disabled';
                bHtml += `<td><button type="button" class="btn btn-sm" onclick="event.stopPropagation();openSalesLineHistoryModal('${esc(o._id)}')"${disabled}>Geçmiş${changeCount > 0 ? ` (${changeCount})` : ''}</button></td>`;
            }
            bHtml += '</tr>';
        });
    }
    document.getElementById('detailBody').innerHTML = bHtml;
    const searchInput = document.getElementById('detailSearch');
    if (searchInput) searchInput.value = detailSearchByType[type] || '';
    filterDetailRows();
    document.getElementById('detailOverlay').classList.add('active');
}

function openDetailColFilter(event, col) {
    closeColFilter();
    const th = event.target.closest('th');
    const rect = th.getBoundingClientRect();
    const { orders, filterCols } = getDetailConfig(currentDetailType);
    const filters = getActiveDetailFilters();
    const activeFiltersForOtherCols = filterCols.filter(item => item !== col);
    const valSet = new Set();
    orders
        .filter(order => activeFiltersForOtherCols.every(item => {
            const selected = filters[item];
            return !selected || selected.size === 0 || selected.has(getDetailCellText(order, item, currentDetailType));
        }))
        .forEach(order => valSet.add(getDetailCellText(order, col, currentDetailType)));
    const allValues = Array.from(valSet).sort((a, b) => String(a).localeCompare(String(b), 'tr'));
    const currentFilter = filters[col] || new Set();
    const isFiltered = currentFilter.size > 0;

    const popup = document.createElement('div');
    popup.className = 'col-filter-popup';
    popup.id = 'colFilterPopup';
    popup.dataset.isFiltered = isFiltered ? '1' : '0';
    popup.dataset.searchPrimed = '0';
    popup.dataset.detailFilter = '1';

    let left = rect.left;
    if (left + 260 > window.innerWidth) left = window.innerWidth - 270;
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.style.left = Math.max(8, left) + 'px';

    popup.innerHTML = `
        <div class="cfp-header">
            <input class="cfp-search" type="text" placeholder="Ara..." oninput="filterPopupSearch(this.value)">
        </div>
        <div class="cfp-list" id="cfpList">
            <div class="cfp-item" style="font-weight:600; border-bottom:1px solid var(--border-light); padding-bottom:6px; margin-bottom:2px;">
                <input type="checkbox" id="cfpSelectAll" onchange="cfpToggleAll(this.checked)" ${!isFiltered ? 'checked' : ''}>
                <label for="cfpSelectAll">Tümünü Seç</label>
            </div>
            ${allValues.map((v, i) => {
                const checked = !isFiltered || currentFilter.has(v);
                const display = v || '(Boş)';
                return `<div class="cfp-item" data-val="${esc(v)}">
                    <input type="checkbox" id="detail_cfp_${i}" data-value="${esc(v)}" ${checked ? 'checked' : ''} onchange="syncSalesLinesPopupSelectAllState()">
                    <label for="detail_cfp_${i}" title="${esc(display)}">${esc(display)}</label>
                </div>`;
            }).join('')}
        </div>
        <div class="cfp-footer">
            <button class="btn btn-sm btn-primary" onclick="applyDetailColFilter('${esc(col)}')">Uygula</button>
            <button class="btn btn-sm" onclick="clearDetailColFilter('${esc(col)}')">Temizle</button>
        </div>
    `;
    document.body.appendChild(popup);
    activeFilterPopup = col;
    popup.querySelector('.cfp-search').focus();
    syncSalesLinesPopupSelectAllState();
}

function applyDetailColFilter(col) {
    const searchValue = String(document.querySelector('#colFilterPopup .cfp-search')?.value || '').trim();
    const allCheckboxes = Array.from(document.querySelectorAll('#cfpList .cfp-item[data-val] input[type=checkbox]'));
    const checkboxes = allCheckboxes.filter(cb => !searchValue || cb.closest('.cfp-item')?.style.display !== 'none');
    const filters = getActiveDetailFilters();
    const checked = searchValue ? new Set(filters[col] || []) : new Set();
    checkboxes.forEach(cb => {
        if (cb.checked) checked.add(cb.dataset.value);
        else checked.delete(cb.dataset.value);
    });
    if (checked.size === 0 || (!searchValue && checked.size === checkboxes.length)) {
        delete filters[col];
    } else {
        filters[col] = checked;
    }
    closeColFilter();
    openDetail(currentDetailType);
}

function clearDetailColFilter(col) {
    const filters = getActiveDetailFilters();
    delete filters[col];
    closeColFilter();
    openDetail(currentDetailType);
}

function addTodayOutputByOrderNo() {
    if (!ensureSalesLinesWritable()) return;
    if (!canManageTodayOutputs()) {
        showToast('Bugünün çıkışları listesini sadece admin ve lojistik düzenleyebilir.', 'warning');
        return;
    }

    const input = document.getElementById('todayOutputOrderNoInput');
    const orderNo = String(input?.value || '').trim();
    if (!orderNo) {
        showToast('Sipariş numarası seçin.', 'warning');
        return;
    }

    const matches = getTodayOutputOrderNoIndex().get(orderNo) || [];
    if (matches.length === 0) {
        showToast('Bu sipariş numarası satış satırlarında bulunamadı.', 'warning');
        return;
    }

    let added = 0;
    matches.forEach(order => {
        const id = String(order._id || '').trim();
        if (id && !todayOutputOrderIds.has(id)) {
            todayOutputOrderIds.add(id);
            added += 1;
        }
    });

    if (input) input.value = '';
    if (added === 0) {
        showToast('Bu sipariş zaten bugünün çıkışları listesinde.', 'info');
        return;
    }

    saveTodayOutputsState({
        source: 'today-outputs-add',
        orderNo,
        count: added,
        approvedAt: null,
        approvedBy: null,
        approvedByUid: null
    });
    renderDashboard();
    requestAnimationFrame(() => openDetail('todayOutputs'));
    showToast(`${added} satır bugünün çıkışlarına eklendi`, 'success');
}

function removeTodayOutputRow(orderId) {
    if (!ensureSalesLinesWritable()) return;
    if (!canManageTodayOutputs()) {
        showToast('Bugünün çıkışları listesini sadece admin ve lojistik düzenleyebilir.', 'warning');
        return;
    }
    const id = String(orderId || '').trim();
    if (!id || !todayOutputOrderIds.has(id)) return;
    todayOutputOrderIds.delete(id);
    saveTodayOutputsState({
        source: 'today-outputs-remove',
        salesOrderId: id,
        approvedAt: null,
        approvedBy: null,
        approvedByUid: null
    });
    renderDashboard();
    requestAnimationFrame(() => openDetail('todayOutputs'));
    showToast('Satır bugünün çıkışlarından çıkarıldı', 'success');
}

async function approveTodayOutputsList() {
    if (!ensureSalesLinesWritable()) return;
    if (!canManageTodayOutputs()) {
        showToast('Bugünün çıkışları listesini sadece admin ve lojistik onaylayabilir.', 'warning');
        return;
    }

    const outputOrders = getTodayOutputOrders();
    if (outputOrders.length === 0) {
        showToast('Onaylanacak liste boş.', 'warning');
        return;
    }

    const partialCount = outputOrders.filter(order => isPartialOutputStatus(order?.['Ürün Durumu'])).length;
    const fullOutputCount = outputOrders.length - partialCount;
    const confirmText = partialCount > 0
        ? `${fullOutputCount} satır "Ürün Çıktı" olarak güncellenecek, ${partialCount} parçalı çıkış satırı korunacak. Onaylıyor musunuz?`
        : `${outputOrders.length} satırın durumu "Ürün Çıktı" olarak güncellenecek. Onaylıyor musunuz?`;
    if (!confirm(confirmText)) return;

    let changed = 0;
    outputOrders.forEach(order => {
        if (isPartialOutputStatus(order?.['Ürün Durumu'])) return;
        if (setSalesLineOrderValue(order, 'Ürün Durumu', 'Ürün Çıktı')) {
            changed += 1;
        }
    });

    const actor = getCurrentSalesLineActor();
    await saveTodayOutputsState({
        source: 'today-outputs-approve',
        count: outputOrders.length,
        approvedAt: new Date().toISOString(),
        approvedBy: actor.paraf || '',
        approvedByUid: actor.uid || null
    }, { immediate: true });
    if (changed > 0) {
        await saveSalesLinesState({ source: 'today-outputs-approve', count: changed }, { immediate: true });
        applyFilters({ preservePage: true, preserveScroll: true });
        renderDashboard();
        openDetail('todayOutputs');
    }
    showToast(changed > 0 ? `${changed} satır Ürün Çıktı olarak güncellendi` : 'Listedeki satırlar zaten onaylı durumda.', changed > 0 ? 'success' : 'info');
}

function startNewTodayOutputsList() {
    if (!ensureSalesLinesWritable()) return;
    if (!canManageTodayOutputs()) {
        showToast('Bugünün çıkışları listesini sadece admin ve lojistik düzenleyebilir.', 'warning');
        return;
    }

    if (todayOutputOrderIds.size > 0 && !confirm('Mevcut bugünün çıkışları listesi temizlenecek. Yeni liste oluşturulsun mu?')) return;
    todayOutputOrderIds = new Set();
    saveTodayOutputsState({ source: 'today-outputs-new-list', resetMeta: true }, { immediate: true });
    renderDashboard();
    openDetail('todayOutputs');
    showToast('Yeni liste oluşturuldu', 'success');
}

function buildTodayOutputExportRows() {
    return buildDetailExportRows('todayOutputs', getTodayOutputOrders(), TODAY_OUTPUT_EXCEL_COLUMNS);
}

async function exportTodayOutputsExcel() {
    return exportDetailExcel('todayOutputs');
}

function startDetailEdit(td) {
    if (!ensureSalesLinesWritable()) return;
    if (td.classList.contains('editing')) return;
    const id = td.dataset.id;
    const col = td.dataset.col;
    const order = allOrders.find(o => o._id === id);
    if (!order || col === 'Ürün Durumu') return;
    const syncMeta = getSalesLineRowSyncMeta(order);
    td.dataset.baseVersion = String(syncMeta.version || 0);
    td.dataset.baseUpdatedAt = syncMeta.updatedAt || '';
    td.dataset.baseEditedLogLength = String(syncMeta.editedLogLength || 0);

    let val = getSalesLineDisplayValue(order, col);
    td.classList.add('editing');
    td.innerHTML = `<input type="text" value="${esc(val)}" onblur="finishDetailEdit(this)" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){this.dataset.cancel='1';this.blur();}">`;
    const input = td.querySelector('input');
    input.focus();
    input.select();
}

function finishDetailEdit(input) {
    if (!ensureSalesLinesWritable()) {
        const td = input.parentElement;
        td.classList.remove('editing');
        openDetail(currentDetailType);
        return;
    }
    const td = input.parentElement;
    if (input.dataset.cancel === '1') {
        td.classList.remove('editing');
        openDetail(currentDetailType);
        setTimeout(flushQueuedSalesLinesAfterEdit, 0);
        return;
    }

    const id = td.dataset.id;
    const col = td.dataset.col;
    const order = allOrders.find(o => o._id === id);
    if (!order) return;

    const baseMeta = {
        version: Number(td.dataset.baseVersion || 0) || 0,
        updatedAt: td.dataset.baseUpdatedAt || '',
        editedLogLength: Number(td.dataset.baseEditedLogLength || 0) || 0
    };
    const changed = setSalesLineOrderValue(order, col, input.value.trim(), baseMeta);
    if (changed) {
        scheduleSalesLinesSave({ source: 'detail-cell-edit', changedCell: col });
        applyFilters({ preservePage: true, preserveScroll: true });
        scheduleDashboardRender();
        showToast('Güncellendi', 'success');
    }
    td.classList.remove('editing');
    openDetail(currentDetailType);
    setTimeout(flushQueuedSalesLinesAfterEdit, 0);
}

function filterDetailRows() {
    if (detailRowsFilterTimer) {
        clearTimeout(detailRowsFilterTimer);
        detailRowsFilterTimer = null;
    }
    const input = document.getElementById('detailSearch');
    const body = document.getElementById('detailBody');
    const count = document.getElementById('detailCount');
    if (!input || !body || !count) return;

    const query = String(input.value || '').trim().toLocaleLowerCase('tr');
    if (currentDetailType) detailSearchByType[currentDetailType] = String(input.value || '');
    const rows = Array.from(body.querySelectorAll('tr[data-detail-search]'));
    let visible = 0;

    rows.forEach(row => {
        let haystack = '';
        try {
            haystack = decodeURIComponent(row.dataset.detailSearch || '');
        } catch (_) {
            haystack = row.dataset.detailSearch || '';
        }
        const matches = !query || haystack.toLocaleLowerCase('tr').includes(query);
        row.style.display = matches ? '' : 'none';
        if (matches) visible += 1;
    });

    count.textContent = `${visible} satır`;
    syncVisibleSelectionCheckboxes();
}

function scheduleFilterDetailRows(options = {}) {
    if (detailRowsFilterTimer) clearTimeout(detailRowsFilterTimer);
    detailRowsFilterTimer = setTimeout(() => {
        detailRowsFilterTimer = null;
        filterDetailRows();
    }, Number(options.delay || 200));
}

function getVisibleDetailSalesLineIds() {
    return Array.from(document.querySelectorAll('#detailBody tr[data-row-id]'))
        .filter(row => row.style.display !== 'none')
        .map(row => row.dataset.rowId)
        .filter(Boolean);
}

function toggleVisibleDetailSelection(checked) {
    getVisibleDetailSalesLineIds().forEach(id => {
        if (checked) selectedSalesLineIds.add(id);
        else selectedSalesLineIds.delete(id);
    });
    updateBulkEditBar();
    syncVisibleSelectionCheckboxes();
}

function closeDetail() {
    const overlay = document.getElementById('detailOverlay');
    overlay.classList.remove('active');
    overlay.classList.remove('modal-fullscreen');
}

function normalizeLinkedOrderNo(value) {
    return String(value || '')
        .trim()
        .toLocaleUpperCase('tr')
        .replace(/\s+/g, '');
}

function splitLinkedOrderNos(value) {
    return String(value || '')
        .split(/[;,/|]+/)
        .map(part => normalizeLinkedOrderNo(part))
        .filter(Boolean);
}

function getLatestStatusChangeLabel(request) {
    const history = Array.isArray(request?.changeHistory) ? request.changeHistory : [];
    const latest = history
        .filter(item => String(item?.field || '').trim() === 'Durum' && item?.changedAt)
        .sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt))[0];

    if (!latest) return '-';

    const changedAt = new Date(latest.changedAt);
    if (Number.isNaN(changedAt.getTime())) return '-';

    return changedAt.toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getLinkedRequestSourceKeys(salesOrder) {
    if (!salesOrder || !window.parent) return [];

    const externalId = salesOrder._id || `${salesOrder['Hafta'] || ''}-${salesOrder['Belge No'] || ''}-${salesOrder['No'] || ''}`;
    const catalogNo = String(salesOrder['No'] || '').trim();
    const description = String(salesOrder['Açıklama'] || salesOrder['Müşteri'] || '').trim();
    const weekNumber = typeof window.parent.normalizeSalesLineWeekNumber === 'function'
        ? window.parent.normalizeSalesLineWeekNumber(salesOrder['Hafta'])
        : String(salesOrder['Hafta'] || '').trim();

    const keys = [];
    const matchedComponents = typeof window.parent.findProductTreeComponentsByCatalog === 'function'
        ? window.parent.findProductTreeComponentsByCatalog(catalogNo)
        : null;

    if (Array.isArray(matchedComponents) && matchedComponents.length > 0) {
        matchedComponents.forEach(component => {
            const materialNo = component.materialNo || '';
            keys.push(`${weekNumber || 'none'}::${materialNo || catalogNo || description}`);
        });
    } else {
        keys.push(`${weekNumber || 'none'}::${catalogNo || description}::unmatched`);
    }

    if (externalId) keys.push(externalId);
    return keys.filter(Boolean);
}

function getLinkedRequestsForSalesOrder(salesOrderId, salesOrder) {
    const normalizedSalesOrderId = String(salesOrderId || '').trim();
    if (!normalizedSalesOrderId || !window.parent || !Array.isArray(window.parent.orders)) return [];

    return getLinkedRequestsSnapshotForSalesOrder({ ...salesOrder, _id: normalizedSalesOrderId });
}

function openLinkedRequestModal(salesOrderId) {
    if (!canViewSalesLineLinkedRequests()) return;

    const salesOrder = allOrders.find(o => o._id === salesOrderId);
    if (!salesOrder) return;

    const orderNo = String(salesOrder['Belge No'] || '').trim();
    const linkedRequests = getLinkedRequestsForSalesOrder(salesOrderId, salesOrder);
    const subtitle = document.getElementById('linkedRequestSubtitle');
    const body = document.getElementById('linkedRequestBody');

    subtitle.textContent = orderNo
        ? `${orderNo} numaral sipariin bal talepleri`
        : 'Sipariş numarası bulunmayan kayıt';

    const summaryHtml = `
        <div class="linked-request-summary">
            <div><strong>Sipariş No:</strong> ${esc(orderNo || '-')}</div>
            <div><strong>Müşteri:</strong> ${esc(String(salesOrder['Müşteri'] || '-'))}</div>
            <div><strong>Ürün:</strong> ${esc(String(salesOrder['Açıklama'] || salesOrder['No'] || '-'))}</div>
            <div><strong>Satış Durumu:</strong> ${esc(String(salesOrder['Ürün Durumu'] || '-'))}</div>
            <div><strong>Miktar:</strong> ${esc(String(salesOrder['Miktar'] || '-'))}</div>
            <div><strong>Lot No:</strong> ${esc(String(salesOrder['Lot No'] || '-'))}</div>
            <div><strong>Satışın Notları:</strong> ${esc(String(salesOrder['Satışın Notları'] || '-'))}</div>
            <div><strong>Üretimin Notları:</strong> ${esc(String(salesOrder['Üretimin Notları'] || '-'))}</div>
            <div><strong>Teslim Tarihi:</strong> ${salesOrder._teslimTarihi ? formatDate(salesOrder._teslimTarihi) : esc(String(salesOrder['Teslim Tarihi'] || '-'))}</div>
        </div>
    `;

    let linkedHtml = '';
    if (!orderNo) {
        linkedHtml = `<div class="linked-request-empty">Bu satış satırında sipariş numarası olmadığı için bağlı talep aranamadı.</div>`;
    } else if (linkedRequests.length === 0) {
        linkedHtml = `<div class="linked-request-empty">Bu sipariş numarası için bağlı talep bulunamadı.</div>`;
    } else {
        linkedHtml = `
            <div class="linked-request-list">
                ${linkedRequests.map((request, index) => `
                    <div class="linked-request-card">
                        <div class="linked-request-card-header">
                            <div class="linked-request-card-title">Bağlı Talep ${index + 1}</div>
                            <div>${window.parent.getStatusBadge ? window.parent.getStatusBadge(request.status || '-') : esc(String(request.status || '-'))}</div>
                        </div>
                        <div class="linked-request-card-grid">
                            <div><strong>Talep Eden:</strong> ${esc(String(request.requester || '-'))}</div>
                            <div><strong>Durum:</strong> ${esc(String(request.status || '-'))} <span style="color: var(--text-secondary);">(${esc(getLatestStatusChangeLabel(request))})</span></div>
                            <div><strong>Rxn Adı:</strong> ${esc(String(request.rxnName || '-'))}</div>
                            <div><strong>Format:</strong> ${esc(String(request.format || '-'))}</div>
                            <div><strong>Katalog No:</strong> ${esc(String(request.catalogNo || '-'))}</div>
                            <div><strong>Madde No:</strong> ${esc(String(request.materialNo || '-'))}</div>
                            <div><strong>Talep Miktar:</strong> ${esc(String(request.quantity ?? '-'))}</div>
                            <div><strong>Üretilen Miktar:</strong> ${esc(String(request.producedQty ?? '-'))}</div>
                            <div><strong>Talep Tarihi:</strong> ${request.requestDate && window.parent.formatDate ? window.parent.formatDate(request.requestDate) : '-'}</div>
                            <div><strong>k Tarihi:</strong> ${request.deliveryDate && window.parent.formatDate ? window.parent.formatDate(request.deliveryDate) : '-'}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    body.innerHTML = summaryHtml + linkedHtml;
    document.getElementById('linkedRequestOverlay').classList.add('active');
}

function closeLinkedRequestModal() {
    const overlay = document.getElementById('linkedRequestOverlay');
    overlay.classList.remove('active');
    overlay.classList.remove('modal-fullscreen');
}

