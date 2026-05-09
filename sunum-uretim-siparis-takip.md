# Uretim ve Siparis Takip Sistemi Sunumu

---

## 1. Sistem Ne Ise Yarar?

Bu sistem satis siparislerinden uretim taleplerinin olusturulmasini, taleplerin takibini ve departmanlar arasi durum bilgisinin tek ekrandan yonetilmesini saglar.

Ana hedefler:

- Satis siparislerini tek listede takip etmek
- Katalog numarasina gore urun agacindaki bilesenleri talep listesine dusurmek
- Talep, uretim, QC, lojistik ve cikis durumlarini izlemek
- Geciken, yaklasan, cikisi yapilan ve iptal edilen kayitlari ayirmak
- Her departmana sadece kendi is akisi icin gerekli alanlari gostermek

---

## 2. Ana Moduller

Sistemde kullanilan temel bolumler:

- Satis satirlari
- Talep listesi
- Acil beklenen talepler
- Karsiligi olmayan urunler
- Degisiklikler listesi
- Geciken ve yaklasan siparisler
- Cikis / iptal listeleri
- Urun agaci yonetimi
- Admin paneli
- Veri yedekleme ve disa aktarma

---

## 3. Departman Yetkileri

| Departman / Rol | Satis Satirlari | Talep Listesi | Talep Geç | Belge No'dan Talep Durumu | Silme / Sifirlama | Admin Paneli |
|---|---|---|---|---|---|---|
| Admin | Gorur | Gorur | Kullanir | Gorur | Kullanir | Gorur |
| Uretim | Gorur | Gorur | Kullanir | Gorur | Kullanamaz | Goremez |
| Satis | Gorur | Goremez | Kullanamaz | Goremez | Kullanamaz | Goremez |
| Lojistik | Gorur | Goremez | Kullanamaz | Goremez | Kullanamaz | Goremez |

Not:

Satis ve lojistik ekipleri satis siparislerinin talebe donusup donusmedigini belge numarasi uzerinden goremez. Bu ekiplerde `Talep Geç` butonu yerine sadece `Degisiklikler` butonu gorunur.

---

## 4. Satis Siparisi Nasil Yuklenir?

1. Kullanici `Satis satirlari` ekranina girer.
2. Excel dosyasi yuklenir.
3. Sistem satis satirlarini tabloya aktarir.
4. Her satirda hafta, temsilci, siparis tarihi, belge aciklamasi, belge no, musteri, urun no, aciklama, miktar, teslim tarihi ve urun durumu gorunur.
5. Yuklenen satis satirlari filtrelenebilir, aranabilir ve Excel/CSV olarak disa aktarilabilir.

Yukleme sonrasi sistem:

- Tarihleri Excel'deki tarih formatina gore okur
- Belge aciklamasini `Belge Aciklamasi` sutunundan alir
- `Belge Turu` verisini kullanmaz
- Satis satirlarini durum ve teslim tarihine gore dashboardlarda siniflandirir

---

## 5. Manuel Satis Siparisi Nasil Girilir?

1. `Satis satirlari` ekraninda `Manuel Siparis` butonuna basilir.
2. Listenin en ustune bos bir satir eklenir.
3. Kullanici urun no, belge no, musteri, miktar, teslim tarihi gibi bilgileri manuel girer.
4. Hafta sutunu 1-52 arasindan secilebilir.
5. Eger girilen katalog numarasi sistemdeki urun agacinda varsa, yetkili kullanici `Talep Geç` dediginde ilgili bilesenler talep listesine duser.

Manuel satirlarda da:

- Belge no duzenlenebilir
- Durum guncellenebilir
- Degisiklik gecmisi tutulur
- Yetkili kullanici belge no uzerinden bagli talepleri gorebilir

---

## 6. Talep Nasil Gecilir?

Talep gecme islemi uretim veya admin yetkisine sahip kullanicilar tarafindan yapilir.

Tek satir talep gecme:

1. `Satis satirlari` ekraninda ilgili siparis satiri bulunur.
2. `Talep Geç` butonuna basilir.
3. Sistem urun no / katalog no bilgisini urun agacinda arar.
4. Eslesen bilesenler talep listesine otomatik eklenir.
5. Satirda talep gecildigi bilgisi kaydedilir.

Talep gecildiginde talep listesine su bilgiler duser:

- Hafta
- Talep tarihi
- Cikis tarihi
- Siparis no
- Talep eden
- Katalog no
- Madde no
- Rxn adi
- Format
- Miktar
- Lot no
- Durum

---

## 7. Toplu Talep Gecme

Toplu talep gecme admin ve uretim yetkisine sahip kullanicilar icindir.

Islem akisi:

1. `Toplu Talep Geç` butonuna basilir.
2. Sistem kullaniciya `Kacinci hafta?` sorusunu gosterir.
3. Kullanici hafta numarasini girer.
4. Sistem o haftadaki satis satirlarini bulur.
5. Talebi henuz gecilmemis satirlarin talepleri toplu olarak olusturulur.
6. Bilesenler talep listesine tek seferde aktarilir.

Karsiligi olmayan katalog numaralari:

- Talep listesinde `Karsiligi olmayan` listesine eklenir.
- Satis satirinda `Karsiligi Yok` olarak gorunur.
- Bu satirlar daha sonra urun agaci guncellenerek takip edilebilir.

---

## 8. Talep Tarihi ve Cikis Tarihi Mantigi

Satis satirindan talep gecildiginde:

- `Talep Tarihi`: talebin gecildigi gun olur.
- `Cikis Tarihi`: talep tarihinden 3 hafta sonrasi olur.

Manuel talep girildiginde:

- Kullanici talep tarihini ve cikis tarihini duzenleyebilir.
- Talep listesinde tarih alanlari filtrelenebilir ve siralanabilir.

---

## 9. Acil Beklenen Talepler

`Acil beklenen` listesi talep tablosundaki bilesenlerin `Cikis Tarihi` alanina gore calisir.

Listeye girenler:

- Cikis tarihine 3 gun veya daha az kalanlar
- Cikis tarihi gecmis olanlar

Listeye girmeyenler:

- Teslim edildi durumundakiler
- Iptal edildi durumundakiler
- Urun cikti durumundakiler
- Urun iptal edildi durumundakiler

Bu liste uretimin oncelikli isleri hizli gormesi icin kullanilir.

---

## 10. Talep Listesi Sekmeleri

Talep listesinde farkli ihtiyaclara gore sekmeler bulunur:

- Tumu
- Acil beklenen
- vCAP
- Liyofilize
- Tup format
- Karsiligi olmayan

Her sekme kendi filtresiyle calisir.

Ornek:

- `vCAP` sekmesi sadece vCAP taleplerini gosterir.
- `Acil beklenen` sekmesi sadece cikis tarihi yaklasan veya gecmis talepleri gosterir.
- `Karsiligi olmayan` sekmesi urun agacinda eslesmeyen kataloglari gosterir.

---

## 11. Talep Durumlari

Talep listesinde kullanilan durumlar:

- Islem Bekliyor
- QC Bekliyor
- QC Gecti
- Teslim Edildi
- Etiketlendi
- QC tekrarlanacak
- Imha edilecek
- QC Gidecek
- Dagitildi
- Iptal Edildi

Durum degisiklikleri kayit altina alinir.

Kaydedilen bilgiler:

- Hangi alan degisti
- Eski deger
- Yeni deger
- Degistiren kullanici parafi
- Degisiklik zamani

---

## 12. Satis Satiri Urun Durumlari

Satis satirlarinda urun durumlari renklerle takip edilir:

- Urun planlandi
- Urun hazir, son urun QC bekliyor
- Urun hazir
- Urun lojistikte
- Urun cikti
- Urun iptal edildi

`Urun cikti` ve `Urun iptal edildi` olan satirlar ana satis listesinde aktif takipten cikar, ilgili dashboard/listelerde izlenir.

---

## 13. Belge No Uzerinden Bagli Talep Kontrolu

Admin ve uretim kullanicilari:

- Talebi gecilen satis satirinda belge numarasina tiklayabilir.
- Bu siparise bagli bilesen taleplerini ve durumlarini gorebilir.
- Her bilesenin mevcut durumunu takip edebilir.

Satis ve lojistik kullanicilari:

- Belge no uzerinden talep durumunu goremez.
- Talep gecilip gecilmedigini bu alandan takip edemez.
- Sadece satis satiri degisiklik gecmisini gorebilir.

---

## 14. Degisiklikler Listesi

Sistem satis satirlarinda yapilan anlamli degisiklikleri takip eder.

Degisiklikler listesinde izlenebilenler:

- Teslim tarihi degisikligi
- Miktar degisikligi
- Urun no degisikligi
- Manuel siparis ekleme
- Talep gecme sonucu
- Karsiligi olmayan durumlari

Not:

Urun durumu degisiklikleri `Degisiklikler` listesine alinmaz. Bu degisiklikler durum takibi uzerinden izlenir.

---

## 15. Admin Neleri Yapabilir?

Admin kullanicisi:

- Tum talepleri gorur
- Tum satis satirlarini gorur
- Talep gecebilir
- Toplu talep gecebilir
- Urun agaci yukleyebilir ve temizleyebilir
- Kullanici onaylayabilir
- Kullanici silebilir / devre disi birakabilir
- Tum veriyi silebilir veya sifirlayabilir
- Veri yedekleme ve disa aktarma ekranlarini kullanabilir

Admin disindaki kullanicilarda:

- Tum silme ve sifirlama tuslari kaldirilmistir
- Fonksiyon seviyesinde de silme/sifirlama engellenmistir

---

## 16. Uretim Departmani Neleri Yapabilir?

Uretim kullanicisi:

- Talep listesini gorur
- Satis satirlarini gorur
- Tekil talep gecebilir
- Toplu talep gecebilir
- Belge no uzerinden bagli talepleri gorebilir
- Talep durumlarini guncelleyebilir
- Acil beklenen talepleri takip edebilir
- Karsiligi olmayanlari gorebilir
- Degisiklik gecmisini takip edebilir

Uretim kullanicisi yapamaz:

- Tum veriyi silemez
- Satis satirlarini sifirlayamaz
- Urun agacini temizleyemez
- Admin paneline giremez

---

## 17. Satis Departmani Neleri Yapabilir?

Satis kullanicisi:

- Satis satirlarini gorur
- Satis satirlarinda kendisiyle ilgili bilgileri takip eder
- Degisiklikler butonundan satir gecmisini gorebilir
- Excel/CSV ciktilari alabilir

Satis kullanicisi yapamaz:

- Talep gecemez
- Toplu talep gecemez
- Belge no uzerinden talep durumunu goremez
- Talep listesini goremez
- Silme/sifirlama islemi yapamaz
- Admin paneline giremez

---

## 18. Lojistik Departmani Neleri Yapabilir?

Lojistik kullanicisi:

- Satis satirlarini gorur
- Urun durumu ve cikis sureclerini takip eder
- Degisiklikler butonundan satir gecmisini gorebilir
- Excel/CSV ciktilari alabilir

Lojistik kullanicisi yapamaz:

- Talep gecemez
- Toplu talep gecemez
- Belge no uzerinden talep durumunu goremez
- Talep listesini goremez
- Silme/sifirlama islemi yapamaz
- Admin paneline giremez

---

## 19. Urun Agaci Mantigi

Urun agaci, katalog numarasi ile bilesenlerin eslestirildigi temel veri kaynagidir.

Kullanildigi yerler:

- Satis satirindan talep gecme
- Manuel siparisin bilesenlere ayrilmasi
- Karsiligi olmayan kataloglarin tespiti
- Talep listesinde format belirleme
- Madde no yazarken sistemdeki bilesenlerin otomatik onerilmesi

Urun agaci yoksa veya katalog eslesmezse:

- Sistem talebi `Karsiligi olmayan` listesine alir.
- Satis satirinda `Karsiligi Yok` bilgisi gorunur.

---

## 20. Madde No Otomatik Oneri

Talep listesinde `Madde No` yazarken sistemdeki bilesenler otomatik onerilir.

Kullanici:

1. Madde No hucresine tiklar.
2. Yazmaya baslar.
3. Sistem kayitli bilesenleri listeler.
4. Kullanici listeden secim yapar.
5. Eslesen Rxn adi ve format bilgisi satira uygulanir.

Bu ozellik manuel duzeltmelerde veri kalitesini artirir.

---

## 21. Veri Guvenligi ve Yetki Mantigi

Sistemde yetkiler departmana ve role gore calisir.

Guvenlik prensipleri:

- Admin haric kimse silme/sifirlama yapamaz.
- Satis ve lojistik talep durumunu belge no uzerinden goremez.
- Talep gecme sadece admin ve uretim tarafindan yapilir.
- Her degisiklik kullanici parafi ile kaydedilir.
- Sifreler sistemde goruntulenmez.
- Kullanici kendi mevcut sifresini dogrulayarak sifresini degistirebilir.

---

## 22. Ornek Is Akisi

1. Satis satirlari Excel olarak yuklenir.
2. Uretim kullanicisi ilgili haftayi filtreler.
3. Talep gecilecek satirlarda `Talep Geç` veya `Toplu Talep Geç` kullanilir.
4. Sistem urun agacindan bilesenleri bulur.
5. Bilesenler talep listesine duser.
6. Uretim talep durumlarini gunceller.
7. Acil beklenen listesi yaklasan/geciken cikislari gosterir.
8. Lojistik urun lojistikte / urun cikti gibi satis satiri durumlarini takip eder.
9. Iptal veya cikis olan satirlar ana takipten ayrilir.

---

## 23. Kapanis

Bu sistemle:

- Satis siparisinden uretim talebine gecis standartlasir.
- Departmanlar sadece kendi is akislari icin gerekli bilgileri gorur.
- Geciken ve yaklasan isler tek ekranda takip edilir.
- Karsiligi olmayan kataloglar kaybolmaz, ayri listede izlenir.
- Degisiklikler paraf ve tarih bilgisiyle kayit altina alinir.

Sonuc:

Daha kontrollu, izlenebilir ve departmanlara gore yetkilendirilmis bir uretim-siparis takip sureci olusur.

