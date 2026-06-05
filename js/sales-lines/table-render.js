function getSalesLineDisplayValue(order, col) {
    if (!order) return '';
    if (col === CUSTOMER_MARKET_COLUMN) return getSalesLineCustomerMarket(order);
    if (col === 'Sipariş Tarihi' && order._siparisTarihi) return formatDate(order._siparisTarihi);
    if (col === 'Teslim Tarihi' && order._teslimTarihi) return formatDate(order._teslimTarihi);
    return String(order[col] || '');
}

function normalizeSalesLineDateInput(value) {
    const parsed = typeof parseSalesLineDateValue === 'function'
        ? parseSalesLineDateValue(value)
        : (typeof parseDate === 'function' ? parseDate(value) : null);
    if (!(parsed instanceof Date) || isNaN(parsed.getTime())) return '';
    if (typeof toDateOnlyString === 'function') return toDateOnlyString(parsed) || '';
    return [
        parsed.getFullYear(),
        String(parsed.getMonth() + 1).padStart(2, '0'),
        String(parsed.getDate()).padStart(2, '0')
    ].join('-');
}

const SALES_LINE_MANUAL_FIELD_COLUMNS = new Set([
    'Miktar',
    'Ölçü Birimi',
    'No',
    'Açıklama',
    'Belge No',
    'Sipariş Tarihi',
    'Teslim Tarihi',
    'Ürün Durumu',
    'Satışın Notları',
    'Üretimin Notları'
]);

function markSalesLineManualField(order, col) {
    if (!order || !SALES_LINE_MANUAL_FIELD_COLUMNS.has(col)) return false;
    const fields = Array.isArray(order._manualFields) ? order._manualFields : [];
    if (fields.includes(col)) {
        order._manualFields = fields;
        return false;
    }
    fields.push(col);
    order._manualFields = fields;
    return true;
}

function isSalesLineManualField(order, col) {
    return Array.isArray(order?._manualFields) && order._manualFields.includes(col);
}


function renderSalesOrderNoDisplay(order, options = {}) {
    const current = String(order?.['Belge No'] || '').trim() || '-';
    const previousNos = normalizePreviousSalesOrderNos(order?._previousBelgeNos);
    const idArg = JSON.stringify(String(order?._id || '')).replace(/"/g, '&quot;');
    const currentHtml = options.link
        ? `<span class="sales-order-link sales-order-no-current" onclick="event.stopPropagation(); openLinkedRequestModal(${idArg})">${esc(current)}</span>`
        : `<span class="sales-order-no-current">${esc(current)}</span>`;
    const previousHtml = previousNos.length
        ? `<span class="sales-order-no-previous" title="Eski STS: ${esc(previousNos.join(', '))}">Eski: ${esc(previousNos.join(', '))}</span>`
        : '';
    return `<span class="sales-order-no-stack">${currentHtml}${previousHtml}</span>`;
}

function setSalesLineOrderValue(order, col, value, baseMeta = null, options = {}) {
    if (!order) return false;
    const isDateColumn = col === 'Sipariş Tarihi' || col === 'Teslim Tarihi';
    const normalizedDate = isDateColumn ? normalizeSalesLineDateInput(value) : '';
    if (isDateColumn && !normalizedDate) {
        showToast('Tarih formatı geçersiz', 'warning');
        return false;
    }
    const rowBaseMeta = {
        ...(baseMeta || getSalesLineRowSyncMeta(order)),
        rowSnapshot: cloneSalesLinePlainValue(order)
    };
    const oldDisplay = getSalesLineDisplayValue(order, col);
    const rawDisplay = String(value ?? '').trim();
    const newDisplay = col === CUSTOMER_MARKET_COLUMN
        ? (CUSTOMER_MARKET_OPTIONS.includes(rawDisplay) ? rawDisplay : '')
        : isDateColumn
        ? normalizedDate
        : rawDisplay;
    const oldComparable = isDateColumn
        ? normalizeSalesLineDateInput(oldDisplay)
        : (col === CUSTOMER_MARKET_COLUMN && oldDisplay.trim() === '-' ? '' : oldDisplay.trim());
    if (oldComparable === newDisplay.trim()) return false;

    recordSalesLineChange(order._id, col, oldDisplay, newDisplay || (col === CUSTOMER_MARKET_COLUMN ? '-' : ''));
    const changedColumns = [col];
    if (markSalesLineManualField(order, col)) changedColumns.push('_manualFields');
    if (col === 'Belge No') {
        updatePreviousSalesOrderNos(order, oldDisplay, newDisplay);
        todayOutputOrderNoIndexCache = null;
        todayOutputOrderNoIndexSignature = '';
    }
    const extraPatch = options && options.extraPatch && typeof options.extraPatch === 'object' ? options.extraPatch : null;
    if (col === 'Ürün Durumu' && normalizeSalesStatus(newDisplay) !== 'ürün hazır ve stok toplandı' && '_stockCollectedQty' in order) {
        delete order._stockCollectedQty;
        delete order._stockCollectedAt;
        delete order._stockCollectedBy;
        changedColumns.push('_stockCollectedQty', '_stockCollectedAt', '_stockCollectedBy');
    }
    order[col] = newDisplay;
    if (extraPatch) {
        Object.entries(extraPatch).forEach(([key, patchValue]) => {
            if (patchValue === undefined) delete order[key];
            else order[key] = patchValue;
            changedColumns.push(key);
        });
    }
    if (col === 'No') {
        const oldDescription = String(order['Açıklama'] || '');
        const oldUnit = String(order['Ölçü Birimi'] || '');
        applyProductInfoToSalesLine(order, newDisplay, {
            preserveManualFields: true,
            preserveDescription: isSalesLineManualField(order, 'A\u00e7\u0131klama'),
            preserveUnit: isSalesLineManualField(order, '\u00d6l\u00e7\u00fc Birimi')
        });
        if (oldDescription !== String(order['Açıklama'] || '')) {
            recordSalesLineChange(order._id, 'Açıklama', oldDescription, String(order['Açıklama'] || ''));
            changedColumns.push('Açıklama');
        }
        if (oldUnit !== String(order['Ölçü Birimi'] || '')) {
            recordSalesLineChange(order._id, 'Ölçü Birimi', oldUnit, String(order['Ölçü Birimi'] || ''));
            changedColumns.push('Ölçü Birimi');
        }
    }
    if (col === 'Miktar') {
        delete order._partialOutputQty;
        delete order._partialOutputOriginalQty;
        changedColumns.push('_partialOutputQty', '_partialOutputOriginalQty');
    }
    if (col === 'Sipariş Tarihi') {
        order._siparisTarihi = normalizedDate;
        changedColumns.push('_siparisTarihi');
    }
    if (col === 'Teslim Tarihi') {
        order._teslimTarihi = normalizedDate;
        changedColumns.push('_teslimTarihi');
    }
    refreshSalesLineSearchIndex(order);
    queueSalesLineRowChange(order, rowBaseMeta, changedColumns);
    return true;
}

function getBulkEditTargetOrders(sourceId) {
    const source = allOrders.find(o => o._id === sourceId);
    if (!source) return [];
    return [source];
}

function applyPartialOutputMetadata(sourceId, outputQty) {
    getBulkEditTargetOrders(sourceId).forEach(order => {
        const baseMeta = {
            ...getSalesLineRowSyncMeta(order),
            rowSnapshot: cloneSalesLinePlainValue(order)
        };
        order._partialOutputOriginalQty = String(order._partialOutputOriginalQty || order['Miktar'] || '');
        order._partialOutputQty = String(outputQty || '').trim();
        queueSalesLineRowChange(order, baseMeta, ['_partialOutputOriginalQty', '_partialOutputQty']);
    });
}

function clearPartialOutputMetadata(sourceId) {
    getBulkEditTargetOrders(sourceId).forEach(order => {
        if (!('_partialOutputQty' in order) && !('_partialOutputOriginalQty' in order)) return;
        const baseMeta = {
            ...getSalesLineRowSyncMeta(order),
            rowSnapshot: cloneSalesLinePlainValue(order)
        };
        delete order._partialOutputQty;
        delete order._partialOutputOriginalQty;
        queueSalesLineRowChange(order, baseMeta, ['_partialOutputOriginalQty', '_partialOutputQty']);
    });
}

function applySalesLineCellChange(sourceId, col, value, baseMeta = null, options = {}) {
    const targets = getBulkEditTargetOrders(sourceId);
    let changedCount = 0;
    targets.forEach(order => {
        if (setSalesLineOrderValue(order, col, value, baseMeta, options)) changedCount += 1;
    });
    return changedCount;
}

function deleteSalesLineRow(id) {
    if (!ensureSalesLinesWritable()) return;
    if (!isSalesLineAdmin()) {
        showToast('Satır silme sadece admin hesabına açıktır.', 'warning');
        return;
    }

    const order = allOrders.find(item => item._id === id);
    if (!order) return;

    const label = String(order['Belge No'] || order['No'] || order['Açıklama'] || 'bu satır').trim();
    if (!confirm(`${label} silinecek. Emin misiniz?`)) return;

    queueSalesLineRowDelete(order);
    allOrders = allOrders.filter(item => item._id !== id);
    delete editedLog[id];
    currentPage = 1;
    saveSalesLinesState({ source: 'delete-sales-line', salesOrderId: id }, { immediate: true });
    applyFilters();
    renderDashboard();
    showToast('Satır silindi', 'success');
}

function getSalesLineRowClass(order) {
    const status = normalizeSalesStatus(order['Ürün Durumu']);
    let rowClass = '';
    if (status === 'ürün hazır, son ürün qc bekliyor') rowClass = 'row-qc-wait';
    else if (status === 'ürün hazır' || status === 'ürün hazır ve stok toplandı') rowClass = 'row-ready';
    else if (status === 'ürün stoktan verilecek') rowClass = 'row-stock';
    else if (status === 'planlandı' || status === 'ürün planlandı') rowClass = 'row-planned';
    else if (status === 'iptal edildi' || status === 'ürün iptal edildi') rowClass = 'row-cancelled';
    else if (status === 'ürün çıktı') rowClass = 'row-output';
    else if (status === 'ürün parçalı çıktı') rowClass = 'row-partial-output';
    else if (status === 'ürün lojistikte') rowClass = 'row-logistics';
    else if (status === 'çekmesi yapıldı' || status === 'ürünün çekmesi yapıldı') rowClass = 'row-pulled';
    return rowClass ? ` class="${rowClass}"` : '';
}

function renderSalesLineHistoryButton(order) {
    const changeCount = getEditedListChanges(order).length;
    const badge = changeCount > 0 ? `<span class="row-edit-badge">${changeCount}</span>` : '';
    return `<button type="button" class="btn btn-sm" onclick="openSalesLineHistoryModal('${order._id}')">Değişiklikler${badge}</button>`;
}

function renderSalesLineActionCell(order) {
    const passed = hasPassedRequestForSalesOrder(order);
    const unmatched = hasUnmatchedRequestForSalesOrder(order);
    const pending = !!salesLineRequestPending[order._id];
    const deleteBtn = isSalesLineAdmin()
        ? `<button type="button" class="btn btn-sm row-delete-btn" onclick="deleteSalesLineRow('${order._id}')">Sil</button>`
        : '';
    if (!canUseSalesLineRequestButton()) {
        return `<td>${renderSalesLineHistoryButton(order)}${deleteBtn}</td>`;
    }
    const resetBtn = passed
        ? `<button type="button" class="btn btn-sm btn-danger" onclick="resetSalesLineRequest('${order._id}')" ${pending ? 'disabled' : ''}>Talebi Geri Al</button>`
        : '';
    return `<td style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><button type="button" class="btn btn-sm ${unmatched ? 'btn-danger' : (passed ? 'btn-success' : '')}" onclick="passSalesLineRequest('${order._id}')" ${pending || passed ? 'disabled' : ''}>${pending ? 'İşleniyor...' : (unmatched ? 'Karşılığı Yok' : (passed ? 'Talep Geçildi' : 'Talep Geç'))}</button>${resetBtn}${renderSalesLineHistoryButton(order)}${deleteBtn}</td>`;
}

function renderSalesLineCell(order, col) {
    const val = order[col] || '';

    if (col === ACTION_COLUMN) {
        return renderSalesLineActionCell(order);
    }
    if (col === 'Hafta') {
        return `<td data-id="${order._id}" data-col="${col}">${renderWeekSelect(order)}</td>`;
    }
    if (col === 'Belge No') {
        if (canViewSalesLineLinkedRequests() && hasPassedRequestForSalesOrder(order)) {
            return `<td class="editable" data-id="${order._id}" data-col="${col}" ondblclick="startEdit(this)">${renderSalesOrderNoDisplay(order, { link: true })}</td>`;
        }
        return `<td class="editable" data-id="${order._id}" data-col="${col}" ondblclick="startEdit(this)">${renderSalesOrderNoDisplay(order)}</td>`;
    }
    if (col === 'Ürün Durumu') {
        return `<td data-id="${order._id}" data-col="${col}">${renderSalesStatusSelect(order)}</td>`;
    }
    if (col === CUSTOMER_MARKET_COLUMN) {
        return `<td data-id="${order._id}" data-col="${col}">${renderCustomerMarketSelect(order)}</td>`;
    }
    if (col === 'Miktar') {
        return `<td class="editable" data-id="${order._id}" data-col="${col}" ondblclick="startEdit(this)">${renderSalesQuantityCell(order)}</td>`;
    }
    if (col === 'Sipariş Tarihi') {
        const display = order._siparisTarihi ? formatDate(order._siparisTarihi) : esc(String(val));
        return `<td class="editable" data-id="${order._id}" data-col="${col}" ondblclick="startEdit(this)">${display}</td>`;
    }
    if (col === 'Teslim Tarihi') {
        const display = order._teslimTarihi ? formatDate(order._teslimTarihi) : esc(String(val));
        return `<td class="editable" data-id="${order._id}" data-col="${col}" ondblclick="startEdit(this)">${display}</td>`;
    }
    return `<td class="editable" data-id="${order._id}" data-col="${col}" ondblclick="startEdit(this)">${esc(String(val))}</td>`;
}

function renderSalesLineRow(order) {
    const checked = selectedSalesLineIds.has(order._id) ? ' checked' : '';
    const safeIdArg = JSON.stringify(String(order._id || '')).replace(/"/g, '&quot;');
    const selectCell = `<td class="select-col" data-id="${esc(order._id)}" data-col="__select"><input type="checkbox" class="row-select-checkbox" onchange="toggleSalesLineSelection(${safeIdArg}, this.checked)" onclick="event.stopPropagation()"${checked}></td>`;
    return `<tr data-row-id="${esc(order._id)}"${getSalesLineRowClass(order)}>${selectCell}${getVisibleColumnOrder().map(col => renderSalesLineCell(order, col)).join('')}</tr>`;
}

function getSortedFilteredOrders() {
    let sorted = [...filteredOrders];
    if (currentSort.col) {
        sorted.sort((a, b) => {
            let va = a[currentSort.col] || '';
            let vb = b[currentSort.col] || '';
            if (currentSort.col === CUSTOMER_MARKET_COLUMN) {
                va = getSalesLineCustomerMarket(a);
                vb = getSalesLineCustomerMarket(b);
            }
            if (currentSort.col.includes('Tarihi')) {
                const key = currentSort.col === 'Teslim Tarihi' ? '_teslimTarihi' : '_siparisTarihi';
                va = a[key] ? a[key].getTime() : 0;
                vb = b[key] ? b[key].getTime() : 0;
            } else if (['Miktar','Hafta'].includes(currentSort.col)) {
                va = parseFloat(va) || 0;
                vb = parseFloat(vb) || 0;
            } else {
                va = String(va).toLowerCase();
                vb = String(vb).toLowerCase();
            }
            if (va < vb) return currentSort.asc ? -1 : 1;
            if (va > vb) return currentSort.asc ? 1 : -1;
            return 0;
        });
    }
    return sorted;
}

function hasActiveTableQuery() {
    const search = String(document.getElementById('searchInput')?.value || '').trim();
    const week = String(document.getElementById('weekFilter')?.value || '').trim();
    const rep = String(document.getElementById('repFilter')?.value || '').trim();
    const location = String(document.getElementById('locationFilter')?.value || '').trim();
    return !!(search || week || rep || location || currentSort.col || Object.values(colFilters).some(set => set && set.size > 0));
}

function canPatchRenderedSalesLineRow(col) {
    return !hasActiveTableQuery();
}

function patchRenderedSalesLineRow(id) {
    const order = allOrders.find(o => o._id === id);
    const escapedId = (window.CSS && typeof CSS.escape === 'function')
        ? CSS.escape(id)
        : String(id).replace(/"/g, '\\"');
    const row = document.querySelector(`#tableBody tr[data-row-id="${escapedId}"]`);
    if (!order || !row) return false;
    const temp = document.createElement('tbody');
    temp.innerHTML = renderSalesLineRow(order);
    const newRow = temp.firstElementChild;
    if (!newRow) return false;
    row.replaceWith(newRow);
    return true;
}

function getVisibleSalesLineIds() {
    return Array.from(document.querySelectorAll('#tableBody tr[data-row-id]'))
        .map(row => row.dataset.rowId)
        .filter(Boolean);
}

function syncVisibleSelectionCheckboxes() {
    document.querySelectorAll('#tableBody .row-select-checkbox').forEach(checkbox => {
        const rowId = checkbox.closest('tr')?.dataset.rowId;
        checkbox.checked = !!rowId && selectedSalesLineIds.has(rowId);
    });

    const headerCheckbox = document.querySelector('#tableHeader .select-col .row-select-checkbox');
    if (headerCheckbox) {
        const visibleIds = getVisibleSalesLineIds();
        headerCheckbox.checked = visibleIds.length > 0 && visibleIds.every(id => selectedSalesLineIds.has(id));
        headerCheckbox.indeterminate = visibleIds.some(id => selectedSalesLineIds.has(id)) && !headerCheckbox.checked;
    }

    document.querySelectorAll('#detailBody .row-select-checkbox').forEach(checkbox => {
        const rowId = checkbox.closest('tr')?.dataset.rowId;
        checkbox.checked = !!rowId && selectedSalesLineIds.has(rowId);
    });

    const detailHeaderCheckbox = document.querySelector('#detailHeader .select-col .row-select-checkbox');
    if (detailHeaderCheckbox) {
        const visibleIds = getVisibleDetailSalesLineIds();
        detailHeaderCheckbox.checked = visibleIds.length > 0 && visibleIds.every(id => selectedSalesLineIds.has(id));
        detailHeaderCheckbox.indeterminate = visibleIds.some(id => selectedSalesLineIds.has(id)) && !detailHeaderCheckbox.checked;
    }
}

function toggleSalesLineSelection(id, checked) {
    if (checked) selectedSalesLineIds.add(id);
    else selectedSalesLineIds.delete(id);
    updateBulkEditBar();
    syncVisibleSelectionCheckboxes();
}

function toggleVisibleSalesLineSelection(checked) {
    getVisibleSalesLineIds().forEach(id => {
        if (checked) selectedSalesLineIds.add(id);
        else selectedSalesLineIds.delete(id);
    });
    updateBulkEditBar();
    syncVisibleSelectionCheckboxes();
}

function clearBulkSelection() {
    selectedSalesLineIds.clear();
    updateBulkEditBar();
    syncVisibleSelectionCheckboxes();
}

function ensureBulkStatusOptions() {
    const select = document.getElementById('bulkEditStatusValue');
    if (!select || select.options.length > 0) return;
    select.innerHTML = getSalesStatusOptions()
        .filter(Boolean)
        .map(status => `<option value="${esc(status)}">${esc(status)}</option>`)
        .join('');
}

function handleBulkEditFieldChange() {
    ensureBulkStatusOptions();
    const field = document.getElementById('bulkEditField')?.value || 'Ürün Durumu';
    const statusInput = document.getElementById('bulkEditStatusValue');
    const customerMarketInput = document.getElementById('bulkEditCustomerMarketValue');
    const textInput = document.getElementById('bulkEditTextValue');
    const dateInput = document.getElementById('bulkEditDateValue');
    if (statusInput) statusInput.style.display = field === 'Ürün Durumu' ? '' : 'none';
    if (customerMarketInput) customerMarketInput.style.display = field === CUSTOMER_MARKET_COLUMN ? '' : 'none';
    if (dateInput) dateInput.style.display = ['Sipariş Tarihi', 'Teslim Tarihi'].includes(field) ? '' : 'none';
    if (textInput) {
        const textFields = ['Belge No', 'Konum Kodu', 'Satışın Notları', 'Üretimin Notları'];
        textInput.style.display = textFields.includes(field) ? '' : 'none';
        textInput.placeholder = field ? `${field} değeri` : 'Yeni değer';
    }
}

function updateBulkEditBar() {
    const bar = document.getElementById('bulkEditBar');
    const count = document.getElementById('bulkEditCount');
    if (!bar || !count) return;
    const selectedCount = selectedSalesLineIds.size;
    count.textContent = `${selectedCount} satır seçildi`;
    bar.classList.toggle('active', selectedCount > 0);
    if (selectedCount > 0) handleBulkEditFieldChange();
}

function getBulkEditValue(field) {
    if (field === 'Ürün Durumu') return document.getElementById('bulkEditStatusValue')?.value || '';
    if (field === CUSTOMER_MARKET_COLUMN) return document.getElementById('bulkEditCustomerMarketValue')?.value || '';
    if (field === 'Sipariş Tarihi' || field === 'Teslim Tarihi') {
        const raw = document.getElementById('bulkEditDateValue')?.value || '';
        if (!raw) return '';
        return normalizeSalesLineDateInput(raw);
    }
    return document.getElementById('bulkEditTextValue')?.value || '';
}

async function applyBulkEditToSelected() {
    if (!ensureSalesLinesWritable()) return;
    const field = document.getElementById('bulkEditField')?.value || '';
    const value = getBulkEditValue(field);
    if (!field) return;
    if ((field === 'Sipariş Tarihi' || field === 'Teslim Tarihi') && !value) {
        showToast('Tarih formatı geçersiz', 'warning');
        return;
    }
    if (!String(value || '').trim()) {
        showToast('Lütfen uygulanacak değeri girin.', 'warning');
        return;
    }

    let changedCount = 0;
    for (const id of selectedSalesLineIds) {
        const order = allOrders.find(item => item._id === id);
        if (!order) continue;
        let extraPatch = {};
        if (field === 'Ürün Durumu' && typeof handleFinalProductStockMovement === 'function') {
            const movement = await handleFinalProductStockMovement(order, order['Ürün Durumu'], value);
            if (!movement?.ok) continue;
            extraPatch = movement.patch || {};
        }
        if (setSalesLineOrderValue(order, field, value, null, { extraPatch })) changedCount += 1;
    }

    if (changedCount === 0) {
        showToast('Seçili satırlarda değişiklik yok.', 'info');
        return;
    }

    scheduleSalesLinesSave({ source: 'bulk-edit', field, count: changedCount });
    applyFilters({ preservePage: true, preserveScroll: true });
    renderDashboard();
    showToast(`${changedCount} satır güncellendi`, 'success');
}

// ===== TABLE =====
function saveColumnWidths() {
    const preferences = getCurrentPersonalizationPreferences();
    writeLocalPersonalization(preferences);
    saveAccountPersonalizationPreferences(preferences).catch(error => {
        console.warn('SÃ¼tun geniÅŸlikleri hesap kiÅŸiselleÅŸtirmesine kaydedilemedi:', error);
    });
}

function getColumnWidth(col) {
    const savedWidth = Number(columnWidths[col]);
    if (Number.isFinite(savedWidth) && savedWidth > 0) return Math.max(70, Math.min(savedWidth, 600));
    return DEFAULT_SALES_LINE_COLUMN_WIDTHS[col] || 140;
}

function renderTableColGroup() {
    const colGroup = document.getElementById('tableColGroup');
    if (!colGroup) return;
    const table = document.getElementById('dataTable');
    const visibleColumns = getVisibleColumnOrder();
    const totalWidth = 44 + visibleColumns.reduce((sum, col) => sum + getColumnWidth(col), 0);
    colGroup.innerHTML = `<col style="width:44px;">` + visibleColumns
        .map(col => `<col style="width:${getColumnWidth(col)}px;">`)
        .join('');
    if (table) {
        table.style.width = `${totalWidth}px`;
        table.style.minWidth = `${totalWidth}px`;
    }
}

let salesLinesHorizontalScrollSyncing = false;
let salesLinesHorizontalScrollBound = false;

function syncSalesLinesHorizontalScroller() {
    const topScroll = document.getElementById('salesLinesTopHorizontalScroll');
    const spacer = document.getElementById('salesLinesTopHorizontalScrollSpacer');
    const tableScroll = document.querySelector('.table-scroll');
    const table = document.getElementById('dataTable');
    if (!topScroll || !spacer || !tableScroll || !table) return;

    const scrollWidth = Math.max(table.scrollWidth, table.getBoundingClientRect().width, tableScroll.clientWidth);
    spacer.style.width = `${scrollWidth}px`;
    topScroll.style.display = scrollWidth > tableScroll.clientWidth + 2 ? 'block' : 'none';
    if (!salesLinesHorizontalScrollSyncing) {
        topScroll.scrollLeft = tableScroll.scrollLeft;
    }

    if (!salesLinesHorizontalScrollBound) {
        salesLinesHorizontalScrollBound = true;
        topScroll.addEventListener('scroll', () => {
            if (salesLinesHorizontalScrollSyncing) return;
            salesLinesHorizontalScrollSyncing = true;
            tableScroll.scrollLeft = topScroll.scrollLeft;
            requestAnimationFrame(() => { salesLinesHorizontalScrollSyncing = false; });
        }, { passive: true });
        tableScroll.addEventListener('scroll', () => {
            if (salesLinesHorizontalScrollSyncing) return;
            salesLinesHorizontalScrollSyncing = true;
            topScroll.scrollLeft = tableScroll.scrollLeft;
            requestAnimationFrame(() => { salesLinesHorizontalScrollSyncing = false; });
        }, { passive: true });
        window.addEventListener('resize', () => requestAnimationFrame(syncSalesLinesHorizontalScroller));
    }
}

function renderColumnResizer(col) {
    return `<span class="col-resizer" title="Sütun genişliğini değiştir" onmousedown="startColumnResize(event,'${col}')" ondblclick="resetColumnWidth(event,'${col}')"></span>`;
}

function renderTable() {
    let headerHtml = '';
    updateColumnPersonalizationButton();
    renderTableColGroup();
    let sorted = getSortedFilteredOrders();
    const visibleIds = sorted.slice(0, renderedRowLimit).map(order => order._id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedSalesLineIds.has(id));
    headerHtml += `<th class="select-col"><input type="checkbox" class="row-select-checkbox" title="Görünen satırları seç" onchange="toggleVisibleSalesLineSelection(this.checked)"${allVisibleSelected ? ' checked' : ''}></th>`;
    getVisibleColumnOrder().forEach((col, i) => {
        const label = colLabels[col] || col;
        if (col === ACTION_COLUMN) {
            headerHtml += `<th data-col="${col}" style="width:${getColumnWidth(col)}px;">${label}${renderColumnResizer(col)}</th>`;
            return;
        }
        const sortIcon = currentSort.col === col ? (currentSort.asc ? '' : '') : '';
        const hasFilter = colFilters[col] && colFilters[col].size > 0;
        const filterClass = hasFilter ? 'active-filter' : '';
        headerHtml += `<th draggable="true" data-col="${col}" style="width:${getColumnWidth(col)}px;"
            ondragstart="colDragStart(event)"
            ondragover="colDragOver(event)"
            ondragenter="colDragEnter(event)"
            ondragleave="colDragLeave(event)"
            ondrop="colDrop(event)">
            <span class="th-label" onclick="sortBy('${col}')" style="cursor:pointer;">${label} <span class="sort-icon">${sortIcon}</span></span>
            <span class="filter-icon ${filterClass}" onclick="event.stopPropagation();openColFilter(event,'${col}')" title="Filtrele">▼</span>
            ${renderColumnResizer(col)}
        </th>`;
    });
    document.getElementById('tableHeader').innerHTML = headerHtml;

    currentPage = 1;
    renderedRowLimit = Math.max(renderBatchSize, Math.min(renderedRowLimit, sorted.length || renderBatchSize));
    const pageData = sorted.slice(0, renderedRowLimit);

    let bodyHtml = '';
    if (pageData.length === 0) {
            bodyHtml = `<tr><td colspan="${getVisibleColumnOrder().length + 1}"><div class="empty-state"><p>Gösterilecek sipariş bulunamadı</p></div></td></tr>`;
    } else {
        pageData.forEach((order) => {
            bodyHtml += renderSalesLineRow(order);
        });
    }
    document.getElementById('tableBody').innerHTML = bodyHtml;
    renderPagination(1, sorted.length);
    updateBulkEditBar();
    requestAnimationFrame(syncSalesLinesHorizontalScroller);
}

// ===== INLINE EDITING =====
function startEdit(td) {
    if (!ensureSalesLinesWritable()) return;
    if (td.classList.contains('editing')) return;
    const id = td.dataset.id;
    const col = td.dataset.col;
    const order = allOrders.find(o => o._id === id);
    if (!order) return;
    const syncMeta = getSalesLineRowSyncMeta(order);
    td.dataset.baseVersion = String(syncMeta.version || 0);
    td.dataset.baseUpdatedAt = syncMeta.updatedAt || '';
    td.dataset.baseEditedLogLength = String(syncMeta.editedLogLength || 0);

    let val = order[col] || '';
    if (col === 'Sipariş Tarihi' && order._siparisTarihi) val = formatDate(order._siparisTarihi);
    else if (col === 'Teslim Tarihi' && order._teslimTarihi) val = formatDate(order._teslimTarihi);
    else val = String(val);

    td.classList.add('editing');
    const listAttr = col === 'No' ? ` list="${ensureProductNoDatalist()}"` : '';
    td.innerHTML = `<input type="text"${listAttr} value="${esc(val)}" onblur="finishEdit(this)" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){this.dataset.cancel='1';this.blur();}">`;
    const input = td.querySelector('input');
    input.focus();
    input.select();
}

function finishEdit(input) {
    const td = input.parentElement;
    if (input.dataset.cancel === '1') {
        const cancelId = td.dataset.id;
        td.classList.remove('editing');
        if (!patchRenderedSalesLineRow(cancelId)) renderTable();
        scheduleFlushQueuedSalesLinesAfterEdit();
        return;
    }
    const id = td.dataset.id;
    const col = td.dataset.col;
    const newVal = input.value.trim();
    const baseMeta = {
        version: Number(td.dataset.baseVersion || 0) || 0,
        updatedAt: td.dataset.baseUpdatedAt || '',
        editedLogLength: Number(td.dataset.baseEditedLogLength || 0) || 0
    };
    const changedCount = applySalesLineCellChange(id, col, newVal, baseMeta);
    scheduleDashboardRender();
    if (changedCount > 0) {
        scheduleSalesLinesSave({ source: 'cell-edit', changedCell: col });
    }
    td.classList.remove('editing');
    if (changedCount > 0) {
        if (canPatchRenderedSalesLineRow(col) && patchRenderedSalesLineRow(id)) {
            document.getElementById('resultCount').textContent = `${filteredOrders.length} satır`;
        } else {
            applyFilters({ preservePage: true, preserveScroll: true });
        }
        showToast(changedCount > 1 ? `${changedCount} satır güncellendi` : 'Güncellendi', 'success');
    } else {
        if (!patchRenderedSalesLineRow(id)) renderTable();
    }
    scheduleFlushQueuedSalesLinesAfterEdit();
}

async function setCellValue(id, col, value) {
    if (!ensureSalesLinesWritable()) {
        if (!patchRenderedSalesLineRow(id)) renderTable();
        return;
    }
    let partialOutputQty = null;
    if (col === 'Ürün Durumu') {
        if (isPartialOutputStatus(value)) {
            partialOutputQty = await promptPartialOutputQuantity(id);
        if (partialOutputQty === null) {
            if (!patchRenderedSalesLineRow(id)) applyFilters({ preservePage: true, preserveScroll: true });
            scheduleFlushQueuedSalesLinesAfterEdit();
            return;
        }
        } else {
            clearPartialOutputMetadata(id);
        }
    }

    let extraPatch = {};
    if (col === 'Ürün Durumu' && typeof handleFinalProductStockMovement === 'function') {
        const order = allOrders.find(item => item._id === id);
        const movement = await handleFinalProductStockMovement(order, order?.['Ürün Durumu'], value);
        if (!movement?.ok) {
            if (!patchRenderedSalesLineRow(id)) applyFilters({ preservePage: true, preserveScroll: true });
            scheduleFlushQueuedSalesLinesAfterEdit();
            return;
        }
        extraPatch = movement.patch || {};
    }

    const changedCount = applySalesLineCellChange(id, col, value, null, { extraPatch });
    if (partialOutputQty !== null) {
        applyPartialOutputMetadata(id, partialOutputQty);
    }
    if (changedCount > 0 || partialOutputQty !== null) {
        scheduleSalesLinesSave({ source: 'cell-edit', changedCell: col });
        if (canPatchRenderedSalesLineRow(col) && patchRenderedSalesLineRow(id)) {
            document.getElementById('resultCount').textContent = `${filteredOrders.length} satır`;
        } else {
            applyFilters({ preservePage: true, preserveScroll: true });
        }
        scheduleDashboardRender();
        showToast(changedCount > 1 ? `${changedCount} satır güncellendi` : 'Durum güncellendi', 'success');
    }
    scheduleFlushQueuedSalesLinesAfterEdit();
}

// ===== COLUMN DRAG & DROP =====
let dragColKey = null;
function colDragStart(e) {
    if (e.target.closest('.col-resizer')) {
        e.preventDefault();
        return;
    }
    dragColKey = e.target.closest('th')?.dataset.col || null;
    if (!dragColKey) {
        e.preventDefault();
        return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragColKey);
}
function colDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function colDragEnter(e) { e.preventDefault(); e.target.closest('th')?.classList.add('drag-over'); }
function colDragLeave(e) { e.target.closest('th')?.classList.remove('drag-over'); }
function colDrop(e) {
    e.preventDefault();
    const targetCol = e.target.closest('th')?.dataset.col || null;
    e.target.closest('th')?.classList.remove('drag-over');
    if (!dragColKey || !targetCol || dragColKey === targetCol) {
        dragColKey = null;
        return;
    }
    const dragColIdx = columnOrder.indexOf(dragColKey);
    const targetIdx = columnOrder.indexOf(targetCol);
    if (dragColIdx < 0 || targetIdx < 0) {
        dragColKey = null;
        return;
    }
    const moved = columnOrder.splice(dragColIdx, 1)[0];
    columnOrder.splice(targetIdx, 0, moved);
    allOrders.forEach(refreshSalesLineSearchIndex);
    dragColKey = null;
    const preferences = getCurrentPersonalizationPreferences();
    applyPersonalizationPreferences(preferences);
    saveAccountPersonalizationPreferences(preferences).catch(error => {
        console.warn('Sütun sırası hesap kişiselleştirmesine kaydedilemedi:', error);
    });
    renderTable();
    showToast('Sütun yeri değiştirildi', 'info');
}

function getColumnHeaderElement(col) {
    return Array.from(document.querySelectorAll('#tableHeader th'))
        .find(th => th.dataset.col === col);
}

function applyColumnWidth(col, width) {
    const normalizedWidth = Math.max(70, Math.min(Number(width) || getColumnWidth(col), 600));
    columnWidths[col] = normalizedWidth;

    const visibleColumns = getVisibleColumnOrder();
    const colIndex = visibleColumns.indexOf(col);
    const colElement = colIndex >= 0 ? document.querySelector(`#tableColGroup col:nth-child(${colIndex + 2})`) : null;
    if (colElement) {
        colElement.style.width = `${normalizedWidth}px`;
    }

    const header = getColumnHeaderElement(col);
    if (header) header.style.width = `${normalizedWidth}px`;

    const table = document.getElementById('dataTable');
    if (table) {
        const totalWidth = visibleColumns.reduce((sum, currentCol) => {
            return sum + (currentCol === col ? normalizedWidth : getColumnWidth(currentCol));
        }, 44);
        table.style.width = `${totalWidth}px`;
        table.style.minWidth = `${totalWidth}px`;
    }
    requestAnimationFrame(syncSalesLinesHorizontalScroller);
}

function startColumnResize(event, col) {
    event.preventDefault();
    event.stopPropagation();
    closeColFilter();

    const header = getColumnHeaderElement(col);
    activeColumnResize = {
        col,
        startX: event.clientX,
        startWidth: header ? header.getBoundingClientRect().width : getColumnWidth(col)
    };

    header?.classList.add('resizing');
    document.body.classList.add('resizing-column');
}

function stopColumnResize() {
    if (!activeColumnResize) return;
    saveColumnWidths();
    getColumnHeaderElement(activeColumnResize.col)?.classList.remove('resizing');
    activeColumnResize = null;
    document.body.classList.remove('resizing-column');
}

function resetColumnWidth(event, col) {
    event.preventDefault();
    event.stopPropagation();
    delete columnWidths[col];
    saveColumnWidths();
    renderTable();
}

document.addEventListener('mousemove', event => {
    if (!activeColumnResize) return;
    const nextWidth = activeColumnResize.startWidth + (event.clientX - activeColumnResize.startX);
    applyColumnWidth(activeColumnResize.col, nextWidth);
});

document.addEventListener('mouseup', stopColumnResize);

// ===== COLUMN FILTER POPUP =====
let activeFilterPopup = null;

function openColFilter(event, col) {
    closeColFilter();
    const th = event.target.closest('th');
    const rect = th.getBoundingClientRect();
    const valSet = new Set();
    allOrders.filter(o => matchesToolbarFilters(o, { ignoreColumnFilter: col })).forEach(o => {
        if (col === 'Belge No') {
            getSalesOrderNoFilterValues(o).forEach(value => valSet.add(value));
            return;
        }
        let v = o[col] || '';
        if (col === CUSTOMER_MARKET_COLUMN) v = getSalesLineCustomerMarket(o);
        if (col === 'Sipariş Tarihi' && o._siparisTarihi) v = formatDate(o._siparisTarihi);
        else if (col === 'Teslim Tarihi' && o._teslimTarihi) v = formatDate(o._teslimTarihi);
        else v = String(v);
        valSet.add(v);
    });
    const allValues = Array.from(valSet).sort((a, b) => String(a).localeCompare(String(b), 'tr'));
    const currentFilter = colFilters[col] || new Set();
    const isFiltered = currentFilter.size > 0;

    const popup = document.createElement('div');
    popup.className = 'col-filter-popup';
    popup.id = 'colFilterPopup';
    popup.dataset.isFiltered = isFiltered ? '1' : '0';
    popup.dataset.searchPrimed = '0';

    let left = rect.left;
    if (left + 260 > window.innerWidth) left = window.innerWidth - 270;
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.style.left = left + 'px';

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
                    <input type="checkbox" id="cfp_${i}" data-value="${esc(v)}" ${checked ? 'checked' : ''} onchange="syncSalesLinesPopupSelectAllState()">
                    <label for="cfp_${i}" title="${esc(display)}">${esc(display)}</label>
                </div>`;
            }).join('')}
        </div>
        <div class="cfp-footer">
            <button class="btn btn-sm btn-primary" onclick="applyColFilter('${col}')">Uygula</button>
            <button class="btn btn-sm" onclick="clearColFilter('${col}')">Temizle</button>
        </div>
    `;
    document.body.appendChild(popup);
    activeFilterPopup = col;
    popup.querySelector('.cfp-search').focus();
    syncSalesLinesPopupSelectAllState();
}

function filterPopupSearch(query) {
    const q = query.toLowerCase();
    const popup = document.getElementById('colFilterPopup');
    document.querySelectorAll('#cfpList .cfp-item[data-val]').forEach(item => {
        const val = (item.dataset.val || '').toLowerCase();
        const label = item.querySelector('label')?.textContent?.toLowerCase() || '';
        item.style.display = (val.includes(q) || label.includes(q)) ? '' : 'none';
    });
    if (q && popup && popup.dataset.isFiltered !== '1' && popup.dataset.searchPrimed !== '1') {
        document.querySelectorAll('#cfpList .cfp-item[data-val] input[type=checkbox]').forEach(cb => {
            cb.checked = false;
        });
        popup.dataset.searchPrimed = '1';
    }
    syncSalesLinesPopupSelectAllState();
}

function cfpToggleAll(checked) {
    document.querySelectorAll('#cfpList .cfp-item[data-val] input[type=checkbox]').forEach(cb => {
        if (cb.closest('.cfp-item').style.display !== 'none') cb.checked = checked;
    });
    syncSalesLinesPopupSelectAllState();
}

function syncSalesLinesPopupSelectAllState() {
    const selectAll = document.getElementById('cfpSelectAll');
    if (!selectAll) return;
    const visibleCheckboxes = Array.from(document.querySelectorAll('#cfpList .cfp-item[data-val] input[type=checkbox]'))
        .filter(cb => cb.closest('.cfp-item')?.style.display !== 'none');
    const checkedCount = visibleCheckboxes.filter(cb => cb.checked).length;
    selectAll.checked = visibleCheckboxes.length > 0 && checkedCount === visibleCheckboxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < visibleCheckboxes.length;
}

function applyColFilter(col) {
    const searchValue = String(document.querySelector('#colFilterPopup .cfp-search')?.value || '').trim();
    const allCheckboxes = Array.from(document.querySelectorAll('#cfpList .cfp-item[data-val] input[type=checkbox]'));
    const checkboxes = allCheckboxes.filter(cb => !searchValue || cb.closest('.cfp-item')?.style.display !== 'none');
    const total = checkboxes.length;
    const checked = searchValue ? new Set(colFilters[col] || []) : new Set();
    checkboxes.forEach(cb => {
        if (cb.checked) checked.add(cb.dataset.value);
        else checked.delete(cb.dataset.value);
    });
    if (checked.size === 0 || (!searchValue && checked.size === total)) {
        delete colFilters[col];
    } else {
        colFilters[col] = checked;
    }
    closeColFilter();
    applyFilters();
}

function clearColFilter(col) {
    delete colFilters[col];
    closeColFilter();
    applyFilters();
}

function closeColFilter() {
    const popup = document.getElementById('colFilterPopup');
    if (popup) popup.remove();
    activeFilterPopup = null;
}

document.addEventListener('click', (e) => {
    if (activeSalesStatusMenu && !e.target.closest('.status-menu-popover') && !e.target.closest('.status-menu-trigger')) {
        closeSalesStatusMenu();
    }
    if (activeFilterPopup && !e.target.closest('.col-filter-popup') && !e.target.closest('.filter-icon')) {
        closeColFilter();
    }
});

// ===== SORTING =====
function sortBy(col) {
    if (currentSort.col === col) currentSort.asc = !currentSort.asc;
    else { currentSort.col = col; currentSort.asc = true; }
    renderedRowLimit = renderBatchSize;
    renderTable();
}

// ===== PAGINATION =====
function renderPagination(totalPages, totalItems) {
    const shown = Math.min(renderedRowLimit, totalItems);
    const suffix = shown < totalItems ? ' - devamı otomatik yüklenir' : '';
    document.getElementById('pagination').innerHTML = `<div class="pagination-info">${shown} / ${totalItems} satır${suffix}</div>`;
    return;
    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalItems);
    let btns = `<button type="button" class="page-btn" data-page="${currentPage - 1}" onclick="goToPage(this.dataset.page)" ${currentPage===1?'disabled':''} aria-label="Önceki sayfa">&lt;</button>`;
    const visiblePageCount = Math.min(5, totalPages);
    const firstVisiblePage = Math.min(Math.max(1, currentPage - 2), Math.max(1, totalPages - visiblePageCount + 1));
    const lastVisiblePage = firstVisiblePage + visiblePageCount - 1;
    for (let p = firstVisiblePage; p <= lastVisiblePage; p++) {
        btns += `<button type="button" class="page-btn ${p===currentPage?'active':''}" data-page="${p}" onclick="goToPage(this.dataset.page)" ${p===currentPage?'aria-current="page"':''}>${p}</button>`;
    }
    btns += `<button type="button" class="page-btn" data-page="${currentPage + 1}" onclick="goToPage(this.dataset.page)" ${currentPage===totalPages?'disabled':''} aria-label="Sonraki sayfa">&gt;</button>`;
    document.getElementById('pagination').innerHTML = `<div class="pagination-info">${start}–${end} / ${totalItems}</div><div class="pagination-btns">${btns}</div>`;
}

function goToPage(p) {
    const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
    const nextPage = Math.min(Math.max(1, Number(p) || 1), totalPages);
    if (nextPage === currentPage) return;
    currentPage = nextPage;
    renderTable();
    const tableScroll = document.querySelector('.table-scroll');
    if (tableScroll) tableScroll.scrollTop = 0;
}
window.goToPage = goToPage;

function loadMoreRenderedRows() {
    if (renderedRowLimit >= filteredOrders.length) return;
    const previousLimit = renderedRowLimit;
    const nextLimit = Math.min(renderedRowLimit + renderBatchSize, filteredOrders.length);
    const tableBody = document.getElementById('tableBody');
    if (!tableBody) {
        renderedRowLimit = nextLimit;
        renderTable();
        return;
    }

    const rowsToAppend = getSortedFilteredOrders().slice(previousLimit, nextLimit);
    renderedRowLimit = nextLimit;
    if (rowsToAppend.length > 0) {
        tableBody.insertAdjacentHTML('beforeend', rowsToAppend.map(renderSalesLineRow).join(''));
    }
    renderPagination(1, filteredOrders.length);
    requestAnimationFrame(syncSalesLinesHorizontalScroller);
}

let salesLinesScrollTicking = false;
let salesLinesLastScrollLoadAt = 0;

function handleSalesLinesInfiniteScroll(el) {
    if (!el || renderedRowLimit >= filteredOrders.length) return;
    const scrollTop = el.scrollTop;
    const clientHeight = el.clientHeight;
    const scrollHeight = el.scrollHeight;
    if (scrollTop + clientHeight >= scrollHeight - 320) {
        const now = Date.now();
        if (now - salesLinesLastScrollLoadAt < 120) return;
        salesLinesLastScrollLoadAt = now;
        loadMoreRenderedRows();
    }
}

document.querySelector('.table-scroll')?.addEventListener('scroll', (event) => {
    const el = event.currentTarget;
    if (salesLinesScrollTicking) return;
    salesLinesScrollTicking = true;
    requestAnimationFrame(() => {
        salesLinesScrollTicking = false;
        handleSalesLinesInfiniteScroll(el);
    });
}, { passive: true });

document.addEventListener('click', (event) => {
    const button = event.target.closest('.page-btn');
    if (!button || !button.closest('#pagination') || button.disabled) return;

    event.preventDefault();
    event.stopPropagation();
    goToPage(button.dataset.page);
}, true);

document.getElementById('pagination')?.addEventListener('click', (event) => {
    const button = event.target.closest('.page-btn');
    if (!button || button.disabled) return;

    event.preventDefault();
    goToPage(button.dataset.page);
});

// ===== RESET =====
function resetFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('weekFilter').value = '';
    document.getElementById('repFilter').value = '';
    document.getElementById('locationFilter').value = '';
    colFilters = {};
    applyFilters();
}

function resetAllChanges() {
    if (!ensureSalesLinesWritable()) return;
    if (!isSalesLineAdmin()) {
        showToast('Bu işlem sadece admin tarafından yapılabilir', 'warning');
        return;
    }
    if (!confirm('Tm veriler silinecek. Emin misiniz?')) return;
    allOrders = [];
    filteredOrders = [];
    editedLog = {};
    todayOutputOrderIds = new Set();
    pendingChangedSalesLineRowIds = new Set();
    pendingDeletedSalesLineRowIds = new Set();
    pendingSalesLineRowBaseMeta = {};
    pendingSalesLineChangedColumns = {};
    pendingLocalSalesLineEdits = new Map();
    serializedSalesLineOrderCache = new Map();
    columnOrder = accountColumnOrderLoaded ? normalizePersonalizationColumnOrder(columnOrder) : [...DEFAULT_SALES_LINE_COLUMN_ORDER];
    localStorage.removeItem(SALES_LINES_STORAGE_KEY);
    clearSalesLinesIndexedDbCache().catch(() => {});
    currentSort = { col: null, asc: true };
    currentPage = 1;
    document.getElementById('mainContent').classList.remove('active');
    document.getElementById('uploadSection').style.display = 'block';
    ['weekFilter','repFilter','locationFilter'].forEach(id => {
        const sel = document.getElementById(id);
        sel.innerHTML = `<option value="">${sel.options[0]?.textContent || 'Tm'}</option>`;
    });
    document.getElementById('searchInput').value = '';
    saveSalesLinesState({ reset: true }, { immediate: true });
    saveTodayOutputsState({ source: 'today-outputs-reset' }, { immediate: true });
    showToast('Veriler sıfırlandı', 'info');
}

