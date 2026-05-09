(function () {
    const scripts = {
        sheetjs: {
            globalName: 'XLSX',
            url: 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
            promise: null
        },
        exceljs: {
            globalName: 'ExcelJS',
            url: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
            promise: null
        }
    };

    function loadExternalScript(config) {
        if (window[config.globalName]) return Promise.resolve(window[config.globalName]);
        if (config.promise) return config.promise;

        config.promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = config.url;
            script.async = true;
            script.onload = () => resolve(window[config.globalName]);
            script.onerror = () => {
                config.promise = null;
                reject(new Error(`${config.globalName} yuklenemedi`));
            };
            document.head.appendChild(script);
        });

        return config.promise;
    }

    window.ensureSheetJs = function () {
        return loadExternalScript(scripts.sheetjs);
    };

    window.ensureExcelJs = function () {
        return loadExternalScript(scripts.exceljs);
    };
})();
