# Sesli Okuyucu (Android Edge)

Android'deki Edge'in kendi **Sesli oku** özelliği web sayfalarını Microsoft sesleriyle okur, ama PDF'leri ve e-kitapları okumaz. Bu proje aradaki boşluğu dolduruyor: belgeyi **cihazda** açıp okuma sırasına dizilmiş metin sayfasına dönüştürüyor, siz de o sayfayı Edge'in Sesli oku özelliğiyle dinliyorsunuz. Google TTS kullanılmıyor, Microsoft'un kapalı API'lerine de dokunulmuyor. Bu kararın gerekçesi [docs/feasibility.md](docs/feasibility.md) dosyasında.

**Adres:** <https://erkaneymur.github.io/pdf-sesli-okuyucu/>

## Desteklenen biçimler

| Biçim | Not |
|---|---|
| PDF | Orijinal sayfa görünümü + okuma sırasına dizilmiş görünmez metin katmanı; iki sütun, tire ve üstbilgi temizliği. **Metin görünümü** düğmesi de var. |
| EPUB (2/3) | Okuma sırası (spine), bölüm başlıkları, kitap adı |
| MOBI, AZW3, PRC/PDB | Sıkıştırmasız ve PalmDOC sıkıştırmalı |
| DOCX, ODT | Paragraflar ve başlık stilleri; dipnot, silinmiş metin ve alan kodları atlanır |
| RTF | Türkçe kod sayfası (`\ansicpg1254`) ve Unicode (`\u`) |
| TXT | UTF-8 / UTF-16 / Windows-1254 otomatik |
| Markdown, HTML, FB2 | FB2'de `windows-1251` gibi XML kodlamaları da okunur |

Desteklenmeyenler açık bir mesajla reddedilir: DRM korumalı kitaplar, HUFF/CDIC sıkıştırmalı MOBI, eski Word (`.doc`), resimden oluşan (taranmış) belgeler (OCR yok).

## Telefona / tablete kurma

APK yok, gerek de yok. APK, sayfayı Edge yerine Chrome'da ya da uygulamanın kendi tarayıcısında açardı ve Edge'in Sesli oku özelliği kaybolurdu.

1. Edge'de yukarıdaki adresi açın.
2. Edge menüsü (≡) → **Telefona ekle** (bazı sürümlerde **Ana ekrana ekle**).
3. Ana ekrandaki **Okuyucu** simgesine dokunun. Sayfa Edge'de açılır, ilk açılıştan sonra internetsiz de çalışır.

## Kullanım

1. **Dosya seç** ile dosyayı seçin ya da bir `https://` bağlantısı yapıştırın.
2. Edge menüsü (≡) → **Sesli oku**. Ses ve hızı Edge'in panelinden seçin.
3. Belirli bir yerden dinlemek için **Şu sayfadan başla** (e-kitaplarda **Şu bölümden başla**) alanına numarayı yazın. Önceki kısımlar gizlenir ve Sesli oku oradan başlar. Aynı dosyayı yeniden açtığınızda **Devam et** düğmesi çıkar.

## Geliştirme

Gereksinim: Node 20+ ve Python 3 (yalnızca yerel sunucu için).

```powershell
npm install
npm run build      # TypeScript (strict) → web/js, PDF.js → web/vendor
npm test           # build + birim ve entegrasyon testleri
npm run fixtures   # tests/fixtures/*.pdf üretir (tarayıcıda denemek için)
npm run serve      # web/ klasörünü 8080 portunda tüm ağa açar
```

`main` dalına her gönderimde GitHub Actions testleri çalıştırıp `web/` klasörünü GitHub Pages'e yayınlar ([.github/workflows/pages.yml](.github/workflows/pages.yml)).

### Telefonda yerel deneme (aynı Wi-Fi)

`npm run serve` komutundan sonra telefondaki Edge'de `http://<bilgisayarın-IP'si>:8080` adresini açın. Bilgisayarın IP'sini PowerShell'de `ipconfig` ile bulabilirsiniz. Windows Güvenlik Duvarı 8080 portu için izin isteyebilir.

## Yapı

```text
src/              TypeScript kaynak (strict)
  layout.ts       PDF düzeni: satır, sütun, paragraf, üstbilgi, tire, cümle, dil
  items.ts        PDF.js metin öğesi → düzen öğesi
  pdf.ts          PDF.js köprüsü (parola, sayfa çizimi, hata mesajları)
  formats/        PDF dışındaki biçimler
    book.ts       biçim tanıma, EPUB/DOCX/ODT/FB2 okuma, bölümleme
    zip.ts        ZIP okuyucu (DecompressionStream)
    markup.ts     HTML/XML → paragraf/başlık blokları
    mobi.ts       PalmDB + PalmDOC
    rtf.ts        RTF ayrıştırıcı
    text.ts       TXT/Markdown, kodlama tanıma
  storage.ts      localStorage: tercihler ve kaldığı yer (hata korumalı)
  main.ts         arayüz
web/              yayınlanan statik site (js/ ve vendor/ build çıktısı)
tests/unit        düzen ve biçim testleri
tests/integration gerçek PDF → PDF.js → düzen hattı (500 sayfa dahil)
tests/helpers     test için ZIP ve MOBI üreticileri
scripts/          vendor kopyalama, fikstür ve simge üretimi
docs/             fizibilite
```

Sabitlenmiş sürümler: `pdfjs-dist 4.10.38`, `typescript 5.7.3`; yalnızca testlerde `pdf-lib 1.17.1`, `linkedom 0.18.9`.

## Gizlilik ve güvenlik

- Dosya hiçbir sunucuya yüklenmez. Metin çıkarma tarayıcıda yapılır.
- Seslendirme Edge'in Sesli oku özelliğiyle yapılır. Bu özellik Microsoft'un çevrimiçi seslerini kullanır, yani **okunan metin Microsoft'a gider**. Android'de çevrimdışı bir Microsoft sesi bulunmuyor.
- Belge içeriği yalnızca `textContent` ile DOM'a yazılır (XSS yok). E-kitap HTML'i `DOMParser` ile ayrı bir belgede ayrıştırılır; orada betik çalışmaz ve kaynak yüklenmez. PDF.js `isEvalSupported: false` ile çalışır. Sıkı bir CSP var ve üçüncü taraf yazı tipi ya da betik yüklenmiyor.
- ZIP girdileri 256 MB ile sınırlı (zip bombası koruması); dosya üst sınırı 300 MB.
- Bağlantıdan açma `credentials: "omit"` ile çalışır. CORS izni vermeyen sunucularda açık bir hata gösterilir; engeli aşmaya çalışılmaz.
- Parolalı PDF'lerde parola istenir. DRM ve korumalar aşılmaz.

## Test durumu (2026-10-17)

| Test | Ortam | Sonuç |
|---|---|---|
| Birim (25) ve entegrasyon (4) testleri | Node 26, Windows | 29/29 geçti |
| 500 sayfalık Türkçe PDF'te metin çıkarma | Node | ≈0,6 sn, tüm sayfalar |
| EPUB, DOCX, ODT, FB2, RTF, TXT, MD, HTML, MOBI örnekleri | Masaüstü Chromium (gerçek DOMParser) | hepsi doğru açıldı |
| 320 / 375 px, açık/koyu tema, yatay kaydırma yok | Masaüstü Chromium (Playwright) | geçti |
| Android Edge Sesli oku (metin görünümü, PDF) | Gerçek telefon | **çalışıyor** (kullanıcı testi) |
| Android Edge Sesli oku: PDF görünümündeki görünmez katman, e-kitap biçimleri | Gerçek cihaz | **doğrulanmadı** |

## Bilinen sınırlamalar

- Oynatma kontrolü (hız, ses, duraklatma) Edge'in Sesli oku panelinde. Okunan paragraf bu sayfada vurgulanmaz.
- OCR yok. Taranmış sayfalar açık bir uyarıyla atlanır.
- Edge'den doğrudan "Paylaş → bu uygulama" akışı yok.
- Parolalı PDF akışı ve ekran kilitliyken okuma otomatik testle doğrulanmadı.
- PDF'te sayfa üstbilgileri ilk iki sayfada okunur, üçüncü sayfadan itibaren atlanır.
