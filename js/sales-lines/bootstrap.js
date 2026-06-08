function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(msg, type='info') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast toast-${type} show`;
    setTimeout(() => toast.classList.remove('show'), 2500);
}

function applyParentRolePermissions() {
    const resetBtn = document.getElementById('salesLinesResetBtn');
    const bulkRequestBtn = document.getElementById('bulkSalesLineRequestBtn');
    const manualSalesLineBtn = document.getElementById('manualSalesLineBtn');
    updateColumnPersonalizationButton();

    try {
        let canDelete = false;
        if (!isSalesLineAdmin()) {
            canDelete = false;
        } else if (typeof embeddedPermissionState.canDeleteSalesLines === 'boolean') {
            canDelete = embeddedPermissionState.canDeleteSalesLines;
        } else if (typeof window.parent.canDeleteData === 'function') {
            canDelete = !!window.parent.canDeleteData();
        } else {
            const user = getParentSessionUser() || {};
            if (String(user.role || '').trim().toLowerCase() === 'admin') {
                canDelete = true;
            }
        }

        const canBulk = canUseSalesLineRequestButton();
        const canManual = canUseManualSalesLineButton();
        const nextSignature = JSON.stringify({ canDelete, canBulk, canManual });
        const changed = nextSignature !== lastPermissionUiSignature;
        lastPermissionUiSignature = nextSignature;

        if (resetBtn) resetBtn.style.display = canDelete ? 'inline-flex' : 'none';
        if (bulkRequestBtn) {
            bulkRequestBtn.style.display = canBulk ? 'inline-flex' : 'none';
        }
        if (manualSalesLineBtn) {
            manualSalesLineBtn.style.display = canManual ? 'inline-flex' : 'none';
        }
        if (changed && allOrders.length > 0) renderTable();
    } catch (_) {
        try {
            const user = getParentSessionUser() || {};
            if (String(user.role || '').trim().toLowerCase() === 'admin') {
                if (resetBtn) resetBtn.style.display = 'inline-flex';
            } else {
                if (resetBtn) resetBtn.style.display = 'none';
            }
        } catch (_) {
            if (resetBtn) resetBtn.style.display = 'none';
        }
        if (bulkRequestBtn) bulkRequestBtn.style.display = 'none';
        const nextSignature = JSON.stringify({ canDelete: false, canBulk: false, canManual: false });
        const changed = nextSignature !== lastPermissionUiSignature;
        lastPermissionUiSignature = nextSignature;
        if (changed && allOrders.length > 0) renderTable();
    }
}

try { applyParentRolePermissions(); } catch (_) {}
window.addEventListener('focus', applyParentRolePermissions);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyParentRolePermissions();
});

window.addEventListener('storage', (event) => {
    if (event.key === SALES_LINES_STORAGE_KEY && event.newValue) {
        if (isSalesLinesFirebaseVerified()) return;
        loadSalesLinesState();
    }
});

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'sales-lines-open-conflicts') {
        openSalesLineConflictModal();
        return;
    }

    if (event.data && event.data.type === 'sales-lines-permissions' && event.data.payload) {
        embeddedPermissionState = {
            ...embeddedPermissionState,
            ...event.data.payload
        };
        visibleColumnSet = loadVisibleColumnSet();
        visibleDashboardActionSet = loadVisibleDashboardActionSet();
        applyParentRolePermissions();
        postSalesLinesTabMessage('SALES_LINES_TAB_ACTIVE');
        scheduleDashboardRender();
        loadAccountPersonalizationPreferences();
        return;
    }

    if (!event.data || event.data.type !== 'sales-lines-remote-state' || !event.data.payload) return;
    if (SALES_LINES_TEST_LOCAL_MODE) return;

    suppressSalesLinesParentPost = true;
    try {
        loadSalesLinesStateFromPayload(event.data.payload, { skipParentPost: true, silent: true, force: true, dataSource: 'firebase' });
    } finally {
        suppressSalesLinesParentPost = false;
    }
});

applyLocalPersonalizationPreferences();
initSalesLinesTabCoordinator();
setSalesLinesDataSourceState({
    dataSource: 'unknown',
    firebaseLoadState: 'loading',
    warning: 'Firebase merkezi veri doğrulanana kadar düzenleme kapalı.',
    context: 'bootstrap-start'
});
scheduleTodayOutputsMidnightRefresh();
getEmbeddedParentWindow()?.postMessage?.({ type: 'sales-lines-ready' }, '*');
Promise.resolve(loadSalesLinesState()).finally(() => {
    runWhenSalesLinesIdle(() => {
        loadRemoteProductTreesForSalesLines().catch(error => {
            console.warn('Ürün ağacı açıklamaları ertelenmiş yüklemede alınamadı:', error);
        });
    }, 3500);
});
startCloudSalesLinesPolling();
applyParentRolePermissions();

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (exitActiveModalFullscreen()) return;
        closeSalesStatusMenu();
        document.getElementById('weekModal').classList.remove('active');
        closeBulkRequestWeekModal();
        closeDetail();
        closeStockKitsPopup();
        closeLinkedRequestModal();
        closeSalesLineConflictModal();
    }
    else if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
        e.preventDefault();
        document.getElementById('searchInput').focus();
    }
});
