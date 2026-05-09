/**
 * Advanced Filters Module - Gelişmiş arama ve filtreleme
 * Çoklu seçim, toplu düzenleme ve gelişmiş sorgu özellikleri
 */

class AdvancedFilterManager {
    constructor() {
        this.filters = {
            search: '',
            weeks: [],
            statuses: [],
            formats: [],
            requesters: [],
            dateRange: { start: null, end: null }
        };
        this.selectedRows = new Set();
        this.onFilterChange = null;
    }

    /**
     * Filtreleri ayarla
     */
    setFilter(filterName, value) {
        if (this.filters.hasOwnProperty(filterName)) {
            this.filters[filterName] = value;
            this.triggerFilterChange();
        }
    }

    /**
     * Filtreleri temizle
     */
    clearFilters() {
        this.filters = {
            search: '',
            weeks: [],
            statuses: [],
            formats: [],
            requesters: [],
            dateRange: { start: null, end: null }
        };
        this.triggerFilterChange();
    }

    /**
     * Filtre değişikliğini tetikle
     */
    triggerFilterChange() {
        if (this.onFilterChange) {
            this.onFilterChange(this.filters);
        }
    }

    /**
     * Verileri filtrele
     */
    filterData(data) {
        let filtered = [...data];

        // Metin araması (tüm alanlarda)
        if (this.filters.search) {
            const searchLower = this.filters.search.toLowerCase();
            filtered = filtered.filter(order => {
                return Object.values(order).some(value =>
                    String(value).toLowerCase().includes(searchLower)
                );
            });
        }

        // Hafta filtresi
        if (this.filters.weeks.length > 0) {
            filtered = filtered.filter(order =>
                this.filters.weeks.includes(order.weekNumber)
            );
        }

        // Durum filtresi
        if (this.filters.statuses.length > 0) {
            filtered = filtered.filter(order =>
                this.filters.statuses.includes(order.status)
            );
        }

        // Format filtresi
        if (this.filters.formats.length > 0) {
            filtered = filtered.filter(order =>
                this.filters.formats.includes(order.format)
            );
        }

        // Talep eden filtresi
        if (this.filters.requesters.length > 0) {
            filtered = filtered.filter(order =>
                this.filters.requesters.includes(order.requester)
            );
        }

        // Tarih aralığı filtresi
        if (this.filters.dateRange.start || this.filters.dateRange.end) {
            filtered = filtered.filter(order => {
                if (!order.requestDate) return false;

                const orderDate = new Date(order.requestDate);
                const start = this.filters.dateRange.start ? new Date(this.filters.dateRange.start) : null;
                const end = this.filters.dateRange.end ? new Date(this.filters.dateRange.end) : null;

                if (start && orderDate < start) return false;
                if (end && orderDate > end) return false;

                return true;
            });
        }

        return filtered;
    }

    /**
     * Satır seçimi - tek
     */
    toggleRowSelection(orderId) {
        if (this.selectedRows.has(orderId)) {
            this.selectedRows.delete(orderId);
        } else {
            this.selectedRows.add(orderId);
        }
        this.updateSelectionUI();
    }

    /**
     * Tüm satırları seç/kaldır
     */
    toggleAllRows(orderIds) {
        if (this.selectedRows.size === orderIds.length) {
            this.selectedRows.clear();
        } else {
            this.selectedRows = new Set(orderIds);
        }
        this.updateSelectionUI();
    }

    /**
     * Seçili satırları temizle
     */
    clearSelection() {
        this.selectedRows.clear();
        this.updateSelectionUI();
    }

    /**
     * Seçim UI'ını güncelle
     */
    updateSelectionUI() {
        // Checkbox'ları güncelle
        document.querySelectorAll('.row-checkbox').forEach(checkbox => {
            const orderId = checkbox.dataset.orderId;
            checkbox.checked = this.selectedRows.has(orderId);
        });

        // Toplu işlem panelini göster/gizle
        const bulkPanel = document.getElementById('bulkActionsPanel');
        if (bulkPanel) {
            if (this.selectedRows.size > 0) {
                bulkPanel.style.display = 'flex';
                const countSpan = bulkPanel.querySelector('.selected-count');
                if (countSpan) {
                    countSpan.textContent = this.selectedRows.size;
                }
            } else {
                bulkPanel.style.display = 'none';
            }
        }
    }

    /**
     * Toplu durum güncelleme
     */
    async bulkUpdateStatus(newStatus) {
        if (this.selectedRows.size === 0) {
            showToast('Lütfen en az bir satır seçin', 'warning');
            return;
        }

        const confirmed = confirm(`${this.selectedRows.size} siparişin durumunu "${newStatus}" olarak güncellemek istediğinize emin misiniz?`);
        if (!confirmed) return;

        try {
            for (const orderId of this.selectedRows) {
                if (typeof window.updateOrder === 'function') {
                    await window.updateOrder(orderId, { status: newStatus });
                } else {
                    const order = await storage.getById(orderId);
                    if (order) {
                        order.status = newStatus;
                        await storage.save(order);
                    }
                }
            }

            showToast(`${this.selectedRows.size} sipariş güncellendi`, 'success');
            this.clearSelection();

            // Tabloyu yenile
            if (typeof applyFilters === 'function') {
                applyFilters();
            }
        } catch (error) {
            showToast('Toplu güncelleme hatası: ' + error.message, 'error');
        }
    }

    /**
     * Toplu silme
     */
    async bulkDelete() {
        if (this.selectedRows.size === 0) {
            showToast('Lütfen en az bir satır seçin', 'warning');
            return;
        }

        const confirmed = confirm(`${this.selectedRows.size} siparişi silmek istediğinize emin misiniz? Bu işlem geri alınamaz!`);
        if (!confirmed) return;

        try {
            for (const orderId of this.selectedRows) {
                if (typeof window.deleteOrder === 'function') {
                    await window.deleteOrder(orderId);
                } else {
                    await storage.delete(orderId);
                }
            }

            showToast(`${this.selectedRows.size} sipariş silindi`, 'success');
            this.clearSelection();

            // Tabloyu yenile
            if (typeof applyFilters === 'function') {
                applyFilters();
            }
        } catch (error) {
            showToast('Toplu silme hatası: ' + error.message, 'error');
        }
    }

    /**
     * Gelişmiş filtreleme UI'ını render et
     */
    renderFilterUI(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const html = `
            <div class="advanced-filters-panel">
                <div class="filter-row">
                    <div class="filter-group">
                        <label>Genel Arama</label>
                        <input type="text" class="filter-input" id="globalSearch"
                            placeholder="Tüm alanlarda ara..." onkeyup="advancedFilters.handleSearchChange(this.value)">
                    </div>
                </div>

                <div class="filter-row">
                    <div class="filter-group">
                        <label>Tarih Aralığı</label>
                        <div class="date-range">
                            <input type="date" class="filter-input" id="dateStart"
                                onchange="advancedFilters.handleDateRangeChange()">
                            <span>-</span>
                            <input type="date" class="filter-input" id="dateEnd"
                                onchange="advancedFilters.handleDateRangeChange()">
                        </div>
                    </div>

                    <div class="filter-group">
                        <label>Durum</label>
                        <select class="filter-select" id="statusFilter" multiple size="3"
                            onchange="advancedFilters.handleMultiSelectChange('statuses', this)">
                            <option value="-">- (İşlem Bekliyor)</option>
                            <option value="QC Bekliyor">QC Bekliyor</option>
                            <option value="Teslim Edildi">Teslim Edildi</option>
                            <option value="QC tekrarlanacak">QC Tekrarlanacak</option>
                            <option value="İmha edilecek">İmha Edilecek</option>
                            <option value="QC GİDECEK">QC Gidecek</option>
                            <option value="Ürün Lojistikte">Ürün Lojistikte</option>
                            <option value="Ürün Çıktı">Ürün Çıktı</option>
                            <option value="Ürün Parçalı Çıktı">Ürün Parçalı Çıktı</option>
                        </select>
                    </div>

                    <div class="filter-group">
                        <label>Format</label>
                        <select class="filter-select" id="formatFilter" multiple size="3"
                            onchange="advancedFilters.handleMultiSelectChange('formats', this)">
                            <option value="vCAP">vCAP</option>
                            <option value="LIYO">LIYO</option>
                            <option value="Bulk">Bulk</option>
                            <option value="Other">Diğer</option>
                        </select>
                    </div>
                </div>

                <div class="filter-actions">
                    <button class="btn btn-secondary btn-sm" onclick="advancedFilters.clearFilters()">
                        Filtreleri Temizle
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="advancedFilters.applyFiltersAndRender()">
                        Filtreleri Uygula
                    </button>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    /**
     * Arama değişikliği
     */
    handleSearchChange(value) {
        this.setFilter('search', value);
    }

    /**
     * Tarih aralığı değişikliği
     */
    handleDateRangeChange() {
        const start = document.getElementById('dateStart')?.value || null;
        const end = document.getElementById('dateEnd')?.value || null;
        this.setFilter('dateRange', { start, end });
    }

    /**
     * Çoklu seçim değişikliği
     */
    handleMultiSelectChange(filterName, selectElement) {
        const selected = Array.from(selectElement.selectedOptions).map(opt => opt.value);
        this.setFilter(filterName, selected);
    }

    /**
     * Filtreleri uygula ve render et
     */
    applyFiltersAndRender() {
        if (typeof applyFilters === 'function') {
            applyFilters();
        }
    }

    /**
     * Toplu işlemler panelini render et
     */
    renderBulkActionsPanel(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const html = `
            <div class="bulk-actions-panel" id="bulkActionsPanel" style="display: none;">
                <div class="bulk-info">
                    <span class="selected-count">0</span> sipariş seçildi
                </div>
                <div class="bulk-buttons">
                    <select class="bulk-status-select" id="bulkStatusSelect">
                        <option value="">Durum değiştir...</option>
                        <option value="-">- (İşlem Bekliyor)</option>
                        <option value="QC Bekliyor">QC Bekliyor</option>
                        <option value="Teslim Edildi">Teslim Edildi</option>
                        <option value="QC tekrarlanacak">QC Tekrarlanacak</option>
                        <option value="İmha edilecek">İmha Edilecek</option>
                        <option value="QC GİDECEK">QC Gidecek</option>
                        <option value="Ürün Lojistikte">Ürün Lojistikte</option>
                        <option value="Ürün Çıktı">Ürün Çıktı</option>
                        <option value="Ürün Parçalı Çıktı">Ürün Parçalı Çıktı</option>
                    </select>
                    <button class="btn btn-primary btn-sm" onclick="advancedFilters.applyBulkStatus()">
                        Uygula
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="advancedFilters.bulkDelete()">
                        Sil
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="advancedFilters.clearSelection()">
                        İptal
                    </button>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    /**
     * Toplu durum uygula
     */
    async applyBulkStatus() {
        const select = document.getElementById('bulkStatusSelect');
        if (!select || !select.value) {
            showToast('Lütfen bir durum seçin', 'warning');
            return;
        }

        await this.bulkUpdateStatus(select.value);
        select.value = '';
    }
}

// Global instance
let advancedFilters = new AdvancedFilterManager();
