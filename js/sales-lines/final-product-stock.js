const FINAL_PRODUCT_STOCK_BIN = 'STOK KİTLER';
const FINAL_PRODUCT_ORDER_BIN = 'SİPARİŞE ÖZEL KİTLER';

function isFinalProductStockEnabled() {
    return typeof isSalesLinesDevEnvironment === 'function'
        && isSalesLinesDevEnvironment()
        && typeof firebase !== 'undefined'
        && firebase?.auth
        && firebase?.database;
}

async function ensureFinalProductStockAuth() {
    if (!isFinalProductStockEnabled()) return false;
    if (firebase.auth().currentUser) return true;

    try {
        const parentAuthUser = window.parent
            && window.parent !== window
            && window.parent.firebase
            && window.parent.firebase.auth
            && window.parent.firebase.auth().currentUser;
        if (parentAuthUser && typeof firebase.auth().updateCurrentUser === 'function') {
            await firebase.auth().updateCurrentUser(parentAuthUser);
            if (firebase.auth().currentUser) return true;
        }
    } catch (error) {
        console.warn('Parent Firebase oturumu sales-lines ekranına taşınamadı:', error);
    }

    return await new Promise(resolve => {
        let done = false;
        let unsubscribe = null;
        const finish = value => {
            if (done) return;
            done = true;
            try { unsubscribe?.(); } catch (_) {}
            resolve(value);
        };
        const timeout = setTimeout(() => finish(!!firebase.auth().currentUser), 3500);
        unsubscribe = firebase.auth().onAuthStateChanged(user => {
            clearTimeout(timeout);
            finish(!!user);
        }, () => {
            clearTimeout(timeout);
            finish(false);
        });
    });
}

function getFinalProductStockDbRef(path = '') {
    const cleanPath = String(path || '').replace(/^\/+/, '');
    const prefix = typeof getSalesLinesDbPrefix === 'function'
        ? String(getSalesLinesDbPrefix() || '').replace(/^\/+/, '')
        : 'dev/';
    return firebase.database().ref(`${prefix}finalProductStock${cleanPath ? `/${cleanPath}` : ''}`);
}

function encodeFinalProductStockKey(value) {
    return encodeURIComponent(String(value || '').trim() || 'empty').replace(/\./g, '%2E');
}

function buildFinalProductStockKey(...parts) {
    return encodeFinalProductStockKey(parts.map(part => String(part || '').trim()).join('|'));
}

function getFinalProductSalesLineId(order) {
    return String(order?._id || order?.id || '').trim();
}

function getFinalProductOrderProductNo(order) {
    return String(order?.['Ürün No'] || order?.['No'] || order?.['Katalog No'] || order?.catalogNo || order?.materialNo || '').trim();
}

function getFinalProductOrderDescription(order) {
    return String(order?.['Açıklama'] || order?.description || order?.rxnName || '').trim();
}

function getFinalProductOrderLotNo(order) {
    return String(order?.['Lot No'] || order?.['LOT NO'] || order?.lotNo || '').trim();
}

function getFinalProductOrderNo(order) {
    return String(order?.['Belge No'] || order?.orderNo || order?.documentNo || '').trim();
}

function getFinalProductOrderQuantity(order) {
    const parsed = typeof parseSalesQuantityNumber === 'function'
        ? parseSalesQuantityNumber(order?.['Miktar'])
        : Number(String(order?.['Miktar'] || '').replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getFinalProductStockActor() {
    const actor = typeof getCurrentSalesLineActor === 'function' ? getCurrentSalesLineActor() : {};
    return {
        uid: actor.uid || null,
        paraf: actor.paraf || 'unknown'
    };
}

function buildFinalProductStockBase(order) {
    const now = new Date().toISOString();
    const actor = getFinalProductStockActor();
    return {
        salesLineId: getFinalProductSalesLineId(order),
        productNo: getFinalProductOrderProductNo(order),
        description: getFinalProductOrderDescription(order),
        lotNo: getFinalProductOrderLotNo(order),
        orderNo: getFinalProductOrderNo(order),
        quantity: getFinalProductOrderQuantity(order),
        createdAt: now,
        updatedAt: now,
        createdBy: actor.paraf,
        updatedBy: actor.paraf,
        createdByUid: actor.uid,
        updatedByUid: actor.uid
    };
}

function buildFinalProductStockMovement(type, base, quantity, fromBin, toBin, movementKey, extra = {}) {
    const now = new Date().toISOString();
    const actor = getFinalProductStockActor();
    return {
        key: movementKey,
        type,
        productNo: base.productNo,
        description: base.description,
        lotNo: extra.lotNo || base.lotNo,
        quantity: Number(quantity) || 0,
        fromBin: fromBin || '',
        toBin: toBin || '',
        orderNo: base.orderNo,
        salesLineId: base.salesLineId,
        sourceSalesLineId: base.salesLineId,
        createdAt: now,
        createdBy: actor.paraf,
        createdByUid: actor.uid,
        ...extra
    };
}

function upsertFinalProductStockItem(root, itemKey, patch, quantityDelta) {
    root.items = root.items || {};
    const now = new Date().toISOString();
    const actor = getFinalProductStockActor();
    const current = root.items[itemKey] || {};
    const nextQty = (Number(current.quantity) || 0) + (Number(quantityDelta) || 0);
    root.items[itemKey] = {
        ...current,
        ...patch,
        quantity: nextQty < 0 ? 0 : nextQty,
        updatedAt: now,
        updatedBy: actor.paraf,
        updatedByUid: actor.uid,
        createdAt: current.createdAt || patch.createdAt || now,
        createdBy: current.createdBy || patch.createdBy || actor.paraf,
        createdByUid: current.createdByUid || patch.createdByUid || actor.uid
    };
}

function hasFinalProductMovement(root, key) {
    return !!(root?.movements && root.movements[buildFinalProductStockKey(key)]);
}

async function transactFinalProductStock(mutator) {
    if (!await ensureFinalProductStockAuth()) {
        showToast('Firebase oturumu doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin.', 'warning');
        return { committed: false, result: null };
    }
    const ref = getFinalProductStockDbRef();
    let resultPayload = null;
    const result = await ref.transaction(current => {
        const root = current && typeof current === 'object' ? current : {};
        root.items = root.items || {};
        root.movements = root.movements || {};
        const next = mutator(root);
        if (next === undefined) return;
        resultPayload = next.result || null;
        return next.root || root;
    });
    return { committed: !!result.committed, result: resultPayload };
}

function getFinalProductMovementPatch(order, key, patch = {}) {
    const applied = order?._warehouseMovementsApplied && typeof order._warehouseMovementsApplied === 'object'
        ? { ...order._warehouseMovementsApplied }
        : {};
    applied[key] = true;
    return {
        _warehouseMovementsApplied: applied,
        _finalProductStockUpdatedAt: new Date().toISOString(),
        ...patch
    };
}

async function applyReadyToOrderStock(order) {
    const base = buildFinalProductStockBase(order);
    if (!base.salesLineId || !base.productNo || base.quantity <= 0) {
        showToast('Stok hareketi için katalog no veya miktar eksik.', 'warning');
        return { ok: false };
    }
    const movementKey = `ready:${base.salesLineId}:${base.productNo}:${base.lotNo}:${base.orderNo}`;
    await transactFinalProductStock(root => {
        if (hasFinalProductMovement(root, movementKey)) return { root, result: { skipped: true } };
        const itemKey = buildFinalProductStockKey('reserved', base.salesLineId, base.productNo, base.lotNo, base.orderNo);
        upsertFinalProductStockItem(root, itemKey, {
            ...base,
            id: itemKey,
            bin: FINAL_PRODUCT_ORDER_BIN,
            source: 'ready'
        }, base.quantity);
        const mKey = buildFinalProductStockKey(movementKey);
        root.movements[mKey] = buildFinalProductStockMovement('ready', base, base.quantity, '', FINAL_PRODUCT_ORDER_BIN, movementKey);
        return { root, result: { movementKey } };
    });
    return { ok: true, patch: getFinalProductMovementPatch(order, movementKey) };
}

async function applyReadyWithExtraStock(order) {
    const base = buildFinalProductStockBase(order);
    if (!base.salesLineId || !base.productNo || base.quantity <= 0) {
        showToast('Stok hareketi için katalog no veya miktar eksik.', 'warning');
        return { ok: false };
    }
    const orderMovementKey = `ready-extra-order:${base.salesLineId}`;
    const stockMovementKey = `ready-extra-stock:${base.salesLineId}`;
    if (!await ensureFinalProductStockAuth()) {
        showToast('Firebase oturumu doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin.', 'warning');
        return { ok: false };
    }
    const existing = (await getFinalProductStockDbRef(`movements/${buildFinalProductStockKey(stockMovementKey)}`).once('value')).val();
    let stockQty = Number(existing?.quantity) || 0;
    if (!existing) {
        const suggestedQty = String(order?._stockCollectedQty || order?.['Miktar'] || '').trim();
        const answer = prompt('Kaç adet stok toplandı?', suggestedQty);
        if (answer === null) return { ok: false };
        stockQty = typeof parseSalesQuantityNumber === 'function'
            ? parseSalesQuantityNumber(answer)
            : Number(String(answer || '').replace(',', '.'));
        if (!Number.isFinite(stockQty) || stockQty < 0) {
            showToast('Geçerli bir stok adedi girin.', 'warning');
            return { ok: false };
        }
    }
    await transactFinalProductStock(root => {
        if (!hasFinalProductMovement(root, orderMovementKey)) {
            const reservedKey = buildFinalProductStockKey('reserved', base.salesLineId, base.productNo, base.lotNo, base.orderNo);
            upsertFinalProductStockItem(root, reservedKey, {
                ...base,
                id: reservedKey,
                bin: FINAL_PRODUCT_ORDER_BIN,
                source: 'ready_with_extra_stock'
            }, base.quantity);
            root.movements[buildFinalProductStockKey(orderMovementKey)] = buildFinalProductStockMovement(
                'ready_with_extra_stock',
                base,
                base.quantity,
                '',
                FINAL_PRODUCT_ORDER_BIN,
                orderMovementKey
            );
        }
        if (stockQty > 0 && !hasFinalProductMovement(root, stockMovementKey)) {
            const stockKey = buildFinalProductStockKey('stock', base.productNo, base.lotNo);
            upsertFinalProductStockItem(root, stockKey, {
                ...base,
                id: stockKey,
                bin: FINAL_PRODUCT_STOCK_BIN,
                orderNo: '',
                salesLineId: '',
                sourceSalesLineId: base.salesLineId,
                source: 'ready_with_extra_stock'
            }, stockQty);
            root.movements[buildFinalProductStockKey(stockMovementKey)] = buildFinalProductStockMovement(
                'ready_with_extra_stock',
                base,
                stockQty,
                '',
                FINAL_PRODUCT_STOCK_BIN,
                stockMovementKey
            );
        }
        return { root, result: { movementKey: stockMovementKey } };
    });
    return {
        ok: true,
        patch: getFinalProductMovementPatch(order, stockMovementKey, {
            _stockCollectedQty: stockQty,
            _stockCollectedAt: new Date().toISOString(),
            _stockCollectedBy: getFinalProductStockActor().paraf
        })
    };
}

async function getAvailableFinalProductStockLots(productNo) {
    if (!await ensureFinalProductStockAuth()) {
        showToast('Firebase oturumu doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin.', 'warning');
        return [];
    }
    const snapshot = await getFinalProductStockDbRef('items').once('value');
    const items = snapshot.val() || {};
    return Object.values(items)
        .filter(item => String(item?.bin || '') === FINAL_PRODUCT_STOCK_BIN)
        .filter(item => String(item?.productNo || '').trim() === String(productNo || '').trim())
        .filter(item => (Number(item?.quantity) || 0) > 0)
        .sort((a, b) => String(a.lotNo || '').localeCompare(String(b.lotNo || ''), 'tr'));
}

async function applyStockToOrder(order) {
    const base = buildFinalProductStockBase(order);
    if (!base.salesLineId || !base.productNo) {
        showToast('Stoktan verilecek ürün için katalog no eksik.', 'warning');
        return { ok: false };
    }
    const movementKey = `stock-to-order:${base.salesLineId}`;
    if (!await ensureFinalProductStockAuth()) {
        showToast('Firebase oturumu doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin.', 'warning');
        return { ok: false };
    }
    const existingMovement = (await getFinalProductStockDbRef(`movements/${buildFinalProductStockKey(movementKey)}`).once('value')).val();
    if (existingMovement) {
        return {
            ok: true,
            patch: getFinalProductMovementPatch(order, movementKey, {
                _stockIssueLotNo: existingMovement.lotNo || '',
                _stockIssueQty: Number(existingMovement.quantity) || 0,
                _stockIssueAt: existingMovement.createdAt || new Date().toISOString(),
                _stockIssueBy: existingMovement.createdBy || ''
            })
        };
    }
    const lots = await getAvailableFinalProductStockLots(base.productNo);
    if (lots.length === 0) {
        showToast('Bu ürün için stokta uygun lot bulunamadı', 'warning');
        return { ok: false };
    }
    const lotText = lots.map((item, index) => `${index + 1}) ${item.lotNo || 'Lot yok'} - ${item.quantity} adet`).join('\n');
    const selection = prompt(`Uygun lotlar:\n${lotText}\n\nKullanılacak lot numarasını seçin:`, '1');
    if (selection === null) return { ok: false };
    const selected = lots[(Number(selection) || 0) - 1];
    if (!selected) {
        showToast('Geçerli bir lot seçin.', 'warning');
        return { ok: false };
    }
    const qtyAnswer = prompt('Bu lottan kaç adet kullanılacak?', String(Math.min(Number(selected.quantity) || 0, base.quantity || Number(selected.quantity) || 0)));
    if (qtyAnswer === null) return { ok: false };
    const qty = typeof parseSalesQuantityNumber === 'function'
        ? parseSalesQuantityNumber(qtyAnswer)
        : Number(String(qtyAnswer || '').replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
        showToast('Geçerli bir miktar girin.', 'warning');
        return { ok: false };
    }
    if (qty > (Number(selected.quantity) || 0)) {
        showToast('Bu lottaki stok yetersiz', 'warning');
        return { ok: false };
    }
    const tx = await transactFinalProductStock(root => {
        if (hasFinalProductMovement(root, movementKey)) return { root, result: { skipped: true } };
        const stockItem = root.items[selected.id] || selected;
        const currentQty = Number(stockItem.quantity) || 0;
        if (currentQty < qty) {
            return;
        }
        upsertFinalProductStockItem(root, selected.id, stockItem, -qty);
        const reservedKey = buildFinalProductStockKey('reserved', base.salesLineId, base.productNo, selected.lotNo, base.orderNo);
        upsertFinalProductStockItem(root, reservedKey, {
            ...base,
            id: reservedKey,
            lotNo: selected.lotNo || '',
            bin: FINAL_PRODUCT_ORDER_BIN,
            source: 'stock_to_order'
        }, qty);
        root.movements[buildFinalProductStockKey(movementKey)] = buildFinalProductStockMovement(
            'stock_to_order',
            base,
            qty,
            FINAL_PRODUCT_STOCK_BIN,
            FINAL_PRODUCT_ORDER_BIN,
            movementKey,
            { lotNo: selected.lotNo || '' }
        );
        return { root, result: { movementKey } };
    });
    if (!tx.committed) {
        showToast('Bu lottaki stok yetersiz', 'warning');
        return { ok: false };
    }
    return {
        ok: true,
        patch: getFinalProductMovementPatch(order, movementKey, {
            _stockIssueLotNo: selected.lotNo || '',
            _stockIssueQty: qty,
            _stockIssueAt: new Date().toISOString(),
            _stockIssueBy: getFinalProductStockActor().paraf,
            _stockIssue: {
                sourceLotNo: selected.lotNo || '',
                quantity: qty,
                issuedAt: new Date().toISOString(),
                issuedBy: getFinalProductStockActor().paraf,
                fromBin: FINAL_PRODUCT_STOCK_BIN,
                toBin: FINAL_PRODUCT_ORDER_BIN
            }
        })
    };
}

async function applyPickedFromOrderStock(order) {
    const base = buildFinalProductStockBase(order);
    if (!base.salesLineId) return { ok: false };
    const movementKey = `picked:${base.salesLineId}`;
    const qtyToPick = base.quantity;
    if (qtyToPick <= 0) {
        showToast('Çekme işlemi için miktar eksik.', 'warning');
        return { ok: false };
    }
    let insufficient = false;
    const tx = await transactFinalProductStock(root => {
        if (hasFinalProductMovement(root, movementKey)) return { root, result: { skipped: true } };
        const reservedItems = Object.entries(root.items || {})
            .filter(([, item]) => String(item?.bin || '') === FINAL_PRODUCT_ORDER_BIN)
            .filter(([, item]) => String(item?.salesLineId || '') === base.salesLineId)
            .filter(([, item]) => (Number(item?.quantity) || 0) > 0);
        const reservedQty = reservedItems.reduce((sum, [, item]) => sum + (Number(item.quantity) || 0), 0);
        if (reservedQty < qtyToPick) {
            insufficient = true;
            return;
        }
        let remaining = qtyToPick;
        reservedItems.forEach(([key, item]) => {
            if (remaining <= 0) return;
            const currentQty = Number(item.quantity) || 0;
            const deduct = Math.min(currentQty, remaining);
            upsertFinalProductStockItem(root, key, item, -deduct);
            remaining -= deduct;
        });
        root.movements[buildFinalProductStockKey(movementKey)] = buildFinalProductStockMovement(
            'picked',
            base,
            qtyToPick,
            FINAL_PRODUCT_ORDER_BIN,
            '',
            movementKey
        );
        return { root, result: { movementKey } };
    });
    if (insufficient || !tx.committed) {
        showToast('Siparişe özel kit miktarı yetersiz.', 'warning');
        return { ok: false };
    }
    return { ok: true, patch: getFinalProductMovementPatch(order, movementKey) };
}

async function handleFinalProductStockMovement(order, oldStatus, newStatus) {
    if (!isFinalProductStockEnabled()) return { ok: true, patch: {} };
    const normalized = typeof normalizeSalesStatus === 'function'
        ? normalizeSalesStatus(newStatus)
        : String(newStatus || '').trim().toLocaleLowerCase('tr');
    try {
        if (normalized === 'ürün hazır') return await applyReadyToOrderStock(order);
        if (normalized === 'ürün hazır ve stok toplandı') return await applyReadyWithExtraStock(order);
        if (normalized === 'ürün stoktan verilecek' || normalized === 'stoktan verilecek') return await applyStockToOrder(order);
        if (normalized === 'ürünün çekmesi yapıldı' || normalized === 'çekmesi yapıldı') return await applyPickedFromOrderStock(order);
        return { ok: true, patch: {} };
    } catch (error) {
        console.error('Son ürün stok hareketi uygulanamadı:', error);
        showToast(error?.message || 'Stok hareketi uygulanamadı.', 'error');
        return { ok: false };
    }
}
