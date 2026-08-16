# Changelog

## v1.0.4

**Jedno přihlášení — všechna okna následují.**

- **Váš účet vás nyní následuje mezi okny.** Přihlaste se, odhlaste nebo změňte plán v jednom okně Restormu a každé další otevřené okno to okamžitě převezme — bez restartu, bez druhého přihlášení. A když dokončíte přihlášení v prohlížeči, potvrzení nyní dorazí do okna, které o něj požádalo, i s několika otevřenými okny.

Opravy:

- **Uzly kódu na Macích s procesorem Intel opět startují** — build pro macOS Intel obsahoval binárku esbuild zkompilovanou pro Apple Silicon.
- **Akce „Nové okno" spouštěče AppImage znovu otevře okno** a příkaz `restorm` instalovaný balíčky .deb/.rpm opět funguje.
- **Start ve Windows je čistší** — okno se nyní načítá přes aplikační protokol, bez tichého záložního režimu po interní chybě při každém spuštění.

## v1.0.3

**Restorm běží v CI, bez FUSE.**

- **`restorm-cli` nyní funguje na CI runnerech i v kontejnerech.** Linuxové sestavení se rozbaluje místo připojení: FUSE, který Ubuntu už nedodává, není potřeba.

## v1.0.2

**Vaše tokeny CLI/CI, bez opuštění aplikace.**

- **Vytvářejte, prohlížejte a odvolávejte tokeny přímo v Restormu** — pro uživatele Pro a Enterprise, z tlačítka účtu v záhlaví. Konec cesty do řídicího panelu kvůli tokenu pro pipeline, kterou právě píšete.
- **Tokeny mohou vypršet.** Při vytváření zvolte platnost: 7 až 365 dní, nebo bez vypršení jako dosud. Vypršelý token je odmítnut stejně jako odvolaný.
- **Vaše organizace může delegovat.** Správce může konkrétnímu členovi povolit vytváření tokenů a odděleně mu zpřístupnit protokol auditu, aniž by z něj udělal správce.
- **Restorm se nyní instaluje z npm.** `npm i -g restorm-cli` a poté `restorm` — aplikace se spustí v systémech Linux, macOS i Windows bez instalátoru. Sestavení se stáhne jen jednou, ověří se zveřejněným kontrolním součtem a uloží do mezipaměti, takže je pipeline nestahuje při každé úloze znovu.

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
