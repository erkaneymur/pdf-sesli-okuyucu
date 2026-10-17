# Fizibilite: Android Edge PDF Sesli Okuma

Tarih: 2026-10-17 · Durum: masaüstü araştırması, gerçek cihaz testi YAPILMADI

## Ek kullanıcı koşulu
Seslendirme **Microsoft sesleriyle** yapılacak. Google TTS (Android sistem motoru) kullanılmayacak.

## Bulgular

| # | Konu | Sonuç | Kaynak |
|---|---|---|---|
| 1 | Edge Android uzantı mağazası | Var (v134, Mart 2025), ama Microsoft'un seçtiği ~22 uzantıyla sınırlı ve "Beta" etiketli. Kendi uzantımızı kararlı sürüme normal yolla kuramayız. | androidauthority.com/microsoft-edge-extensions-android-3535402 |
| 2 | Uzantıyı ID ile kurma | Yalnızca Canary'de, gizli bayrak ve geliştirici menüsüyle. Uzantının Edge Add-ons mağazasında yayınlanmış olması gerekir. Resmî değil. | windowscentral.com (Microsoft Edge for Android now supports installing ANY extension) |
| 3 | .crx dosyasından kurma | Yalnızca root veya Shizuku ile, gizli bir activity üzerinden. Resmî değil, kapsam dışı. | Reddit (doğrulanmadı) |
| 4 | Web Speech API (Edge Android) | Android'de sistem TTS motoruna (çoğu cihazda Google) bağlanıyor. Bazı raporlarda ses listesi boş dönüyor. **Kullanıcı koşulunu ihlal eder.** | readium.org/speech/docs/WebSpeech.html |
| 5 | Edge'in kendi "Sesli oku" özelliği (Android) | Web sayfalarında Microsoft doğal sesleriyle çalışıyor. **PDF'te çalışmıyor.** | explore.microsoft.com/en-us/edge/features/read-aloud · learn.microsoft.com/answers/questions/2397260 |
| 6 | Azure AI Speech (resmî Microsoft TTS) | Android SDK'sı var, tr-TR nöral sesleri var. Ücretsiz katman ayda 0,5 milyon karakter (≈250 sayfa). Metin Azure'a gidiyor, anahtar gerekiyor. | azure.microsoft.com/pricing/details/cognitive-services/speech-services |
| 7 | Edge'in gayriresmî TTS uç noktası (edge-tts vb.) | Teknik olarak var. Şartnamenin 1. ve 6. maddeleri gereği (özel Microsoft API'si kopyalanmayacak) **kullanılmayacak.** | — |

## Karar

**Uzantı (Plan A): NO-GO.** Uzantı kararlı Edge'e kurulamıyor. Kurulsa bile tarayıcı içi TTS Google motorunu kullanırdı.

Microsoft sesiyle uygulanabilir iki yol var:

### Seçenek 1: Web okuyucu + Edge'in kendi Sesli oku özelliği (önerilen MVP)
Statik bir web sayfası (PWA). PDF'i seçin, PDF.js metni **cihazda** çıkarıp temiz HTML paragraflarına dönüştürür. Ardından Edge menüsü → *Sesli oku* ile metni Microsoft sesleri okur.
- Artı: Ücretsiz, anahtar gerekmiyor, Edge'in kendi Microsoft sesleri, kod tamamen bizim.
- Eksi: Oynatma kontrolü Edge'de, bizde değil. Edge'in sayfayı okunabilir bulması gerekiyor.
- `UNKNOWN`: Sesli oku, JS ile üretilen içeriği ve yerel dosyadan oluşturulan sayfayı okuyor mu? Uzun sayfada nerede duruyor? → Test T1–T3.

### Seçenek 2: Yerel Android uygulaması + Azure AI Speech
Kotlin/Compose uygulaması. Edge'den PDF paylaşılır, uygulama Azure nöral sesiyle (ör. `tr-TR-EmelNeural`) okur. Arka planda ve kilit ekranında oynatma desteklenir.
- Artı: Tam kontrol (hız, vurgulama, kaldığı yer), arka plan oynatma.
- Eksi: Azure hesabı ve anahtar gerekiyor, ücretsiz kotadan sonra ücretli. PDF metni Microsoft bulutuna gidiyor (açık onay gerekir).

Edge'in Sesli oku özelliği de metni Microsoft bulutuna gönderir. "Google okumasın" koşulu, "metin cihazdan çıkmasın" (madde 6) ile ancak çevrimdışı bir Microsoft sesi olsaydı birlikte sağlanabilirdi. Android'de böyle bir ses yok. Bu nedenle madde 6 açık kullanıcı onayına çevrildi.

## Seçilen yol
Kullanıcı 2026-10-17'de **Seçenek 1**'i seçti. MVP `web/` klasöründe. Masaüstü test sonuçları README'de.

## Gerçek cihaz testleri (bekliyor)
- T1: Edge Android'de PWA'yı açın, PDF seçin, *Sesli oku* menüde görünüyor mu?
- T2: Türkçe metni Microsoft sesiyle okuyor mu? Ses adı nedir?
- T3: 100 sayfalık PDF'te sayfa sonlarında okuma kesintisiz sürüyor mu?
- T4 (Seçenek 2): Ekran kilitliyken Azure sesiyle okuma devam ediyor mu?
