window.ReaksiyonOrdersRenderer = {
    renderRow(order, safeColumns, deps = {}) {
        const formatDate = deps.formatDate || (value => value || '');
        const resolveOrderFormat = deps.resolveOrderFormat || (() => '');
        const formatDateTimeShort = deps.formatDateTimeShort || (value => value || '');
        const statusClass = order.status ? `row-${order.status.replace(/ /g, '-')}` : '';
        let rowHtml = `<tr class="${statusClass}" data-order-id="${order.id}">`;

        rowHtml += `
            <td class="expand-icon-cell">
                <div class="row-menu-container">
                    <button class="row-menu-btn" onclick="event.stopPropagation(); toggleRowMenu('${order.id}')">...</button>
                    <div id="menu-${order.id}" class="row-menu-dropdown">
                        <div class="row-menu-item" onclick="openDetailModal('${order.id}')">Düzenle</div>
                        <div class="row-menu-item" onclick="showChangeHistory('${order.id}')">Değişiklikleri Göster</div>
                    </div>
                </div>
                <span class="expand-icon" id="icon-${order.id}" onclick="toggleDetail('${order.id}')"></span>
            </td>`;

        safeColumns.forEach(col => {
            let cellContent = order[col.id] || '';

            if (col.id === 'requester' && order.sourceSystem === 'sales-lines') {
                cellContent = '';
            }

            if (col.type === 'date' && order[col.id]) {
                cellContent = formatDate(order[col.id]);
            } else if (col.id === 'format') {
                cellContent = resolveOrderFormat(order) || cellContent;
            } else if (col.type === 'status') {
                cellContent = `
                <select class="inline-status" onchange="updateStatus('${order.id}', this.value)" style="min-width: 130px; padding: 2px;" onclick="event.stopPropagation()">
                    <option value="-" ${order.status === '-' ? 'selected' : ''}>İşlem Bekliyor</option>
                    <option value="QC Bekliyor" ${order.status === 'QC Bekliyor' ? 'selected' : ''}>QC Bekliyor</option>
                    <option value="QC Geçti" ${order.status === 'QC Geçti' ? 'selected' : ''}>QC Geçti</option>
                    <option value="Teslim Edildi" ${order.status === 'Teslim Edildi' ? 'selected' : ''}>Teslim Edildi</option>
                    <option value="Etiketlendi" ${order.status === 'Etiketlendi' ? 'selected' : ''}>Etiketlendi</option>
                    <option value="QC tekrarlanacak" ${order.status === 'QC tekrarlanacak' ? 'selected' : ''}>QC Tekrar</option>
                    <option value="İmha edilecek" ${order.status === 'İmha edilecek' ? 'selected' : ''}>İmha</option>
                    <option value="QC GİDECEK" ${order.status === 'QC GİDECEK' ? 'selected' : ''}>QC Gidecek</option>
                    <option value="Dağıtıldı" ${order.status === 'Dağıtıldı' ? 'selected' : ''}>Dağıtıldı</option>
                    <option value="İptal Edildi" ${order.status === 'İptal Edildi' ? 'selected' : ''}>İptal Edildi</option>
                </select>`;
            }

            let clickAction = '';
            if (col.type !== 'status') {
                clickAction = `onclick="event.stopPropagation(); makeEditable(this, '${order.id}', '${col.id}', '${col.type}')"`;
            }

            let style = '';
            if (col.bold) style = 'font-weight: 600;';
            if (col.id === 'weekNumber') cellContent = `<span class="week-badge">${cellContent}</span>`;

            const wrapClass = (col.wrap || (col.id === 'rxnName' || (typeof col.id === 'string' && col.id.includes('Note')))) ? 'wrap-text' : '';
            rowHtml += `<td ${clickAction} style="${style}" class="${wrapClass}">${cellContent}</td>`;
        });

        rowHtml += `
            <td class="modified-by-cell" onclick="event.stopPropagation(); showChangeHistory('${order.id}')" style="cursor:pointer;" title="Değişiklik geçmişini aç">
                ${order.lastModifiedBy || '-'}
            </td>
            <td class="modified-by-cell" onclick="event.stopPropagation(); showChangeHistory('${order.id}')" style="cursor:pointer;" title="Değişiklik geçmişini aç">
                ${formatDateTimeShort(order.lastModifiedAt || (Array.isArray(order.changeHistory) && order.changeHistory.length > 0 ? order.changeHistory[order.changeHistory.length - 1].changedAt : ''))}
            </td>
        </tr>`;

        rowHtml += `
        <tr id="detail-${order.id}" class="detail-row">
            <td colspan="${safeColumns.length + 3}" class="detail-content">
                <div class="detail-grid">
                    <div class="detail-item">
                        <label>QC Onaylayan</label>
                        <select class="inline-status" onchange="event.stopPropagation(); saveCell('${order.id}', 'qcApprover', this.value)" onclick="event.stopPropagation()" style="min-width: 80px; padding: 4px 8px; font-size: 0.85rem;">
                            <option value="" ${!order.qcApprover ? 'selected' : ''}>Seçiniz</option>
                            <option value="MG" ${order.qcApprover === 'MG' ? 'selected' : ''}>MG</option>
                            <option value="C" ${order.qcApprover === 'C' ? 'selected' : ''}>C</option>
                            <option value="SK" ${order.qcApprover === 'SK' ? 'selected' : ''}>SK</option>
                            <option value="CY" ${order.qcApprover === 'CY' ? 'selected' : ''}>CY</option>
                        </select>
                    </div>
                    <div class="detail-item">
                        <label>Ürünle Çıkacak Bileşen Lotları</label>
                        <span class="editable-detail" onclick="event.stopPropagation(); makeEditable(this, '${order.id}', 'componentLots', 'text')">${order.componentLots || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <label>PC Strip İçeriği</label>
                        <span class="editable-detail" onclick="event.stopPropagation(); makeEditable(this, '${order.id}', 'pcStripContent', 'text')">${order.pcStripContent || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <label>QC Notu</label>
                        <span class="editable-detail" onclick="event.stopPropagation(); makeEditable(this, '${order.id}', 'qcNote', 'text')">${order.qcNote || '-'}</span>
                    </div>
                </div>
            </td>
        </tr>`;

        return rowHtml;
    }
};
