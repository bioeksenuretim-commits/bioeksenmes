const uploadArea = document.getElementById('uploadArea');
uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files[0]) startUpload(e.dataTransfer.files[0]);
});

document.getElementById('fileInput').addEventListener('change', function() { if (this.files[0]) startUpload(this.files[0]); this.value = ''; });
document.getElementById('reuploadInput').addEventListener('change', function() { if (this.files[0]) startUpload(this.files[0]); this.value = ''; });

function triggerUpload() {
    if (!ensureSalesLinesWritable()) return;
    const ri = document.getElementById('reuploadInput');
    ri.click();
}

function startUpload(file) {
    if (!ensureSalesLinesWritable()) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) {
        showToast('Lütfen .xlsx veya .xls dosyası yükleyin', 'warning');
        return;
    }
    pendingFile = file;
    document.getElementById('weekInput').value = '';
    document.getElementById('weekModal').classList.add('active');
    setTimeout(() => document.getElementById('weekInput').focus(), 100);
}

document.getElementById('weekInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmWeek();
});
document.getElementById('bulkRequestWeekInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBulkPassSalesLineRequests();
    if (e.key === 'Escape') closeBulkRequestWeekModal();
});
document.getElementById('partialOutputInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmPartialOutputQuantity();
    if (e.key === 'Escape') closePartialOutputModal();
});
document.getElementById('manualSalesLineModal')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target?.tagName !== 'BUTTON') confirmManualSalesLineForm();
    if (e.key === 'Escape') closeManualSalesLineModal();
});

function confirmWeek() {
    if (!ensureSalesLinesWritable()) return;
    const weekNum = document.getElementById('weekInput').value.trim();
    if (!weekNum) { showToast('Lütfen hafta numarası girin', 'warning'); return; }
    document.getElementById('weekModal').classList.remove('active');
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('loading').classList.add('active');

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            await ensureSheetJs();
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: false });
            processWorkbook(workbook, weekNum);
            document.getElementById('loading').classList.remove('active');
            document.getElementById('mainContent').classList.add('active');
            const savedToCloud = await saveSalesLinesState({ sourceFile: pendingFile ? pendingFile.name : '', week: String(weekNum) });
            showToast(
                savedToCloud
                    ? `Hafta ${weekNum} verileri yüklendi ve buluta kaydedildi`
                    : `Hafta ${weekNum} verileri bu cihazda yüklendi; bulut kaydı başarısız`,
                savedToCloud ? 'success' : 'warning'
            );
        } catch(err) {
            document.getElementById('loading').classList.remove('active');
            document.getElementById('uploadSection').style.display = 'block';
            showToast('Dosya işlenirken hata oluştu', 'warning');
            console.error(err);
        }
    };
    reader.readAsArrayBuffer(pendingFile);
}

function processWorkbook(workbook, weekNum) {
    const normalizedWeek = String(weekNum || '').trim();

    workbook.SheetNames.forEach(sheetName => {
        const ws = workbook.Sheets[sheetName];
        if (!ws || !ws['!ref']) return;
        const jsonData = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (jsonData.length === 0) return;
        const firstRowKeys = Object.keys(jsonData[0]);
        let lastRow = null;

        jsonData.forEach((row, idx) => {
            const order = {};
            const colMap = {
                'Satış Temsilcisi Kodu': 'Temsilci', 'Tem': 'Temsilci', 'TEM': 'Temsilci', 'Temsilci': 'Temsilci',
                'Satış Yeri Müşteri Adı': 'Kurum', 'Kurum': 'Kurum', 'KURUM': 'Kurum', 'Firma': 'Kurum',
                'Sell-to Customer Name': 'Müşteri', 'Sell to Customer Name': 'Müşteri', 'Customer Name': 'Müşteri', 'Müşteri': 'Müşteri',
                'Belge Türü': null, 'Belge Turu': null,
                'Belge Açıklaması': 'Belge Açıklaması', 'Belge Aciklamasi': 'Belge Açıklaması',
                'Sipariş Tarihi': 'Sipariş Tarihi', 'Siparis Tarihi': 'Sipariş Tarihi',
                'Belge No': 'Belge No', 'BELGE NO': 'Belge No',
                'No': 'No', 'NO': 'No', 'Ürün No': 'No',
                'Açıklama': 'Açıklama', 'AÇIKLAMA': 'Açıklama',
                'Konum Kodu': 'Konum Kodu', 'KONUM KODU': 'Konum Kodu',
                'Miktar': 'Miktar', 'MIKTAR': 'Miktar',
                'Ölçü Birimi Kodu': 'Ölçü Birimi', 'Ölçü Birimi': 'Ölçü Birimi', 'Birim': 'Ölçü Birimi',
                'Talep edilen teslim tarihi': 'Teslim Tarihi', 'Okş Tarihi': 'Teslim Tarihi', 'Çıkış Tarihi': 'Teslim Tarihi',
                'Sipariş Notu': null,
                'Ürün Durumu': 'Ürün Durumu', 'Urun Durumu': 'Ürün Durumu',
                'Lot No': 'Lot No',
                'LOT NO': 'Lot No',
                'Satışın Notları': 'Satışın Notları',
                'Satisin Notlari': 'Satışın Notları',
                'Üretimin Notları': 'Üretimin Notları',
                'Uretimin Notlari': 'Üretimin Notları',
                'Sevk Edilen Miktar': 'Sevk Edilen Miktar',
                'Rezerve Et': 'Rezerve',
            };

            firstRowKeys.forEach(key => {
                const cleanKey = key.trim();
                if (Object.prototype.hasOwnProperty.call(colMap, cleanKey) && colMap[cleanKey] === null) return;
                const stdKey = colMap[cleanKey] || cleanKey;
                if (stdKey === null) return;
                if (order[stdKey] === undefined || order[stdKey] === '') {
                    order[stdKey] = row[key] !== undefined ? row[key] : '';
                }
            });
            sanitizeBelgeAciklamasi(order, row, firstRowKeys);

            ['Temsilci','Müşteri','Sipariş Tarihi','Belge No'].forEach(f => {
                if ((!order[f] || String(order[f]).trim() === '') && lastRow && lastRow[f]) {
                    order[f] = lastRow[f];
                }
            });

            order['Hafta'] = normalizedWeek || String(weekNum);
            order._id = buildStableSalesLineId(order, idx);
            order._siparisTarihi = parseDate(order['Sipariş Tarihi'] || '');
            order._teslimTarihi = parseDate(order['Teslim Tarihi'] || '');

            const hasData = (order['Belge No'] || order['No'] || order['Açıklama'] || order['Müşteri']);
            if (hasData) allOrders.push(order);
            lastRow = order;
        });
    });

    const normalizedIdentityState = normalizeSalesLineIdentities(allOrders, editedLog);
    allOrders = normalizedIdentityState.orders;
    editedLog = normalizedIdentityState.editedLog;

    populateFilter('weekFilter', Array.from(new Set(allOrders.map(o => o['Hafta']).filter(Boolean))).sort((a,b)=>a-b));
    populateFilter('repFilter', Array.from(new Set(allOrders.map(o => o['Temsilci']).filter(Boolean))).sort());
    populateFilter('locationFilter', Array.from(new Set(allOrders.map(o => o['Konum Kodu']).filter(Boolean))).sort());
    applyFilters();
    renderDashboard();
}

function parseDate(val) {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val.getTime())) {
        return new Date(val.getUTCFullYear(), val.getUTCMonth(), val.getUTCDate());
    }
    const str = String(val).trim();
    let m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) return new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]));
    m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
    m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]));
    const num = parseFloat(str);
    if (!isNaN(num) && num > 40000 && num < 60000) {
        const utcDate = new Date((Math.floor(num) - 25569) * 86400000);
        return new Date(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate());
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

function formatDate(d) {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
    return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
}

