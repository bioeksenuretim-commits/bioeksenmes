function normalizeCustomerMarketName(value) {
    return String(value || '')
        .trim()
        .toLocaleUpperCase('tr')
        .replace(/\u0130/g, 'I')
        .replace(/\u0131/g, 'I')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const TEST_CUSTOMER_MARKET_ROWS = Array.isArray(window.TEST_CUSTOMER_MARKET_LIST) ? window.TEST_CUSTOMER_MARKET_LIST : [];
const TEST_CUSTOMER_MARKET_BY_NAME = TEST_CUSTOMER_MARKET_ROWS.reduce((acc, row) => {
    const key = normalizeCustomerMarketName(row?.name);
    if (key && row?.market) acc[key] = String(row.market).trim();
    return acc;
}, {});
const TEST_CUSTOMER_MARKET_AMBIGUOUS_NAMES = TEST_CUSTOMER_MARKET_ROWS.reduce((acc, row) => {
    const key = normalizeCustomerMarketName(row?.name);
    const market = String(row?.market || '').trim();
    if (!key || !market) return acc;
    if (!acc._markets[key]) acc._markets[key] = new Set();
    acc._markets[key].add(market);
    if (acc._markets[key].size > 1) acc.names.add(key);
    return acc;
}, { _markets: {}, names: new Set() }).names;
const CUSTOMER_MARKET_OVERRIDES_BY_NAME = {
    [normalizeCustomerMarketName('Bioeksen Ar Ge Teknolojileri Anonim Şirketi')]: 'YURT \u0130\u00c7\u0130'
};

function getSalesLineValueByAliases(order, aliases) {
    if (!order) return '';
    for (const alias of aliases) {
        if (order[alias] !== undefined && order[alias] !== null && String(order[alias]).trim()) {
            return order[alias];
        }
    }
    return '';
}

function getSalesLineCustomerName(order) {
    return getSalesLineValueByAliases(order, ['Müşteri', 'M\u00fc\u015fteri', 'MÃ¼ÅŸteri', 'MÃƒÂ¼Ã…Å¸teri', 'Kurum']);
}

function getSalesLineCustomerMarket(order) {
    if (!order) return '';
    const manualMarket = String(order[CUSTOMER_MARKET_COLUMN] || '').trim();
    if (CUSTOMER_MARKET_OPTIONS.includes(manualMarket)) return manualMarket;

    const candidates = [
        getSalesLineCustomerName(order),
        getSalesLineValueByAliases(order, ['Belge A\u00e7\u0131klamas\u0131', 'Belge Aciklamasi', 'Belge AÃ§Ä±klamasÄ±', 'Belge AÃƒÂ§Ã„Â±klamasÃ„Â±'])
    ].map(normalizeCustomerMarketName).filter(Boolean);

    for (const key of candidates) {
        if (CUSTOMER_MARKET_OVERRIDES_BY_NAME[key]) return CUSTOMER_MARKET_OVERRIDES_BY_NAME[key];
        if (TEST_CUSTOMER_MARKET_AMBIGUOUS_NAMES.has(key)) return '-';
        if (TEST_CUSTOMER_MARKET_BY_NAME[key]) return TEST_CUSTOMER_MARKET_BY_NAME[key];
    }

    for (const key of candidates) {
        const match = TEST_CUSTOMER_MARKET_ROWS.find(row => {
            const customerKey = normalizeCustomerMarketName(row?.name);
            return customerKey && !TEST_CUSTOMER_MARKET_AMBIGUOUS_NAMES.has(customerKey) && !CUSTOMER_MARKET_OVERRIDES_BY_NAME[customerKey] && (key.includes(customerKey) || customerKey.includes(key));
        });
        if (match?.market) return String(match.market).trim();
    }

    return '-';
}

function renderCustomerMarketSelect(order) {
    const current = getSalesLineCustomerMarket(order) || '-';
    const idArg = JSON.stringify(String(order?._id || '')).replace(/"/g, '&quot;');
    const colArg = JSON.stringify(CUSTOMER_MARKET_COLUMN).replace(/"/g, '&quot;');
    let html = `<select class="status-select" onchange="setCellValue(${idArg}, ${colArg}, this.value)" style="min-width: 118px;">`;
    html += `<option value="" ${current === '-' ? 'selected' : ''}>-</option>`;
    CUSTOMER_MARKET_OPTIONS.forEach(option => {
        html += `<option value="${esc(option)}" ${current === option ? 'selected' : ''}>${esc(option)}</option>`;
    });
    html += `</select>`;
    return html;
}

function populateFilter(id, values) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    const firstOpt = sel.options[0]?.textContent || 'Tm';
    const normalizedValues = values.map(value => String(value || '')).filter(Boolean);
    if (current && !normalizedValues.includes(current)) normalizedValues.push(current);
    sel.innerHTML = `<option value="">${firstOpt}</option>`;
    normalizedValues.forEach(v => { sel.innerHTML += `<option value="${esc(String(v))}">${esc(String(v))}</option>`; });
    sel.value = current;
}

function sortSalesLineFilterValues(values, numeric = false) {
    return Array.from(new Set(values.map(value => String(value || '')).filter(Boolean)))
        .sort((a, b) => numeric ? (Number(a) || 0) - (Number(b) || 0) : a.localeCompare(b, 'tr'));
}

function getToolbarFilterState() {
    return {
        search: String(document.getElementById('searchInput')?.value || '').toLocaleLowerCase('tr'),
        week: String(document.getElementById('weekFilter')?.value || ''),
        rep: String(document.getElementById('repFilter')?.value || ''),
        location: String(document.getElementById('locationFilter')?.value || '')
    };
}

function getSalesLineColumnFilterValue(order, col) {
    if (col === CUSTOMER_MARKET_COLUMN) return getSalesLineCustomerMarket(order);
    if (col === 'Sipariş Tarihi' && order._siparisTarihi) return formatDate(order._siparisTarihi);
    if (col === 'Teslim Tarihi' && order._teslimTarihi) return formatDate(order._teslimTarihi);
    return String(order[col] || '');
}

function matchesSalesLineColumnFilters(order, options = {}) {
    const ignoredCol = options.ignoreColumnFilter || '';
    for (const [col, allowedSet] of Object.entries(colFilters)) {
        if (col === ignoredCol) continue;
        if (!allowedSet || allowedSet.size === 0) continue;
        if (col === 'Belge No') {
            const orderNoValues = getSalesOrderNoFilterValues(order);
            if (!orderNoValues.some(value => allowedSet.has(value))) return false;
            continue;
        }
        if (!allowedSet.has(getSalesLineColumnFilterValue(order, col))) return false;
    }
    return true;
}

function matchesToolbarFilters(order, options = {}) {
    if (!options.includeTerminal && isTerminalSalesStatus(order['Ürün Durumu'])) return false;
    const { search, week, rep, location } = getToolbarFilterState();
    const ignoredToolbar = options.ignoreToolbarFilter || '';
    if (ignoredToolbar !== 'week' && week && String(order['Hafta'] || '') !== week) return false;
    if (ignoredToolbar !== 'rep' && rep && String(order['Temsilci'] || '') !== rep) return false;
    if (ignoredToolbar !== 'location' && location && String(order['Konum Kodu'] || '') !== location) return false;
    if (!matchesSalesLineColumnFilters(order, options)) return false;
    if (ignoredToolbar !== 'search' && search && !String(order._searchIndex || '').includes(search)) return false;
    return true;
}

function refreshToolbarFilterOptions() {
    populateFilter('weekFilter', sortSalesLineFilterValues(
        allOrders
            .filter(order => matchesToolbarFilters(order, { ignoreToolbarFilter: 'week' }))
            .map(order => order['Hafta']),
        true
    ));
    populateFilter('repFilter', sortSalesLineFilterValues(
        allOrders
            .filter(order => matchesToolbarFilters(order, { ignoreToolbarFilter: 'rep' }))
            .map(order => order['Temsilci'])
    ));
    populateFilter('locationFilter', sortSalesLineFilterValues(
        allOrders
            .filter(order => matchesToolbarFilters(order, { ignoreToolbarFilter: 'location' }))
            .map(order => order['Konum Kodu'])
    ));
}

function scheduleApplyFilters(options = {}) {
    if (applyFiltersTimer) clearTimeout(applyFiltersTimer);
    applyFiltersTimer = setTimeout(() => {
        applyFiltersTimer = null;
        applyFilters(options);
    }, Number(options.delay || 220));
}

function applyFilters(options = {}) {
    if (applyFiltersTimer) {
        clearTimeout(applyFiltersTimer);
        applyFiltersTimer = null;
    }
    const previousPage = currentPage;
    const tableScroll = document.querySelector('.table-scroll');
    const previousScrollTop = tableScroll ? tableScroll.scrollTop : 0;

    refreshToolbarFilterOptions();
    filteredOrders = allOrders.filter(o => matchesToolbarFilters(o));
    currentPage = options.preservePage ? previousPage : 1;
    if (!options.preservePage) renderedRowLimit = renderBatchSize;
    renderTable();
    if (options.skipDashboard !== true) scheduleDashboardRender();
    if (options.preserveScroll && tableScroll) {
        requestAnimationFrame(() => {
            const currentTableScroll = document.querySelector('.table-scroll');
            if (currentTableScroll) {
                currentTableScroll.scrollTop = Math.min(previousScrollTop, currentTableScroll.scrollHeight);
            }
        });
    }
    document.getElementById('resultCount').textContent = `${filteredOrders.length} satır`;
}

function normalizeSalesStatus(value) {
    return String(value || '').trim().toLocaleLowerCase('tr');
}

function getCanonicalSalesStatus(value) {
    const status = normalizeSalesStatus(value);
    if (status === 'planlandı' || status === 'ürün planlandı') return 'Ürün Planlandı';
    if (status === 'ürün hazır, son ürün qc bekliyor') return 'Ürün Hazır, Son Ürün QC Bekliyor';
    if (status === 'ürün hazır') return 'Ürün Hazır';
    if (status === 'ürün stoktan verilecek') return 'Ürün Stoktan Verilecek';
    if (status === 'ürün lojistikte') return 'Ürün Lojistikte';
    if (status === 'ürün çıktı') return 'Ürün Çıktı';
    if (status === 'çekmesi yapıldı' || status === 'ürünün çekmesi yapıldı') return 'Ürünün Çekmesi Yapıldı';
    if (status === 'ürün parçalı çıktı') return 'Ürün Parçalı Çıktı';
    if (status === 'iptal edildi' || status === 'ürün iptal edildi') return 'Ürün İptal Edildi';
    return String(value || '').trim();
}

function isTerminalSalesStatus(value) {
    const status = normalizeSalesStatus(value);
    return status === 'iptal edildi' || status === 'ürün iptal edildi' || status === 'ürün çıktı';
}

function getSalesStatusOptions() {
    return ['', 'Ürün Planlandı', 'Ürün Hazır, Son Ürün QC Bekliyor', 'Ürün Hazır', 'Ürün Stoktan Verilecek', 'Ürün Lojistikte', 'Ürün Çıktı', 'Ürünün Çekmesi Yapıldı', 'Ürün Parçalı Çıktı', 'Ürün İptal Edildi'];
}

function renderSalesStatusSelect(order, refreshType = '') {
    const curVal = String(order['Ürün Durumu'] || '');
    const canonicalVal = getCanonicalSalesStatus(curVal);
    const opts = getSalesStatusOptions();
    const isCustom = canonicalVal && !opts.includes(canonicalVal);
    const display = canonicalVal || '-- Seç --';
    const idArg = JSON.stringify(String(order._id || '')).replace(/"/g, '&quot;');
    const refreshArg = JSON.stringify(String(refreshType || '')).replace(/"/g, '&quot;');
    const customAttr = isCustom ? ` data-custom-status="${esc(canonicalVal)}"` : '';
    return `<button type="button" class="status-select status-menu-trigger" title="${esc(display)}" onclick="openSalesStatusMenu(event,${idArg},${refreshArg})"${customAttr}>${esc(display)}</button>`;
}

let activeSalesStatusMenu = null;

function closeSalesStatusMenu() {
    if (activeSalesStatusMenu) {
        activeSalesStatusMenu.remove();
        activeSalesStatusMenu = null;
        setTimeout(flushQueuedSalesLinesAfterEdit, 0);
    }
}

function openSalesStatusMenu(event, orderId, refreshType = '') {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    closeColFilter();
    closeSalesStatusMenu();

    const order = allOrders.find(item => item._id === orderId);
    const trigger = event?.currentTarget || event?.target;
    if (!order || !trigger) return;

    const curVal = getCanonicalSalesStatus(order['Ürün Durumu'] || '');
    const options = [...getSalesStatusOptions()];
    if (curVal && !options.includes(curVal)) options.push(curVal);

    const menu = document.createElement('div');
    menu.className = 'status-menu-popover';
    menu.addEventListener('click', e => e.stopPropagation());
    menu.innerHTML = options.map(option => {
        const label = option || '-- Seç --';
        const active = option === curVal ? ' active' : '';
        return `<button type="button" class="status-menu-option${active}" data-value="${esc(option)}">${esc(label)}</button>`;
    }).join('');

    menu.querySelectorAll('.status-menu-option').forEach(button => {
        button.addEventListener('click', async () => {
            const value = button.dataset.value || '';
            closeSalesStatusMenu();
            await setCellValue(orderId, 'Ürün Durumu', value);
            if (refreshType) openDetail(refreshType);
        });
    });

    document.body.appendChild(menu);
    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - menuRect.width - 8);
    let top = rect.bottom + 4;
    if (top + menuRect.height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuRect.height - 4);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    activeSalesStatusMenu = menu;
}

function isPartialOutputStatus(value) {
    return normalizeSalesStatus(value) === 'ürün parçalı çıktı';
}

function parseSalesQuantityNumber(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const match = text.match(/-?\d+(?:[.,]\d+)?/);
    if (!match) return null;
    const number = Number(match[0].replace(',', '.'));
    return Number.isFinite(number) ? number : null;
}

function formatSalesQuantityNumber(value, originalText = '') {
    const original = String(originalText || '');
    const decimalMatch = original.match(/[.,](\d+)/);
    const fractionDigits = decimalMatch ? Math.min(decimalMatch[1].length, 4) : 0;
    const fixed = Number(value).toFixed(fractionDigits);
    return original.includes(',') ? fixed.replace('.', ',') : fixed.replace(/\.0+$/, '');
}

function getPartialOutputRemainingQuantity(order) {
    if (!isPartialOutputStatus(order?.['Ürün Durumu'])) return String(order?.['Miktar'] || '');
    const originalText = String(order?._partialOutputOriginalQty || order?.['Miktar'] || '').trim();
    const outputText = String(order?._partialOutputQty || '').trim();
    const originalQty = parseSalesQuantityNumber(originalText);
    const outputQty = parseSalesQuantityNumber(outputText);
    if (originalQty === null || outputQty === null) return originalText || String(order?.['Miktar'] || '');
    const remaining = Math.max(0, originalQty - outputQty);
    return formatSalesQuantityNumber(remaining, originalText);
}

function renderSalesQuantityCell(order) {
    const quantity = String(order?.['Miktar'] || '');
    if (!isPartialOutputStatus(order?.['Ürün Durumu']) || !String(order?._partialOutputQty || '').trim()) {
        return esc(quantity);
    }

    const originalQty = String(order._partialOutputOriginalQty || quantity || '-');
    const remainingQty = getPartialOutputRemainingQuantity(order);
    return `
        <span class="partial-output-qty" title="Kalan miktar">
            <span class="original-qty">${esc(originalQty)}</span>
            <span class="output-qty">${esc(remainingQty)}</span>
        </span>
    `;
}

let partialOutputModalResolver = null;

function promptPartialOutputQuantity(sourceId) {
    const targets = getBulkEditTargetOrders(sourceId);
    const source = targets[0] || allOrders.find(o => o._id === sourceId);
    const currentPartial = String(source?._partialOutputQty || '').trim();
    const modal = document.getElementById('partialOutputModal');
    const input = document.getElementById('partialOutputInput');
    if (!modal || !input) return Promise.resolve(null);

    input.value = currentPartial;
    modal.classList.add('active');
    setTimeout(() => input.focus(), 80);

    return new Promise(resolve => {
        partialOutputModalResolver = resolve;
    });
}

function closePartialOutputModal() {
    document.getElementById('partialOutputModal')?.classList.remove('active');
    if (partialOutputModalResolver) {
        partialOutputModalResolver(null);
        partialOutputModalResolver = null;
    }
}

function confirmPartialOutputQuantity() {
    if (!ensureSalesLinesWritable()) {
        closePartialOutputModal();
        return;
    }
    const input = document.getElementById('partialOutputInput');
    const rawValue = String(input?.value || '').trim();
    const numericValue = Number(rawValue.replace(',', '.'));
    if (!rawValue || !Number.isFinite(numericValue) || numericValue <= 0) {
        showToast('Lütfen 0’dan büyük geçerli bir çıkış miktarı girin.', 'warning');
        input?.focus();
        return;
    }

    document.getElementById('partialOutputModal')?.classList.remove('active');
    if (partialOutputModalResolver) {
        partialOutputModalResolver(rawValue);
        partialOutputModalResolver = null;
    }
}

function renderWeekSelect(order) {
    const current = String(order?.['Hafta'] || '').trim();
    let html = `<select class="status-select" onchange="setCellValue('${order._id}','Hafta',this.value)" style="min-width: 74px;">`;
    html += `<option value="" ${current ? '' : 'selected'}>--</option>`;
    for (let week = 1; week <= 52; week += 1) {
        const value = String(week);
        html += `<option value="${value}" ${current === value ? 'selected' : ''}>${week}. Hafta</option>`;
    }
    html += `</select>`;
    return html;
}

function getProductCatalogOptions() {
    const values = new Set();
    const addValue = value => {
        const normalized = String(value || '').trim().toLocaleUpperCase('tr');
        if (normalized) values.add(normalized);
    };

    const tree =
        (window.parent && window.parent !== window && window.parent.productTree)
            ? window.parent.productTree
            : window.productTree;

    if (tree && typeof tree === 'object') {
        Object.keys(tree).forEach(addValue);
    }

    const manager =
        (window.parent && window.parent !== window && window.parent.productTreeExcel && Array.isArray(window.parent.productTreeExcel.productTreeData))
            ? window.parent.productTreeExcel
            : (window.productTreeExcel && Array.isArray(window.productTreeExcel.productTreeData) ? window.productTreeExcel : null);

    if (manager) {
        manager.productTreeData.forEach(component => {
            addValue(component?.productTreeNo || component?.catalogNo || component?.productNo);
        });
    }

    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr'));
}

let productNoDatalistSignature = '';

function ensureProductNoDatalist() {
    let list = document.getElementById('salesProductNoOptions');
    if (!list) {
        list = document.createElement('datalist');
        list.id = 'salesProductNoOptions';
        document.body.appendChild(list);
    }

    const signature = getProductTreeLookupCacheKey();
    if (productNoDatalistSignature === signature && list.dataset.signature === signature) {
        return list.id;
    }

    list.innerHTML = getProductCatalogOptions()
        .map(value => `<option value="${esc(value)}"></option>`)
        .join('');
    productNoDatalistSignature = signature;
    list.dataset.signature = signature;
    return list.id;
}

function runWhenSalesLinesIdle(callback, timeout = 2500) {
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(callback, { timeout });
        return;
    }
    setTimeout(callback, Math.min(timeout, 1200));
}

async function loadRemoteProductTreesForSalesLines() {
    if (SALES_LINES_TEST_LOCAL_MODE) {
        remoteProductTreeProducts = [];
        return [];
    }

    const parentWindow = getEmbeddedParentWindow();
    try {
        const parentManager = parentWindow?.productTreeExcel;
        if (parentManager && typeof parentManager.getManagedProducts === 'function') {
            remoteProductTreeProducts = parentManager.getManagedProducts()
                .filter(product => String(product?.catalogNo || product?.productTreeNo || '').trim());
            invalidateProductTreeLookupCache();
            runWhenSalesLinesIdle(() => ensureProductNoDatalist(), 3500);
            runWhenSalesLinesIdle(() => refreshSalesLineProductInfoFromLookup(), 3800);
            return remoteProductTreeProducts;
        }
    } catch (_) {}

    if (isEmbeddedSalesLinesFrame()) {
        remoteProductTreeProducts = [];
        return [];
    }

    if (remoteProductTreeLoadPromise) return remoteProductTreeLoadPromise;
    remoteProductTreeLoadPromise = fetch(PRODUCT_TREES_CLOUD_URL)
        .then(response => response.ok ? response.json() : null)
        .then(data => {
            remoteProductTreeProducts = data && typeof data === 'object'
                ? Object.values(data).filter(product => String(product?.catalogNo || product?.productTreeNo || '').trim())
                : [];
            invalidateProductTreeLookupCache();
            runWhenSalesLinesIdle(() => ensureProductNoDatalist(), 3500);
            runWhenSalesLinesIdle(() => refreshSalesLineProductInfoFromLookup(), 3800);
            return remoteProductTreeProducts;
        })
        .catch(error => {
            console.warn('Ürün ağacı açıklamaları Firebase üzerinden alınamadı:', error);
            return [];
        });
    return remoteProductTreeLoadPromise;
}

let productTreeLookupCache = null;

function getProductTreeLookupCacheKey() {
    const tree =
        (window.parent && window.parent !== window && window.parent.productTree)
            ? window.parent.productTree
            : window.productTree;
    const descriptions =
        (window.parent && window.parent !== window && window.parent.productTreeDescriptions)
            ? window.parent.productTreeDescriptions
            : window.productTreeDescriptions;
    const manager =
        (window.parent && window.parent !== window && window.parent.productTreeExcel && Array.isArray(window.parent.productTreeExcel.productTreeData))
            ? window.parent.productTreeExcel
            : (window.productTreeExcel && Array.isArray(window.productTreeExcel.productTreeData) ? window.productTreeExcel : null);

    return [
        tree ? Object.keys(tree).length : 0,
        descriptions ? Object.keys(descriptions).length : 0,
        manager?.productTreeData?.length || 0,
        manager?.manualProducts?.length || 0,
        remoteProductTreeProducts.length
    ].join('|');
}

function invalidateProductTreeLookupCache() {
    productTreeLookupCache = null;
    productNoDatalistSignature = '';
}

function getProductTreeLookupItems() {
    const cacheKey = getProductTreeLookupCacheKey();
    if (productTreeLookupCache?.key === cacheKey) {
        return productTreeLookupCache.items;
    }

    const items = [];
    const itemMap = new Map();
    const addItem = (key, description, unit) => {
        const normalizedKey = String(key || '').trim().toLocaleUpperCase('tr');
        if (!normalizedKey) return;
        const nextDescription = String(description || '').trim();
        const nextUnit = String(unit || '').trim();
        const existing = itemMap.get(normalizedKey);
        if (existing) {
            if (!existing.description && nextDescription) existing.description = nextDescription;
            if (!existing.unit && nextUnit) existing.unit = nextUnit;
            return;
        }

        const item = {
            key: normalizedKey,
            description: nextDescription,
            unit: nextUnit
        };
        itemMap.set(normalizedKey, item);
        items.push(item);
    };

    const resolveCatalogSalesUnit = (productOrComponents, fallbackUnit = '') => {
        const components = Array.isArray(productOrComponents)
            ? productOrComponents
            : (Array.isArray(productOrComponents?.components) ? productOrComponents.components : []);
        if (components.length >= 3) return 'Kutu';
        if (!Array.isArray(productOrComponents)) {
            const productFormat = String(productOrComponents?.format || '').trim();
            if (productFormat) return productFormat;
            const productUnit = String(productOrComponents?.unit || '').trim();
            if (productUnit) return productUnit;
        }
        return String(fallbackUnit || '').trim();
    };

    const tree =
        (window.parent && window.parent !== window && window.parent.productTree)
            ? window.parent.productTree
            : window.productTree;

    if (tree && typeof tree === 'object') {
        const descriptions =
            (window.parent && window.parent !== window && window.parent.productTreeDescriptions)
                ? window.parent.productTreeDescriptions
                : window.productTreeDescriptions;

        Object.entries(tree).forEach(([catalogNo, components]) => {
            if (!Array.isArray(components)) return;
            const first = components[0] || {};
            addItem(catalogNo, descriptions?.[catalogNo] || first.productDescription || '', resolveCatalogSalesUnit(components, first.unit || first.format || ''));
            components.forEach(component => {
                addItem(
                    component?.materialNo || component?.componentNo,
                    component?.rxnName || component?.description || catalogNo,
                    component?.unit || ''
                );
            });
        });
    }

    const manager =
        (window.parent && window.parent !== window && window.parent.productTreeExcel && Array.isArray(window.parent.productTreeExcel.productTreeData))
            ? window.parent.productTreeExcel
            : (window.productTreeExcel && Array.isArray(window.productTreeExcel.productTreeData) ? window.productTreeExcel : null);

    if (manager) {
        if (typeof manager.getManagedProducts === 'function') {
            manager.getManagedProducts().forEach(product => {
                addItem(
                    product?.catalogNo || product?.productTreeNo,
                    product?.productDescription || product?.description || '',
                    resolveCatalogSalesUnit(product, product?.unit || '')
                );
            });
        }

        manager.productTreeData.forEach(component => {
            addItem(
                component?.productTreeNo || component?.catalogNo,
                component?.productDescription || '',
                component?.unit || component?.measureUnit || component?.unitName || ''
            );
            addItem(
                component?.materialNo || component?.componentNo || component?.productTreeNo || component?.catalogNo,
                component?.description || component?.rxnName || component?.productName || '',
                component?.unit || component?.measureUnit || component?.unitName || ''
            );
        });
    }

    remoteProductTreeProducts.forEach(product => {
        const catalogNo = product?.catalogNo || product?.productTreeNo;
        addItem(catalogNo, product?.productDescription || product?.description || '', resolveCatalogSalesUnit(product, product?.unit || ''));
        (product?.components || []).forEach(component => {
            addItem(
                component?.materialNo || component?.componentNo,
                component?.rxnName || component?.description || product?.productDescription || '',
                component?.unit || ''
            );
        });
    });

    productTreeLookupCache = {
        key: cacheKey,
        items,
        map: new Map(items.map(item => [item.key, item]))
    };
    return items;
}

function getProductTreeLookupItem(value) {
    const lookupValue = String(value || '').trim().toLocaleUpperCase('tr');
    if (!lookupValue) return null;
    getProductTreeLookupItems();
    return productTreeLookupCache?.map?.get(lookupValue) || null;
}

function refreshSalesLineProductInfoFromLookup(options = {}) {
    if (!Array.isArray(allOrders) || allOrders.length === 0) return 0;

    const overwrite = options.overwrite === true;
    let changedCount = 0;

    allOrders.forEach(order => {
        const catalogNo = String(order?.['No'] || '').trim();
        if (!catalogNo) return;

        const match = getProductTreeLookupItem(catalogNo);
        if (!match) return;

        const baseMeta = getSalesLineRowSyncMeta(order);
        let changed = false;

        const currentDescription = String(order['Açıklama'] || '');
        const currentUnit = String(order['Ölçü Birimi'] || '');

        if (match.description && (overwrite || !currentDescription.trim())) {
            order['Açıklama'] = match.description;
            changed = changed || currentDescription !== String(order['Açıklama'] || '');
        }

        if (match.unit && (overwrite || !currentUnit.trim())) {
            order['Ölçü Birimi'] = match.unit;
            changed = changed || currentUnit !== String(order['Ölçü Birimi'] || '');
        }

        if (!changed) return;
        refreshSalesLineSearchIndex(order);
        queueSalesLineRowChange(order, baseMeta);
        changedCount += 1;
    });

    if (changedCount > 0) {
        saveSalesLinesState({ source: 'product-tree-lookup-refresh', count: changedCount });
        if (typeof applyFilters === 'function') applyFilters();
        if (typeof renderDashboard === 'function') renderDashboard();
    }

    return changedCount;
}

function applyProductInfoToSalesLine(order, value) {
    const lookupValue = String(value || '').trim().toLocaleUpperCase('tr');
    if (!order || !lookupValue) return false;

    const match = getProductTreeLookupItem(lookupValue);
    const oldDescription = String(order['Açıklama'] || '');
    const oldUnit = String(order['Ölçü Birimi'] || '');

    if (!match) {
        order['Açıklama'] = '';
        return oldDescription !== '';
    }

    order['Açıklama'] = match.description || '';
    if (match.unit) {
        order['Ölçü Birimi'] = match.unit;
    }
    return oldDescription !== String(order['Açıklama'] || '') || oldUnit !== String(order['Ölçü Birimi'] || '');
}

const MANUAL_SALES_LINE_STEPS = [
    { key: 'itemCount', title: 'Manuel sipariş', prompt: 'Kaç kalem sipariş gireceksiniz?', type: 'number', placeholder: 'Örn: 5' },
    { key: 'orderNo', title: 'Sipariş Numarası', prompt: 'Sipariş numarasını girin.', type: 'text', placeholder: 'Belge no' },
    { key: 'customer', title: 'Müşteri', prompt: 'Müşteri bilgisini girin.', type: 'text', placeholder: 'Belge açıklaması' },
    { key: 'institution', title: 'Kurum', prompt: 'Kurum bilgisini girin.', type: 'text', placeholder: 'Müşteri' },
    { key: 'deliveryDate', title: 'Sipariş teslim tarihi', prompt: 'Sipariş teslim tarihini girin.', type: 'date', placeholder: '' },
    { key: 'location', title: 'Konum', prompt: 'Konum bilgisini girin.', type: 'text', placeholder: 'Konum' },
    { key: 'requestDate', title: 'Sipariş Talep Tarihi', prompt: 'Sipariş talep tarihini girin.', type: 'date', placeholder: '' },
    { key: 'customerMarket', title: CUSTOMER_MARKET_COLUMN, prompt: 'Yurtiçi/Yurtdışı bilgisini seçin.', type: 'select', options: CUSTOMER_MARKET_OPTIONS }
];

function renderManualSalesLineForm() {
    const modal = document.getElementById('manualSalesLineModal');
    const form = document.getElementById('manualSalesLineForm');
    if (!modal || !form) return;

    form.innerHTML = MANUAL_SALES_LINE_STEPS.map(step => {
        const id = `manual_${step.key}`;
        const label = step.key === 'itemCount' ? 'Kalem Sayısı' : step.title;
        if (step.type === 'select') {
            return `<div class="manual-sales-field">
                <label for="${id}">${esc(label)}</label>
                <select id="${id}" data-key="${esc(step.key)}">
                    <option value="">Seçiniz</option>
                    ${(step.options || []).map(option => `<option value="${esc(option)}">${esc(option)}</option>`).join('')}
                </select>
            </div>`;
        }
        const minAttr = step.key === 'itemCount' ? ' min="1" step="1"' : '';
        return `<div class="manual-sales-field">
            <label for="${id}">${esc(label)}</label>
            <input id="${id}" data-key="${esc(step.key)}" type="${esc(step.type)}" placeholder="${esc(step.placeholder || '')}"${minAttr}>
        </div>`;
    }).join('');

    modal.classList.add('active');
    setTimeout(() => document.getElementById('manual_itemCount')?.focus(), 80);
}

function closeManualSalesLineModal() {
    document.getElementById('manualSalesLineModal')?.classList.remove('active');
}

function confirmManualSalesLineForm() {
    if (!ensureSalesLinesWritable()) {
        closeManualSalesLineModal();
        return;
    }
    const answers = {};

    for (const step of MANUAL_SALES_LINE_STEPS) {
        const control = document.querySelector(`#manualSalesLineForm [data-key="${step.key}"]`);
        const value = String(control?.value || '').trim();

        if (!value) {
            showToast('Lütfen tüm alanları doldurun.', 'warning');
            control?.focus();
            return;
        }

        if (step.key === 'itemCount') {
            const count = Number(value);
            if (!Number.isInteger(count) || count < 1) {
                showToast('Lütfen 1 veya daha büyük bir kalem sayısı girin.', 'warning');
                control?.focus();
                return;
            }
        }

        if (step.key === 'customerMarket' && !CUSTOMER_MARKET_OPTIONS.includes(value)) {
            showToast('Lütfen Yurtiçi/Yurtdışı seçimini yapın.', 'warning');
            control?.focus();
            return;
        }

        answers[step.key] = value;
    }

    createManualSalesLineOrders(answers);
    closeManualSalesLineModal();
}

function createManualSalesLineOrders(answers) {
    if (!ensureSalesLinesWritable()) return;
    const count = Number(answers.itemCount) || 1;
    const week = document.getElementById('weekFilter')?.value || '';
    const now = new Date();
    const createdIds = [];
    const representative = getCurrentEditorName();

    for (let i = 0; i < count; i += 1) {
        const order = {
            _manual: true,
            _linkedRequestIds: [],
            _siparisTarihi: parseDate(answers.requestDate),
            _teslimTarihi: parseDate(answers.deliveryDate),
            'Hafta': week,
            'Temsilci': representative === 'Bilinmiyor' ? '' : representative,
            'Sipariş Tarihi': answers.requestDate || '',
            'Belge Açıklaması': answers.customer || '',
            'Belge No': answers.orderNo || '',
            'Müşteri': answers.institution || '',
            'Kurum': answers.institution || '',
            'No': '',
            'Açıklama': '',
            'Konum Kodu': answers.location || '',
            'Miktar': '',
            'Ölçü Birimi': '',
            'Teslim Tarihi': answers.deliveryDate || '',
            'Lot No': '',
            'Satışın Notları': '',
            'Üretimin Notları': '',
            'Ürün Durumu': '',
            [CUSTOMER_MARKET_COLUMN]: answers.customerMarket || ''
        };
        const id = `sl_manual_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;
        order._id = id;
        refreshSalesLineSearchIndex(order);
        queueSalesLineRowChange(order);
        allOrders.unshift(order);
        createdIds.push(id);
        recordSalesLineChange(id, ACTION_COLUMN, '', `Manuel sipariş eklendi ${now.toLocaleString('tr-TR')}`);
    }

    saveSalesLinesState({ source: 'manual-sales-lines', count });
    currentPage = 1;
    currentSort = { col: null, asc: true };
    applyFilters();
    renderDashboard();

    requestAnimationFrame(() => {
        const firstId = createdIds[createdIds.length - 1] || createdIds[0];
        const noCell = firstId ? document.querySelector(`#tableBody td[data-id="${firstId}"][data-col="No"]`) : null;
        if (noCell) startEdit(noCell);
    });
    showToast(`${count} manuel sipariş kalemi eklendi`, 'success');
}

function addManualSalesLineOrder() {
    if (!ensureSalesLinesWritable()) return;
    if (!canUseManualSalesLineButton()) {
        showToast('Bu işlem için yetkiniz yok.', 'warning');
        return;
    }

    renderManualSalesLineForm();
}

