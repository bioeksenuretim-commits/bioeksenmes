(function () {
    const scripts = {
        sheetjs: {
            globalName: 'XLSX',
            urls: [
                '/js/vendor/xlsx-0.20.3.full.min.js',
                'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
            ],
            integrity: 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT',
            promise: null
        },
        exceljs: {
            globalName: 'ExcelJS',
            urls: [
                '/js/vendor/exceljs-4.4.0.min.js',
                'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'
            ],
            integrity: 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz',
            promise: null
        }
    };

    function loadScriptUrl(config, url, isFallback) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.async = true;
            if (isFallback && config.integrity) {
                script.integrity = config.integrity;
                script.crossOrigin = 'anonymous';
            }
            script.onload = () => {
                if (window[config.globalName]) {
                    resolve(window[config.globalName]);
                    return;
                }
                reject(new Error(`${config.globalName} yuklendi ama global nesne bulunamadi`));
            };
            script.onerror = () => reject(new Error(`${config.globalName} yuklenemedi: ${url}`));
            document.head.appendChild(script);
        });
    }

    function loadExternalScript(config) {
        if (window[config.globalName]) return Promise.resolve(window[config.globalName]);
        if (config.promise) return config.promise;

        config.promise = (async () => {
            let lastError = null;
            for (let i = 0; i < config.urls.length; i += 1) {
                try {
                    return await loadScriptUrl(config, config.urls[i], i > 0);
                } catch (error) {
                    lastError = error;
                }
            }
            config.promise = null;
            throw lastError || new Error(`${config.globalName} yuklenemedi`);
        })();

        return config.promise;
    }

    window.ensureSheetJs = function () {
        return loadExternalScript(scripts.sheetjs);
    };

    window.ensureExcelJs = function () {
        return loadExternalScript(scripts.exceljs);
    };
})();
