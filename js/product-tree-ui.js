/**
 * Product Tree UI Functions - ürün ağacı arayüzü
 */

function updateProductTreeStats() {
    const stats = productTreeExcel.getStats();

    document.getElementById('ptTotalComponents').textContent = stats.totalComponents;
    document.getElementById('ptTotalTrees').textContent = stats.totalProductTrees;
    document.getElementById('ptUniqueComponents').textContent = stats.totalUniqueComponents;

    const manualCount = document.getElementById('ptManualProductCount');
    if (manualCount) {
        manualCount.textContent = stats.totalManualProducts || 0;
    }
}

async function handleProductTreeExcelUpload(input) {
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        showToast('Lütfen bir Excel dosyası seçin (.xlsx veya .xls)', 'error');
        return;
    }

    try {
        showLoading('Excel dosyası yükleniyor...');

        const count = await productTreeExcel.loadExcelFile(file);
        productTreeExcel.saveToStorage();

        if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof firebaseSync !== 'undefined' && firebaseSync.productTreesRef) {
            firebaseSync.syncProductTrees(productTreeExcel.getManagedProducts(), { force: true, reason: 'excel_upload_product_trees' })
                .catch(error => console.warn('Ürün ağacı Firebase kaydı atlandı:', error));
        }

        updateProductTreeStats();
        renderManagedProductsList();
        document.getElementById('clearPTBtn').disabled = false;

        const statusDiv = document.getElementById('ptUploadStatus');
        const statusText = document.getElementById('ptStatusText');
        statusText.textContent = `${count} bileşen başarıyla yüklendi! (${new Date().toLocaleString('tr-TR')})`;
        statusDiv.style.display = 'block';

        hideLoading();
    } catch (error) {
        hideLoading();
        showToast('Excel yükleme hatası: ' + error.message, 'error');
    }

    input.value = '';
}

async function downloadProductTreesExcel() {
    await ensureSheetJs();
    if (typeof XLSX === 'undefined') {
        showToast('Excel modülü yüklenemedi. Sayfayı yenileyip tekrar deneyin.', 'error');
        return;
    }

    const rows = productTreeExcel.getExcelExportRows();
    if (!rows.length) {
        showToast('İndirilecek ürün ağacı bulunamadı.', 'warning');
        return;
    }

    const summaryRows = [
        { Metrik: 'Toplam ürün ağacı', Değer: productTreeExcel.getManagedProducts().length },
        { Metrik: 'Toplam bileşen satırı', Değer: rows.length },
        { Metrik: 'Dolu ürün açıklaması', Değer: new Set(rows.filter(row => row['Ürün Açıklaması']).map(row => row['Ürün Ağacı No'])).size }
    ];

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    const detailSheet = XLSX.utils.json_to_sheet(rows, {
        header: [
            'Ürün Ağacı No',
            'Ağaç Tipi',
            'Satır No',
            'Bileşen No',
            'Bileşen Açıklaması',
            'Miktar',
            'Format',
            'Ölçü Birimi',
            'Ürün Açıklaması'
        ]
    });

    detailSheet['!cols'] = [
        { wch: 18 },
        { wch: 14 },
        { wch: 10 },
        { wch: 18 },
        { wch: 36 },
        { wch: 10 },
        { wch: 14 },
        { wch: 14 },
        { wch: 42 }
    ];
    summarySheet['!cols'] = [{ wch: 24 }, { wch: 14 }];

    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Özet');
    XLSX.utils.book_append_sheet(workbook, detailSheet, 'Ürün Ağaçları');
    XLSX.writeFile(workbook, `urun_agaclari_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function searchProductTree() {
    const searchInput = document.getElementById('ptSearchInput');
    const resultsDiv = document.getElementById('ptSearchResults');

    if (!searchInput.value.trim()) {
        resultsDiv.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Lütfen bir arama terimi girin</p>';
        return;
    }

    if (!productTreeExcel.isLoaded) {
        resultsDiv.innerHTML = '<p style="color: var(--warning); text-align: center; padding: 2rem;">Önce Excel yükleyin veya manuel ürün tanımlayın</p>';
        return;
    }

    const searchTerm = searchInput.value.trim();
    const result = productTreeExcel.search(searchTerm);
    renderSearchResults(result);
}

function renderSearchResults(result) {
    const resultsDiv = document.getElementById('ptSearchResults');

    if (result.type === 'not_found') {
        resultsDiv.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                <div style="font-size: 2rem; margin-bottom: 0.75rem;">Bulunamadı</div>
                <p>"${result.searchTerm}" için kayıt bulunamadı.</p>
            </div>
        `;
        return;
    }

    let title = 'Kısmi eşleşmeler';
    if (result.type === 'product_tree') title = `Ürün ağacı: ${result.searchTerm}`;
    if (result.type === 'component') title = `Bileşen bulundu: ${result.searchTerm}`;

    let html = `
        <div style="margin-top: 1.5rem;">
            <h4 style="color: var(--text-primary); margin-bottom: 1rem;">${title}</h4>
            <div class="table-container" style="max-height: 400px; overflow-y: auto;">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Ürün Katalog No</th>
                            <th>Ürün Açıklaması</th>
                            <th>Bileşen YM No</th>
                            <th>Bileşen Adı</th>
                            <th>Kaynak</th>
                            <th>Miktar Esası</th>
                            <th>İşlem</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    result.components.forEach((component, index) => {
        html += `
            <tr>
                <td><strong>${component.productTreeNo || '-'}</strong></td>
                <td>${component.productDescription || '-'}</td>
                <td><code>${component.componentNo || '-'}</code></td>
                <td>${component.description || '-'}</td>
                <td>${component.source === 'manual' ? 'Manuel ürün' : 'Excel'}</td>
                <td>${component.quantity || 1}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="createOrderFromComponent(${index}, '${result.type}', '${result.searchTerm}')">
                        Talep oluştur
                    </button>
                </td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    resultsDiv.innerHTML = html;
    window.lastSearchResult = result;
}

function createOrderFromComponent(componentIndex, searchType, searchTerm) {
    if (!window.lastSearchResult) {
        showToast('Arama sonucu bulunamadı', 'error');
        return;
    }

    const component = window.lastSearchResult.components[componentIndex];
    if (!component) {
        showToast('Bileşen bulunamadı', 'error');
        return;
    }

    switchTab('new-order');

    setTimeout(() => {
        const catalogNoInput = document.getElementById('catalogNo');
        if (catalogNoInput) {
            catalogNoInput.value = searchTerm;
            const event = new Event('input', { bubbles: true });
            catalogNoInput.dispatchEvent(event);
        }

        showToast(`${component.description} için form hazırlandı`, 'info');
    }, 100);
}

async function createBulkOrderFromSearch(searchType, searchTerm) {
    if (!window.lastSearchResult || window.lastSearchResult.components.length === 0) {
        showToast('Arama sonucu bulunamadı', 'error');
        return;
    }

    const quantity = prompt('Kaç adet talep ediyorsunuz?', '96');
    if (!quantity || isNaN(quantity) || parseInt(quantity, 10) <= 0) {
        showToast('Geçerli bir miktar girin', 'warning');
        return;
    }

    const orderNo = prompt('Sipariş No (opsiyonel):', '');

    try {
        showLoading('Toplu talep oluşturuluyor...');

        let requesterName = 'Sistem';
        if (typeof currentUser !== 'undefined' && currentUser && currentUser.paraf) {
            requesterName = currentUser.paraf;
        }

        let targetWeek = new Date().getWeek();
        if (typeof selectedWeekFilter !== 'undefined' && selectedWeekFilter !== null) {
            targetWeek = selectedWeekFilter;
        } else {
            const weekInput = prompt('Hangi haftaya eklensin? (Boş: mevcut hafta)', targetWeek);
            if (weekInput) targetWeek = weekInput;
        }

        const orderData = {
            weekNumber: targetWeek,
            requestDate: new Date().toISOString().split('T')[0],
            requester: requesterName,
            orderNo: orderNo || '',
            deliveryDate: '',
            requesterNote: `Ürün Ağacı: ${searchTerm}`,
            format: 'Bulk',
            productionOrderNo: ''
        };

        const createdOrders = productTreeExcel.createOrdersFromSearch(
            window.lastSearchResult,
            parseInt(quantity, 10),
            orderData
        );

        for (const order of createdOrders) {
            orders.push(order);
            await storage.save(order);
        }

        await window.saveOrders();

        hideLoading();
        showToast(`${createdOrders.length} adet talep oluşturuldu!`, 'success');
        switchTab('vcap');
    } catch (error) {
        hideLoading();
        showToast('Toplu talep oluşturma hatası: ' + error.message, 'error');
    }
}

function clearProductTree() {
    if (typeof isAdmin === 'function' && !isAdmin()) {
        showToast('Bu işlem sadece admin tarafından yapılabilir', 'warning');
        return;
    }

    const confirmed = confirm('Ürün ağacı verilerini ve manuel eklenen ürünleri silmek istediğinize emin misiniz?');
    if (!confirmed) return;

    productTreeExcel.clear();
    updateProductTreeStats();
    renderManagedProductsList();
    document.getElementById('clearPTBtn').disabled = true;
    document.getElementById('ptUploadStatus').style.display = 'none';
    document.getElementById('ptSearchResults').innerHTML = '';
    showToast('Ürün ağacı verileri temizlendi', 'info');
}

function showProductTreeInfo() {
    const guideDiv = document.getElementById('ptGuide');
    guideDiv.style.display = guideDiv.style.display === 'none' ? 'block' : 'none';
}

function getProductTreeUnitOptions(selectedUnit = '') {
    const options = ['', 'STRIP MIC', 'TÜP (MIC)', 'STRIP BIO', 'TÜP', 'UL'];
    return options.map(option => {
        const selected = option === selectedUnit ? 'selected' : '';
        const label = option || 'Ölçü birimi seçin';
        return `<option value="${option}" ${selected}>${label}</option>`;
    }).join('');
}

function getProductTreeFormatOptions(selectedFormat = '') {
    const options = ['', 'Kutu', 'vCAP', 'Liyofilize', 'Tup', 'Karma'];
    return options.map(option => {
        const selected = option === selectedFormat ? 'selected' : '';
        const label = option || 'Format seçin';
        return `<option value="${option}" ${selected}>${label}</option>`;
    }).join('');
}

function syncComponentFormatFromUnit(unitSelect) {
    const row = unitSelect.closest('.manual-component-row');
    if (!row) return;

    const formatSelect = row.querySelector('[data-field="format"]');
    if (!formatSelect || typeof productTreeExcel === 'undefined') return;

    const derivedFormat = productTreeExcel.classifyUnitToFormat(unitSelect.value || '');
    if (derivedFormat) {
        formatSelect.value = derivedFormat;
    }
}

function addManualComponentRow(component = { materialNo: '', rxnName: '', quantity: 1, unit: '', format: '' }) {
    const container = document.getElementById('manualProductComponents');
    if (!container) return;

    const selectedUnit = component.unit || '';
    const selectedFormat = component.format || (typeof productTreeExcel !== 'undefined' ? productTreeExcel.classifyUnitToFormat(selectedUnit) : '');

    const row = document.createElement('div');
    row.className = 'manual-component-row';
    row.innerHTML = `
        <input type="text" class="form-input" data-field="materialNo" placeholder="Madde No / YM kodu" value="${component.materialNo || ''}">
        <input type="text" class="form-input" data-field="rxnName" placeholder="Rxn Adı" value="${component.rxnName || ''}">
        <input type="number" class="form-input" data-field="quantity" placeholder="Miktar" min="1" step="0.01" value="${component.quantity || 1}">
        <select class="form-input" data-field="unit" onchange="syncComponentFormatFromUnit(this)">
            ${getProductTreeUnitOptions(selectedUnit)}
        </select>
        <select class="form-input" data-field="format">
            ${getProductTreeFormatOptions(selectedFormat)}
        </select>
        <button type="button" class="btn btn-secondary btn-sm" onclick="removeManualComponentRow(this)">Satırı kaldır</button>
    `;

    container.appendChild(row);
}

function removeManualComponentRow(button) {
    const container = document.getElementById('manualProductComponents');
    if (!container) return;

    if (container.children.length === 1) {
        showToast('En az bir bileşen kalmalı.', 'warning');
        return;
    }

    button.closest('.manual-component-row').remove();
}

function toggleManualProductForm() {
    const panel = document.getElementById('manualProductPanel');
    if (!panel) return;

    const isHidden = panel.style.display === 'none' || !panel.style.display;
    panel.style.display = isHidden ? 'block' : 'none';
}

function collectManualProductFormData() {
    const catalogNo = document.getElementById('manualCatalogNo').value.trim();
    const hmNo = document.getElementById('manualHmNo').value.trim();
    const productDescription = document.getElementById('manualProductDescription')?.value.trim() || '';
    const format = document.getElementById('manualProductFormat').value.trim();
    const rows = Array.from(document.querySelectorAll('#manualProductComponents .manual-component-row'));

    const components = rows.map(row => ({
        materialNo: row.querySelector('[data-field="materialNo"]').value.trim(),
        rxnName: row.querySelector('[data-field="rxnName"]').value.trim(),
        quantity: row.querySelector('[data-field="quantity"]').value.trim(),
        unit: row.querySelector('[data-field="unit"]').value.trim(),
        format: row.querySelector('[data-field="format"]').value.trim()
    })).filter(component => component.materialNo || component.rxnName);

    const resolvedFormat = format || (typeof productTreeExcel !== 'undefined' ? productTreeExcel.inferProductFormat(components) : '');
    return { catalogNo, productDescription, hmNo, format: resolvedFormat, components };
}

function resetManualProductForm() {
    document.getElementById('manualCatalogNo').value = '';
    document.getElementById('manualHmNo').value = '';
    const productDescriptionInput = document.getElementById('manualProductDescription');
    if (productDescriptionInput) productDescriptionInput.value = '';
    document.getElementById('manualProductFormat').value = '';
    const container = document.getElementById('manualProductComponents');
    container.innerHTML = '';
    addManualComponentRow();
}

function saveManualProduct() {
    try {
        const formData = collectManualProductFormData();
        productTreeExcel.addManualProduct(formData);
        updateProductTreeStats();
        renderManualProductsList();
        document.getElementById('clearPTBtn').disabled = false;
        resetManualProductForm();
        document.getElementById('manualProductPanel').style.display = 'none';
        showToast(`${formData.catalogNo.toUpperCase()} sisteme eklendi`, 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function deleteManualProduct(catalogNo) {
    const confirmed = confirm(`${catalogNo} iin manuel tanm silmek istiyor musunuz?`);
    if (!confirmed) return;

    productTreeExcel.removeManualProduct(catalogNo);
    updateProductTreeStats();
    renderManagedProductsList();
    showToast(`${catalogNo} kaldırıldı`, 'info');
}

function getProductWellCount(product) {
    const value = product?.['Kuyucuk Sayısı'] ?? product?.kuyucukSayisi ?? product?.wellCount;
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;

    const componentValue = (product?.components || [])
        .map(component => component?.['Kuyucuk Sayısı'] ?? component?.kuyucukSayisi ?? component?.wellCount)
        .find(item => item !== undefined && item !== null && String(item).trim() !== '');

    return componentValue || '-';
}

function getComponentWellCount(component, product) {
    const value = component?.['Kuyucuk Sayısı'] ?? component?.kuyucukSayisi ?? component?.wellCount;
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    return getProductWellCount(product);
}

function renderManualProductsList() {
    const list = document.getElementById('manualProductList');
    if (!list) return;

    const manualProducts = productTreeExcel.getManualProducts();
    if (manualProducts.length === 0) {
        list.innerHTML = '<p style="color: var(--text-muted); margin: 0;">Henüz manuel tanımlı ürün yok.</p>';
        return;
    }

    list.innerHTML = manualProducts.map(product => `
        <div class="manual-product-card">
            <div>
                <strong>${product.catalogNo}</strong>
                <div class="section-subtle">${product.productDescription || ''}</div>
                <div class="section-subtle">HM: ${product.hmNo} · Format: ${product.format} · Kuyucuk Sayısı: ${getProductWellCount(product)} · ${product.components.length} bileşen</div>
                <div class="section-subtle">${product.components.map(component => `${component.materialNo} / ${component.rxnName} / ${component.quantity}`).join(', ')}</div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="deleteManualProduct('${product.catalogNo}')">Sil</button>
        </div>
    `).join('');
}

function enhanceCatalogNoAutocomplete() {
    const catalogNoInput = document.getElementById('catalogNo');
    if (!catalogNoInput) return;

    catalogNoInput.addEventListener('input', function (e) {
        const value = e.target.value;
        if (!value || !productTreeExcel.isLoaded) return;

        const suggestions = productTreeExcel.getSuggestions(value, 5);
        if (suggestions.length > 0) {
            console.log('Ürün ağacı önerileri:', suggestions);
        }
    });
}

let productTreeEditorState = null;
const managedProductsPageState = {
    page: 1,
    pageSize: 25,
    lastQuery: ''
};

function populateManagedProductForm(product) {
    document.getElementById('manualCatalogNo').value = product.catalogNo || '';
    document.getElementById('manualHmNo').value = product.hmNo || '';
    const productDescriptionInput = document.getElementById('manualProductDescription');
    if (productDescriptionInput) productDescriptionInput.value = product.productDescription || '';
    document.getElementById('manualProductFormat').value = product.format || '';

    const container = document.getElementById('manualProductComponents');
    container.innerHTML = '';
    (product.components || []).forEach(component => addManualComponentRow({
        materialNo: component.materialNo || '',
        rxnName: component.rxnName || '',
        quantity: component.quantity || 1,
        unit: component.unit || '',
        format: component.format || ''
    }));

    if (!container.children.length) addManualComponentRow();
    document.getElementById('manualProductPanel').style.display = 'block';
}

function editManagedProduct(catalogNo) {
    const product = productTreeExcel.getManagedProduct(catalogNo);
    if (!product) {
        showToast('Ürün ağacı bulunamadı', 'warning');
        return;
    }

    productTreeEditorState = {
        originalCatalogNo: product.catalogNo,
        productDescription: product.productDescription || '',
        source: product.source || 'excel'
    };
    populateManagedProductForm(product);
    showToast(`${product.catalogNo} düzenleme modunda`, 'info');
}

function deleteManagedProduct(catalogNo) {
    const product = productTreeExcel.getManagedProduct(catalogNo);
    if (!product) return;

    const confirmed = confirm(`${catalogNo} ürün ağacını silmek istiyor musunuz?`);
    if (!confirmed) return;

    productTreeExcel.removeProduct(catalogNo);
    updateProductTreeStats();
    renderManagedProductsList();
    showToast(`${catalogNo} kaldırıldı`, 'info');
}

function getFilteredManagedProducts() {
    const query = (document.getElementById('managedProductSearch')?.value || '').trim().toLocaleUpperCase('tr');
    if (query !== managedProductsPageState.lastQuery) {
        managedProductsPageState.page = 1;
        managedProductsPageState.lastQuery = query;
    }

    const products = productTreeExcel.getManagedProducts();
    if (!query) return products;
    return products.filter(product => String(product._searchIndex || '').includes(query));
}

function setManagedProductsPage(page) {
    const products = getFilteredManagedProducts();
    const totalPages = Math.max(1, Math.ceil(products.length / managedProductsPageState.pageSize));
    managedProductsPageState.page = Math.min(Math.max(1, Number(page) || 1), totalPages);
    renderManagedProductsList();
}

function renderManagedProductsList() {
    const list = document.getElementById('manualProductList');
    if (!list) return;

    const products = getFilteredManagedProducts();

    if (products.length === 0) {
        list.innerHTML = '<p style="color: var(--text-muted); margin: 0;">Gösterilecek ürün ağacı bulunamadı.</p>';
        return;
    }

    const totalPages = Math.max(1, Math.ceil(products.length / managedProductsPageState.pageSize));
    managedProductsPageState.page = Math.min(managedProductsPageState.page, totalPages);
    const start = (managedProductsPageState.page - 1) * managedProductsPageState.pageSize;
    const pageProducts = products.slice(start, start + managedProductsPageState.pageSize);
    const end = Math.min(start + pageProducts.length, products.length);
    const pager = `
        <div class="section-subtle" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
            <span>${start + 1}-${end} / ${products.length} ürün ağacı</span>
            <span class="dense-actions">
                <button type="button" class="btn btn-secondary btn-sm" onclick="setManagedProductsPage(${managedProductsPageState.page - 1})" ${managedProductsPageState.page <= 1 ? 'disabled' : ''}>Önceki</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="setManagedProductsPage(${managedProductsPageState.page + 1})" ${managedProductsPageState.page >= totalPages ? 'disabled' : ''}>Sonraki</button>
            </span>
        </div>
    `;

    list.innerHTML = pager + pageProducts.map(product => `
        <div class="manual-product-card">
            <div>
                <strong>${product.catalogNo}</strong>
                <div class="section-subtle">${product.productDescription || ''}</div>
                <div class="section-subtle">Kaynak: ${product.source === 'manual' ? 'Manuel' : 'Excel'} · HM: ${product.hmNo || '-'} · Format: ${product.format || '-'} · Kuyucuk Sayısı: ${getProductWellCount(product)} · ${product.components.length} bileşen</div>
                <div class="table-container" style="margin-top: 10px;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Madde No</th>
                                <th>Rxn Adı</th>
                                <th>Miktar</th>
                                <th>Ölçü Birimi</th>
                                <th>Format</th>
                                <th>Kuyucuk Sayısı</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${product.components.map(component => `
                                <tr>
                                    <td><code>${component.materialNo || '-'}</code></td>
                                    <td>${component.rxnName || '-'}</td>
                                    <td>${component.quantity || 1}</td>
                                    <td>${component.unit || '-'}</td>
                                    <td>${component.format || '-'}</td>
                                    <td>${getComponentWellCount(component, product)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="dense-actions">
                <button type="button" class="btn btn-secondary btn-sm" onclick="editManagedProduct('${product.catalogNo}')">Düzenle</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="deleteManagedProduct('${product.catalogNo}')">Sil</button>
            </div>
        </div>
    `).join('');
}

function saveManualProduct() {
    try {
        const formData = collectManualProductFormData();
        const source = productTreeEditorState?.source || 'manual';
        productTreeExcel.upsertProduct({
            ...formData,
            productDescription: formData.productDescription || '',
            source
        }, { originalCatalogNo: productTreeEditorState?.originalCatalogNo });
        updateProductTreeStats();
        renderManagedProductsList();
        document.getElementById('clearPTBtn').disabled = false;
        resetManualProductForm();
        document.getElementById('manualProductPanel').style.display = 'none';
        showToast(`${String(formData.catalogNo || '').trim().toUpperCase()} sisteme kaydedildi`, 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function resetManualProductForm() {
    productTreeEditorState = null;
    document.getElementById('manualCatalogNo').value = '';
    document.getElementById('manualHmNo').value = '';
    const productDescriptionInput = document.getElementById('manualProductDescription');
    if (productDescriptionInput) productDescriptionInput.value = '';
    document.getElementById('manualProductFormat').value = '';
    const container = document.getElementById('manualProductComponents');
    container.innerHTML = '';
    addManualComponentRow();
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        console.log('Ürün ağacı UI başlatılıyor... isLoaded:', productTreeExcel.isLoaded, 'toplam:', productTreeExcel.productTreeData.length);
        updateProductTreeStats();
        renderManagedProductsList();
        if (productTreeExcel.isLoaded) {
            document.getElementById('clearPTBtn').disabled = false;
            const status = document.getElementById('ptUploadStatus');
            const statusText = document.getElementById('ptStatusText');
            if (status && statusText) {
                status.style.display = 'block';
                statusText.textContent = 'Ürün ağacı verileri hazır';
            }
        }
        if (!document.querySelector('#manualProductComponents .manual-component-row')) {
            addManualComponentRow();
        }
    }, 500);

    setTimeout(enhanceCatalogNoAutocomplete, 1000);
});
