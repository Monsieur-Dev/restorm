# Changelog

## v1.1.4

**Forbind din AI-assistent på macOS — nu pålideligt.**

- **Rettet: Claude Desktop og Cursor på macOS.** At forbinde en AI-assistent indlæste Restorms værktøjer, men hvert kald fejlede så med „ingen kørende instans“, selv med Restorm åben — appen og connectoren ledte efter hinanden i forskellige midlertidige mapper. De finder nu hinanden pålideligt, uanset hvad der startede connectoren.
- **Formel tiltale på italiensk, polsk og finsk.** Grænsefladen tiltaler dig nu i formel form på disse tre sprog, i tråd med resten.
- **Code-handling i scenarier — renere, med indbyggede eksempler.** Code-noden strækker sig ikke længere, når scriptet er langt, og dens editor får en fane **Brug for hjælp?**, der viser et køreklart eksempel i det sprog, du har valgt (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). At indsætte, mens editoren er åben, efterlader ikke længere en løs Code-node på lærredet.

## v1.1.3

**Forbind din AI-assistent til Restorm.**

- **Med ét klik, direkte i appen.** MCP-menuen i statuslinjen tilbyder nu „Tilføj Restorm til din AI-assistent“ — en klar-til-at-indsætte-opsætning for Claude Code, Claude Desktop og Cursor, plus „Tilføj til Claude Code“ med ét klik.
- **Eller én linje, hvor som helst.** Peg en hvilken som helst MCP-klient mod dit kørende Restorm med `npx -y restorm-mcp` — broen finder det selv, ingen port eller token at kopiere.
- **En plugin til Claude Code.** Kør `/plugin marketplace add Monsieur-Dev/restorm`, og installér derefter `restorm`-pluginet.

Se [Forbind din AI-assistent](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Understøttelse af OpenAPI 3.2.**

- **Importér OpenAPI 3.2-specifikationer.** `QUERY`-metoden, brugerdefinerede verber (`additionalOperations`), query string-parameteren og streaming-medietyper importeres som klar-til-brug-anmodninger.
- **Gennemse en fil til import.** En Gennemse-knap i importdialogen åbner en indbygget filvælger — ikke mere at skrive eller trække en sti.
- **Delt visning ved store indsætninger.** Når du indsætter en spec med flere linjer, åbnes en kodeeditor til venstre og forhåndsvisningen til højre med en trækbar adskiller.
- **Tolerant import.** En spec med et par ødelagte `$ref`s importerer alle de ruter, den kan, og viser en advarsel med det, den måtte springe over.

Rettelser:

- Import af en ugyldig eller utilgængelig spec viser en klar besked i stedet for at åbne dialogen til nedbrudsrapport.
- Detaljevisningen af nedbrudsrapporten kan rulles igen.
- Baggrunde bag dialoger er ikke længere sløret.

## v1.1.1

**API-designeren styres nu fra sidepanelet.**

- **Dine modeller, enums og ruter bor i sidepanelet.** De tre lister i fanerne forsvinder — modeller (med deres arvehierarki), enums og ruter (grupper og deres ruter) sidder nu direkte i sidepanelets træ. Højreklik for at omdøbe, tilføje en undermodel eller undergruppe, klone en rute, generere CRUD eller slette; træk for at omarrangere eller flytte forælder — aldrig ud af designet. Hver side viser nu kun detaljerne for det valgte element.
- **Et overblik over dine modeller, enums og ruter.** Rodknuden i hver sektion viser nu alt under den — og Modeller får en **Graf**-fane: et klassediagram over dine modeller med deres nedarvning og referencer. Enums viser deres værdier lige ved siden af navnet.
- **Ét sted at omdøbe.** En model, enum eller rute omdøbes fra dens store titel (blyanten), og et tomt navn viser **»<uden navn>«**, så blyanten altid er inden for rækkevidde — navnet vises ikke længere to gange på siden.
- **Valideringsfejl peger på elementet.** Når noget er galt — en model og en enum med samme navn, en reference til noget, der ikke længere findes — forklarer en note øverst på modellen, enum'en eller ruten det.
- **En komplet brødkrumme-sti.** Stien afspejler hele sidepanelets hierarki — mapper › design › sektion › gruppe › element — og hvert segment kan klikkes.
- **Vælg flere, slet på én gang.** Vælg flere modeller, enums eller ruter og slet dem på én gang, efter en bekræftelse.
- **Kopiér eller åbn kilden til en kodeskabelon med ét klik.** På siden "</> Code" viser en skabelon ved hover en knap til at kopiere dens URL eller sti og en til at åbne den — repositoriet i din browser eller mappen på disken for en lokal skabelon.
- **Nye ruter starter med et navn.** En rute oprettet fra bunden får nu et standardnavn, så du kan omdøbe den med det samme.
- **Forhåndsvisningsfaner, som i din editor.** Et enkelt klik åbner nu et element i en genanvendelig **forhåndsvisnings**-fane (dens navn vises i kursiv); at klikke på et andet element genbruger samme fane i stedet for at stable en ny. Dobbeltklik på den, redigér noget, eller kør en forespørgsel for at holde den åben permanent. Slå det fra under Indstillinger › Adfærd.
- **Fastgør de faner, du holder åbne.** Højreklik på en fane og fastgør den: fastgjorte faner bliver forrest, overlever »luk de andre« og huskes pr. projekt.
- **Miljøer får en rigtig detaljevisning.** Åbn et miljø for at omdøbe det fra dets titel, angive dets ikon og farve og tilføje et undermiljø — og højrekliksmenuen dublerer nu et miljø med alle dets variabler og undermiljøer.

Rettelser:

- **At vælge en kodeskabelon lukker biblioteket.** "Brug" sender dig nu direkte tilbage til Code-siden.
- **Dokumentationsgenerering fejler ikke længere på valgfrie felter.** At generere dokumentation fra et design, hvis model eller parameter lod "required" være uindstillet, stopper ikke længere med en skabelonfejl.
- **Sletning af en enum spørger først.** Enums får samme bekræftelse som modeller og ruter.
- **Sidepanelet afslører dit valg.** Med »synkronisér sidepanel med aktiv fane« slået til udvider det at vælge eller oprette en model, enum eller rute dens forældre, så den forbliver synlig i træet.
- **Miljøknappen forbliver læsbar på enhver farve.** Dens etiket skifter nu til mørk eller lys tekst for at forblive læselig mod miljøets farve, ligesom kør-knappen.
- **Midterklik lukker en åben fil.** At midterklikke på et element i sidepanelets »Åbne«-liste lukker dens fane — og en ny Adfærd-indstilling lader dig skjule det panel helt.
- **Klarere ordlyd når man starter fra dokumentation.** I et importeret API's dokumentation lyder knappen nu "Opret en ny forespørgsel ud fra denne dokumentation."
- **Login virker i Microsoft Store-versionen.** Det brugerdefinerede protokol-callback, som browseren giver tilbage efter login, er nu erklæret i Store-pakken, så login fuldføres i stedet for at få timeout.

## v1.1.0

🎉 **Restorm er nu også en API-designer.** Design dit API, servér det som en live-mock på tværs af fem protokoller på én gang, og generér dets klienter — uden at forlade appen, alt sammen på din egen disk.

- **En visuel API-designer.** Modellér dit API i hånden — modeller, enums (navngivne eller inline), ruter, parametre, navngivne eksempler, begrænsninger, tags og udfasninger — uden at skrive en eneste linje spec.
- **Servér det som en mock, med ét klik, på tværs af 5 protokoller på én gang.** Designet bliver til en server, der svarer i HTTP, GraphQL, SOAP, OData og gRPC samtidig. Svarene kommer fra dine navngivne eksempler (eller realistiske data genereret ud fra dine modeller), med validering af begrænsninger, simuleret latenstid og en stateful tilstand.
- **Klar-til-brug klienter, genereret automatisk.** Mens mocken kører, opretter Clients-sektionen rigtige, kørbare forespørgsler for hver aktiveret protokol, rettet mod mockens endpoints. Ét klik åbner en forespørgsel og rammer serveren — ikke mere genimport af dit API et andet sted for at teste det.
- **Generér kode** ud fra dit design med de medfølgende skabeloner og dine egne tilpassede, gengivet i en sandkasse og skrevet til disk først, når du bekræfter. **Eksportér også deskriptoren** (OpenAPI og andre).
- **Ved import forudfyldes forespørgselsindhold**: GraphQL vælger returtypens skalarfelter, gRPC udfolder indlejrede beskeder — forespørgslen kører, som den er.

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
