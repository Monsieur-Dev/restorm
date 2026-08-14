# Changelog

## v1.0.1

**Прва исправка: премештање у бочној траци, називи картица и извештаји о падовима.**

- **Премештање ставке у бочној траци више не руши апликацију.** Уз отворен мини прегледач, Подешавања или MCP записе, свако превлачење у бочној траци распадало би интерфејс, а помагало је само поновно покретање.
- **Преименовање ставке сада освежава сваку отворену картицу** — укључујући картице у подељеном окну и картице свих врста захтева (gRPC, GraphQL, Redis…), које су задржавале стари назив до поновног отварања.
- **Извештаји о падовима поново стижу до нас.** Уз укључено слање, 1.0.0 није слала ништа у тишини: пад на који сте наишли нама није говорио ништа.
- **Илустрација „језици кода“ поново приказује своје логотипе.**

## v1.0.0

**Restorm 1.0 — local-first API klijent je stigao.**

Restorm je brz, offline-first desktop klijent za testiranje i pokretanje API-ja preko svih glavnih protokola.

- **Protokoli**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenariji**: vizuelno povežite zahteve, grananje/petlje, izdvojte i ponovo koristite vrednosti, pokrećite bez interfejsa u CI-ju.
- **Okruženja i promenljive**: `{{handlebars}}` svuda, tipizirane tajne, okruženja po fascikli.
- **Uvoz/Izvoz**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, izvoz koda.
- **Projekti izvorno za Git**: vaš `.restorm` projekat je obična datoteka — verzionišite ga, upoređujte i rešavajte konflikte u aplikaciji.
- **Local-first i privatno**: sve se izvršava na vašem računaru; izlazni zaštitni zid nadzire svaki spoljni poziv.
- **Višeplatformski**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Besplatno Community izdanje, uz Pro i Enterprise za timove.
