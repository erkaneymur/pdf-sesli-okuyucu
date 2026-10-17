# PDF Sesli Okuyucu (Android Edge)

Android'deki Edge'in kendi **Sesli oku** özelliği web sayfalarını Microsoft sesleriyle okur, ama PDF'leri okumaz. Bu proje aradaki boşluğu dolduruyor: PDF'i **cihazda** temiz bir metin sayfasına dönüştürüyor, siz de o sayfayı Edge'in Sesli oku özelliğiyle dinliyorsunuz. Google TTS kullanılmıyor, Microsoft'un kapalı API'lerine de dokunulmuyor. Bu kararın gerekçesi [docs/feasibility.md](docs/feasibility.md) dosyasında.

## Kullanım (telefonda)

1. Sayfayı Edge'de açın.
2. **PDF seç** ile dosyayı seçin ya da bir `https://` PDF bağlantısı yapıştırın.
3. Edge menüsü (⋯) → **Sesli oku**. Ses ve hızı Edge'in panelinden seçin.
4. Belirli bir sayfadan dinlemek için **Şu sayfadan başla** alanına numarayı yazın. Önceki sayfalar gizlenir ve Sesli oku o sayfadan başlar. Aynı PDF'i yeniden açtığınızda **Kaldığım yerden devam et** düğmesi çıkar.

## Geliştirme

Gereksinim: Node 20+ ve Python 3 (yalnızca yerel sunucu için).

```powershell
npm install
npm run build      # TypeScript (strict) → web/js, PDF.js → web/vendor
npm test           # build + birim ve entegrasyon testleri
npm run fixtures   # tests/fixtures/*.pdf üretir (tarayıcıda denemek için)
npm run serve      # web/ klasörünü 8080 portunda tüm ağa açar
```

### Telefonda deneme (aynı Wi-Fi)

`npm run serve` komutundan sonra telefondaki Edge'de `http://<bilgisayarın-IP'si>:8080` adresini açın. Bilgisayarın IP'sini PowerShell'de `ipconfig` ile bulabilirsiniz. Windows Güvenlik Duvarı 8080 portu için izin isteyebilir.

Kalıcı kullanım için `web/` klasörünü herhangi bir statik HTTPS sunucusuna (ör. GitHub Pages) koymak yeterli. Derleme adımı gerekmiyor, `web/` olduğu gibi yayınlanabilir.

## Yapı

```
src/            TypeScript kaynak (strict)
  layout.ts     saf düzen mantığı: satır, sütun, paragraf, üstbilgi, tire, cümle, dil
  items.ts      PDF.js metin öğesi → düzen öğesi
  pdf.ts        PDF.js köprüsü (parola, hata mesajları)
  storage.ts    localStorage: tercihler ve kaldığı sayfa (hata korumalı)
  main.ts       arayüz
web/            yayınlanan statik site (js/ ve vendor/ build çıktısı)
tests/unit      düzen mantığı testleri
tests/integration  gerçek PDF → PDF.js → düzen hattı (500 sayfa dahil)
scripts/        vendor kopyalama, fikstür üretimi
docs/           fizibilite
```

Sabitlenmiş sürümler: `pdfjs-dist 4.10.38`, `typescript 5.7.3`, `pdf-lib 1.17.1` (yalnızca test fikstürleri için).

## Gizlilik ve güvenlik

- PDF hiçbir sunucuya yüklenmez. Metin çıkarma tarayıcıda yapılır.
- Seslendirme Edge'in Sesli oku özelliğiyle yapılır. Bu özellik Microsoft'un çevrimiçi seslerini kullanır, yani **okunan metin Microsoft'a gider**. Android'de çevrimdışı bir Microsoft sesi bulunmuyor.
- PDF içeriği yalnızca `textContent` ile DOM'a yazılır (XSS yok). PDF.js `isEvalSupported: false` ile çalışır. Sıkı bir CSP var ve üçüncü taraf yazı tipi ya da betik yüklenmiyor.
- Bağlantıdan açma `credentials: "omit"` ile çalışır. CORS izni vermeyen sunucularda açık bir hata gösterilir; engeli aşmaya çalışılmaz.
- Parolalı PDF'lerde parola istenir. DRM ve korumalar aşılmaz.

## Test durumu (2026-10-17)

| Test | Ortam | Sonuç |
|---|---|---|
| Birim (12) ve entegrasyon (4) testleri | Node 26, Windows | 16/16 geçti |
| 500 sayfalık Türkçe PDF'te metin çıkarma | Node | ≈0,6 sn, tüm sayfalar |
| İki sütun, başlık sırası, tire birleştirme, üstbilgi ve sayfa no temizliği | Node + tarayıcı | geçti |
| 320 / 375 px, açık/koyu tema, yatay kaydırma yok | Masaüstü Chromium (Playwright) | geçti |
| Taranmış PDF uyarısı, sayfadan başlama (100 sayfa) | Masaüstü Chromium | geçti |
| **Android Edge Sesli oku bu sayfayı okuyor mu?** | Gerçek cihaz | **DOĞRULANMADI** (docs/feasibility.md T1–T3) |

## Bilinen sınırlamalar

- Oynatma kontrolü (hız, ses, duraklatma) Edge'in Sesli oku panelinde. Okunan paragraf bu sayfada vurgulanmaz.
- OCR yok. Taranmış sayfalar açık bir uyarıyla atlanır.
- Edge'den doğrudan "Paylaş → bu uygulama" akışı yok (PWA share target bir sonraki adım).
- Parolalı PDF akışı ve ekran kilitliyken okuma otomatik testle doğrulanmadı.
- Sayfa üstbilgileri ilk iki sayfada okunur, üçüncü sayfadan itibaren atlanır.
