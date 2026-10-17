# Claude Code Proje Şartnamesi: Android Microsoft Edge PDF Sesli Okuma

## 1. Amaç
Android Microsoft Edge üzerinde PDF belgelerini Türkçe başta olmak üzere çok dilli, erişilebilir ve kesintisiz seslendirebilen bir çözüm geliştir. Windows Edge'in **Sesli Oku (Read Aloud)** deneyimini işlevsel olarak örnek al; Microsoft'un kapalı kaynak kodunu, marka öğelerini veya özel API'lerini kopyalama.

**Önemli:** Android Edge'de uzantı kurulumu, Manifest V3 API'leri, PDF görüntüleyiciye erişim ve mağaza dağıtımı sürüme göre değişebilir. Bunları doğrulamadan “kesin çalışır” kabul etme. Eklentiyle yapılamayan özellikler için Android uygulaması / paylaşım hedefi / özel PDF görüntüleyici alternatifini tasarla.

## 2. Claude Code'un ilk görevi: fizibilite
1. Android Edge'in güncel kararlı ve varsa test sürümlerinde uzantı yükleme ve dağıtım yollarını resmi kaynaklardan araştır.
2. Manifest V3, content scripts, background service worker, downloads, tabs, storage ve PDF URL erişimi için destek matrisi hazırla.
3. Edge'in dahili PDF görüntüleyicisinin uzantı tarafından okunup okunamadığını gerçek cihazda test et; `edge://`, `chrome-extension://`, `blob:`, `content://` ve `file://` kaynaklarının kısıtlarını ayrı değerlendir.
4. Android TTS motorlarının kullanılabilirliğini, Web Speech API desteğini, ses listelerini ve arka plan oynatma sınırlamalarını doğrula.
5. Doğrulanamayan noktaları `UNKNOWN` olarak işaretle; varsayımları test senaryosuna dönüştür.
6. Çıktı: `docs/feasibility.md`, sürüm/tarih/kaynak URL'leri, test cihazları ve `GO / NO-GO` kararı.

## 3. Çözüm mimarisi ve karar ağacı
### A. Öncelik: Edge Android uzantısı
- Uygun olması halinde Manifest V3 tabanlı, minimum izinli TypeScript uzantısı geliştir.
- PDF bağlantısına kullanıcı komutuyla erişip içeriği uzantının **kendi PDF okuyucu sayfasında** aç.
- PDF.js ile metin katmanını, sayfa numaralarını ve koordinatları elde et.
- Eklenti dahili Edge PDF görüntüleyicisine erişemiyorsa bunu aşmaya çalışma; kendi görüntüleyicisini kullan.
- Android tarayıcısında eklenti paneli ve arka plan işlemleri çalışmıyorsa açık sekme tabanlı okuyucuya geç.

### B. Yedek plan: Android yerel uygulaması
- Edge'in Android uzantı desteği yeterli değilse Kotlin + Jetpack Compose ile ayrı bir Android PDF sesli okuyucu geliştir.
- Android Sharesheet (`ACTION_SEND`), `ACTION_VIEW`, Storage Access Framework ve `content://` URI izinleriyle Edge'den paylaşılan/indirilen PDF'leri al.
- Android `TextToSpeech`, MediaSession ve foreground media service ile ekran kilitliyken ve arka planda okumayı destekle.
- PDF metin çıkarma için lisansı uygun bir kütüphane, taranmış sayfalar için isteğe bağlı cihaz üstü OCR kullan.
- Kullanıcıya bunun **Edge eklentisi değil, Edge ile birlikte çalışan uygulama** olduğunu açıkça bildir.

## 4. Temel işlevsel gereksinimler
- PDF bağlantısından açma; cihazdan PDF seçme; Edge'den PDF paylaşma (platformun izin verdiği yöntemle).
- Metin tabanlı PDF'lerde sayfa ve paragraf sırasına göre metin çıkarma.
- Çok sütunlu belgelerde, başlıklarda, dipnotlarda ve tablolarda mantıklı okuma sırası; gerektiğinde manuel sıra düzeltme.
- Türkçe (`tr-TR`) varsayılan ses; İngilizce ve PDF dilini otomatik algılama; manuel dil ve ses seçimi.
- Oynat, duraklat, devam et, durdur, önceki/sonraki paragraf, sayfa atla.
- Hız ayarı 0.5×–2.5×; cihaz motorunun izin verdiği ölçüde ses perdesi ayarı.
- Okunan metni/paragrafı eş zamanlı vurgulama (motorun kelime zamanlaması yoksa paragraf düzeyinde).
- Belge bazında son sayfa, paragraf ve tercihleri yerel olarak saklama.
- Ekran okuyucularla uyumlu, büyük dokunma hedefli, açık/koyu temalı arayüz.
- İsteğe bağlı OCR: görüntü PDF'lerinde metin tanıma; OCR başarısızlığında açık uyarı.
- İnternet gerektirmeyen TTS mümkünse öncelikli; çevrimiçi sesler ancak açık onayla.
- Şifreli/DRM korumalı veya erişim izni bulunmayan belgelerde korumaları aşma.

## 5. Teknik modüller
```text
android-edge-pdf-reader/
  README.md
  docs/
    feasibility.md
    architecture.md
    compatibility-matrix.md
    privacy-security.md
    test-plan.md
  extension/                 # Fizibilite olumluysa
    manifest.json
    src/
      background/
      reader/
      pdf/
      tts/
      storage/
      ui/
  android/                   # Gerekirse yerel uygulama
    app/src/main/
  tests/
    fixtures/
    unit/
    integration/
  scripts/
```

### PDF işleme
- PDF.js ile text item'ları sayfa ve koordinat bazında ayrıştır.
- Satır birleştirme, hece bölünmesi, noktalama, sayfa üstbilgisi/altbilgisi ve okuma sırası için test edilebilir algoritmalar kullan.
- Çıkarılan metni `Document -> Page -> Block -> Sentence` veri modeliyle temsil et.
- Büyük PDF'lerde sayfa bazlı lazy loading, bellek sınırı ve iptal edilebilir işlemler uygula.

### Seslendirme
- Web Speech API destekleniyorsa özellik algılama (`feature detection`) yap; destek yoksa başarısızlığı kullanıcıya göster ve yerel uygulama alternatifine geç.
- Android uygulamasında sistem `TextToSpeech` API'sini kullan; ses motoru kurulu değilse kurulum/yönlendirme ekranı göster.
- Uzun metni cümle/paragraf parçalarına böl; kuyruk yönetimi, tekrar deneme, odak kaybı, kulaklık çıkarma ve gelen arama olaylarını ele al.
- Android'de arka plan oynatmayı yalnızca gerekli platform izinleri ve servis türleriyle uygula.

## 6. Güvenlik, mahremiyet ve lisans
- Varsayılan olarak PDF içeriğini sunucuya gönderme; analitik ve telemetri varsayılan kapalı.
- En az izin ilkesi: geniş host izinleri ve dosya erişimi için açık gerekçe ve kullanıcı onayı.
- `blob:`/`content:` erişimini yetkisiz aşma, güvenlik sınırlarını atlatma veya tarayıcıya kod enjekte etme girişimi yapma.
- PDF içeriğini güvenilmeyen girdi say; XSS, kötü amaçlı PDF, dosya boyutu ve kaynak tüketimi risklerini test et.
- PDF.js, OCR ve diğer bağımlılıkların lisanslarını doğrula; üçüncü taraf marka ve sesleri izinsiz kullanma.

## 7. Kabul kriterleri
1. Gerçek Android Edge üzerinde desteklenen kurulum ve PDF açma akışı videolu/ekran görüntülü testle kanıtlanmalı; destek yoksa açıkça belgelenmeli.
2. Türkçe metin tabanlı 10, 100 ve 500 sayfalık PDF'lerde okunabilir seslendirme sağlanmalı.
3. Çok sütunlu bilimsel makale, tablo içeren belge, Türkçe karakterler, İngilizce PDF ve taranmış PDF test edilmeli.
4. Duraklat/devam et ve belge bazında kaldığı yerden sürdürme çalışmalı.
5. Ekran kilitliyken okuma, **yalnızca ilgili platform ve mimari izin veriyorsa** kabul kriteri olmalı; uzantıda garanti edilmemeli.
6. PDF metni varsayılan olarak cihaz dışına çıkmamalı.
7. İzin verilmeyen dosya veya kaynaklarda açıklayıcı hata gösterilmeli; sessiz başarısızlık olmamalı.
8. Erişilebilirlik, düşük bellek, çevrimdışı kullanım ve batarya tüketimi test edilmeli.

## 8. Test matrisi
| Senaryo | Beklenen sonuç |
|---|---|
| Edge'de HTTPS PDF | Desteklenen yöntemle okuyucuya aktarım |
| Edge dahili PDF görüntüleyici | Doğrudan erişim yoksa özel görüntüleyici |
| Cihazdan yerel PDF | İzinli dosya seçme veya Android paylaşım akışı |
| Taranmış PDF | OCR ile okuma veya net açıklama |
| Türkçe/İngilizce karışık | Dil seçimi, mümkünse otomatik bölüm algılama |
| 500 sayfa PDF | Sayfa bazlı işleme, çökmeden çalışma |
| Arka plan / ekran kilidi | Destek varsa sürdürme, yoksa belgelenmiş sınırlama |
| Ağ bağlantısı yok | Cihazdaki ses motoruyla çalışma |
| Şifreli PDF | Yetkili parola akışı veya açıklayıcı hata |

## 9. Claude Code çalışma talimatı
1. Önce fizibilite araştırması ve uyumluluk testleri yap; kod yazmadan kritik platform kısıtlarını listele.
2. Resmi Microsoft Edge, Chromium Extensions ve Android geliştirici belgelerine öncelik ver; güncel kaynakları tarihleriyle belirt.
3. Kullanıcıya **uzantı / yerel Android uygulaması / hibrit çözüm** seçeneklerini gerekçeleriyle karşılaştır; teknik olarak uygulanabilir olanı seç.
4. Önce çalışan MVP üret: PDF aç -> metni çıkar -> Türkçe seslendir -> duraklat/devam et.
5. Ardından vurgu, hız, yer imi, OCR ve arka plan özelliklerini ekle.
6. Kodda TypeScript strict mode, modüler tasarım, testler, hata yönetimi ve sürüm sabitleme uygula.
7. Android uygulaması gerekiyorsa Kotlin, Jetpack Compose, Gradle ve güncel Android SDK kullan.
8. Derleme komutları, kurulum adımları, test raporları, APK/uzantı paketi üretim komutları ve bilinen sınırlamaları README'ye ekle.
9. Gerçek cihazda doğrulanmamış hiçbir işlevi “çalışıyor” diye raporlama; simülatör ve masaüstü testlerini ayrı belirt.
10. İş bittiğinde kaynak kodu, kurulum kılavuzu, test sonuçları ve kalan riskleri teslim et.

## 10. Öncelikler
- **P0:** Android Edge uyumluluğu ve uygulanabilir mimari kararı.
- **P1:** Türkçe PDF metin çıkarma ve seslendirme, temel kontrol paneli.
- **P2:** Çok dilli sesler, metin vurgulama, konum kaydı, erişilebilirlik.
- **P3:** OCR, karmaşık sayfa düzeni, performans iyileştirmesi.
- **P4:** Platformun izin verdiği arka plan oynatma ve gelişmiş ses seçenekleri.

**Başlangıç komutu:** Bu şartnameyi uygulamaya al. Önce `docs/feasibility.md` dosyasını oluştur, doğrulanmış Android Edge yeteneklerine göre mimari kararı ver, ardından çalışan MVP'yi geliştir. Teknik engelleri saklama; gerekirse Android paylaşım akışıyla çalışan yerel uygulama üret.
