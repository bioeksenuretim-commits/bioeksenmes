/**
 * Backup & Export Module - Veri yedekleme ve dışa aktarma
 * JSON, Excel, CSV export desteği
 */

class BackupManager {
    constructor(storageManager) {
        this.storage = storageManager;
    }

    /**
     * JSON olarak indir
     */
    async downloadJSON() {
        try {
            const requestOrders = await this.getRequestOrdersForBackup();
            const salesPayload = await this.getSalesLinesPayloadForBackup();
            const salesOrders = Array.isArray(salesPayload?.allOrders) ? salesPayload.allOrders : [];
            const jsonString = JSON.stringify({
                version: '2.0',
                exportDate: new Date().toISOString(),
                totalOrders: requestOrders.length,
                totalSalesLines: salesOrders.length,
                orders: requestOrders,
                salesLines: salesPayload || { allOrders: [], editedLog: {} }
            }, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `reaksiyon_backup_${this.getDateString()}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);

            showToast('JSON yedekleme başarıyla indirildi', 'success');
            return true;
        } catch (error) {
            showToast('JSON indirme hatası: ' + error.message, 'error');
            return false;
        }
    }

    /**
     * JSON dosyasından yükle
     */
    async uploadJSON(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const count = await this.storage.importFromJSON(e.target.result);
                    showToast(`${count} sipariş başarıyla içe aktarıldı`, 'success');
                    resolve(count);
                } catch (error) {
                    showToast('JSON yükleme hatası: ' + error.message, 'error');
                    reject(error);
                }
            };

            reader.onerror = () => {
                showToast('Dosya okunamadı', 'error');
                reject(new Error('Dosya okunamadı'));
            };

            reader.readAsText(file);
        });
    }

    /**
     * Excel olarak indir
     */
    async downloadExcel() {
        try {
            await ensureSheetJs();
            const requestOrders = await this.getRequestOrdersForBackup();
            const salesPayload = await this.getSalesLinesPayloadForBackup();
            const salesOrders = Array.isArray(salesPayload?.allOrders) ? salesPayload.allOrders : [];
            const salesChanges = salesPayload?.editedLog || {};

            if (requestOrders.length === 0 && salesOrders.length === 0) {
                showToast('Dışa aktarılacak veri yok', 'warning');
                return false;
            }

            const wb = XLSX.utils.book_new();

            this.appendGroupedRequestSheets(wb, requestOrders);
            this.appendGroupedSalesLineSheets(wb, salesOrders);
            this.appendSalesLineChangeSheet(wb, salesOrders, salesChanges);

            if (wb.SheetNames.length === 0) {
                this.appendJsonSheet(wb, 'Yedek', [{ Bilgi: 'Yedeklenecek veri bulunamadı' }]);
            }

            XLSX.writeFile(wb, `reaksiyon_tam_yedek_${this.getDateString()}.xlsx`);

            showToast(`${requestOrders.length} talep ve ${salesOrders.length} satış satırı Excel olarak indirildi`, 'success');
            return true;
        } catch (error) {
            console.error('Excel yedekleme hatası:', error);
            showToast('Excel indirme hatası: ' + error.message, 'error');
            return false;
        }
    }

    async getRequestOrdersForBackup() {
        const liveOrders = Array.isArray(window.orders) ? window.orders : [];
        const sourceOrders = liveOrders.length > 0 ? liveOrders : await this.storage.getAll();
        return sourceOrders.filter(order => order && order.sourceSystem !== 'sales-lines');
    }

    async getSalesLinesPayloadForBackup() {
        const framePayload = this.getSalesLinesPayloadFromFrameForBackup();
        if (Array.isArray(framePayload?.allOrders)) {
            return this.normalizeSalesLinesPayloadForBackup(framePayload);
        }

        const indexedPayload = await this.getSalesLinesPayloadFromIndexedDbForBackup();
        if (Array.isArray(indexedPayload?.allOrders)) {
            return this.normalizeSalesLinesPayloadForBackup(indexedPayload);
        }

        try {
            const raw = localStorage.getItem(this.getSalesLinesStorageKeyForBackup());
            if (!raw) throw new Error('local sales lines marker not found');
            const payload = JSON.parse(raw);
            if (Array.isArray(payload?.allOrders)) {
                return this.normalizeSalesLinesPayloadForBackup(payload);
            }
        } catch (error) {
            console.warn('Satış satırları yedek verisi okunamadı:', error);
        }

        try {
            if (typeof firebaseSync !== 'undefined' && firebaseSync && typeof firebaseSync.getSalesLinesPayload === 'function') {
                const payload = await firebaseSync.getSalesLinesPayload();
                if (Array.isArray(payload?.allOrders)) {
                    return this.normalizeSalesLinesPayloadForBackup(payload);
                }
            }
        } catch (error) {
            console.warn('Sales lines cloud backup data could not be read:', error);
        }

        return { allOrders: [], editedLog: {}, columnOrder: [], meta: {} };
    }

    getSalesLinesPayloadFromFrameForBackup() {
        try {
            const frame = document.getElementById('salesLinesFrame');
            const getter = frame?.contentWindow?.getSalesLinesBackupPayload;
            if (typeof getter !== 'function') return null;
            return getter();
        } catch (error) {
            console.warn('Sales lines frame backup data could not be read:', error);
            return null;
        }
    }

    normalizeSalesLinesPayloadForBackup(payload) {
        return {
            allOrders: Array.isArray(payload?.allOrders) ? payload.allOrders : [],
            editedLog: payload?.editedLog || {},
            columnOrder: Array.isArray(payload?.columnOrder) ? payload.columnOrder : [],
            meta: payload?.meta || {}
        };
    }

    getSalesLinesStorageKeyForBackup() {
        return this.isTestLocalSessionForBackup()
            ? 'reaksiyon_test_sales_lines_data_v1'
            : 'reaksiyon_sales_lines_data_v1';
    }

    getSalesLinesCacheDbNameForBackup() {
        return this.isTestLocalSessionForBackup()
            ? 'ReaksiyonTestSalesLinesCache'
            : 'ReaksiyonSalesLinesCache';
    }

    isTestLocalSessionForBackup() {
        try {
            const session = JSON.parse(sessionStorage.getItem('reaksiyon_test_session') || 'null');
            return session?.authProvider === 'test-local';
        } catch (_) {
            return false;
        }
    }

    async getSalesLinesPayloadFromIndexedDbForBackup() {
        if (!('indexedDB' in window)) return null;

        return new Promise(resolve => {
            const request = indexedDB.open(this.getSalesLinesCacheDbNameForBackup(), 1);
            request.onerror = () => resolve(null);
            request.onupgradeneeded = event => {
                event.target.transaction.abort();
                resolve(null);
            };
            request.onsuccess = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('payloads')) {
                    db.close();
                    resolve(null);
                    return;
                }

                const transaction = db.transaction(['payloads'], 'readonly');
                const getRequest = transaction.objectStore('payloads').get('current');
                getRequest.onsuccess = () => {
                    db.close();
                    resolve(getRequest.result?.payload || null);
                };
                getRequest.onerror = () => {
                    db.close();
                    resolve(null);
                };
            };
        });
    }

    appendGroupedRequestSheets(wb, orders) {
        const colFieldMap = this.getRequestExportColumns();
        const userColumns = (typeof currentColumns !== 'undefined' && currentColumns.length > 0)
            ? currentColumns
            : null;

        let orderedCols = userColumns
            ? userColumns.filter(c => colFieldMap[c.id])
            : Object.keys(colFieldMap).map(id => ({ id }));

        if (!orderedCols.find(c => c.id === 'lastModifiedBy')) {
            orderedCols.push({ id: 'lastModifiedBy' });
        }

        const grouped = this.groupByWeek(orders, order => order.weekNumber);
        grouped.forEach(({ week, items }) => {
            const data = items.map(order => {
                const row = {};
                orderedCols.forEach(col => {
                    const map = colFieldMap[col.id];
                    if (map) row[map.label] = map.format ? map.format(order[col.id], order) : (order[col.id] || '');
                });
                return row;
            });
            const widths = orderedCols.map(col => ({ wch: colFieldMap[col.id]?.wch || 12 }));
            this.appendJsonSheet(wb, this.safeSheetName(`Talepler_Hafta_${week}`), data, widths);
        });
    }

    appendGroupedSalesLineSheets(wb, salesOrders) {
        const columns = [
            ['Hafta', 'Hafta', 8],
            ['Temsilci', 'Temsilci', 12],
            ['Sipariş Tarihi', 'Sipariş Tarihi', 13],
            ['Belge Açıklaması', 'Belge Açıklaması', 24],
            ['Belge No', 'Belge No', 15],
            ['Müşteri', 'Müşteri', 24],
            ['Kurum', 'Kurum', 24],
            ['Konum Kodu', 'Konum Kodu', 12],
            ['No', 'No', 16],
            ['Açıklama', 'Açıklama', 28],
            ['Miktar', 'Miktar', 10],
            ['Ölçü Birimi', 'Ölçü Birimi', 12],
            ['Teslim Tarihi', 'Teslim Tarihi', 13],
            ['Lot No', 'Lot No', 16],
            ['Satışın Notları', 'Satışın Notları', 28],
            ['Üretimin Notları', 'Üretimin Notları', 28],
            ['Ürün Durumu', 'Ürün Durumu', 18]
        ];

        const grouped = this.groupByWeek(salesOrders, order => order.Hafta || order['Hafta']);
        grouped.forEach(({ week, items }) => {
            const data = items.map(order => {
                const row = {};
                columns.forEach(([key, label]) => {
                    row[label] = order[key] || '';
                });
                return row;
            });
            const widths = columns.map(([, , wch]) => ({ wch }));
            this.appendJsonSheet(wb, this.safeSheetName(`Satis_Hafta_${week}`), data, widths);
        });
    }

    appendSalesLineChangeSheet(wb, salesOrders, editedLog) {
        const orderMap = new Map((salesOrders || []).map(order => [String(order._id || ''), order]));
        const rows = [];

        Object.entries(editedLog || {}).forEach(([orderId, changes]) => {
            const order = orderMap.get(String(orderId)) || {};
            (Array.isArray(changes) ? changes : []).forEach(change => {
                rows.push({
                    Hafta: order.Hafta || '',
                    'Belge No': order['Belge No'] || '',
                    No: order.No || '',
                    Açıklama: order['Açıklama'] || '',
                    Alan: change?.col || '',
                    Eski: change?.oldVal || '',
                    Yeni: change?.newVal || '',
                    Zaman: change?.time || change?.changedAt || ''
                });
            });
        });

        if (rows.length > 0) {
            this.appendJsonSheet(wb, 'Satis_Degisiklikleri', rows, [
                { wch: 8 }, { wch: 15 }, { wch: 16 }, { wch: 28 },
                { wch: 18 }, { wch: 25 }, { wch: 25 }, { wch: 16 }
            ]);
        }
    }

    getRequestExportColumns() {
        return {
            weekNumber: { label: 'Hafta', wch: 8 },
            requestDate: { label: 'Tarih', wch: 12, format: value => value ? this.formatExportDate(value) : '' },
            materialNo: { label: 'Madde No', wch: 15 },
            rxnName: { label: 'Urun Aciklamasi', wch: 25 },
            format: { label: 'Format', wch: 12 },
            requesterNote: { label: 'Talep Gecen Not', wch: 25 },
            quantity: { label: 'Planlanan Miktar (Rack)', wch: 18 },
            plannedRxnQty: { label: 'Planlanan Miktar (Rxn)', wch: 18 },
            plannedWellQty: { label: 'Planlanan (well)', wch: 16 },
            producer: { label: 'Sorumlu Kisi', wch: 14 },
            plannedStartDate: { label: 'Planlanan Baslangic', wch: 18, format: value => value ? this.formatExportDate(value) : '' },
            plannedEndDate: { label: 'Planlanan Bitis', wch: 16, format: value => value ? this.formatExportDate(value) : '' },
            producedQty: { label: 'Gerceklesen Miktar (Rack)', wch: 20 },
            actualRxnQty: { label: 'Gerceklesen Miktar (Rxn)', wch: 20 },
            actualWellQty: { label: 'Gerceklesen Miktar (well)', wch: 20 },
            productionOrderNo: { label: 'SBUE No', wch: 18 },
            lotNo: { label: 'Lot No', wch: 20 },
            status: { label: 'Durum', wch: 15 },
            qcApprover: { label: 'QC Onaylayan', wch: 14 }
        };
    }
    groupByWeek(items, getWeek) {
        const groups = new Map();
        (items || []).forEach(item => {
            const weekValue = String(getWeek(item) || '').trim() || 'Belirsiz';
            if (!groups.has(weekValue)) groups.set(weekValue, []);
            groups.get(weekValue).push(item);
        });

        return [...groups.entries()]
            .sort(([a], [b]) => {
                const na = Number(a);
                const nb = Number(b);
                if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
                return String(a).localeCompare(String(b), 'tr');
            })
            .map(([week, items]) => ({ week, items }));
    }

    appendJsonSheet(wb, sheetName, data, colWidths = null) {
        const ws = XLSX.utils.json_to_sheet(data.length > 0 ? data : [{ Bilgi: 'Veri yok' }]);
        if (colWidths) ws['!cols'] = colWidths;
        XLSX.utils.book_append_sheet(wb, ws, this.safeSheetName(sheetName, wb));
    }

    safeSheetName(name, wb = null) {
        const base = String(name || 'Sayfa')
            .replace(/[\\/?*[\]:]/g, '_')
            .slice(0, 31) || 'Sayfa';
        if (!wb || !wb.SheetNames.includes(base)) return base;

        let index = 2;
        let candidate = base.slice(0, 28) + '_' + index;
        while (wb.SheetNames.includes(candidate)) {
            index += 1;
            candidate = base.slice(0, 28) + '_' + index;
        }
        return candidate;
    }

    formatExportDate(value) {
        if (!value) return '';
        if (typeof formatDate === 'function') return formatDate(value);
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('tr-TR');
    }

    /**
     * CSV olarak indir
     */
    async downloadCSV() {
        try {
            const requestOrders = await this.getRequestOrdersForBackup();
            const salesPayload = await this.getSalesLinesPayloadForBackup();
            const salesOrders = Array.isArray(salesPayload?.allOrders) ? salesPayload.allOrders : [];

            if (requestOrders.length === 0 && salesOrders.length === 0) {
                showToast('Dışa aktarılacak veri yok', 'warning');
                return false;
            }

            // CSV başlıkları
            const headers = [
                'Kaynak', 'Hafta', 'Talep Tarihi', 'Talep Eden', 'Katalog No', 'Madde No',
                'Rxn Adı', 'Format', 'Talep Miktar', 'Üretim Emri No', 'Üretilen Miktar',
                'Sipariş No', 'Çıkış Tarihi', 'Talep Eden Not', 'Lot No',
                'Üretim Yapan Ekibin Notu', 'Durum', 'Üretici', 'QC Onaylayan'
            ];

            // CSV satırları
            const requestRows = requestOrders.map(order => [
                'Talep',
                order.weekNumber || '',
                order.requestDate || '',
                order.requester || '',
                order.catalogNo || '',
                order.materialNo || '',
                order.rxnName || '',
                order.format || '',
                order.quantity || '',
                order.productionOrderNo || '',
                order.producedQty || '',
                order.orderNo || '',
                order.deliveryDate || '',
                this.escapeCsv(order.requesterNote || ''),
                this.escapeCsv(order.lotNo || ''),
                this.escapeCsv(order.producerNote || ''),
                order.status || '',
                order.producer || '',
                order.qcApprover || ''
            ]);

            // CSV oluştur
            const salesRows = salesOrders.map(order => [
                'Sat\u0131\u015f Sat\u0131r\u0131',
                this.getSalesLineValue(order, ['Hafta']),
                this.getSalesLineValue(order, ['Sipari\u015f Tarihi']),
                this.getSalesLineValue(order, ['Temsilci']),
                this.getSalesLineValue(order, ['No']),
                '',
                this.getSalesLineValue(order, ['A\u00e7\u0131klama']),
                this.getSalesLineValue(order, ['\u00d6l\u00e7\u00fc Birimi']),
                this.getSalesLineValue(order, ['Miktar']),
                '',
                '',
                this.getSalesLineValue(order, ['Belge No']),
                this.getSalesLineValue(order, ['Teslim Tarihi']),
                this.escapeCsv(this.getSalesLineValue(order, ['Sat\u0131\u015f\u0131n Notlar\u0131'])),
                this.escapeCsv(this.getSalesLineValue(order, ['Lot No'])),
                this.escapeCsv(this.getSalesLineValue(order, ['\u00dcretimin Notlar\u0131'])),
                this.getSalesLineValue(order, ['\u00dcr\u00fcn Durumu']),
                this.getSalesLineValue(order, ['Temsilci']),
                ''
            ]);
            const rows = [...requestRows, ...salesRows];

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            // BOM ekle (Türkçe karakter desteği için)
            const BOM = '\uFEFF';
            const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `reaksiyon_export_${this.getDateString()}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);

            showToast(`${rows.length} satir CSV olarak indirildi`, 'success');
            return true;
        } catch (error) {
            showToast('CSV indirme hatası: ' + error.message, 'error');
            return false;
        }
    }

    /**
     * CSV için özel karakterleri escape et
     */
    escapeCsv(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/"/g, '""');
    }

    getSalesLineValue(row, keys) {
        for (const key of keys) {
            const value = row?.[key];
            if (value !== undefined && value !== null && String(value).trim() !== '') return value;
        }
        return '';
    }

    getRowValue(row, keys) {
        for (const key of keys) {
            if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
                return row[key];
            }
        }
        return '';
    }

    getSheetRows(workbook, sheetName) {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet || !worksheet['!ref']) return [];
        return XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    }

    isSalesLineBackupSheet(sheetName, rows) {
        if (/^Satis_Hafta_/i.test(sheetName) || /^Satış_Hafta_/i.test(sheetName)) return true;
        const keys = rows[0] ? Object.keys(rows[0]) : [];
        return keys.includes('Belge No') && keys.includes('No') && keys.includes('Açıklama') && !keys.includes('Rxn Adı');
    }

    isRequestBackupSheet(sheetName, rows) {
        if (/^Talepler_Hafta_/i.test(sheetName)) return true;
        const keys = rows[0] ? Object.keys(rows[0]) : [];
        return keys.includes('Rxn Adı') || keys.includes('Katalog No');
    }

    getWeekFromSheetName(sheetName) {
        const match = String(sheetName || '').match(/Hafta_(\d+)/i);
        return match ? match[1] : '';
    }

    buildSalesLinesPayloadFromWorkbook(workbook) {
        const allOrders = [];
        const batchId = Date.now().toString(36);

        workbook.SheetNames.forEach(sheetName => {
            const rows = this.getSheetRows(workbook, sheetName);
            if (rows.length === 0 || !this.isSalesLineBackupSheet(sheetName, rows)) return;

            const sheetWeek = this.getWeekFromSheetName(sheetName);
            rows.forEach((row, idx) => {
                const order = {
                    Hafta: String(this.getRowValue(row, ['Hafta']) || sheetWeek || '').trim(),
                    Temsilci: this.getRowValue(row, ['Temsilci']),
                    'Sipariş Tarihi': this.getRowValue(row, ['Sipariş Tarihi', 'Siparis Tarihi']),
                    'Belge Açıklaması': this.getRowValue(row, ['Belge Açıklaması', 'Belge Aciklamasi']),
                    'Belge No': this.getRowValue(row, ['Belge No', 'BELGE NO']),
                    Müşteri: this.getRowValue(row, ['Müşteri', 'Musteri', 'Sell-to Customer Name', 'Customer Name']),
                    Kurum: this.getRowValue(row, ['Kurum', 'Firma']),
                    'Konum Kodu': this.getRowValue(row, ['Konum Kodu', 'KONUM KODU']),
                    No: this.getRowValue(row, ['No', 'NO', 'Ürün No']),
                    Açıklama: this.getRowValue(row, ['Açıklama', 'Aciklama', 'AÇIKLAMA']),
                    Miktar: this.getRowValue(row, ['Miktar', 'MIKTAR']),
                    'Ölçü Birimi': this.getRowValue(row, ['Ölçü Birimi', 'Ölçü Birimi Kodu', 'Birim']),
                    'Teslim Tarihi': this.getRowValue(row, ['Teslim Tarihi', 'Talep edilen teslim tarihi', 'Okş Tarihi', 'Çıkış Tarihi']),
                    'Lot No': this.getRowValue(row, ['Lot No', 'LOT NO']),
                    'Satışın Notları': this.getRowValue(row, ['Satışın Notları', 'Satisin Notlari']),
                    'Üretimin Notları': this.getRowValue(row, ['Üretimin Notları', 'Uretimin Notlari']),
                    'Ürün Durumu': this.getRowValue(row, ['Ürün Durumu', 'Urun Durumu'])
                };

                if (!(order['Belge No'] || order.No || order.Açıklama || order.Müşteri)) return;
                order._id = `restore_${batchId}_${sheetName}_${idx}`.replace(/[^\w-]/g, '_');
                order._linkedRequestIds = [];
                order._siparisTarihi = order['Sipariş Tarihi'] || null;
                order._teslimTarihi = order['Teslim Tarihi'] || null;
                allOrders.push(order);
            });
        });

        if (allOrders.length === 0) return null;
        return {
            version: 1,
            savedAt: new Date().toISOString(),
            meta: { source: 'excel-full-backup-import' },
            editedLog: {},
            allOrders
        };
    }

    async saveSalesLinesPayload(payload) {
        if (!payload || !Array.isArray(payload.allOrders)) return 0;

        localStorage.setItem('reaksiyon_sales_lines_data_v1', JSON.stringify(payload));

        if (typeof window.applyRemoteSalesLinesPayload === 'function') {
            await window.applyRemoteSalesLinesPayload(payload);
        } else {
            const frame = document.getElementById('salesLinesFrame');
            if (frame && frame.contentWindow) {
                frame.contentWindow.postMessage({ type: 'sales-lines-remote-state', payload }, '*');
            }
        }

        if (typeof window.syncSalesLinesPayloadToCloud === 'function') {
            window.syncSalesLinesPayloadToCloud(payload, 'excel_full_backup_import');
        }

        return payload.allOrders.length;
    }

    /**
     * Otomatik yedekleme kontrolü
     */
    async checkAutoBackup() {
        const backed = await this.storage.autoBackup();
        if (backed) {
            console.log('Otomatik yedekleme yapıldı');
        }
    }

    /**
     * Yedeği geri yükle
     */
    async restoreBackup() {
        try {
            const count = await this.storage.restoreBackup();
            showToast(`${count} sipariş yedekten geri yüklendi`, 'success');
            return count;
        } catch (error) {
            showToast('Yedek geri yükleme hatası: ' + error.message, 'error');
            return 0;
        }
    }

    /**
     * Excel dosyasından sipariş yükle (Yeni Özellik)
     */
    async uploadExcel(file, defaultWeek = null) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    await ensureSheetJs();
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const salesLinesPayload = this.buildSalesLinesPayloadFromWorkbook(workbook);
                    const requestRows = [];

                    workbook.SheetNames.forEach(sheetName => {
                        const rows = this.getSheetRows(workbook, sheetName);
                        if (rows.length > 0 && this.isRequestBackupSheet(sheetName, rows)) {
                            requestRows.push(...rows);
                        }
                    });

                    if (requestRows.length === 0 && !salesLinesPayload) {
                        throw new Error('Excel dosyası boş veya okunamadı');
                    }

                    // Verileri map'le
                    let successCount = 0;
                    const ordersToSave = [];

                    for (const row of requestRows) {
                        // Zorunlu alan kontrolü (Örn: Rxn Adı veya Katalog No yoksa atla)
                        if (!row['Rxn Adı'] && !row['Katalog No']) continue;

                        const newOrder = {
                            id: 'ord_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                            // Hafta: Excel'deki değer (Hafta/Hafta No/Week) > Seçilen/Girilen Hafta > Mevcut Hafta
                            weekNumber: (row['Hafta'] || row['Hafta No'] || row['Week']) ? String(row['Hafta'] || row['Hafta No'] || row['Week']) : (defaultWeek ? String(defaultWeek) : String(new Date().getWeek())),
                            requestDate: row['Talep Tarihi'] || new Date().toISOString().split('T')[0],
                            requester: row['Talep Eden'] || '',
                            catalogNo: row['Katalog No'] ? String(row['Katalog No']) : '',
                            materialNo: row['Madde No'] ? String(row['Madde No']) : '',
                            rxnName: row['Rxn Adı'] || '',
                            format: row['Format'] || '',
                            quantity: row['Talep Miktar'] ? Number(row['Talep Miktar']) : 0,
                            productionOrderNo: row['Üretim Emri No'] || '',
                            producedQty: row['retilen Miktar'] ? Number(row['retilen Miktar']) : 0,
                            orderNo: row['Sipariş No'] || '',
                            country: row['Ülke'] || '',
                            deliveryDate: row['Çıkış Tarihi'] || '',
                            requesterNote: row['Talep Eden Not'] || '',
                            lotNo: row['Lot No'] || '',
                            producerNote: row['Üretim Yapan Ekibin Notu'] || '',
                            team1Note: row['Ekip 1 Not'] || '',
                            team2Note: row['Ekip 2 Not'] || '',
                            status: row['Durum'] || '-',
                            producer: row['Üretici'] || row['Üreten'] || '',
                            qcApprover: row['QC Onaylayan'] || row['QC Onay'] || '',
                            createdAt: new Date().toISOString(),
                            lastModifiedBy: currentUser ? currentUser.paraf : '',
                            changeHistory: []
                        };

                        ordersToSave.push(newOrder);
                        successCount++;
                    }

                    let salesLineCount = 0;
                    if (salesLinesPayload) {
                        salesLineCount = await this.saveSalesLinesPayload(salesLinesPayload);
                    }

                    if (successCount > 0) {
                        // Mevcut siparişlere ekle
                        if (typeof orders !== 'undefined') {
                            orders.push(...ordersToSave);
                        }

                        // Storage'a kaydet
                        await this.storage.saveAll(typeof orders !== 'undefined' ? orders : ordersToSave);

                        resolve(successCount + salesLineCount);
                    } else if (salesLineCount > 0) {
                        resolve(salesLineCount);
                    } else {
                        reject(new Error('İçe aktarılacak geçerli veri bulunamadı'));
                    }

                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Dosya okuma hatası'));
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Tarih string'i oluştur (dosya adı için)
     */
    getDateString() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        return `${year}${month}${day}_${hours}${minutes}`;
    }

    /**
     * Backup UI'ını render et
     */
    renderBackupUI(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const html = `
            <div class="backup-panel">
                <h3>Veri Yedekleme ve Dışa Aktarma</h3>

                <div class="backup-section">
                    <h4>Dışa Aktar</h4>
                    <div class="backup-buttons">
                        <button class="btn btn-primary" onclick="backupManager.downloadJSON()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM4.5 7.5a.5.5 0 0 0 0 1h5.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L10.293 7.5H4.5z"/>
                            </svg>
                            JSON İndir
                        </button>
                        <button class="btn btn-success" onclick="downloadFullBackupExcel()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M5.884 6.68a.5.5 0 1 0-.768.64L7.349 10l-2.233 2.68a.5.5 0 0 0 .768.64L8 10.781l2.116 2.54a.5.5 0 0 0 .768-.641L8.651 10l2.233-2.68a.5.5 0 0 0-.768-.64L8 9.219l-2.116-2.54z"/>
                                <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/>
                            </svg>
                            Tam Excel Yedeği
                        </button>
                        <button class="btn btn-info" onclick="backupManager.downloadCSV()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/>
                            </svg>
                            CSV İndir
                        </button>
                    </div>
                </div>

                <div class="backup-section">
                    <h4>İçe Aktar</h4>
                    <div class="backup-buttons">
                        <input type="file" id="jsonImportInput" accept=".json" style="display: none;"
                            onchange="handleJSONImport(this)">
                        <button class="btn btn-secondary" onclick="document.getElementById('jsonImportInput').click()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM4.5 7.5a.5.5 0 0 1 0-1h5.793L8.146 4.354a.5.5 0 1 1 .708-.708l3 3a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708-.708L10.293 7.5H4.5z"/>
                            </svg>
                            JSON Yükle
                        </button>
                        <button class="btn btn-warning" onclick="handleRestoreBackup()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                            </svg>
                            Yedeği Geri Yükle
                        </button>
                    </div>
                    
                    <h4 style="margin-top: 1.5rem;">Excel'den Veri Aktar</h4>
                    <div class="backup-buttons">
                        <input type="file" id="excelOrderImportInput" accept=".xlsx, .xls" style="display: none;"
                            onchange="handleExcelOrderImport(this)">
                        <button class="btn btn-success" onclick="document.getElementById('excelOrderImportInput').click()" style="background: #10b981; border-color: #10b981;">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/>
                            </svg>
                            Excel'den Yükle
                        </button>
                    </div>
                </div>

                <div class="backup-info">
                    <p><strong>İpucu:</strong> Verileriniz otomatik olarak her gün yedeklenir.</p>
                    <p>Son yedek: <span id="lastBackupDate">-</span></p>
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Son yedekleme tarihini göster
        const lastBackupDate = localStorage.getItem('last_backup_date');
        if (lastBackupDate) {
            document.getElementById('lastBackupDate').textContent = lastBackupDate;
        }
    }
}

// Global JSON import handler
async function handleJSONImport(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];

        if (!file.name.endsWith('.json')) {
            showToast('Lütfen bir JSON dosyası seçin', 'error');
            return;
        }

        try {
            await backupManager.uploadJSON(file);

            // Global orders'ı güncelle
            if (typeof storage !== 'undefined') {
                orders = await storage.getAll();
                console.log(`JSON import sonrası ${orders.length} sipariş yüklendi`);

                // Pagination güncelle
                if (typeof pagination !== 'undefined') {
                    pagination.setTotalItems(orders.length);
                    pagination.currentPage = 1;
                }
            }

            // Sayfayı yenile
            if (typeof renderDashboard === 'function') renderDashboard();
            if (typeof renderWeekSidebar === 'function') renderWeekSidebar();
            if (typeof applyFilters === 'function') applyFilters();

        } catch (error) {
            console.error('Import error:', error);
            showToast('İçe aktarma hatası: ' + error.message, 'error');
        }

        // Input'u sıfırla
        input.value = '';
    }
}

// Global Restore Backup Handler
async function handleRestoreBackup() {
    try {
        const count = await backupManager.restoreBackup();

        if (count > 0) {
            // Global orders'ı güncelle
            if (typeof storage !== 'undefined') {
                orders = await storage.getAll();

                // Pagination güncelle
                if (typeof pagination !== 'undefined') {
                    pagination.setTotalItems(orders.length);
                    pagination.currentPage = 1;
                }
            }

            // Sayfayı yenile
            if (typeof renderDashboard === 'function') renderDashboard();
            if (typeof renderWeekSidebar === 'function') renderWeekSidebar();
            if (typeof applyFilters === 'function') applyFilters();
        }
    } catch (error) {
        console.error('Restore error:', error);
    }
}

// Global Excel Order Import Handler
async function handleExcelOrderImport(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        showToast('Lütfen bir Excel dosyası seçin (.xlsx veya .xls)', 'error');
        return;
    }

    try {
        // Hafta seçimi mantığı
        let targetWeek = null;

        // 1. Sidebar'da seçili hafta varsa onu kullan
        if (typeof selectedWeekFilter !== 'undefined' && selectedWeekFilter !== null) {
            targetWeek = selectedWeekFilter;
        }
        // 2. Yoksa kullanıcıya sor
        else {
            const weekInputStr = prompt('Excel verileri hangi haftaya eklensin? (Boş bırakırsanız Exceldeki hafta veya mevcut hafta kullanılır):', new Date().getWeek());

            // Eğer iptal edildiyse (null)
            if (weekInputStr === null) {
                showToast('İşlem iptal edildi.', 'warning');
                input.value = '';
                return;
            }

            // Değer girildiyse
            if (weekInputStr.trim() !== '') {
                const week = parseInt(weekInputStr);
                if (!isNaN(week) && week >= 1 && week <= 52) {
                    targetWeek = week;
                } else {
                    showToast('Geçersiz hafta numarası. İşlem iptal edildi.', 'error');
                    input.value = '';
                    return;
                }
            }
        }

        const manager = getBackupManager();
        if (!manager || typeof manager.uploadExcel !== 'function') {
            throw new Error('Yedekleme modülü henüz hazır değil. Sayfayı yenileyip tekrar deneyin.');
        }

        const count = await manager.uploadExcel(file, targetWeek);
        showToast(`${count} sipariş Excel'den başarıyla yüklendi`, 'success');

        // saveOrders ile tüm sistemleri senkronize et
        if (typeof saveOrders === 'function') {
            await saveOrders();
        }

        // Global orders'ı güncelle
        if (typeof storage !== 'undefined') {
            orders = await storage.getAll();

            if (typeof pagination !== 'undefined') {
                pagination.setTotalItems(orders.length);
                pagination.currentPage = 1;
            }
        }

        // Sayfayı yenile
        if (typeof renderDashboard === 'function') renderDashboard();
        if (typeof renderWeekSidebar === 'function') renderWeekSidebar();
        if (typeof updateWeekFilterOptions === 'function') updateWeekFilterOptions();
        if (typeof applyFilters === 'function') applyFilters();

    } catch (error) {
        console.error('Excel import error:', error);
        showToast('Excel içe aktarma hatası: ' + error.message, 'error');
    }

    input.value = '';
}

// Global instances
var backupManager = window.backupManager || null;

function getBackupManager() {
    let manager = window.backupManager || backupManager;
    if (!manager && typeof BackupManager === 'function' && typeof storage !== 'undefined') {
        manager = new BackupManager(storage);
        backupManager = manager;
        window.backupManager = manager;
    }
    return manager;
}

async function downloadFullBackupExcel() {
    const manager = getBackupManager();

    if (manager && typeof manager.downloadExcel === 'function') {
        return manager.downloadExcel();
    }

    showToast('Yedekleme başlatılamadı. Sayfa modülleri henüz yüklenmemiş görünüyor.', 'warning');
    return false;
}

window.downloadFullBackupExcel = downloadFullBackupExcel;

