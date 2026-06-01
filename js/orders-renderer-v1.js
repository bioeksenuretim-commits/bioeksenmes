window.ReaksiyonOrdersRenderer = {
    renderRow(order, safeColumns, deps = {}) {
        const formatDate = deps.formatDate || (value => value || '');
        const resolveOrderFormat = deps.resolveOrderFormat || (() => '');
        const formatDateTimeShort = deps.formatDateTimeShort || (value => value || '');
        const normalizeStatus = deps.normalizeOrderStatus || (value => {
            const raw = String(value || '').trim();
            if (!raw || raw === '-') return 'Ürün İşlem Bekliyor';
            return raw;
        });
        const statusOptions = deps.orderStatusOptions || [
            'Ürün İşlem Bekliyor',
            'Ürün Oligo Bekliyor',
            'Ürün Planlandı',
            'Ürün Dağıtıldı',
            'Ürün QC ye gitti',
            'Ürün QC tekrarına gitti',
            'Ürün QC den Geçmedi',
            'Ürün Revizyon bekliyor',
            'Ürün Etiketlendi',
            'Ürün Teslim Edildi',
            'Ürün İptal Edildi'
        ];
        const isOrderBulkSelected = typeof deps.isOrderBulkSelected === 'function' ? deps.isOrderBulkSelected : () => false;
        const currentStatus = normalizeStatus(order.status);
        const statusClass = currentStatus ? `row-${currentStatus.replace(/ /g, '-')}` : '';
        const selectedAttr = isOrderBulkSelected(order.id) ? ' checked' : '';
        let rowHtml = `<tr class="${statusClass}" data-order-id="${order.id}">`;

        rowHtml += `
            <td class="expand-icon-cell">
                <input type="checkbox" class="orders-row-checkbox" data-order-id="${order.id}"${selectedAttr}
                    onclick="event.stopPropagation(); toggleOrderBulkSelection('${order.id}', this.checked)"
                    aria-label="Satır seç">
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
                    ${statusOptions.map(status => `<option value="${status}" ${currentStatus === status ? 'selected' : ''}>${status}</option>`).join('')}
                </select>`;
            }

            let clickAction = '';
            if (col.type !== 'status' && col.editable) {
                clickAction = `onclick="event.stopPropagation(); makeEditable(this, '${order.id}', '${col.id}', '${col.type}')"`;
            }

            let style = '';
            if (col.bold) style = 'font-weight: 600;';
            if (col.id === 'weekNumber') cellContent = `<span class="week-badge">${cellContent}</span>`;

            const wrapClass = (col.wrap || (col.id === 'rxnName' || (typeof col.id === 'string' && col.id.includes('Note')))) ? 'wrap-text' : '';
            rowHtml += `<td ${clickAction} style="${style}" class="${wrapClass}">${cellContent}</td>`;
        });

        rowHtml += '</tr>';

        rowHtml += `
        <tr id="detail-${order.id}" class="detail-row">
            <td colspan="${safeColumns.length + 1}" class="detail-content">
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
