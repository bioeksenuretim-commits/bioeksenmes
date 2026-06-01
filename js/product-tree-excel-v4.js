/**
 * Product Tree Excel Manager - Excel'den ve manuel girişten ürün ağacı yönetimi
 */

class ProductTreeExcelManager {
    constructor() {
        this.productTreeData = [];
        this.productTreeIndex = {};
        this.componentIndex = {};
        this.manualProducts = [];
        this.isLoaded = false;
        this.storageKey = 'product_tree_excel_data_v20260501_descriptions';
        this.manualStorageKey = 'product_tree_manual_products';
        this.bootstrapUnitLookup = this.createUnitLookupFromLegacyTree(window.productTree);
        this.managedProductsCache = null;
    }

    normalizeSearchText(value) {
        return String(value || '').toLocaleUpperCase('tr');
    }

    buildComponentSearchIndex(component) {
        return this.normalizeSearchText([
            component.productTreeNo,
            component.productDescription,
            component.componentNo,
            component.description,
            component.hmNo,
            component.format,
            component.unit
        ].join(' '));
    }

    buildManagedProductSearchIndex(product) {
        return this.normalizeSearchText([
            product.catalogNo,
            product.productDescription,
            product.hmNo,
            product.format,
            product['Kuyucuk Sayısı'],
            product.kuyucukSayisi,
            product.source,
            ...(product.components || []).map(component => [
                component.materialNo,
                component.rxnName,
                component.unit,
                component.format,
                component['Kuyucuk Sayısı'],
                component.kuyucukSayisi
            ].join(' '))
        ].join(' '));
    }

    invalidateManagedProductsCache() {
        this.managedProductsCache = null;
    }

    normalizeManagedProduct(product) {
        const productWellCount = product?.['Kuyucuk Sayısı'] ?? product?.kuyucukSayisi ?? product?.wellCount ?? '';
        const normalizedComponents = Array.isArray(product.components) ? product.components.map((component, index) => {
            const unit = String(component.unit || '').trim();
            const format = String(component.format || this.classifyUnitToFormat(unit) || '').trim();
            const componentWellCount = component?.['Kuyucuk Sayısı'] ?? component?.kuyucukSayisi ?? component?.wellCount ?? productWellCount;

            return {
                id: component.id || `managed-component-${Date.now()}-${index}`,
                materialNo: String(component.materialNo || component.componentNo || '').trim().toUpperCase(),
                rxnName: String(component.rxnName || component.description || '').trim(),
                quantity: Number(component.quantity) || Number(component.multiplier) || 1,
                unit,
                format,
                'Kuyucuk Sayısı': componentWellCount
            };
        }) : [];

        const normalizedProduct = {
            catalogNo: String(product.catalogNo || product.productTreeNo || '').trim().toUpperCase(),
            productDescription: String(product.productDescription || product.description || '').trim(),
            hmNo: String(product.hmNo || '').trim().toUpperCase(),
            format: this.resolveCatalogFormat(normalizedComponents, product.format),
            source: product.source === 'manual' ? 'manual' : 'excel',
            createdAt: product.createdAt || new Date().toISOString(),
            'Kuyucuk Sayısı': productWellCount,
            kuyucukSayisiKaynak: product.kuyucukSayisiKaynak || '',
            components: normalizedComponents
        };

        if (!normalizedProduct.catalogNo) throw new Error('Ürün katalog numarası zorunludur.');
        if (normalizedProduct.source === 'manual' && !normalizedProduct.hmNo) throw new Error('Ürün HM numarası zorunludur.');
        if (normalizedProduct.components.length === 0) throw new Error('En az bir bileşen eklemelisiniz.');

        normalizedProduct.components.forEach((component, index) => {
            if (!component.materialNo) throw new Error(`Madde ${index + 1} için madde no zorunludur.`);
            if (!component.rxnName) throw new Error(`Madde ${index + 1} için Rxn adı zorunludur.`);
            if (!(Number(component.quantity) > 0)) throw new Error(`Madde ${index + 1} için miktar 0'dan büyük olmalıdır.`);
        });

        return normalizedProduct;
    }

    classifyUnitToFormat(unit) {
        const normalizedUnit = String(unit || '')
            .trim()
            .toLocaleUpperCase('tr')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace('TÜP', 'TUP')
            .replace('TÜP (MIC)', 'TUP (MIC)');

        if (!normalizedUnit) return '';
        if (normalizedUnit === 'STRIP MIC' || normalizedUnit === 'TUP (MIC)' || normalizedUnit === 'TUP(MIC)') return 'vCAP';
        if (normalizedUnit === 'STRIP BIO') return 'Liyofilize';
        if (normalizedUnit === 'TUP' || normalizedUnit === 'UL') return 'Tup';
        return '';
    }

    inferProductFormat(components = []) {
        if ((components || []).length >= 3) return 'Kutu';
        const formats = [...new Set((components || []).map(component => String(component.format || '').trim()).filter(Boolean))];
        if (formats.length === 1) return formats[0];
        if (formats.length > 1) return 'Karma';
        return '';
    }

    resolveCatalogFormat(components = [], fallbackFormat = '') {
        if ((components || []).length >= 3) return 'Kutu';
        return String(fallbackFormat || this.inferProductFormat(components) || '').trim();
    }

    setExcelComponents(components) {
        this.productTreeData = [];
        this.productTreeIndex = {};
        this.componentIndex = {};
        this.manualProducts = [];

        components.forEach(component => {
            this.addComponentToIndexes({
                id: component.id || `excel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                productTreeNo: String(component.productTreeNo || '').trim().toUpperCase(),
                productDescription: String(component.productDescription || '').trim(),
                type: component.type || '',
                componentNo: String(component.componentNo || '').trim().toUpperCase(),
                description: String(component.description || '').trim(),
                quantity: Number(component.quantity) || 1,
                unit: component.unit || '',
                scrapPercent: Number(component.scrapPercent) || 0,
                hmNo: String(component.hmNo || '').trim().toUpperCase(),
                format: this.classifyUnitToFormat(component.unit) || String(component.format || '').trim(),
                source: component.source === 'manual' ? 'manual' : 'excel'
            });
        });

        this.loadManualProductsFromStorage();
        this.syncToLegacyProductTree();
        this.isLoaded = this.productTreeData.length > 0;
    }

    async loadExcelFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    await ensureSheetJs();
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames.includes('Ürün Ağaçları') ? 'Ürün Ağaçları' : workbook.SheetNames[0];
                    const firstSheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(firstSheet);

                    this.processExcelData(jsonData);
                    this.isLoaded = this.productTreeData.length > 0;

                    showToast(`${this.productTreeData.length} bileşen yüklendi!`, 'success');
                    resolve(this.productTreeData.length);
                } catch (error) {
                    showToast('Excel yükleme hatası: ' + error.message, 'error');
                    reject(error);
                }
            };

            reader.onerror = () => {
                    showToast('Dosya okunamadı', 'error');
                    reject(new Error('Dosya okunamadı'));
            };

            reader.readAsArrayBuffer(file);
        });
    }

    processExcelData(jsonData) {
        const excelComponents = [];

        jsonData.forEach((row, index) => {
            const productTreeNo = this.getRowValue(row, ['Ürün Ağacı No', 'Urun Agaci No']);
            const componentNo = this.getRowValue(row, ['Bileşen No', 'No']);

            if (!productTreeNo && !componentNo) return;

            const unitValue = this.getRowValue(row, ['Ölçü Birimi', 'Ölçü Birimi Kodu', 'Olcu Birimi Kodu']);
            const formatValue = this.classifyUnitToFormat(unitValue) || 'Karşılığı Olmayan Ürünler';

            const component = {
                id: `excel-${index}`,
                productTreeNo,
                productDescription: this.getRowValue(row, ['Ürün Açıklaması', 'Urun Aciklamasi']),
                type: this.getRowValue(row, ['Tür', 'Tur']),
                componentNo,
                description: this.getRowValue(row, ['Bileşen Açıklaması', 'Açıklama', 'Aciklama']),
                quantity: parseFloat(this.getRowValue(row, ['Miktar', 'Miktar esası', 'Miktar esasi'])) || 1,
                unit: unitValue,
                scrapPercent: parseFloat(this.getRowValue(row, ['Iskarta %'])) || 0,
                hmNo: this.getRowValue(row, ['HM No']),
                format: formatValue,
                source: 'excel'
            };

            excelComponents.push(component);
        });

        this.setExcelComponents(excelComponents);
    }

    getRowValue(row, keys) {
        for (const key of keys) {
            if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
                return String(row[key]).trim();
            }
        }
        return '';
    }

    createUnitLookupFromLegacyTree(tree) {
        const lookup = new Map();
        if (!tree || typeof tree !== 'object') return lookup;

        Object.entries(tree).forEach(([catalogNo, components]) => {
            const normalizedCatalogNo = String(catalogNo || '').trim().toUpperCase();
            if (!normalizedCatalogNo || !Array.isArray(components)) return;

            components.forEach(component => {
                const materialNo = String(component?.materialNo || '').trim().toUpperCase();
                const unit = String(component?.unit || '').trim();
                if (!materialNo || !unit) return;
                lookup.set(`${normalizedCatalogNo}::${materialNo}`, unit);
            });
        });

        return lookup;
    }

    isMissingUnitValue(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return !normalized || normalized === '-' || normalized === '—' || normalized === 'null' || normalized === 'undefined';
    }

    backfillMissingUnitsFromLookup(lookup = this.bootstrapUnitLookup) {
        if (!(lookup instanceof Map) || lookup.size === 0 || !Array.isArray(this.productTreeData)) {
            return 0;
        }

        let patchedCount = 0;
        this.productTreeData = this.productTreeData.map(component => {
            const existingUnit = String(component?.unit || '').trim();
            if (!this.isMissingUnitValue(existingUnit)) return component;

            const productTreeNo = String(component?.productTreeNo || '').trim().toUpperCase();
            const componentNo = String(component?.componentNo || '').trim().toUpperCase();
            if (!productTreeNo || !componentNo) return component;

            const fallbackUnit = lookup.get(`${productTreeNo}::${componentNo}`) || '';
            if (!fallbackUnit) return component;

            patchedCount += 1;
            return {
                ...component,
                unit: fallbackUnit,
                format: component.format || this.classifyUnitToFormat(fallbackUnit) || ''
            };
        });

        if (patchedCount > 0) {
            this.rebuildIndexes();
            this.saveToStorage();
            this.syncToLegacyProductTree();
        }

        return patchedCount;
    }

    normalizeComponentFormatsByUnit() {
        if (!Array.isArray(this.productTreeData) || this.productTreeData.length === 0) return 0;

        let patchedCount = 0;
        this.productTreeData = this.productTreeData.map(component => {
            const expectedFormat = this.classifyUnitToFormat(component?.unit || '');
            if (!expectedFormat) return component;

            const currentFormat = String(component?.format || '').trim();
            if (currentFormat === expectedFormat) return component;

            patchedCount += 1;
            return {
                ...component,
                format: expectedFormat
            };
        });

        if (patchedCount > 0) {
            this.rebuildIndexes();
            this.saveToStorage();
            this.syncToLegacyProductTree();
        }

        return patchedCount;
    }

    addComponentToIndexes(component) {
        component._searchIndex = this.buildComponentSearchIndex(component);
        this.productTreeData.push(component);
        this.invalidateManagedProductsCache();

        if (component.productTreeNo) {
            if (!this.productTreeIndex[component.productTreeNo]) {
                this.productTreeIndex[component.productTreeNo] = [];
            }
            this.productTreeIndex[component.productTreeNo].push(component);
        }

        if (component.componentNo) {
            if (!this.componentIndex[component.componentNo]) {
                this.componentIndex[component.componentNo] = [];
            }
            this.componentIndex[component.componentNo].push(component);
        }
    }

    createManualComponent(product, component, index) {
        return {
            id: `manual-${product.catalogNo}-${index}`,
            productTreeNo: product.catalogNo,
            productDescription: product.productDescription || '',
            type: 'Manuel Tanım',
            componentNo: component.materialNo,
            description: component.rxnName,
            quantity: Number(component.quantity) || 1,
            unit: component.unit || '',
            scrapPercent: 0,
            hmNo: product.hmNo || '',
            format: component.format || this.classifyUnitToFormat(component.unit) || product.format || '',
            'Kuyucuk Sayısı': component['Kuyucuk Sayısı'] ?? product['Kuyucuk Sayısı'] ?? '',
            source: 'manual'
        };
    }

    addManualProduct(product) {
        const normalizedProduct = {
            catalogNo: String(product.catalogNo || '').trim().toUpperCase(),
            hmNo: String(product.hmNo || '').trim().toUpperCase(),
            format: String(product.format || '').trim(),
            createdAt: product.createdAt || new Date().toISOString(),
            components: Array.isArray(product.components) ? product.components.map((component, index) => ({
                id: component.id || `manual-component-${Date.now()}-${index}`,
                materialNo: String(component.materialNo || '').trim().toUpperCase(),
                rxnName: String(component.rxnName || '').trim(),
                quantity: Number(component.quantity) || 1
            })) : []
        };

        if (!normalizedProduct.catalogNo) {
            throw new Error('Ürün katalog numarası zorunludur.');
        }

        if (!normalizedProduct.hmNo) {
            throw new Error('Ürün HM numarası zorunludur.');
        }

        if (!normalizedProduct.format) {
            throw new Error('Format türü zorunludur.');
        }

        if (normalizedProduct.components.length === 0) {
            throw new Error('En az bir bileşen eklemelisiniz.');
        }

        normalizedProduct.components.forEach((component, index) => {
            if (!component.materialNo) {
                throw new Error(`Madde ${index + 1} için madde no zorunludur.`);
            }

            if (!component.rxnName) {
                throw new Error(`Madde ${index + 1} için Rxn adı zorunludur.`);
            }

            if (!(Number(component.quantity) > 0)) {
                throw new Error(`Madde ${index + 1} için miktar 0'dan büyük olmalıdır.`);
            }
        });

        this.removeManualProduct(normalizedProduct.catalogNo, false);
        this.manualProducts.push(normalizedProduct);

        normalizedProduct.components.forEach((component, index) => {
            this.addComponentToIndexes(this.createManualComponent(normalizedProduct, component, index));
        });

        this.saveManualProductsToStorage();
        this.syncToLegacyProductTree();
        this.isLoaded = this.productTreeData.length > 0;

        return normalizedProduct;
    }

    removeManualProduct(catalogNo, persist = true) {
        const normalizedCatalogNo = String(catalogNo || '').trim().toUpperCase();
        if (!normalizedCatalogNo) return;

        const before = this.manualProducts.length;
        this.manualProducts = this.manualProducts.filter(product => product.catalogNo !== normalizedCatalogNo);
        if (before === this.manualProducts.length) return;

        this.productTreeData = this.productTreeData.filter(component => {
            return !(component.source === 'manual' && String(component.productTreeNo || '').toUpperCase() === normalizedCatalogNo);
        });

        this.rebuildIndexes();

        if (persist) {
            this.saveManualProductsToStorage();
            this.syncToLegacyProductTree();
        }
    }

    rebuildIndexes() {
        this.productTreeIndex = {};
        this.componentIndex = {};
        this.invalidateManagedProductsCache();

        this.productTreeData.forEach(component => {
            component._searchIndex = this.buildComponentSearchIndex(component);
            if (component.productTreeNo) {
                if (!this.productTreeIndex[component.productTreeNo]) {
                    this.productTreeIndex[component.productTreeNo] = [];
                }
                this.productTreeIndex[component.productTreeNo].push(component);
            }

            if (component.componentNo) {
                if (!this.componentIndex[component.componentNo]) {
                    this.componentIndex[component.componentNo] = [];
                }
                this.componentIndex[component.componentNo].push(component);
            }
        });

        this.isLoaded = this.productTreeData.length > 0;
    }

    saveManualProductsToStorage() {
        localStorage.setItem(this.manualStorageKey, JSON.stringify(this.manualProducts));
    }

    loadManualProductsFromStorage() {
        try {
            const saved = localStorage.getItem(this.manualStorageKey);
            if (!saved) return;

            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed)) return;

            parsed.forEach(product => {
                const normalizedProduct = {
                    catalogNo: String(product.catalogNo || '').trim().toUpperCase(),
                    hmNo: String(product.hmNo || '').trim().toUpperCase(),
                    format: String(product.format || '').trim(),
                    createdAt: product.createdAt || new Date().toISOString(),
                    components: Array.isArray(product.components) ? product.components.map((component, index) => ({
                        id: component.id || `manual-component-loaded-${index}`,
                        materialNo: String(component.materialNo || '').trim().toUpperCase(),
                        rxnName: String(component.rxnName || '').trim(),
                        quantity: Number(component.quantity) || 1
                    })) : []
                };

                if (!normalizedProduct.catalogNo || normalizedProduct.components.length === 0) return;

                this.manualProducts.push(normalizedProduct);
                normalizedProduct.components.forEach((component, index) => {
                    this.addComponentToIndexes(this.createManualComponent(normalizedProduct, component, index));
                });
            });
        } catch (error) {
            console.error('Manuel ürünler yüklenemedi:', error);
        }
    }

    syncToLegacyProductTree() {
        if (!window.productTree) {
            window.productTree = {};
        }

        const previousManualKeys = Array.isArray(window._manualProductTreeKeys) ? window._manualProductTreeKeys : [];
        previousManualKeys.forEach(key => {
            delete window.productTree[key];
        });
        window._manualProductTreeKeys = [];

        this.manualProducts.forEach(product => {
            window.productTree[product.catalogNo] = product.components.map(component => ({
                materialNo: component.materialNo,
                rxnName: component.rxnName,
                multiplier: Number(component.quantity) || 1,
                format: product.format,
                hmNo: product.hmNo || ''
            }));
            window._manualProductTreeKeys.push(product.catalogNo);

            product.components.forEach(component => {
                window.productTree[component.materialNo] = [{
                    materialNo: component.materialNo,
                    rxnName: component.rxnName,
                    multiplier: Number(component.quantity) || 1,
                    format: product.format,
                    hmNo: product.hmNo || ''
                }];
                window._manualProductTreeKeys.push(component.materialNo);
            });
        });
    }

    getComponentsByProductTreeNo(productTreeNo) {
        const normalized = String(productTreeNo).trim().toUpperCase();
        let components = this.productTreeIndex[normalized];

        if (!components) {
            const key = Object.keys(this.productTreeIndex).find(item => item.toUpperCase() === normalized);
            components = key ? this.productTreeIndex[key] : null;
        }

        return components || [];
    }

    getComponentByNo(componentNo) {
        const normalized = String(componentNo).trim().toUpperCase();
        let components = this.componentIndex[normalized];

        if (!components) {
            const key = Object.keys(this.componentIndex).find(item => item.toUpperCase() === normalized);
            components = key ? this.componentIndex[key] : null;
        }

        return components ? components[0] : null;
    }

    search(searchTerm) {
        const normalized = String(searchTerm).trim().toUpperCase();
        const components = this.getComponentsByProductTreeNo(normalized);

        if (components.length > 0) {
            return {
                type: 'product_tree',
                searchTerm,
                components
            };
        }

        const component = this.getComponentByNo(normalized);
        if (component) {
            return {
                type: 'component',
                searchTerm,
                components: [component]
            };
        }

        const partialMatches = this.searchPartial(normalized);
        if (partialMatches.length > 0) {
            return {
                type: 'partial',
                searchTerm,
                components: partialMatches
            };
        }

        return {
            type: 'not_found',
            searchTerm,
            components: []
        };
    }

    searchPartial(searchTerm) {
        const normalized = this.normalizeSearchText(searchTerm);
        return this.productTreeData.filter(component => String(component._searchIndex || '').includes(normalized));
    }

    getSuggestions(searchTerm, limit = 10) {
        const normalized = searchTerm.toUpperCase();
        const suggestions = [];

        Object.keys(this.productTreeIndex).forEach(key => {
            if (key.toUpperCase().includes(normalized)) {
                const components = this.productTreeIndex[key];
                suggestions.push({
                    type: 'product_tree',
                    value: key,
                    label: `${key} (${components.length} bileşen)`,
                    count: components.length
                });
            }
        });

        Object.keys(this.componentIndex).forEach(key => {
            if (key.toUpperCase().includes(normalized)) {
                const component = this.componentIndex[key][0];
                suggestions.push({
                    type: 'component',
                    value: key,
                    label: `${key} - ${component.description}`,
                    description: component.description
                });
            }
        });

        return suggestions.slice(0, limit);
    }

    getExcelExportRows() {
        const rows = [];
        this.getManagedProducts().forEach(product => {
            (product.components || []).forEach((component, index) => {
                rows.push({
                    'Ürün Ağacı No': product.catalogNo || '',
                    'Ağaç Tipi': product.source === 'manual' ? 'Manuel' : 'Ana Ürün',
                    'Satır No': index + 1,
                    'Bileşen No': component.materialNo || '',
                    'Bileşen Açıklaması': component.rxnName || '',
                    'Miktar': Number(component.quantity) || 1,
                    'Format': component.format || product.format || '',
                    'Ölçü Birimi': component.unit || '',
                    'Ürün Açıklaması': product.productDescription || ''
                });
            });
        });
        return rows;
    }

    createOrdersFromSearch(searchResult, requestedQuantity, orderData) {
        return searchResult.components.map(component => ({
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            weekNumber: orderData.weekNumber || '',
            requestDate: orderData.requestDate || new Date().toISOString().split('T')[0],
            requester: orderData.requester || 'Sistem',
            catalogNo: searchResult.searchTerm,
            materialNo: component.componentNo || '',
            rxnName: component.description || '',
            format: orderData.format || 'Bulk',
            quantity: Math.ceil(requestedQuantity * component.quantity),
            productionOrderNo: orderData.productionOrderNo || '',
            producedQty: '',
            orderNo: orderData.orderNo || '',
            deliveryDate: orderData.deliveryDate || '',
            requesterNote: orderData.requesterNote || `Ürün Ağacı: ${searchResult.type}`,
            lotNo: '',
            producerNote: '',
            status: '-',
            producer: '',
            qcApprover: '',
            _excelData: {
                productTreeNo: component.productTreeNo,
                type: component.type,
                unit: component.unit,
                scrapPercent: component.scrapPercent,
                baseQuantity: component.quantity,
                searchType: searchResult.type,
                hmNo: component.hmNo || ''
            }
        }));
    }

    saveToStorage() {
        try {
            const excelDataOnly = this.productTreeData.filter(component => component.source !== 'manual');
            localStorage.setItem(this.storageKey, JSON.stringify({
                data: excelDataOnly,
                loadedAt: new Date().toISOString()
            }));
            return true;
        } catch (error) {
            if (error && (error.name === 'QuotaExceededError' || error.code === 22)) {
                try {
                    localStorage.removeItem(this.storageKey);
                } catch (_) {}
                console.warn('Ürün ağacı localStorage kotası dolu; büyük ürün ağacı cachelenmeden kullanılacak.', error);
                return false;
            }
            console.error('Kaydetme hatası:', error);
            return false;
        }
    }

    loadFromStorage() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                const savedData = Array.isArray(parsed.data) ? parsed.data : [];
                if (savedData.length > 0) {
                    if (savedData[0].productTreeNo !== undefined || savedData[0].componentNo !== undefined) {
                        this.setExcelComponents(savedData.filter(component => component.source !== 'manual'));
                    } else {
                        this.processExcelData(savedData);
                    }
                }

                if (this.isLoaded) {
                    return this.isLoaded;
                }
            }

            if (this.importLegacyProductTree()) {
                return this.isLoaded;
            }

            this.setExcelComponents([]);
            return this.isLoaded;
        } catch (error) {
            console.error('Yükleme hatası:', error);
            return false;
        }
    }

    clear() {
        this.replaceAllManagedProducts([], { skipCloud: false, reason: 'clear_product_trees' });
    }

    addManualProduct(product) {
        const normalizedProduct = this.normalizeManagedProduct({ ...product, source: 'manual' });
        this.removeProduct(normalizedProduct.catalogNo, false);
        this.manualProducts.push(normalizedProduct);

        normalizedProduct.components.forEach((component, index) => {
            this.addComponentToIndexes(this.createManualComponent(normalizedProduct, component, index));
        });

        this.saveManualProductsToStorage();
        this.saveToStorage();
        this.syncToLegacyProductTree();
        this.isLoaded = this.productTreeData.length > 0;
        return normalizedProduct;
    }

    importLegacyProductTree() {
        if (!window.productTree || Object.keys(window.productTree).length === 0) return false;

        const excelComponents = [];
        Object.entries(window.productTree).forEach(([productTreeNo, components]) => {
            if (!Array.isArray(components)) return;

            components.forEach((component, index) => {
                excelComponents.push({
                    id: `legacy-${productTreeNo}-${index}`,
                    productTreeNo,
                    productDescription: (window.productTreeDescriptions && window.productTreeDescriptions[productTreeNo]) || component.productDescription || '',
                    type: 'Legacy Import',
                    componentNo: component.materialNo || '',
                    description: component.rxnName || '',
                    quantity: Number(component.multiplier) || 1,
                    unit: component.unit || '',
                    scrapPercent: Number(component.scrapPercent) || 0,
                    hmNo: component.hmNo || '',
                    format: component.format || '',
                    source: 'excel'
                });
            });
        });

        if (excelComponents.length === 0) return false;
        this.setExcelComponents(excelComponents);
        this.saveToStorage();
        return true;
    }

    replaceAllManagedProducts(products = [], options = {}) {
        const previousComponentMeta = new Map(
            (Array.isArray(this.productTreeData) ? this.productTreeData : []).map(component => ([
                `${String(component.productTreeNo || '').trim().toUpperCase()}::${String(component.componentNo || '').trim().toUpperCase()}`,
                {
                    unit: String(component.unit || '').trim(),
                    format: String(component.format || '').trim()
                }
            ]))
        );

        this.productTreeData = [];
        this.productTreeIndex = {};
        this.componentIndex = {};
        this.manualProducts = [];

        (products || []).forEach((product, productIndex) => {
            let normalizedProduct = null;
            try {
                normalizedProduct = this.normalizeManagedProduct(product);
            } catch (error) {
                console.warn('Geçersiz ürün ağacı kaydı atlandı:', error?.message || error, product);
                return;
            }

            if (!normalizedProduct.catalogNo) return;

            if (normalizedProduct.source === 'manual') {
                this.manualProducts.push(normalizedProduct);
                normalizedProduct.components.forEach((component, index) => {
                    this.addComponentToIndexes(this.createManualComponent(normalizedProduct, component, index));
                });
                return;
            }

            normalizedProduct.components.forEach((component, index) => {
                const componentMetaKey = `${normalizedProduct.catalogNo}::${String(component.materialNo || '').trim().toUpperCase()}`;
                const previousMeta = previousComponentMeta.get(componentMetaKey) || {};
                const fallbackUnit = this.bootstrapUnitLookup.get(componentMetaKey) || '';
                const componentUnit = this.isMissingUnitValue(component.unit) ? '' : String(component.unit || '').trim();
                const previousUnit = this.isMissingUnitValue(previousMeta.unit) ? '' : String(previousMeta.unit || '').trim();
                const resolvedUnit = componentUnit || previousUnit || fallbackUnit || '';
                this.addComponentToIndexes({
                    id: component.id || `cloud-excel-${productIndex}-${index}`,
                    productTreeNo: normalizedProduct.catalogNo,
                    productDescription: normalizedProduct.productDescription || '',
                    type: product.type || 'Cloud Senkron',
                    componentNo: component.materialNo,
                    description: component.rxnName,
                    quantity: Number(component.quantity) || 1,
                    unit: resolvedUnit,
                    scrapPercent: 0,
                    hmNo: normalizedProduct.hmNo || '',
                    format: component.format || previousMeta.format || this.classifyUnitToFormat(resolvedUnit) || normalizedProduct.format || '',
                    'Kuyucuk Sayısı': component['Kuyucuk Sayısı'] ?? normalizedProduct['Kuyucuk Sayısı'] ?? '',
                    kuyucukSayisiKaynak: normalizedProduct.kuyucukSayisiKaynak || '',
                    source: 'excel'
                });
            });
        });

        this.rebuildIndexes();
        this.saveManualProductsToStorage();
        this.saveToStorage();
        this.syncToLegacyProductTree();

        if (!options.skipCloud && typeof firebaseSync !== 'undefined' && firebaseReady && firebaseSync.productTreesRef) {
            firebaseSync.syncProductTrees(this.getManagedProducts(), { reason: options.reason || 'replace_all_product_trees' })
                .catch(error => console.warn('Ürün ağacı cloud sync hatası:', error));
        }

        return this.getManagedProducts();
    }

    removeProduct(catalogNo, persist = true) {
        const normalizedCatalogNo = String(catalogNo || '').trim().toUpperCase();
        if (!normalizedCatalogNo) return;

        this.manualProducts = this.manualProducts.filter(product => product.catalogNo !== normalizedCatalogNo);
        this.productTreeData = this.productTreeData.filter(component =>
            String(component.productTreeNo || '').trim().toUpperCase() !== normalizedCatalogNo
        );
        this.rebuildIndexes();

        if (persist) {
            this.saveManualProductsToStorage();
            this.saveToStorage();
            this.syncToLegacyProductTree();
            if (typeof firebaseSync !== 'undefined' && firebaseReady && firebaseSync.productTreesRef) {
                firebaseSync.syncProductTrees(this.getManagedProducts(), { reason: 'remove_product_tree' })
                    .catch(error => console.warn('Ürün ağacı silme sync hatası:', error));
            }
        }
    }

    upsertProduct(product, options = {}) {
        const normalizedProduct = this.normalizeManagedProduct(product);
        const originalCatalogNo = String(options.originalCatalogNo || normalizedProduct.catalogNo).trim().toUpperCase();

        this.removeProduct(originalCatalogNo, false);
        if (originalCatalogNo !== normalizedProduct.catalogNo) {
            this.removeProduct(normalizedProduct.catalogNo, false);
        }

        if (normalizedProduct.source === 'manual') {
            this.manualProducts.push(normalizedProduct);
            normalizedProduct.components.forEach((component, index) => {
                this.addComponentToIndexes(this.createManualComponent(normalizedProduct, component, index));
            });
        } else {
            normalizedProduct.components.forEach((component, index) => {
                this.addComponentToIndexes({
                    id: component.id || `excel-edit-${normalizedProduct.catalogNo}-${index}`,
                    productTreeNo: normalizedProduct.catalogNo,
                    productDescription: normalizedProduct.productDescription || '',
                    type: 'Excel Düzenleme',
                    componentNo: component.materialNo,
                    description: component.rxnName,
                    quantity: Number(component.quantity) || 1,
                    unit: component.unit || '',
                    scrapPercent: 0,
                    hmNo: normalizedProduct.hmNo || '',
                    format: component.format || normalizedProduct.format || '',
                    'Kuyucuk Sayısı': component['Kuyucuk Sayısı'] ?? normalizedProduct['Kuyucuk Sayısı'] ?? '',
                    kuyucukSayisiKaynak: normalizedProduct.kuyucukSayisiKaynak || '',
                    source: 'excel'
                });
            });
        }

        this.rebuildIndexes();
        this.saveManualProductsToStorage();
        this.saveToStorage();
        this.syncToLegacyProductTree();
        if (typeof firebaseSync !== 'undefined' && firebaseReady && firebaseSync.productTreesRef) {
            firebaseSync.syncProductTrees(this.getManagedProducts(), { reason: 'upsert_product_tree' })
                .catch(error => console.warn('Ürün ağacı kaydetme sync hatası:', error));
        }
        return normalizedProduct;
    }

    syncToLegacyProductTree() {
        const nextProductTree = {};
        this.productTreeData.forEach(component => {
            const productTreeNo = String(component.productTreeNo || '').trim().toUpperCase();
            const materialNo = String(component.componentNo || '').trim().toUpperCase();
            const normalizedComponent = {
                materialNo,
                rxnName: component.description || '',
                multiplier: Number(component.quantity) || 1,
                format: component.format || '',
                unit: component.unit || '',
                productDescription: component.productDescription || '',
                hmNo: component.hmNo || ''
            };

            if (productTreeNo) {
                if (!nextProductTree[productTreeNo]) nextProductTree[productTreeNo] = [];
                nextProductTree[productTreeNo].push(normalizedComponent);
            }

            if (materialNo && !nextProductTree[materialNo]) {
                nextProductTree[materialNo] = [normalizedComponent];
            }
        });

        window.productTree = nextProductTree;
        window.productTreeDescriptions = {};
        this.productTreeData.forEach(component => {
            const productTreeNo = String(component.productTreeNo || '').trim().toUpperCase();
            if (productTreeNo && window.productTreeDescriptions[productTreeNo] === undefined) {
                window.productTreeDescriptions[productTreeNo] = component.productDescription || '';
            }
        });
    }

    getManagedProducts() {
        if (Array.isArray(this.managedProductsCache)) {
            return this.managedProductsCache.map(product => ({
                ...product,
                components: product.components.map(component => ({ ...component }))
            }));
        }

        const manualMap = new Map(this.manualProducts.map(product => [product.catalogNo, {
            ...product,
            format: this.resolveCatalogFormat(product.components, product.format),
            source: 'manual',
            components: product.components.map(component => ({ ...component }))
        }]));

        const excelMap = new Map();
        this.productTreeData
            .filter(component => component.source !== 'manual')
            .forEach(component => {
                const catalogNo = String(component.productTreeNo || '').trim().toUpperCase();
                if (!catalogNo) return;

                if (!excelMap.has(catalogNo)) {
                    excelMap.set(catalogNo, {
                        catalogNo,
                        productDescription: component.productDescription || '',
                        hmNo: component.hmNo || '',
                        format: component.format || '',
                        source: 'excel',
                        createdAt: '',
                        'Kuyucuk Sayısı': component['Kuyucuk Sayısı'] ?? '',
                        kuyucukSayisiKaynak: component.kuyucukSayisiKaynak || '',
                        components: []
                    });
                }

                const product = excelMap.get(catalogNo);
                if (!product.productDescription && component.productDescription) product.productDescription = component.productDescription;
                if (!product.hmNo && component.hmNo) product.hmNo = component.hmNo;
                if (!product.format && component.format) product.format = component.format;
                if ((product['Kuyucuk Sayısı'] === undefined || product['Kuyucuk Sayısı'] === null || String(product['Kuyucuk Sayısı']).trim() === '') && component['Kuyucuk Sayısı'] !== undefined) {
                    product['Kuyucuk Sayısı'] = component['Kuyucuk Sayısı'];
                }
                product.components.push({
                    id: component.id,
                    materialNo: component.componentNo || '',
                    rxnName: component.description || '',
                    quantity: Number(component.quantity) || 1,
                    unit: component.unit || '',
                    format: component.format || '',
                    'Kuyucuk Sayısı': component['Kuyucuk Sayısı'] ?? ''
                });
            });

        excelMap.forEach(product => {
            product.format = this.resolveCatalogFormat(product.components, product.format);
        });

        this.managedProductsCache = [...excelMap.values(), ...manualMap.values()]
            .map(product => ({
                ...product,
                _searchIndex: this.buildManagedProductSearchIndex(product)
            }))
            .sort((a, b) => a.catalogNo.localeCompare(b.catalogNo, 'tr'));

        return this.managedProductsCache.map(product => ({
            ...product,
            components: product.components.map(component => ({ ...component }))
        }));
    }

    getManagedProduct(catalogNo) {
        const normalizedCatalogNo = String(catalogNo || '').trim().toUpperCase();
        return this.getManagedProducts().find(product => product.catalogNo === normalizedCatalogNo) || null;
    }

    loadFromStorage() {
        // 1. Önce localStorage'dan yüklemeyi dene
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                const savedData = Array.isArray(parsed.data) ? parsed.data : [];
                if (savedData.length > 0) {
                    if (savedData[0].productTreeNo !== undefined || savedData[0].componentNo !== undefined) {
                        this.setExcelComponents(savedData.filter(component => component.source !== 'manual'));
                    } else {
                        this.processExcelData(savedData);
                    }
                }

                const patchedCount = this.backfillMissingUnitsFromLookup();
                if (patchedCount > 0) {
                    console.log(`Eksik ölçü birimi otomatik dolduruldu: ${patchedCount} bileşen`);
                }

                const formatPatchedCount = this.normalizeComponentFormatsByUnit();
                if (formatPatchedCount > 0) {
                    console.log(`Ölçü birimine göre format düzeltildi: ${formatPatchedCount} bileşen`);
                }

                if (this.isLoaded) {
                    console.log('Ürün ağacı localStorage\'dan yüklendi:', this.productTreeData.length, 'bileşen');
                    return this.isLoaded;
                }
            }
        } catch (error) {
            console.warn('localStorage yükleme hatası, gömülü veriye dönülüyor:', error);
        }

        // 2. localStorage boş/hatalıysa product_tree.js gömülü verisinden yükle
        try {
            if (this.importLegacyProductTree()) {
                console.log('Ürün ağacı product_tree.js\'den yüklendi:', this.productTreeData.length, 'bileşen');
                return this.isLoaded;
            }
        } catch (error) {
            console.error('product_tree.js import hatası:', error);
        }

        // 3. Hiçbir kaynak bulunamadı
        console.warn('⚠ Ürün ağacı verisi bulunamadı. window.productTree:', typeof window.productTree, window.productTree ? Object.keys(window.productTree).length + ' ürün' : 'tanımsız');
        this.setExcelComponents([]);
        return this.isLoaded;
    }

    getStats() {
        return {
            totalComponents: this.productTreeData.length,
            totalProductTrees: Object.keys(this.productTreeIndex).length,
            totalUniqueComponents: Object.keys(this.componentIndex).length,
            totalManualProducts: this.manualProducts.length,
            isLoaded: this.isLoaded
        };
    }

    getManualProducts() {
        return [...this.manualProducts];
    }
}

const productTreeExcel = new ProductTreeExcelManager();

document.addEventListener('DOMContentLoaded', () => {
    productTreeExcel.loadFromStorage();

    // Sayfa yüklendiğinde ürün ağacı listesini render et
    // (product-tree-ui.js daha önce yüklendiği için fonksiyonlar mevcut)
    if (typeof renderManagedProductsList === 'function') {
        renderManagedProductsList();
    }
    if (typeof updateProductTreeStats === 'function') {
        updateProductTreeStats();
    }
});
