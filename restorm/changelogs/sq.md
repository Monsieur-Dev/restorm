# Changelog

## v1.0.3

**Restorm punon në CI, pa FUSE.**

- **`restorm-cli` tani funksionon në runner-at e CI-së dhe në kontejnerë.** Ndërtimi për Linux shpaketohet në vend që të montohet: FUSE, që Ubuntu nuk e ofron më, nuk nevojitet.

## v1.0.2

**Tokenat tuaj CLI/CI, pa dalë nga aplikacioni.**

- **Krijoni, shikoni dhe revokoni tokena nga Restorm** — për përdoruesit Pro dhe Enterprise, nga butoni i llogarisë në shiritin e titullit. Mbaroi vajtja te paneli për një token të tubacionit që po shkruani tani.
- **Tokenat mund të skadojnë.** Zgjidhni një kohëzgjatje gjatë krijimit: 7 deri në 365 ditë, ose pa skadim si më parë. Një token i skaduar refuzohet njësoj si një i revokuar.
- **Organizata juaj mund të delegojë.** Një administrator mund t'i lejojë një anëtari të caktuar të krijojë tokena dhe, veçmas, t'i japë qasje te regjistri i auditimit, pa e bërë administrator.
- **Restorm tani instalohet nga npm.** `npm i -g restorm-cli`, pastaj `restorm` — aplikacioni niset në Linux, macOS dhe Windows pa program instalimi. Ndërtimi shkarkohet një herë, verifikohet me shumën e kontrollit të publikuar dhe ruhet në memorien e fshehtë, kështu që një tubacion nuk e shkarkon më në çdo punë.

## v1.0.1

**Rregullimi i parë: zhvendosja në shiritin anësor, emrat e skedave dhe raportet e rrëzimeve.**

- **Zhvendosja e një elementi në shiritin anësor nuk e prish më aplikacionin.** Me mini-shfletuesin, Cilësimet ose regjistrat MCP të hapur, çdo tërheqje në shiritin anësor e shkatërronte ndërfaqen dhe vetëm rinisja e kthente.
- **Riemërtimi i një elementi tani përditëson çdo skedë të hapur** — përfshirë skedat në një panel të ndarë dhe skedat e çdo lloji kërkese (gRPC, GraphQL, Redis…), të cilat ruanin emrin e vjetër derisa t'i rihapnit.
- **Raportet e rrëzimeve na mbërrijnë sërish.** Me raportimin të aktivizuar, 1.0.0 nuk dërgonte asgjë në heshtje: një rrëzim që hasnit nuk na tregonte asgjë.
- **Ilustrimi «gjuhët e kodit» i shfaq sërish logot e veta.**

## v1.0.0

**Restorm 1.0 — klienti API local-first, tashmë i disponueshëm.**

Restorm është një klient desktop i shpejtë, offline-first, për të testuar dhe drejtuar API-të në të gjitha protokollet kryesore.

- **Protokollet**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Skenarët**: lidhni kërkesat në mënyrë vizuale, degëzim/cikël, nxirrni dhe ripërdorni vlera, ekzekutoni pa ndërfaqe në CI.
- **Mjediset & variablat**: `{{handlebars}}` kudo, sekrete të tipizuara, mjedise për çdo dosje.
- **Importim/Eksportim**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, eksportim kodi.
- **Projekte nativë për Git**: projekti juaj `.restorm` është një skedar i thjeshtë — versionojeni, krahasojeni dhe zgjidhni konfliktet brenda aplikacionit.
- **Local-first & privat**: gjithçka ekzekutohet në makinën tuaj; një mur zjarri dalës kontrollon çdo thirrje të jashtme.
- **Ndërplatformë**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Edicioni Community falas, me Pro & Enterprise për ekipet.
