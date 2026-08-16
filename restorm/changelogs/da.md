# Changelog

## v1.0.4

**Log ind én gang — alle vinduer følger med.**

- **Din konto følger dig nu på tværs af vinduer.** Log ind, log ud eller skift abonnement i ét Restorm-vindue, og alle andre åbne vinduer overtager det med det samme — uden genstart, uden endnu et login. Og når du afslutter et login i browseren, lander bekræftelsen nu i det vindue, der bad om det, selv med flere vinduer åbne.

Rettelser:

- **Kodenoder starter igen på Intel-Macs** — macOS-Intel-builden indeholdt en esbuild-binær kompileret til Apple Silicon.
- **AppImage-launcherens handling "Nyt vindue" åbner igen et vindue**, og kommandoen `restorm` installeret af .deb/.rpm-pakkerne virker igen.

## v1.0.3

**Restorm kører i CI, uden FUSE.**

- **`restorm-cli` virker nu på CI-runnere og i containere.** Linux-bygningen pakkes ud i stedet for at blive monteret: FUSE, som Ubuntu ikke længere leverer, er ikke nødvendigt mere.

## v1.0.2

**Dine CLI/CI-tokens, uden at forlade appen.**

- **Opret, se og tilbagekald dine tokens fra Restorm** — for Pro- og Enterprise-brugere, fra kontoknappen i titellinjen. Slut med turen til dashboardet for at få et token til den pipeline, du sidder og skriver.
- **Tokens kan udløbe.** Vælg en levetid ved oprettelsen: 7 til 365 dage, eller uden udløb som hidtil. Et udløbet token afvises på samme måde som et tilbagekaldt.
- **Din organisation kan uddelegere.** En administrator kan lade et bestemt medlem oprette tokens og separat give adgang til revisionsloggen — uden at gøre vedkommende til administrator.
- **Restorm installerer nu sig selv fra npm.** `npm i -g restorm-cli` og derefter `restorm` — programmet starter på Linux, macOS og Windows uden installationsprogram. Bygningen hentes én gang, kontrolleres mod sin offentliggjorte tjeksum og gemmes i cachen, så en pipeline ikke længere henter den ved hvert job.

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
