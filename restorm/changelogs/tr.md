# Changelog

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
