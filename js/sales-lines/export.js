// ===== EXPORT =====
function wrapExcelCellText(value, maxLineLength = 24) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLineLength) return text;

    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach(word => {
        const parts = word.length > maxLineLength
            ? word.match(new RegExp(`.{1,${maxLineLength}}`, 'g')) || [word]
            : [word];

        parts.forEach(part => {
            if (!currentLine) {
                currentLine = part;
                return;
            }

            if ((currentLine + ' ' + part).length <= maxLineLength) {
                currentLine += ' ' + part;
            } else {
                lines.push(currentLine);
                currentLine = part;
            }
        });
    });

    if (currentLine) lines.push(currentLine);
    return lines.join('\n');
}

function shouldWrapExcelColumn(label, value) {
    const wrapColumns = new Set([
        'Belge Açıklaması',
        'Müşteri',
        'Açıklama',
        'Satışın Notları',
        'Üretimin Notları',
        'Ürün Durumu'
    ]);
    const text = String(value ?? '');
    return wrapColumns.has(label) || text.length > 48;
}

function getExcelWrapLineLength(label) {
    if (label === 'Müşteri' || label === 'Belge Açıklaması') return 24;
    if (label === 'Satışın Notları' || label === 'Üretimin Notları' || label === 'Açıklama') return 28;
    return 30;
}

function getExcelColumnWidth(header, rows) {
    const hasWrappedValue = rows.some(row => String(row[header] || '').includes('\n'));
    if (hasWrappedValue) return 34;

    const maxLength = rows.reduce((max, row) => {
        return Math.max(max, String(row[header] || '').length, String(header).length);
    }, String(header).length);
    return Math.min(Math.max(maxLength + 2, 12), 24);
}

function applyExcelWrapStyle(ws, headers, exportData) {
    ws['!cols'] = headers.map(header => ({ wch: getExcelColumnWidth(header, exportData) }));
    ws['!rows'] = [{ hpt: 24 }, ...exportData.map(row => {
        const lineCount = Math.max(...headers.map(header => String(row[header] || '').split('\n').length));
        return { hpt: Math.min(Math.max(lineCount * 18, 22), 120) };
    })];

    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let row = range.s.r; row <= range.e.r; row++) {
        for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
            if (!ws[cellAddress]) continue;
            ws[cellAddress].s = {
                alignment: { wrapText: true, vertical: row === 0 ? 'center' : 'top' }
            };
        }
    }
}

async function writeStyledExcelFile(headers, rows, sheetName, filename) {
    await ensureExcelJs();
    if (typeof ExcelJS === 'undefined') return false;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);
    worksheet.columns = headers.map(header => ({
        header,
        key: header,
        width: getExcelColumnWidth(header, rows)
    }));
    worksheet.addRows(rows);
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    worksheet.getRow(1).height = 24;
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };

    rows.forEach((row, index) => {
        const excelRow = worksheet.getRow(index + 2);
        const lineCount = Math.max(...headers.map(header => String(row[header] || '').split('\n').length));
        excelRow.height = Math.min(Math.max(lineCount * 18, 24), 140);
        excelRow.eachCell(cell => {
            cell.alignment = { vertical: 'top', wrapText: true };
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    return true;
}

async function exportFilteredExcel() {
    if (filteredOrders.length === 0) { showToast('Dışa aktarılacak veri yok', 'warning'); return; }
    const exportColumns = getVisibleColumnOrder();
    const headers = exportColumns.map(col => colLabels[col] || col);
    const exportData = filteredOrders.map(o => {
        const row = {};
        exportColumns.forEach(col => {
            const label = colLabels[col] || col;
            let value = '';
            if (col === 'Sipariş Tarihi') value = o._siparisTarihi ? formatDate(o._siparisTarihi) : '';
            else if (col === 'Teslim Tarihi') value = o._teslimTarihi ? formatDate(o._teslimTarihi) : '';
            else if (col === CUSTOMER_MARKET_COLUMN) value = getSalesLineCustomerMarket(o);
            else if (col === 'Miktar') value = getPartialOutputRemainingQuantity(o);
            else value = o[col] || '';
            row[label] = shouldWrapExcelColumn(label, value) ? wrapExcelCellText(value, getExcelWrapLineLength(label)) : value;
        });
        return row;
    });
    const filename = `siparis_rapor_${new Date().toISOString().slice(0,10)}.xlsx`;
    if (await writeStyledExcelFile(headers, exportData, 'Siparişler', filename)) {
        showToast('Excel indirildi', 'success');
        return;
    }

    await ensureSheetJs();
    const ws = XLSX.utils.json_to_sheet(exportData);
    applyExcelWrapStyle(ws, headers, exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Siparişler');
    XLSX.writeFile(wb, filename);
    showToast('Excel indirildi', 'success');
}

function exportCSV() {
    if (filteredOrders.length === 0) { showToast('Dışa aktarılacak veri yok', 'warning'); return; }
    const exportColumns = getVisibleColumnOrder();
    const headers = exportColumns.map(c => colLabels[c] || c);
    let csv = '\uFEFF' + headers.join(';') + '\n';
    filteredOrders.forEach(o => {
        csv += exportColumns.map(col => {
            let v = '';
            if (col === 'Sipariş Tarihi') v = o._siparisTarihi ? formatDate(o._siparisTarihi) : '';
            else if (col === 'Teslim Tarihi') v = o._teslimTarihi ? formatDate(o._teslimTarihi) : '';
            else if (col === CUSTOMER_MARKET_COLUMN) v = getSalesLineCustomerMarket(o);
            else if (col === 'Miktar') v = getPartialOutputRemainingQuantity(o);
            else v = o[col] || '';
            return `"${String(v).replace(/"/g,'""')}"`;
        }).join(';') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `siparis_rapor_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    showToast('CSV indirildi', 'success');
}

// ===== UTILITIES =====
