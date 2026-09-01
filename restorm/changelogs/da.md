# Changelog

## v1.0.6

Rettelser:

- **Et meget stort projekt fejler nu ved lagring med en klar besked i stedet for at fryse.** Hvis et projekt bliver for stort til at skrive til disken i én omgang — hvilket kan ske efter import af et usædvanligt stort API-skema — fortæller Restorm dig nu tydeligt, at det er for stort til at gemme, i stedet for at gå ned eller fejle i stilhed.
- **Tydeligere fejlrapportering bag kulisserne.** Annullering af dialogen »Gem som« registreres ikke længere som en fejl, og en mislykket import angiver nu sin reelle årsag — så de rigtige problemer er lettere at opdage og rette.

## v1.0.5

**Cookie jar — én krukke cookies pr. miljø.**

- **Hvert miljø beholder sine egne cookies.** Log ind på dit dev-API og dit prod-API fra to miljøer, og deres sessioner blandes aldrig – en cookie, der fanges i det ene, sendes kun tilbage i netop det. Udløb, `Path`, `Domain` og underdomæner, `Secure`, `HttpOnly` og `SameSite` respekteres nu i stedet for at blive kasseret.
- **Mød Cookie jar.** En ny fane på arbejdsfladen — **Vis ▸ Cookie jar** — viser hvert miljøs cookies grupperet efter domæne i sammenklappelige paneler: rediger en værdi, slet en, ryd et domæne eller hele krukken, eller tilføj en cookie manuelt. Den opdateres i realtid, efterhånden som dine forespørgsler sætter cookies.
- **Se, hvad hver forespørgsel sendte og modtog.** Hver forespørgsel har nu en **Cookies**-fane ved siden af Svar og Info, der viser de cookies, der blev sendt med kaldet, og de cookies, der blev modtaget retur — herunder cookies sat ved en omdirigering, som aldrig når frem til det endelige svar. Den findes også på tidligere svar i din historik.
- **Cookie-logins virker bare.** En forespørgsel, der returnerer `Set-Cookie`, fanges og gensendes automatisk i de beskyttede kald, der følger – også på tværs af en scenariekørsel, hvor hvert trin deler miljøets krukke.
- **Cookies bevares som i en browser.** Cookies med en udløbstid gemmes pr. projekt og genindlæses, når du åbner det igen; session-cookies kasseres, når du genstarter — præcis som en browser ville gøre.
- **Ud over REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC og SSE sender og gemmer nu alle cookies, og WebSocket bærer dem med i forbindelsens handshake.
- **Cookies kan bruge dine variabler.** Skriv `{{token}}` i en cookie, du tilføjer manuelt, og den slås op mod det aktive miljø, når forespørgslen sendes af sted.

Rettelser:

- **Automatisk lagring dækker nu miljøer i mapper.** Tilføjelse eller omdøbning af et undermiljø gemmes med det samme i tilstanden for automatisk lagring — ikke flere "gem før lukning?"-prompter for en ændring, der allerede var tænkt til at ligge på disken.

## v1.0.4

**Log ind én gang — alle vinduer følger med.**

- **Din konto følger dig nu på tværs af vinduer.** Log ind, log ud eller skift abonnement i ét Restorm-vindue, og alle andre åbne vinduer overtager det med det samme — uden genstart, uden endnu et login. Og når du afslutter et login i browseren, lander bekræftelsen nu i det vindue, der bad om det, selv med flere vinduer åbne.

Rettelser:

- **Kodenoder starter igen på Intel-Macs** — macOS-Intel-builden indeholdt en esbuild-binær kompileret til Apple Silicon.
- **AppImage-launcherens handling "Nyt vindue" åbner igen et vindue**, og kommandoen `restorm` installeret af .deb/.rpm-pakkerne virker igen.
- **Opstart på Windows er renere** — vinduet indlæses nu via app-protokollen uden stille fallback efter en intern fejl ved hver start.

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
