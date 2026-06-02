# bioeksenmes

Firebase Hosting uzerinde calisan uretim ve siparis takip uygulamasi.

## Deploy

Canli ortam Firebase Hosting uzerinden yayinlanir:

- Site: `reaksiyontalep`
- Project: `reaksiyontalep`
- URL: https://reaksiyontalep.web.app

Canliya alirken deploy sonrasi acik ekranlara guncelleme bildirimi gitmesi icin su script kullanilir:

```powershell
.\scripts\deploy-hosting-with-build-version.ps1
```

Script `js/init-v4.js` icindeki `APP_BUILD_VERSION` degerini okur, Firebase Hosting deploy eder ve ardindan `/appMeta/buildVersion` alanini ayni degerle gunceller. Bu alan degisince uygulamayi acik tutan kullanicilara "Yeni guncelleme var" bildirimi gosterilir.

GitHub Actions kurulumu tamamlandiktan sonra `main` branch'e merge edilen degisiklikler otomatik olarak canli ortama deploy edilir.
