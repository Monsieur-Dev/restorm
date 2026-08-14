# Changelog

## v1.0.1

**První oprava: přesouvání v postranním panelu, názvy karet a hlášení o pádech.**

- **Přesunutí položky v postranním panelu už aplikaci nerozbije.** Při otevřeném mini prohlížeči, Nastavení nebo protokolech MCP jakékoli přetažení v postranním panelu rozbilo rozhraní a pomohl jen restart.
- **Přejmenování položky nyní aktualizuje každou otevřenou kartu** — včetně karet v rozděleném panelu a karet všech typů požadavků (gRPC, GraphQL, Redis…), které si až do znovuotevření nechávaly starý název.
- **Hlášení o pádech se k nám opět dostávají.** Se zapnutým odesíláním verze 1.0.0 tiše neodeslala nic: pád, na který jste narazili, nám nic neřekl.
- **Ilustrace „programovací jazyky“ opět zobrazuje svá loga.**

## v1.0.0

**Restorm 1.0 — local-first API klient je tu.**

Restorm je rychlý desktopový klient fungující offline pro testování a ovládání API napříč všemi hlavními protokoly.

- **Protokoly**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scénáře**: vizuálně řetězte požadavky, větvete/opakujte, extrahujte a znovu používejte hodnoty, spouštějte bez rozhraní v CI.
- **Prostředí a proměnné**: `{{handlebars}}` všude, typované tajné hodnoty, prostředí pro každou složku.
- **Import/Export**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, export kódu.
- **Projekty nativní pro Git**: váš projekt `.restorm` je běžný soubor — verzujte jej, porovnávejte a řešte konflikty přímo v aplikaci.
- **Local-first a soukromé**: vše běží na vašem počítači; odchozí firewall hlídá každé externí volání.
- **Multiplatformní**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Bezplatná edice Community, s Pro a Enterprise pro týmy.
