# Changelog

## v1.1.4

**Koble til AI-assistenten din på macOS — nå pålitelig.**

- **Rettet: Claude Desktop og Cursor på macOS.** Å koble til en AI-assistent lastet inn Restorms verktøy, men hvert kall mislyktes deretter med «ingen kjørende instans», selv med Restorm åpen — appen og connectoren lette etter hverandre i forskjellige midlertidige mapper. De finner nå hverandre pålitelig, uansett hva som startet connectoren.
- **Formell tiltale på italiensk, polsk og finsk.** Grensesnittet tiltaler deg nå i formell form på disse tre språkene, i tråd med resten.
- **Code-handling i scenarier — ryddigere, med innebygde eksempler.** Code-noden strekker seg ikke lenger når skriptet er langt, og editoren får en fane **Trenger du hjelp?** som viser et kjøreklart eksempel i språket du har valgt (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). Å lime inn mens editoren er åpen, legger ikke lenger en løs Code-node på lerretet.
- **Finn designproblemer i de importerte API-ene dine.** Etter import av et API — eller når du åpner en fil på nytt — sjekker Restorm stille hvert API for strukturelle problemer (dupliserte ruter, manglende svar, stier som kolliderer med mockserveren…), merker det i sidepanelet med et «!» og legger til en «Problemer»-fane som viser hvert problem og nøyaktig hvilke ruter det berører, der hver rute kan foldes ut til dokumentasjonen sin.

## v1.1.3

**Koble AI-assistenten din til Restorm.**

- **Med ett klikk, rett fra appen.** MCP-menyen i statuslinjen tilbyr nå «Legg til Restorm i AI-assistenten din» — ferdig oppsett til å lime inn for Claude Code, Claude Desktop og Cursor, pluss «Legg til i Claude Code» med ett klikk.
- **Eller én linje, hvor som helst.** Pek en hvilken som helst MCP-klient mot den kjørende Restorm-en din med `npx -y restorm-mcp` — broen finner den selv, ingen port eller token å kopiere.
- **En plugin for Claude Code.** Kjør `/plugin marketplace add Monsieur-Dev/restorm`, og installer deretter `restorm`-pluginen.

Se [Koble til AI-assistenten din](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Støtte for OpenAPI 3.2.**

- **Importer OpenAPI 3.2-spesifikasjoner.** `QUERY`-metoden, egendefinerte verb (`additionalOperations`), query string-parameteren og strømmemediatyper importeres som klare forespørsler.
- **Bla etter en fil å importere.** En Bla gjennom-knapp i importdialogen åpner en innebygd filvelger — ikke mer å skrive eller dra en sti.
- **Delt visning for store innliminger.** Å lime inn en spesifikasjon med flere linjer åpner en kodeeditor til venstre og forhåndsvisningen til høyre, med en flyttbar skillelinje.
- **Tolerant import.** En spesifikasjon med et par ødelagte `$ref`-er importerer alle rutene den kan og viser en advarsel med det den måtte hoppe over.

Rettelser:

- Å importere en ugyldig eller utilgjengelig spesifikasjon viser en tydelig melding i stedet for å åpne dialogen for krasjrapport.
- Detaljvisningen av krasjrapporten kan rulles igjen.
- Bakgrunner bak dialoger er ikke lenger uskarpe.

## v1.1.1

**API-designeren styres nå fra sidepanelet.**

- **Modellene, enumene og rutene dine bor i sidepanelet.** De tre listene i fanene forsvinner — modeller (med arvenøstingen sin), enums og ruter (grupper og rutene deres) ligger nå direkte i treet i sidepanelet. Høyreklikk for å gi nytt navn, legge til en undermodell eller undergruppe, klone en rute, generere CRUD eller slette; dra for å endre rekkefølge eller forelder — aldri ut av designet. Hver side viser nå bare detaljene for det valgte elementet.
- **En oversikt over modellene, enumene og rutene dine.** Rotnoden i hver seksjon viser nå alt under den — og Modeller får en **Graf**-fane: et klassediagram over modellene dine med arv og referanser. Enumer viser verdiene sine rett ved siden av navnet.
- **Ett sted å gi nytt navn.** En modell, enum eller rute får nytt navn fra den store tittelen (blyanten), og et tomt navn viser **«<uten navn>»** slik at blyanten alltid er innen rekkevidde — navnet vises ikke lenger to ganger på siden.
- **Valideringsfeil peker på elementet.** Når noe er galt — en modell og en enum med samme navn, en referanse til noe som ikke finnes lenger — forklarer en melding øverst på modellen, enumen eller ruten det.
- **En fullstendig brødsmulesti.** Stien speiler hele sidefeltets hierarki — mapper › design › seksjon › gruppe › element — og hvert segment er klikkbart.
- **Velg flere, slett på én gang.** Velg flere modeller, enumer eller ruter og slett dem på én gang, etter en bekreftelse.
- **Kopier eller åpne kilden til en kodemal med ett klikk.** På siden "</> Code" viser en mal ved hover en knapp for å kopiere URL-en eller stien og en for å åpne den — repoet i nettleseren, eller mappen på disken for en lokal mal.
- **Nye ruter starter med et navn.** En rute laget fra bunnen av får nå et standardnavn, så du kan gi den nytt navn med en gang.
- **Forhåndsvisningsfaner, som i editoren din.** Ett klikk åpner nå et element i en gjenbrukbar **forhåndsvisnings**-fane (navnet vises i kursiv); å klikke et annet element gjenbruker samme fane i stedet for å stable en ny. Dobbeltklikk på den, rediger noe, eller kjør en forespørsel for å holde den åpen for godt. Slå det av under Innstillinger › Oppførsel.
- **Fest fanene du holder åpne.** Høyreklikk en fane og fest den: festede faner blir liggende først, overlever «lukk de andre» og huskes per prosjekt.
- **Miljøer får en skikkelig detaljvisning.** Åpne et miljø for å gi det nytt navn fra tittelen, angi ikon og farge og legge til et undermiljø — og høyreklikkmenyen dupliserer nå et miljø med alle variablene og undermiljøene.

Rettelser:

- **Å velge en kodemal lukker biblioteket.** "Bruk" tar deg nå rett tilbake til Code-siden.
- **Dokumentasjonsgenerering feiler ikke lenger på valgfrie felter.** Å generere dokumentasjon fra et design der modellen eller parameteren lot "required" være uinnstilt, stopper ikke lenger med en malfeil.
- **Sletting av en enum spør først.** Enumer får samme bekreftelse som modeller og ruter.
- **Sidefeltet avslører det du velger.** Med «synkroniser sidefeltet med aktiv fane» på, utvider det å velge eller opprette en modell, enum eller rute foreldrene dens slik at den holdes synlig i treet.
- **Miljøknappen forblir lesbar på enhver farge.** Etiketten skifter nå til mørk eller lys tekst for å holde seg lesbar mot miljøets farge, som kjør-knappen.
- **Midtklikk lukker en åpen fil.** Å midtklikke et element i «Åpne»-listen i sidefeltet lukker fanen dens — og en ny Oppførsel-innstilling lar deg skjule det panelet helt.
- **Klarere ordlyd når du starter fra dokumentasjon.** I dokumentasjonen til et importert API står det nå "Opprett en ny forespørsel fra denne dokumentasjonen" på knappen.
- **Innlogging fungerer i Microsoft Store-versjonen.** Tilbakekallet med egendefinert protokoll som nettleseren gir tilbake etter innlogging, er nå deklarert i Store-pakken, slik at innloggingen fullføres i stedet for å få tidsavbrudd.

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
