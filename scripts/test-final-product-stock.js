const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getAtPath(root, pathParts) {
    return pathParts.reduce((value, part) => value && value[part], root);
}

function createHarness() {
    let databaseRoot = {};
    const prompts = [];
    const toasts = [];

    function ref(pathValue = '') {
        const pathParts = String(pathValue || '').split('/').filter(Boolean);
        return {
            async once() {
                return { val: () => clone(getAtPath(databaseRoot, pathParts)) };
            },
            async transaction(mutator) {
                const current = clone(getAtPath(databaseRoot, pathParts));
                const next = mutator(current);
                if (next === undefined) return { committed: false };
                if (pathParts.length === 0) {
                    databaseRoot = clone(next);
                } else {
                    let cursor = databaseRoot;
                    pathParts.slice(0, -1).forEach(part => {
                        cursor[part] = cursor[part] || {};
                        cursor = cursor[part];
                    });
                    cursor[pathParts[pathParts.length - 1]] = clone(next);
                }
                return { committed: true };
            }
        };
    }

    const context = {
        console,
        Date,
        encodeURIComponent,
        setTimeout,
        clearTimeout,
        window: {},
        isSalesLinesDevEnvironment: () => true,
        getSalesLinesDbPrefix: () => '',
        getCurrentSalesLineActor: () => ({ uid: 'test-user', paraf: 'TST' }),
        parseSalesQuantityNumber: value => Number(String(value || '').replace(',', '.')),
        normalizeSalesStatus: value => String(value || '').trim().toLocaleLowerCase('tr'),
        showToast: (message, type) => toasts.push({ message, type }),
        prompt: () => prompts.shift() ?? null,
        firebase: {
            auth: () => ({
                currentUser: { uid: 'test-user' },
                onAuthStateChanged: callback => {
                    callback({ uid: 'test-user' });
                    return () => {};
                }
            }),
            database: () => ({ ref })
        }
    };
    context.firebase.auth.updateCurrentUser = async () => {};
    context.window = { parent: null, firebase: context.firebase };

    const sourcePath = path.join(__dirname, '..', 'js', 'sales-lines', 'final-product-stock.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const exposed = `
        this.stockApi = {
            buildFinalProductStockBase,
            buildFinalProductStockKey,
            handleFinalProductStockMovement,
            upsertFinalProductStockItem
        };
    `;
    vm.runInNewContext(`${source}\n${exposed}`, context, { filename: sourcePath });

    return {
        api: context.stockApi,
        prompts,
        toasts,
        getRoot: () => databaseRoot,
        setRoot: value => { databaseRoot = clone(value); }
    };
}

function getItems(root, bin) {
    return Object.values(root.items || {}).filter(item => item.bin === bin);
}

function sumQuantity(items) {
    return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

async function run() {
    const harness = createHarness();
    const { api, prompts } = harness;
    const order = {
        _id: 'line-1',
        'Ürün No': 'KIT-1',
        'Açıklama': 'Test Kit',
        'Lot No': 'LOT-1',
        'Belge No': 'ORD-1',
        Miktar: 5
    };

    const zeroRoot = { items: { item: { quantity: 2 } } };
    api.upsertFinalProductStockItem(zeroRoot, 'item', {}, -2);
    assert.strictEqual(zeroRoot.items.item, undefined, 'Sıfır miktarlı item silinmeli');

    await api.handleFinalProductStockMovement(order, 'Ürün Planlandı', 'Ürün Hazır');
    let root = harness.getRoot().finalProductStock;
    assert.strictEqual(sumQuantity(getItems(root, 'SİPARİŞE ÖZEL KİTLER')), 5);

    await api.handleFinalProductStockMovement(order, 'Ürün Hazır', 'Ürün Hazır');
    root = harness.getRoot().finalProductStock;
    assert.strictEqual(sumQuantity(getItems(root, 'SİPARİŞE ÖZEL KİTLER')), 5, 'Hazır hareketi çift yazılmamalı');

    root.items = {};
    harness.setRoot({ finalProductStock: root });
    await api.handleFinalProductStockMovement(order, 'Ürün Hazır', 'Ürün Hazır');
    root = harness.getRoot().finalProductStock;
    assert.strictEqual(
        sumQuantity(getItems(root, 'SİPARİŞE ÖZEL KİTLER')),
        5,
        'Aktif hazır hareketinin eksik rezervasyonu onarılmalı'
    );

    await api.handleFinalProductStockMovement(order, 'Ürün Hazır', 'Ürün Hazır');
    root = harness.getRoot().finalProductStock;
    assert.strictEqual(
        sumQuantity(getItems(root, 'SİPARİŞE ÖZEL KİTLER')),
        5,
        'Rezervasyon onarımı miktarı çift yazmamalı'
    );

    prompts.push('3');
    await api.handleFinalProductStockMovement(order, 'Ürün Hazır', 'Ürün Hazır ve Stok Toplandı');
    root = harness.getRoot().finalProductStock;
    assert.strictEqual(sumQuantity(getItems(root, 'SİPARİŞE ÖZEL KİTLER')), 5, 'Sipariş rezervasyonu tekrar eklenmemeli');
    assert.strictEqual(sumQuantity(getItems(root, 'STOK KİTLER')), 3, 'Ekstra stok eklenmeli');

    await api.handleFinalProductStockMovement(order, 'Ürün Hazır ve Stok Toplandı', 'Ürün Hazır ve Stok Toplandı');
    root = harness.getRoot().finalProductStock;
    assert.strictEqual(sumQuantity(getItems(root, 'SİPARİŞE ÖZEL KİTLER')), 5);
    assert.strictEqual(sumQuantity(getItems(root, 'STOK KİTLER')), 3);

    await api.handleFinalProductStockMovement(order, 'Ürün Hazır ve Stok Toplandı', 'Ürün Planlandı');
    root = harness.getRoot().finalProductStock;
    assert.strictEqual(getItems(root, 'SİPARİŞE ÖZEL KİTLER').length, 0, 'Rezervasyon geri alınmalı');
    assert.strictEqual(getItems(root, 'STOK KİTLER').length, 0, 'Ekstra stok geri alınmalı');
    assert.ok(
        Object.values(root.movements || {}).some(item => item.type === 'revert_ready_with_extra_stock'),
        'Hazır ve stok toplandı geri alma hareketi loglanmalı'
    );

    await api.handleFinalProductStockMovement(order, 'Ürün Planlandı', 'Ürün Hazır');
    root = harness.getRoot().finalProductStock;
    root.items = {};
    harness.setRoot({ finalProductStock: root });
    await api.handleFinalProductStockMovement(order, 'Ürün Hazır', 'Ürünün Çekmesi Yapıldı');
    root = harness.getRoot().finalProductStock;
    assert.strictEqual(getItems(root, 'SİPARİŞE ÖZEL KİTLER').length, 0, 'Çekilen rezervasyon tamamen silinmeli');

    await api.handleFinalProductStockMovement(order, 'Ürünün Çekmesi Yapıldı', 'Ürün Planlandı');
    root = harness.getRoot().finalProductStock;
    assert.strictEqual(sumQuantity(getItems(root, 'SİPARİŞE ÖZEL KİTLER')), 5, 'Çekme geri alındığında rezervasyon dönmeli');
    assert.ok(
        Object.values(root.movements || {}).some(item => item.type === 'revert_picked'),
        'Çekme geri alma hareketi loglanmalı'
    );

    const stockKey = api.buildFinalProductStockKey('stock', 'KIT-2', 'LOT-S');
    harness.setRoot({
        finalProductStock: {
            items: {
                [stockKey]: {
                    id: stockKey,
                    productNo: 'KIT-2',
                    lotNo: 'LOT-S',
                    quantity: 10,
                    bin: 'STOK KİTLER'
                }
            },
            movements: {}
        }
    });
    const stockOrder = {
        _id: 'line-2',
        'Ürün No': 'KIT-2',
        'Açıklama': 'Stock Kit',
        'Belge No': 'ORD-2',
        Miktar: 4
    };
    prompts.push('1', '4');
    await api.handleFinalProductStockMovement(stockOrder, 'Ürün Planlandı', 'Ürün Stoktan Verilecek');
    root = harness.getRoot().finalProductStock;
    assert.strictEqual(sumQuantity(getItems(root, 'STOK KİTLER')), 6);
    assert.strictEqual(sumQuantity(getItems(root, 'SİPARİŞE ÖZEL KİTLER')), 4);

    await api.handleFinalProductStockMovement(stockOrder, 'Ürün Stoktan Verilecek', 'Ürün Stoktan Verilecek');
    root = harness.getRoot().finalProductStock;
    assert.strictEqual(sumQuantity(getItems(root, 'STOK KİTLER')), 6, 'Stok aktarımı çift düşmemeli');
    assert.strictEqual(sumQuantity(getItems(root, 'SİPARİŞE ÖZEL KİTLER')), 4);

    await api.handleFinalProductStockMovement(stockOrder, 'Ürün Stoktan Verilecek', 'Ürün Planlandı');
    root = harness.getRoot().finalProductStock;
    assert.strictEqual(sumQuantity(getItems(root, 'STOK KİTLER')), 10, 'Stok aktarımı geri dönmeli');
    assert.strictEqual(getItems(root, 'SİPARİŞE ÖZEL KİTLER').length, 0);

    const movementTypes = Object.values(root.movements || {}).map(item => item.type);
    assert.ok(movementTypes.includes('revert_stock_to_order'), 'Stok geri alma hareketi loglanmalı');

    const missingHarness = createHarness();
    const missingResult = await missingHarness.api.handleFinalProductStockMovement(
        {
            _id: 'line-missing',
            'Ürün No': 'KIT-MISSING',
            'Belge No': 'ORD-MISSING',
            Miktar: 1
        },
        'Ürün Planlandı',
        'Ürünün Çekmesi Yapıldı'
    );
    assert.strictEqual(missingResult?.ok, false, 'Rezervasyonsuz çekme reddedilmeli');
    assert.strictEqual(
        missingHarness.toasts.at(-1)?.message,
        'Bu satır için siparişe özel kit bulunamadı. Önce Ürün Hazır hareketini tekrar oluşturun.',
        'Rezervasyon bulunamadığında açıklayıcı uyarı gösterilmeli'
    );

    console.log('final-product-stock regression tests passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
