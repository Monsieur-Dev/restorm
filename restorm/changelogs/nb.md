# Changelog

## v1.1.0

🎉 **Restorm er nå også en API-designer.** Design API-et ditt, server det som en live-mock på tvers av fem protokoller samtidig, og generer klientene — uten å forlate appen, alt på din egen disk.

- **En visuell API-designer.** Modeller API-et ditt for hånd — modeller, enums (navngitte eller inline), ruter, parametere, navngitte eksempler, begrensninger, tagger og utfasinger — uten å skrive en eneste linje spesifikasjon.
- **Server det som en mock, med ett klikk, på tvers av 5 protokoller samtidig.** Designet blir en server som svarer i HTTP, GraphQL, SOAP, OData og gRPC samtidig. Svarene kommer fra dine navngitte eksempler (eller realistiske data generert fra modellene dine), med validering av begrensninger, simulert ventetid og en stateful modus.
- **Klare-til-bruk klienter, generert automatisk.** Mens mocken kjører, oppretter Clients-seksjonen ekte, kjørbare forespørsler for hver aktiverte protokoll, rettet mot mockens endepunkter. Ett klikk åpner en forespørsel og treffer serveren — ikke mer reimportering av API-et ditt et annet sted for å teste det.
- **Generer kode** fra designet ditt med de medfølgende malene og dine egne tilpassede, gjengitt i en sandkasse og skrevet til disk først etter at du bekrefter. **Eksporter også deskriptoren** (OpenAPI og andre).
- **Ved import forhåndsutfylles forespørselskroppene**: GraphQL velger returtypens skalarfelter, gRPC utvider nøstede meldinger — forespørselen kjører som den er.

## v1.0.6

Rettelser:

- **Et svært stort prosjekt feiler nå ved lagring med en tydelig melding i stedet for å fryse.** Hvis et prosjekt blir for stort til å skrives til disk i én omgang — noe som kan skje etter import av et uvanlig stort API-skjema — sier Restorm nå tydelig fra at det er for stort til å lagres, i stedet for å krasje eller feile i stillhet.
- **Tydeligere feilrapportering bak kulissene.** Å avbryte dialogen «Lagre som» registreres ikke lenger som en feil, og en mislykket import melder nå sin egentlige årsak — slik at de reelle problemene er lettere å oppdage og rette.

## v1.0.5

**Cookie jar — én krukke med cookies per miljø.**

- **Hvert miljø beholder sine egne cookies.** Logg inn mot dev-API-et og prod-API-et ditt fra to miljøer, og øktene deres krysses aldri — en cookie som fanges opp i det ene, sendes bare tilbake i akkurat det. Utløp, `Path`, `Domain` og subdomener, `Secure`, `HttpOnly` og `SameSite` respekteres nå, i stedet for å forkastes.
- **Møt Cookie jar.** En ny arbeidsbenkfane — **Vis ▸ Cookie jar** — lister hvert miljøs cookies gruppert etter domene i sammenleggbare ruter: rediger en verdi, slett en, tøm et domene eller hele krukken, eller legg til en cookie for hånd. Den oppdateres direkte etter hvert som forespørslene dine setter cookies.
- **Se hva hver forespørsel sendte og mottok.** Hver forespørsel har nå en **Cookies**-fane ved siden av Svar og Info, som viser cookiene som ble sendt med kallet og cookiene som ble mottatt tilbake — medregnet cookies satt ved en omdirigering, som aldri når det endelige svaret. Den finnes også på tidligere svar i historikken din.
- **Cookie-innlogging bare virker.** En forespørsel som returnerer `Set-Cookie` fanges opp og spilles av automatisk på de beskyttede kallene som følger — også gjennom en scenariokjøring, der hvert steg deler miljøets krukke.
- **Cookies bevares som i en nettleser.** Cookies med et utløp lagres per prosjekt og lastes inn på nytt når du åpner det igjen; øktcookies forkastes når du starter på nytt — akkurat slik en nettleser ville gjort.
- **Mer enn REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC og SSE sender og lagrer nå alle cookies, og WebSocket tar dem med på tilkoblingshåndtrykket.
- **Cookies kan bruke variablene dine.** Skriv `{{token}}` i en cookie du legger til for hånd, så løses den mot det aktive miljøet når forespørselen sendes.

Rettelser:

- **Automatisk lagring dekker nå miljøer inne i mapper.** Å legge til eller gi nytt navn til et undermiljø lagres med det samme i modus for automatisk lagring — ikke mer «lagre før lukking?»-spørsmål for en endring som allerede var ment å ligge på disk.

## v1.0.4

**Logg inn én gang — alle vinduer følger etter.**

- **Kontoen din følger deg nå på tvers av vinduer.** Logg inn, logg ut eller bytt plan i ett Restorm-vindu, og alle andre åpne vinduer tar det i bruk umiddelbart — uten omstart, uten en ny innlogging. Og når du fullfører en innlogging i nettleseren, når bekreftelsen nå vinduet som ba om den, selv med flere vinduer åpne.

Rettelser:

- **Kodenoder starter igjen på Intel-Macer** — macOS-Intel-bygget inneholdt en esbuild-binær kompilert for Apple Silicon.
- **AppImage-starterens handling «Nytt vindu» åpner et vindu igjen**, og kommandoen `restorm` installert av .deb/.rpm-pakkene virker igjen.
- **Oppstarten på Windows er renere** — vinduet lastes nå via appprotokollen uten stille reserveløsning etter en intern feil ved hver start.

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
