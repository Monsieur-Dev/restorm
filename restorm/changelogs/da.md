# Changelog

## v1.0.1

**Første rettelse: flytning i sidepanelet, fanenavne og nedbrudsrapporter.**

- **At flytte et element i sidepanelet ødelægger ikke længere appen.** Med minibrowseren, Indstillinger eller MCP-loggene åbne rev enhver trækbevægelse i sidepanelet grænsefladen ned, og kun en genstart hjalp.
- **Omdøbning af et element opdaterer nu alle åbne faner** — også faner i et opdelt panel og faner for alle anmodningstyper (gRPC, GraphQL, Redis…), som beholdt deres gamle navn, indtil de blev åbnet igen.
- **Nedbrudsrapporter når frem til os igen.** Med rapportering slået til sendte 1.0.0 stiltiende ingenting: et nedbrud hos dig fortalte os intet.
- **Illustrationen “kodesprog” viser sine logoer igen.**

## v1.0.0

**Restorm 1.0 — den local-first API-klient er landet.**

Restorm er en hurtig, offline-first desktopklient til at teste og styre API'er på tværs af alle de vigtigste protokoller.

- **Protokoller**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenarier**: kæd forespørgsler sammen visuelt, forgren/loop, udtræk og genbrug værdier, kør headless i CI.
- **Miljøer og variabler**: `{{handlebars}}` overalt, typede hemmeligheder, miljøer pr. mappe.
- **Import/Eksport**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, kodeeksport.
- **Git-native projekter**: dit `.restorm`-projekt er en almindelig fil — versionér, sammenlign og løs konflikter i appen.
- **Local-first og privat**: alt kører på din egen maskine; en udgående firewall kontrollerer hvert eksternt kald.
- **Platformsuafhængig**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Gratis Community-udgave, med Pro og Enterprise til teams.
