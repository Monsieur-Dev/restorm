# Changelog

## v1.0.4

**Logg inn én gang — alle vinduer følger etter.**

- **Kontoen din følger deg nå på tvers av vinduer.** Logg inn, logg ut eller bytt plan i ett Restorm-vindu, og alle andre åpne vinduer tar det i bruk umiddelbart — uten omstart, uten en ny innlogging. Og når du fullfører en innlogging i nettleseren, når bekreftelsen nå vinduet som ba om den, selv med flere vinduer åpne.

Rettelser:

- **Kodenoder starter igjen på Intel-Macer** — macOS-Intel-bygget inneholdt en esbuild-binær kompilert for Apple Silicon.
- **AppImage-starterens handling «Nytt vindu» åpner et vindu igjen**, og kommandoen `restorm` installert av .deb/.rpm-pakkene virker igjen.

## v1.0.3

**Restorm kjører i CI, uten FUSE.**

- **`restorm-cli` virker nå på CI-runnere og i containere.** Linux-bygget pakkes ut i stedet for å monteres: FUSE, som Ubuntu ikke lenger leverer, trengs ikke mer.

## v1.0.2

**CLI/CI-tokenene dine, uten å forlate appen.**

- **Opprett, se og tilbakekall tokener fra Restorm** — for Pro- og Enterprise-brukere, fra kontoknappen i tittellinjen. Slutt på turen til dashbordet for et token til rørledningen du skriver akkurat nå.
- **Tokener kan utløpe.** Velg levetid når du oppretter: 7 til 365 dager, eller uten utløp som før. Et utløpt token avvises på samme måte som et tilbakekalt.
- **Organisasjonen din kan delegere.** En administrator kan la et bestemt medlem opprette tokener, og separat gi tilgang til revisjonsloggen — uten å gjøre vedkommende til administrator.
- **Restorm installerer seg nå fra npm.** `npm i -g restorm-cli`, deretter `restorm` — programmet starter på Linux, macOS og Windows uten installasjonsprogram. Bygget lastes ned én gang, kontrolleres mot den publiserte sjekksummen og lagres i hurtiglageret, så en pipeline ikke laster det ned på nytt ved hver jobb.

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
