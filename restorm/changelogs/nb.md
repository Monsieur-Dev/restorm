# Changelog

## v1.0.2

**CLI/CI-tokenene dine, uten å forlate appen.**

- **Opprett, se og tilbakekall tokener fra Restorm** — for Pro- og Enterprise-brukere, fra kontoknappen i tittellinjen. Slutt på turen til dashbordet for et token til rørledningen du skriver akkurat nå.
- **Tokener kan utløpe.** Velg levetid når du oppretter: 7 til 365 dager, eller uten utløp som før. Et utløpt token avvises på samme måte som et tilbakekalt.
- **Organisasjonen din kan delegere.** En administrator kan la et bestemt medlem opprette tokener, og separat gi tilgang til revisjonsloggen — uten å gjøre vedkommende til administrator.

## v1.0.1

**Første rettelse: flytting i sidepanelet, fanenavn og krasjrapporter.**

- **Å flytte et element i sidepanelet ødelegger ikke lenger appen.** Med minileseren, Innstillinger eller MCP-loggene åpne rev enhver dra-bevegelse i sidepanelet ned grensesnittet, og bare en omstart hjalp.
- **Å gi et element nytt navn oppdaterer nå alle åpne faner** — også faner i et delt panel og faner for alle forespørselstyper (gRPC, GraphQL, Redis…), som beholdt det gamle navnet til de ble åpnet på nytt.
- **Krasjrapporter når oss igjen.** Med rapportering slått på sendte 1.0.0 stille ingenting: et krasj hos deg fortalte oss ingenting.
- **Illustrasjonen «kodespråk» viser logoene sine igjen.**

## v1.0.0

**Restorm 1.0 — den local-first API-klienten er her.**

Restorm er en rask, offline-first skrivebordsklient for å teste og styre API-er på tvers av alle de viktigste protokollene.

- **Protokoller**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenarier**: kjed sammen forespørsler visuelt, forgren/løkke, hent ut og gjenbruk verdier, kjør headless i CI.
- **Miljøer og variabler**: `{{handlebars}}` overalt, typede hemmeligheter, miljøer per mappe.
- **Import/Eksport**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, kodeeksport.
- **Git-native prosjekter**: `.restorm`-prosjektet ditt er en vanlig fil — versjonér, sammenlign og løs konflikter i appen.
- **Local-first og privat**: alt kjører på din egen maskin; en utgående brannmur kontrollerer hvert eksternt kall.
- **Plattformuavhengig**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Gratis Community-utgave, med Pro og Enterprise for team.
