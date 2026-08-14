# Changelog

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
