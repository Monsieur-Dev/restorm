# Changelog

## v1.0.4

**Bir kez oturum açın — tüm pencereler izler.**

- **Hesabınız artık pencereden pencereye sizi izliyor.** Bir Restorm penceresinde oturum açın, kapatın veya planı değiştirin; diğer tüm açık pencereler bunu anında benimser — yeniden başlatma yok, ikinci oturum açma yok. Ve tarayıcıda bir oturum açmayı tamamladığınızda, onay artık bunu isteyen pencereye ulaşıyor, birden çok pencere açıkken bile.

Düzeltmeler:

- **Kod düğümleri Intel Mac'lerde yeniden başlıyor** — macOS Intel derlemesi Apple Silicon için derlenmiş bir esbuild ikilisi içeriyordu.
- **AppImage başlatıcısının "Yeni pencere" eylemi yeniden pencere açıyor** ve .deb/.rpm paketlerinin kurduğu `restorm` komutu yeniden çalışıyor.

## v1.0.3

**Restorm CI'da çalışıyor, FUSE olmadan.**

- **`restorm-cli` artık CI runner'larında ve konteynerlerde çalışıyor.** Linux yapısı bağlanmak yerine açılıyor: Ubuntu'nun artık sunmadığı FUSE'a gerek kalmadı.

## v1.0.2

**CLI/CI belirteçleriniz, uygulamadan çıkmadan.**

- **Belirteçleri Restorm içinde oluşturun, görün ve iptal edin** — Pro ve Enterprise kullanıcıları için, başlık çubuğundaki hesap düğmesinden. Şu anda yazdığınız hat için panele gidip gelmeye son.
- **Belirteçlerin ömrü olabilir.** Oluştururken bir süre seçin: 7 ila 365 gün ya da eskisi gibi süresiz. Süresi dolmuş bir belirteç, iptal edilmiş biri gibi reddedilir.
- **Kuruluşunuz yetki devredebilir.** Bir yönetici, belirli bir üyeye belirteç oluşturma izni verebilir ve ayrıca denetim günlüğüne erişim tanıyabilir — onu yönetici yapmadan.
- **Restorm artık npm üzerinden kuruluyor.** `npm i -g restorm-cli`, ardından `restorm` — uygulama Linux, macOS ve Windows'ta kurulum sihirbazı olmadan açılır. Yapı bir kez indirilir, yayımlanan sağlama toplamıyla doğrulanır ve önbellekte tutulur; böylece bir iş akışı onu her işte yeniden indirmez.

## v1.0.1

**İlk yama: kenar çubuğunda taşıma, sekme adları ve çökme raporları.**

- **Kenar çubuğunda bir öğeyi taşımak artık uygulamayı bozmuyor.** Mini tarayıcı, Ayarlar veya MCP günlükleri açıkken kenar çubuğundaki herhangi bir satırı sürüklemek arayüzü yıkıyordu ve yalnızca yeniden başlatma işe yarıyordu.
- **Bir öğeyi yeniden adlandırmak artık açık tüm sekmeleri güncelliyor** — bölünmüş bölmedeki sekmeler ve her istek türünün sekmeleri (gRPC, GraphQL, Redis…) dâhil; bunlar yeniden açılana kadar eski adlarını koruyordu.
- **Çökme raporları yeniden bize ulaşıyor.** Rapor gönderimi açıkken 1.0.0 sessizce hiçbir şey göndermiyordu: yaşadığınız bir çökme bize hiçbir şey anlatmıyordu.
- **“Kod dilleri” ipucu görseli logolarını yeniden gösteriyor.**

## v1.0.0

**Restorm 1.0 — local-first API istemcisi yayında.**

Restorm, tüm önemli protokollerde API'leri test etmek ve çalıştırmak için hızlı, önce çevrimdışı çalışan bir masaüstü istemcisidir.

- **Protokoller**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Senaryolar**: istekleri görsel olarak zincirleyin, dallandırın/döngüye alın, değerleri çıkarıp yeniden kullanın, CI'da arayüzsüz çalıştırın.
- **Ortamlar ve değişkenler**: her yerde `{{handlebars}}`, türlü gizli değerler, klasör başına ortamlar.
- **İçe/Dışa Aktarma**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, kod dışa aktarımı.
- **Git-yerel projeler**: `.restorm` projeniz sıradan bir dosyadır — sürümleyin, karşılaştırın ve çakışmaları uygulama içinde çözün.
- **Local-first ve özel**: her şey kendi makinenizde çalışır; giden bir güvenlik duvarı her dış çağrıyı denetler.
- **Çapraz platform**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Ücretsiz Community sürümü, ekipler için Pro ve Enterprise ile.
