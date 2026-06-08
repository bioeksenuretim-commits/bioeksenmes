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
    if (nextQty <= 0) {
        delete root.items[itemKey];
        return;
    }
    root.items[itemKey] = {
        ...current,
        ...patch,
        quantity: nextQty,
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

function getFinalProductMovement(root, key) {
    return root?.movements?.[buildFinalProductStockKey(key)] || null;
}

function isFinalProductMovementActive(root, key) {
    const movement = getFinalProductMovement(root, key);
    return !!movement && movement.active !== false;
}

function activateFinalProductMovement(root, key, movement) {
    root.movements = root.movements || {};
    const encodedKey = buildFinalProductStockKey(key);
    const current = root.movements[encodedKey];
    const actor = getFinalProductStockActor();
    if (!current) {
        root.movements[encodedKey] = {
            ...movement,
            active: true,
            activationVersion: 1
        };
        return root.movements[encodedKey];
    }
    root.movements[encodedKey] = {
        ...current,
        ...movement,
        active: true,
        activationVersion: Math.max(1, Number(current.activationVersion) || 1) + (current.active === false ? 1 : 0),
        reappliedAt: current.active === false ? new Date().toISOString() : current.reappliedAt || '',
        reappliedBy: current.active === false ? actor.paraf : current.reappliedBy || ''
    };
    return root.movements[encodedKey];
}

function deactivateFinalProductMovement(root, key) {
    const encodedKey = buildFinalProductStockKey(key);
    const movement = root?.movements?.[encodedKey];
    if (!movement || movement.active === false) return null;
    const actor = getFinalProductStockActor();
    root.movements[encodedKey] = {
        ...movement,
        active: false,
        revertedAt: new Date().toISOString(),
        revertedBy: actor.paraf
    };
    return root.movements[encodedKey];
}

function getFinalProductReservedItemKey(base, lotNo = base.lotNo) {
    return buildFinalProductStockKey('reserved', base.salesLineId, base.productNo, lotNo, base.orderNo);
}

function getFinalProductReadyMovementKey(base) {
    return `ready:${base.salesLineId}:${base.productNo}:${base.lotNo}:${base.orderNo}`;
}

function getFinalProductReadyExtraOrderMovementKey(base) {
    return `ready-extra-order:${base.salesLineId}`;
}

function getFinalProductReadyExtraStockMovementKey(base) {
    return `ready-extra-stock:${base.salesLineId}`;
}

function getFinalProductStockToOrderMovementKey(base) {
    return `stock-to-order:${base.salesLineId}`;
}

function getFinalProductPickedMovementKey(base) {
    return `picked:${base.salesLineId}`;
}

function ensureReservedOrderStockOnce(root, base, source, movementKeyCandidates = []) {
    const activeMovementKey = movementKeyCandidates.find(key => isFinalProductMovementActive(root, key));
    if (activeMovementKey) {
        return { added: false, movementKey: activeMovementKey };
    }

    const movementKey = movementKeyCandidates[0] || getFinalProductReadyMovementKey(base);
    const itemKey = getFinalProductReservedItemKey(base);
    upsertFinalProductStockItem(root, itemKey, {
        ...base,
        id: itemKey,
        bin: FINAL_PRODUCT_ORDER_BIN,
        source
    }, base.quantity);
    activateFinalProductMovement(
        root,
        movementKey,
        buildFinalProductStockMovement(source, base, base.quantity, '', FINAL_PRODUCT_ORDER_BIN, movementKey)
    );
    return { added: true, movementKey };
}

function buildFinalProductMovementBase(movement, fallbackBase) {
    return {
        ...fallbackBase,
        salesLineId: movement?.salesLineId || movement?.sourceSalesLineId || fallbackBase.salesLineId,
        productNo: movement?.productNo || fallbackBase.productNo,
        description: movement?.description || fallbackBase.description,
        lotNo: movement?.lotNo || fallbackBase.lotNo,
        orderNo: movement?.orderNo || fallbackBase.orderNo,
        quantity: Number(movement?.quantity) || fallbackBase.quantity
    };
}

function revertFinalProductMovementOnce(root, sourceKey, revertType, fallbackBase, reverseMutation) {
    const sourceMovement = getFinalProductMovement(root, sourceKey);
    if (!sourceMovement || sourceMovement.active === false) {
        return { reverted: false, skipped: true };
    }
    const activationVersion = Math.max(1, Number(sourceMovement.activationVersion) || 1);
    const revertKey = `${revertType}:${sourceKey}:v${activationVersion}`;
    if (hasFinalProductMovement(root, revertKey)) {
        deactivateFinalProductMovement(root, sourceKey);
        return { reverted: false, skipped: true, revertKey };
    }

    const movementBase = buildFinalProductMovementBase(sourceMovement, fallbackBase);
    reverseMutation(root, sourceMovement, movementBase);
    deactivateFinalProductMovement(root, sourceKey);
    activateFinalProductMovement(
        root,
        revertKey,
        buildFinalProductStockMovement(
            revertType,
            movementBase,
            Number(sourceMovement.quantity) || 0,
            sourceMovement.toBin || '',
            sourceMovement.fromBin || '',
            revertKey,
            {
                sourceMovementKey: sourceKey,
                sourceMovementType: sourceMovement.type || ''
            }
        )
    );
    return { reverted: true, revertKey };
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
    const movementKey = getFinalProductReadyMovementKey(base);
    await transactFinalProductStock(root => {
        if (isFinalProductMovementActive(root, movementKey)) return { root, result: { skipped: true } };
        ensureReservedOrderStockOnce(root, base, 'ready', [movementKey]);
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
    const orderMovementKey = getFinalProductReadyExtraOrderMovementKey(base);
    const stockMovementKey = getFinalProductReadyExtraStockMovementKey(base);
    if (!await ensureFinalProductStockAuth()) {
        showToast('Firebase oturumu doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin.', 'warning');
        return { ok: false };
    }
    const existing = (await getFinalProductStockDbRef(`movements/${buildFinalProductStockKey(stockMovementKey)}`).once('value')).val();
    const existingIsActive = !!existing && existing.active !== false;
    let stockQty = existingIsActive ? Number(existing?.quantity) || 0 : 0;
    if (!existingIsActive) {
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
        const readyMovementKey = getFinalProductReadyMovementKey(base);
        const reservation = ensureReservedOrderStockOnce(
            root,
            base,
            'ready_with_extra_stock',
            [orderMovementKey, readyMovementKey]
        );
        if (!isFinalProductMovementActive(root, orderMovementKey)) {
            activateFinalProductMovement(
                root,
                orderMovementKey,
                buildFinalProductStockMovement(
                    'ready_with_extra_stock',
                    base,
                    reservation.added ? base.quantity : 0,
                    '',
                    FINAL_PRODUCT_ORDER_BIN,
                    orderMovementKey,
                    {
                        reservationAdded: reservation.added,
                        reservedMovementKey: reservation.movementKey
                    }
                )
            );
        }
        if (stockQty > 0 && !isFinalProductMovementActive(root, stockMovementKey)) {
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
            activateFinalProductMovement(
                root,
                stockMovementKey,
                buildFinalProductStockMovement(
                    'ready_with_extra_stock',
                    base,
                    stockQty,
                    '',
                    FINAL_PRODUCT_STOCK_BIN,
                    stockMovementKey
                )
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
    const movementKey = getFinalProductStockToOrderMovementKey(base);
    if (!await ensureFinalProductStockAuth()) {
        showToast('Firebase oturumu doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin.', 'warning');
        return { ok: false };
    }
    const existingMovement = (await getFinalProductStockDbRef(`movements/${buildFinalProductStockKey(movementKey)}`).once('value')).val();
    if (existingMovement && existingMovement.active !== false) {
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
        if (isFinalProductMovementActive(root, movementKey)) return { root, result: { skipped: true } };
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
        activateFinalProductMovement(
            root,
            movementKey,
            buildFinalProductStockMovement(
                'stock_to_order',
                base,
                qty,
                FINAL_PRODUCT_STOCK_BIN,
                FINAL_PRODUCT_ORDER_BIN,
                movementKey,
                {
                    lotNo: selected.lotNo || '',
                    sourceItemKey: selected.id || buildFinalProductStockKey('stock', base.productNo, selected.lotNo)
                }
            )
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
    const movementKey = getFinalProductPickedMovementKey(base);
    const qtyToPick = base.quantity;
    if (qtyToPick <= 0) {
        showToast('Çekme işlemi için miktar eksik.', 'warning');
        return { ok: false };
    }
    let insufficient = false;
    const tx = await transactFinalProductStock(root => {
        if (isFinalProductMovementActive(root, movementKey)) return { root, result: { skipped: true } };
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
        const pickedItems = [];
        reservedItems.forEach(([key, item]) => {
            if (remaining <= 0) return;
            const currentQty = Number(item.quantity) || 0;
            const deduct = Math.min(currentQty, remaining);
            upsertFinalProductStockItem(root, key, item, -deduct);
            pickedItems.push({
                itemKey: key,
                quantity: deduct,
                lotNo: item.lotNo || '',
                source: item.source || ''
            });
            remaining -= deduct;
        });
        activateFinalProductMovement(
            root,
            movementKey,
            buildFinalProductStockMovement(
                'picked',
                base,
                qtyToPick,
                FINAL_PRODUCT_ORDER_BIN,
                '',
                movementKey,
                { pickedItems }
            )
        );
        return { root, result: { movementKey } };
    });
    if (insufficient || !tx.committed) {
        showToast('Siparişe özel kit miktarı yetersiz.', 'warning');
        return { ok: false };
    }
    return { ok: true, patch: getFinalProductMovementPatch(order, movementKey) };
}

function normalizeFinalProductStockStatus(status) {
    return typeof normalizeSalesStatus === 'function'
        ? normalizeSalesStatus(status)
        : String(status || '').trim().toLocaleLowerCase('tr');
}

function isFinalProductPickedStatus(status) {
    return status === 'ürünün çekmesi yapıldı' || status === 'çekmesi yapıldı';
}

function restorePickedFinalProductItems(root, movement, base) {
    const pickedItems = Array.isArray(movement?.pickedItems) ? movement.pickedItems : [];
    if (pickedItems.length > 0) {
        pickedItems.forEach(item => {
            const itemKey = item.itemKey || getFinalProductReservedItemKey(base, item.lotNo || base.lotNo);
            upsertFinalProductStockItem(root, itemKey, {
                ...base,
                id: itemKey,
                lotNo: item.lotNo || base.lotNo,
                bin: FINAL_PRODUCT_ORDER_BIN,
                source: item.source || 'revert_picked'
            }, Number(item.quantity) || 0);
        });
        return;
    }

    const itemKey = getFinalProductReservedItemKey(base, movement?.lotNo || base.lotNo);
    upsertFinalProductStockItem(root, itemKey, {
        ...base,
        id: itemKey,
        lotNo: movement?.lotNo || base.lotNo,
        bin: FINAL_PRODUCT_ORDER_BIN,
        source: 'revert_picked'
    }, Number(movement?.quantity) || base.quantity);
}

async function revertReadyToOrderStock(order, revertType = 'revert_ready') {
    const base = buildFinalProductStockBase(order);
    const movementKey = getFinalProductReadyMovementKey(base);
    await transactFinalProductStock(root => {
        revertFinalProductMovementOnce(root, movementKey, revertType, base, (nextRoot, movement, movementBase) => {
            const itemKey = getFinalProductReservedItemKey(movementBase, movement.lotNo || movementBase.lotNo);
            upsertFinalProductStockItem(nextRoot, itemKey, {}, -(Number(movement.quantity) || movementBase.quantity));
        });
        return { root, result: { movementKey } };
    });
    return { ok: true, patch: { _finalProductStockUpdatedAt: new Date().toISOString() } };
}

async function revertReadyWithExtraStock(order) {
    const base = buildFinalProductStockBase(order);
    const orderMovementKey = getFinalProductReadyExtraOrderMovementKey(base);
    const stockMovementKey = getFinalProductReadyExtraStockMovementKey(base);
    const readyMovementKey = getFinalProductReadyMovementKey(base);

    await transactFinalProductStock(root => {
        const orderMovement = getFinalProductMovement(root, orderMovementKey);
        const reservedMovementKey = orderMovement?.reservedMovementKey
            || (isFinalProductMovementActive(root, readyMovementKey) ? readyMovementKey : orderMovementKey);

        revertFinalProductMovementOnce(
            root,
            reservedMovementKey,
            'revert_ready_with_extra_stock',
            base,
            (nextRoot, movement, movementBase) => {
                const itemKey = getFinalProductReservedItemKey(movementBase, movement.lotNo || movementBase.lotNo);
                upsertFinalProductStockItem(nextRoot, itemKey, {}, -(Number(movement.quantity) || movementBase.quantity));
            }
        );

        if (orderMovementKey !== reservedMovementKey && isFinalProductMovementActive(root, orderMovementKey)) {
            revertFinalProductMovementOnce(
                root,
                orderMovementKey,
                'revert_ready_with_extra_stock',
                base,
                () => {}
            );
        }

        revertFinalProductMovementOnce(
            root,
            stockMovementKey,
            'revert_ready_with_extra_stock',
            base,
            (nextRoot, movement, movementBase) => {
                const stockKey = buildFinalProductStockKey('stock', movementBase.productNo, movement.lotNo || movementBase.lotNo);
                upsertFinalProductStockItem(nextRoot, stockKey, {}, -(Number(movement.quantity) || 0));
            }
        );
        return { root, result: { orderMovementKey, stockMovementKey } };
    });
    return { ok: true, patch: { _finalProductStockUpdatedAt: new Date().toISOString() } };
}

async function revertStockToOrder(order) {
    const base = buildFinalProductStockBase(order);
    const movementKey = getFinalProductStockToOrderMovementKey(base);
    await transactFinalProductStock(root => {
        revertFinalProductMovementOnce(root, movementKey, 'revert_stock_to_order', base, (nextRoot, movement, movementBase) => {
            const quantity = Number(movement.quantity) || 0;
            const lotNo = movement.lotNo || movementBase.lotNo;
            const reservedKey = getFinalProductReservedItemKey(movementBase, lotNo);
            upsertFinalProductStockItem(nextRoot, reservedKey, {}, -quantity);

            const stockKey = movement.sourceItemKey || buildFinalProductStockKey('stock', movementBase.productNo, lotNo);
            upsertFinalProductStockItem(nextRoot, stockKey, {
                ...movementBase,
                id: stockKey,
                lotNo,
                bin: FINAL_PRODUCT_STOCK_BIN,
                orderNo: '',
                salesLineId: '',
                sourceSalesLineId: movementBase.salesLineId,
                source: 'revert_stock_to_order'
            }, quantity);
        });
        return { root, result: { movementKey } };
    });
    return { ok: true, patch: { _finalProductStockUpdatedAt: new Date().toISOString() } };
}

async function revertPickedFromOrderStock(order) {
    const base = buildFinalProductStockBase(order);
    const movementKey = getFinalProductPickedMovementKey(base);
    await transactFinalProductStock(root => {
        revertFinalProductMovementOnce(root, movementKey, 'revert_picked', base, (nextRoot, movement, movementBase) => {
            restorePickedFinalProductItems(nextRoot, movement, movementBase);
        });
        return { root, result: { movementKey } };
    });
    return { ok: true, patch: { _finalProductStockUpdatedAt: new Date().toISOString() } };
}

async function revertPreviousFinalProductStockMovement(order, oldStatus, newStatus) {
    const previous = normalizeFinalProductStockStatus(oldStatus);
    const next = normalizeFinalProductStockStatus(newStatus);
    if (!previous || previous === next) return { ok: true, patch: {} };

    if (isFinalProductPickedStatus(previous)) {
        return await revertPickedFromOrderStock(order);
    }

    // Çekme, mevcut rezervasyonu tüketen normal devam adımıdır.
    if (isFinalProductPickedStatus(next)) return { ok: true, patch: {} };

    // Hazırdan stok toplandıya geçiş aynı sipariş rezervasyonunu yeniden yazmamalıdır.
    if (previous === 'ürün hazır' && next === 'ürün hazır ve stok toplandı') {
        return { ok: true, patch: {} };
    }

    if (previous === 'ürün hazır') {
        return await revertReadyToOrderStock(order);
    }
    if (previous === 'ürün hazır ve stok toplandı') {
        return await revertReadyWithExtraStock(order);
    }
    if (previous === 'ürün stoktan verilecek' || previous === 'stoktan verilecek') {
        return await revertStockToOrder(order);
    }
    return { ok: true, patch: {} };
}

async function handleFinalProductStockMovement(order, oldStatus, newStatus) {
    if (!isFinalProductStockEnabled()) return { ok: true, patch: {} };
    const normalized = normalizeFinalProductStockStatus(newStatus);
    try {
        const previous = normalizeFinalProductStockStatus(oldStatus);
        const isReadyWithExtra = normalized === 'ürün hazır ve stok toplandı';
        const isStockToOrder = normalized === 'ürün stoktan verilecek' || normalized === 'stoktan verilecek';

        // Kullanıcı girdisi isteyen hareketlerde iptal edilirse eski depo durumu korunur.
        if (isReadyWithExtra || isStockToOrder) {
            const applied = isReadyWithExtra
                ? await applyReadyWithExtraStock(order)
                : await applyStockToOrder(order);
            if (!applied?.ok) return applied;

            const keepReadyReservation = previous === 'ürün hazır' && isReadyWithExtra;
            if (!keepReadyReservation) {
                const revertedAfterApply = await revertPreviousFinalProductStockMovement(order, oldStatus, newStatus);
                if (!revertedAfterApply?.ok) return revertedAfterApply;
            }
            return applied;
        }

        const reverted = await revertPreviousFinalProductStockMovement(order, oldStatus, newStatus);
        if (!reverted?.ok) return reverted;
        if (normalized === 'ürün hazır') return await applyReadyToOrderStock(order);
        if (normalized === 'ürünün çekmesi yapıldı' || normalized === 'çekmesi yapıldı') return await applyPickedFromOrderStock(order);
        return { ok: true, patch: {} };
    } catch (error) {
        console.error('Son ürün stok hareketi uygulanamadı:', error);
        showToast(error?.message || 'Stok hareketi uygulanamadı.', 'error');
        return { ok: false };
    }
}
