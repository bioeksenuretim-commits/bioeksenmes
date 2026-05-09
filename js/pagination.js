/**
 * Pagination Module - Sayfalama ve performans yönetimi
 * Virtual scrolling ve lazy loading desteği
 */

class PaginationManager {
    constructor(options = {}) {
        this.itemsPerPage = options.itemsPerPage || 50;
        this.currentPage = 1;
        this.totalItems = 0;
        this.totalPages = 0;
        this.visiblePages = options.visiblePages || 5;
        this.onPageChange = options.onPageChange || (() => {});
    }

    /**
     * Toplam öğe sayısını ayarla
     */
    setTotalItems(count) {
        this.totalItems = count;
        this.totalPages = Math.ceil(count / this.itemsPerPage);

        // Mevcut sayfa geçerli değilse düzelt
        if (this.currentPage > this.totalPages) {
            this.currentPage = Math.max(1, this.totalPages);
        }
    }

    /**
     * Sayfayı değiştir
     */
    goToPage(pageNumber) {
        if (pageNumber < 1 || pageNumber > this.totalPages) {
            return false;
        }

        this.currentPage = pageNumber;
        this.onPageChange(this.currentPage);
        return true;
    }

    /**
     * Sonraki sayfa
     */
    nextPage() {
        return this.goToPage(this.currentPage + 1);
    }

    /**
     * Önceki sayfa
     */
    prevPage() {
        return this.goToPage(this.currentPage - 1);
    }

    /**
     * İlk sayfa
     */
    firstPage() {
        return this.goToPage(1);
    }

    /**
     * Son sayfa
     */
    lastPage() {
        return this.goToPage(this.totalPages);
    }

    /**
     * Mevcut sayfanın verilerini al
     */
    getCurrentPageData(allData) {
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        return allData.slice(startIndex, endIndex);
    }

    /**
     * Sayfa bilgisini render et
     */
    renderPagination(containerId) {
        const container = document.getElementById(containerId);
        if (!container || this.totalPages <= 1) {
            if (container) container.innerHTML = '';
            return;
        }

        let html = '<div class="pagination-wrapper">';

        // Sayfa bilgisi
        html += `
            <div class="pagination-info">
                <span>${this.getTotalItemsText()}</span>
                <select class="items-per-page" onchange="pagination.changeItemsPerPage(this.value)">
                    <option value="25" ${this.itemsPerPage === 25 ? 'selected' : ''}>25/sayfa</option>
                    <option value="50" ${this.itemsPerPage === 50 ? 'selected' : ''}>50/sayfa</option>
                    <option value="100" ${this.itemsPerPage === 100 ? 'selected' : ''}>100/sayfa</option>
                    <option value="200" ${this.itemsPerPage === 200 ? 'selected' : ''}>200/sayfa</option>
                </select>
            </div>
        `;

        // Sayfa butonları
        html += '<div class="pagination-controls">';

        // İlk sayfa
        html += `<button class="page-btn" onclick="pagination.firstPage()" ${this.currentPage === 1 ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 2v12h2V2H3zm3 0l8 6-8 6V2z"/>
            </svg>
        </button>`;

        // Önceki sayfa
        html += `<button class="page-btn" onclick="pagination.prevPage()" ${this.currentPage === 1 ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11 2L3 8l8 6V2z"/>
            </svg>
        </button>`;

        // Sayfa numaraları
        const pageNumbers = this.getPageNumbers();
        pageNumbers.forEach(pageNum => {
            if (pageNum === '...') {
                html += '<span class="page-ellipsis">...</span>';
            } else {
                html += `<button class="page-btn ${pageNum === this.currentPage ? 'active' : ''}"
                    onclick="pagination.goToPage(${pageNum})">${pageNum}</button>`;
            }
        });

        // Sonraki sayfa
        html += `<button class="page-btn" onclick="pagination.nextPage()" ${this.currentPage === this.totalPages ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 2v12l8-6-8-6z"/>
            </svg>
        </button>`;

        // Son sayfa
        html += `<button class="page-btn" onclick="pagination.lastPage()" ${this.currentPage === this.totalPages ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11 2H9v12h2V2zm-5 0v12l8-6-8-6z"/>
            </svg>
        </button>`;

        html += '</div></div>';

        container.innerHTML = html;
    }

    /**
     * Görünür sayfa numaralarını hesapla
     */
    getPageNumbers() {
        const pages = [];
        const halfVisible = Math.floor(this.visiblePages / 2);

        let startPage = Math.max(1, this.currentPage - halfVisible);
        let endPage = Math.min(this.totalPages, this.currentPage + halfVisible);

        // Başlangıç ayarlaması
        if (endPage - startPage < this.visiblePages - 1) {
            if (startPage === 1) {
                endPage = Math.min(this.totalPages, this.visiblePages);
            } else {
                startPage = Math.max(1, this.totalPages - this.visiblePages + 1);
            }
        }

        // İlk sayfa
        if (startPage > 1) {
            pages.push(1);
            if (startPage > 2) {
                pages.push('...');
            }
        }

        // Ara sayfalar
        for (let i = startPage; i <= endPage; i++) {
            pages.push(i);
        }

        // Son sayfa
        if (endPage < this.totalPages) {
            if (endPage < this.totalPages - 1) {
                pages.push('...');
            }
            pages.push(this.totalPages);
        }

        return pages;
    }

    /**
     * Toplam öğe metni
     */
    getTotalItemsText() {
        const start = (this.currentPage - 1) * this.itemsPerPage + 1;
        const end = Math.min(this.currentPage * this.itemsPerPage, this.totalItems);
        return `${start}-${end} / ${this.totalItems} sipariş`;
    }

    /**
     * Sayfa başına öğe sayısını değiştir
     */
    changeItemsPerPage(newValue) {
        this.itemsPerPage = parseInt(newValue);
        this.setTotalItems(this.totalItems);
        this.currentPage = 1;
        this.onPageChange(this.currentPage);
    }

    /**
     * Sayfayı sıfırla
     */
    reset() {
        this.currentPage = 1;
        this.totalItems = 0;
        this.totalPages = 0;
    }
}

/**
 * Virtual Scrolling için optimize edilmiş render
 */
class VirtualScrollManager {
    constructor(options = {}) {
        this.containerHeight = options.containerHeight || 600;
        this.rowHeight = options.rowHeight || 50;
        this.buffer = options.buffer || 5;
        this.scrollContainer = null;
        this.contentContainer = null;
        this.allData = [];
        this.visibleStart = 0;
        this.visibleEnd = 0;
        this.onRender = options.onRender || (() => {});
    }

    /**
     * Virtual scroll'u başlat
     */
    init(scrollContainerId, contentContainerId) {
        this.scrollContainer = document.getElementById(scrollContainerId);
        this.contentContainer = document.getElementById(contentContainerId);

        if (!this.scrollContainer || !this.contentContainer) {
            console.error('Virtual scroll konteynerleri bulunamadı');
            return;
        }

        this.scrollContainer.addEventListener('scroll', () => this.handleScroll());
    }

    /**
     * Verileri ayarla
     */
    setData(data) {
        this.allData = data;
        this.updateVisibleRange();
        this.render();
    }

    /**
     * Scroll olayını işle
     */
    handleScroll() {
        this.updateVisibleRange();
        this.render();
    }

    /**
     * Görünür aralığı güncelle
     */
    updateVisibleRange() {
        const scrollTop = this.scrollContainer.scrollTop;
        const visibleRowCount = Math.ceil(this.containerHeight / this.rowHeight);

        this.visibleStart = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.buffer);
        this.visibleEnd = Math.min(
            this.allData.length,
            this.visibleStart + visibleRowCount + (this.buffer * 2)
        );
    }

    /**
     * Görünür öğeleri render et
     */
    render() {
        const totalHeight = this.allData.length * this.rowHeight;
        const offsetY = this.visibleStart * this.rowHeight;

        // Toplam yüksekliği ayarla
        this.contentContainer.style.height = `${totalHeight}px`;

        // Görünür verileri al
        const visibleData = this.allData.slice(this.visibleStart, this.visibleEnd);

        // Render callback'i çağır
        this.onRender(visibleData, offsetY, this.visibleStart);
    }
}

// Global instance
let pagination = null;
let virtualScroll = null;
