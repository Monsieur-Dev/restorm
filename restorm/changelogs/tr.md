# Changelog

## v1.1.1

**API tasarımcısı artık kenar çubuğundan yönetiliyor.**

- **Modelleriniz, enum'larınız ve rotalarınız kenar çubuğunda yaşıyor.** Sekmelerdeki üç liste kayboluyor — modeller (kalıtım iç içeliğiyle), enum'lar ve rotalar (gruplar ve rotaları) artık doğrudan kenar çubuğu ağacında yer alıyor. Sağ tıklayarak yeniden adlandırın, bir alt model veya alt grup ekleyin, bir rotayı klonlayın, CRUD üretin veya silin; sıralamayı değiştirmek veya üst öğeyi taşımak için sürükleyin — asla tasarımın dışına değil. Her sayfa artık yalnızca seçili öğenin ayrıntılarını gösteriyor.
- **Modellerinize, enumlarınıza ve rotalarınıza kuş bakışı.** Her bölümün kök düğümü artık altındaki her şeyi listeler — ve Modeller bir **Grafik** sekmesi kazanır: modellerinizin kalıtım ve referanslarıyla bir sınıf diyagramı. Enumlar değerlerini adın hemen yanında gösterir.
- **Yeniden adlandırmak için tek yer.** Bir model, enum veya rota büyük başlığından (kalem) yeniden adlandırılır ve boş bir ad **“<adsız>”** gösterir; böylece kalem her zaman erişilebilir kalır — ad artık sayfada iki kez görünmez.
- **Doğrulama hataları öğeyi işaret eder.** Bir şey yanlış olduğunda — aynı adı paylaşan bir model ve enum, artık var olmayan bir şeye referans — modelin, enumun veya rotanın üstündeki bir not bunu açıklar.
- **Eksiksiz bir gezinti yolu.** İz, kenar çubuğunun tüm hiyerarşisini yansıtır — klasörler › tasarım › bölüm › grup › öğe — ve her parça tıklanabilir.
- **Birkaçını seç, tek seferde sil.** Birden çok modeli, enumu veya rotayı seçin ve bir onaydan sonra hepsini tek seferde silin.
- **Bir kod şablonunun kaynağını tek tıklamayla kopyalayın veya açın.** "</> Code" sayfasında bir şablonun üzerine gelindiğinde URL'sini veya yolunu kopyalamak için bir düğme ve onu açmak için bir düğme belirir — tarayıcınızdaki depo veya yerel bir şablon için diskteki klasör.
- **Yeni rotalar bir adla başlar.** Sıfırdan oluşturulan bir rota artık varsayılan bir ad alır, böylece onu hemen yeniden adlandırabilirsiniz.
- **Editörünüzdeki gibi önizleme sekmeleri.** Tek tıklama artık bir öğeyi yeniden kullanılabilir bir **önizleme** sekmesinde açar (adı italik gösterilir); başka bir öğeye tıklamak yeni bir sekme yığmak yerine aynı sekmeyi yeniden kullanır. Çift tıklama, herhangi bir düzenleme veya bir isteği çalıştırma sekmeyi kalıcı olarak açık tutar. Ayarlar › Davranış'tan kapatın.
- **Açık tuttuğunuz sekmeleri sabitleyin.** Bir sekmeye sağ tıklayıp sabitleyin: sabitlenen sekmeler önde kalır, "diğerlerini kapat" işlemine dayanır ve proje bazında hatırlanır.
- **Ortamlar gerçek bir ayrıntı görünümüne kavuşuyor.** Bir ortamı açarak başlığından yeniden adlandırın, simgesini ve rengini ayarlayın ve bir alt ortam ekleyin — ve sağ tık menüsü artık bir ortamı tüm değişkenleri ve alt ortamlarıyla birlikte çoğaltır.

Düzeltmeler:

- **Bir kod şablonu seçmek kütüphaneyi kapatır.** "Kullan" artık sizi doğrudan Code sayfasına geri götürür.
- **Belge oluşturma artık isteğe bağlı alanlarda başarısız olmuyor.** Modeli veya parametresi "required" değerini ayarlanmamış bırakan bir tasarımdan belge oluşturmak artık bir şablon hatasıyla durmuyor.
- **Bir enumu silmek önce sorar.** Enumlar, modeller ve rotalarla aynı onayı alır.
- **Kenar çubuğu seçiminizi ortaya çıkarır.** «Kenar çubuğunu etkin sekmeyle eşitle» açıkken bir model, enum veya rota seçmek ya da oluşturmak, ağaçta görünür kalması için üst öğelerini açar.
- **Ortam düğmesi her renkte okunaklı kalır.** Etiketi artık, çalıştır düğmesi gibi, ortamın rengine karşı okunaklı kalmak için koyu veya açık metne geçer.
- **Orta tıklama açık bir dosyayı kapatır.** Kenar çubuğundaki "Açık" listesindeki bir öğeye orta tıklamak sekmesini kapatır — ve yeni bir Davranış ayarı o paneli tamamen gizlemenizi sağlar.
- **Dokümantasyondan başlarken daha net ifade.** İçe aktarılan bir API'nin dokümantasyonunda düğme artık "Bu dokümantasyondan yeni bir istek oluştur" yazıyor.
- **Microsoft Store sürümünde oturum açma çalışıyor.** Tarayıcının oturum açtıktan sonra geri verdiği özel protokol geri çağrısı artık Store paketinde tanımlı olduğundan, oturum açma zaman aşımına uğramak yerine tamamlanıyor.

## v1.1.0

🎉 **Restorm artık aynı zamanda bir API tasarımcısı.** API'nizi tasarlayın, aynı anda beş protokolde canlı bir mock olarak sunun ve istemcilerini üretin — uygulamadan çıkmadan, tümü kendi diskinizde.

- **Görsel bir API tasarımcısı.** API'nizi elle modelleyin — modeller, enum'lar (adlandırılmış veya satır içi), rotalar, parametreler, adlandırılmış örnekler, kısıtlamalar, etiketler ve kullanımdan kaldırmalar — tek satır spesifikasyon yazmadan.
- **Tek tıklamayla, aynı anda 5 protokolde mock olarak sunun.** Tasarım, HTTP, GraphQL, SOAP, OData ve gRPC'de aynı anda yanıt veren bir sunucuya dönüşür. Yanıtlar adlandırılmış örneklerinizden (ya da modellerinizden üretilen gerçekçi verilerden) gelir; kısıtlama doğrulaması, simüle edilmiş gecikme ve durum bilgili (stateful) bir mod içerir.
- **Çalıştırmaya hazır istemciler, otomatik üretilir.** Mock çalışırken Clients bölümü, etkin her protokol için mock'un uç noktalarına yönlendirilmiş gerçek, çalıştırılabilir istekler oluşturur. Tek tıklama bir isteği açar ve sunucuya vurur — test etmek için API'nizi başka bir yere yeniden içe aktarmaya son.
- **Kod üretin**: sunulan şablonları ve kendi özel şablonlarınızı kullanarak tasarımınızdan; bir sanal alanda oluşturulur ve yalnızca siz onayladıktan sonra diske yazılır. **Tanımlayıcıyı da dışa aktarın** (OpenAPI ve diğerleri).
- **İçe aktarımda istek gövdeleri önceden doldurulur**: GraphQL dönüş tipinin skaler alanlarını seçer, gRPC iç içe mesajları açar — istek olduğu gibi çalışır.

## v1.0.6

Düzeltmeler:

- **Çok büyük bir proje artık donmak yerine net bir mesajla kaydedilemiyor.** Bir proje tek seferde diske yazılamayacak kadar büyürse — ki bu, alışılmadık ölçüde büyük bir API şemasını içe aktardıktan sonra olabilir — Restorm çökmek ya da sessizce başarısız olmak yerine, kaydedilemeyecek kadar büyük olduğunu açıkça bildirir.
- **Perde arkasında daha net hata raporlama.** «Farklı Kaydet» iletişim kutusunu iptal etmek artık hata olarak kaydedilmiyor ve başarısız bir içe aktarma artık gerçek nedenini bildiriyor — böylece gerçek sorunları fark etmek ve düzeltmek kolaylaşıyor.

## v1.0.5

**Cookie jar — her ortam için bir çerez kavanozu.**

- **Her ortam kendi çerezlerini saklar.** Dev API'nize ve prod API'nize iki ayrı ortamdan giriş yapın; oturumları asla birbirine karışmaz — birinde yakalanan bir çerez yalnızca o ortamda geri gönderilir. Son kullanma tarihi, `Path`, `Domain` ve alt alan adları, `Secure`, `HttpOnly` ve `SameSite` artık göz ardı edilmiyor, gereğince uygulanıyor.
- **Cookie jar ile tanışın.** Yeni bir çalışma tezgahı sekmesi — **Görünüm ▸ Cookie jar** — her ortamın çerezlerini açılıp kapanan bölmelerde etki alanına göre gruplayarak listeler: bir değeri düzenleyin, birini silin, bir etki alanını ya da tüm kavanozu temizleyin veya elle çerez ekleyin. İstekleriniz çerez ayarladıkça canlı olarak yenilenir.
- **Her isteğin ne gönderip ne aldığını görün.** Artık her istekte, Response ve Info'nun yanında bir **Cookies** sekmesi var; çağrıyla birlikte gönderilen çerezleri ve geri alınan çerezleri gösterir — nihai yanıta asla ulaşmayan, bir yönlendirmede ayarlanan çerezler de dâhil. Geçmişinizdeki eski yanıtlarda da bulunur.
- **Çerezli oturum açmalar sorunsuz çalışır.** `Set-Cookie` döndüren bir istek yakalanır ve ardından gelen korumalı çağrılarda otomatik olarak yeniden gönderilir — her adımın ortamın kavanozunu paylaştığı bir senaryo çalıştırması boyunca da geçerlidir.
- **Çerezler bir tarayıcıdaki gibi kalıcıdır.** Son kullanma tarihi olan çerezler proje başına kaydedilir ve projeyi yeniden açtığınızda yeniden yüklenir; oturum çerezleri ise uygulamayı yeniden başlattığınızda atılır — tıpkı bir tarayıcının yapacağı gibi.
- **REST'in ötesinde.** GraphQL, SOAP, OData, JSON-RPC, tRPC ve SSE artık çerez gönderip saklıyor; WebSocket ise bunları bağlantı el sıkışması sırasında taşıyor.
- **Çerezler değişkenlerinizi kullanabilir.** Elle eklediğiniz bir çereze `{{token}}` yazın; istek gönderildiğinde etkin ortama göre çözümlenir.

Düzeltmeler:

- **Otomatik kaydetme artık klasörlerin içindeki ortamları da kapsıyor.** Otomatik kaydetme modunda bir alt ortam eklemek ya da yeniden adlandırmak hemen kaydedilir — zaten diske yazılması amaçlanan bir değişiklik için artık «kapatmadan önce kaydedilsin mi?» istemi yok.

## v1.0.4

**Bir kez oturum açın — tüm pencereler izler.**

- **Hesabınız artık pencereden pencereye sizi izliyor.** Bir Restorm penceresinde oturum açın, kapatın veya planı değiştirin; diğer tüm açık pencereler bunu anında benimser — yeniden başlatma yok, ikinci oturum açma yok. Ve tarayıcıda bir oturum açmayı tamamladığınızda, onay artık bunu isteyen pencereye ulaşıyor, birden çok pencere açıkken bile.

Düzeltmeler:

- **Kod düğümleri Intel Mac'lerde yeniden başlıyor** — macOS Intel derlemesi Apple Silicon için derlenmiş bir esbuild ikilisi içeriyordu.
- **AppImage başlatıcısının "Yeni pencere" eylemi yeniden pencere açıyor** ve .deb/.rpm paketlerinin kurduğu `restorm` komutu yeniden çalışıyor.
- **Windows'ta başlangıç daha temiz** — pencere artık her başlatmada bir iç hatanın ardından sessiz bir yedeğe düşmeden uygulama protokolü üzerinden yükleniyor.

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
