# Changelog

## v1.1.4

**Verbind uw AI-assistent op macOS — nu betrouwbaar.**

- **Opgelost: Claude Desktop en Cursor op macOS.** Het verbinden van een AI-assistent laadde de tools van Restorm wel, maar daarna mislukte elke aanroep met “geen actieve instantie”, zelfs met Restorm open — de app en de connector zochten elkaar in verschillende tijdelijke mappen. Ze vinden elkaar nu betrouwbaar, ongeacht wat de connector heeft gestart.
- **Formele aanspreekvorm in het Italiaans, Pools en Fins.** De interface spreekt u in deze drie talen nu aan in de formele vorm, in lijn met de rest.
- **Code-actie in scenario's — netter, met ingebouwde voorbeelden.** De Code-node rekt niet meer uit bij een lang script, en de editor krijgt een tabblad **Hulp nodig?** met een direct uitvoerbaar voorbeeld in de door u gekozen taal (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). Plakken terwijl de editor open staat, zet niet langer een losse Code-node op het canvas.
- **Spot ontwerpproblemen in uw geïmporteerde API's.** Na het importeren van een API — of bij het opnieuw openen van een bestand — controleert Restorm onopvallend elke API op structurele problemen (dubbele routes, ontbrekende antwoorden, paden die botsen met de Mock Server…), markeert die in de zijbalk met een “!”, en voegt een tabblad “Problemen” toe dat elk probleem en de precies betrokken routes opsomt, waarbij elke route uitklapbaar is naar de bijbehorende documentatie.

## v1.1.3

**Verbind uw AI-assistent met Restorm.**

- **Met één klik, vanuit de app.** Het MCP-menu in de statusbalk biedt nu “Restorm aan uw AI-assistent toevoegen” — kant-en-klare instellingen om te plakken voor Claude Code, Claude Desktop en Cursor, plus een “Aan Claude Code toevoegen” met één klik.
- **Of één regel, overal.** Richt een willekeurige MCP-client op uw draaiende Restorm met `npx -y restorm-mcp` — de brug vindt het vanzelf, geen poort of token om te kopiëren.
- **Een plugin voor Claude Code.** Voer `/plugin marketplace add Monsieur-Dev/restorm` uit en installeer daarna de `restorm`-plugin.

Zie [Uw AI-assistent verbinden](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Ondersteuning voor OpenAPI 3.2.**

- **Importeer OpenAPI 3.2-specificaties.** De `QUERY`-methode, aangepaste werkwoorden (`additionalOperations`), de query-stringparameter en streaming-mediatypes worden geïmporteerd als kant-en-klare verzoeken.
- **Blader naar een bestand om te importeren.** Een Bladeren-knop in het importvenster opent een native bestandskiezer — geen pad meer typen of slepen.
- **Gesplitste weergave voor grote plaksels.** Bij het plakken van een spec met meerdere regels opent links een code-editor en rechts het voorbeeld, met een versleepbare scheiding.
- **Tolerante import.** Een spec met een paar kapotte `$ref`s importeert elke mogelijke route en toont een waarschuwing met wat is overgeslagen.

Oplossingen:

- Het importeren van een ongeldige of onbereikbare spec toont een duidelijke melding in plaats van het crashrapport-venster te openen.
- De detailweergave van het crashrapport scrollt weer.
- Achtergronden van vensters zijn niet langer wazig.

## v1.1.1

**De API-designer wordt nu vanuit de zijbalk bediend.**

- **Uw modellen, enums en routes leven in de zijbalk.** De drie lijsten in de tabbladen verdwijnen: de modellen (met hun overervingsnesting), de enums en de routes (groepen en hun routes) staan nu rechtstreeks in de boom van de zijbalk. Klik met de rechtermuisknop om te hernoemen, een submodel of subgroep toe te voegen, een route te klonen, CRUD te genereren of te verwijderen; sleep om te herordenen of opnieuw onder te brengen — nooit buiten het ontwerp. Elke pagina toont nu alleen nog de details van het geselecteerde item.
- **Een overzicht van uw modellen, enums en routes.** De hoofdknoop van elke sectie toont nu alles eronder — en Modellen krijgen een **Graph**-tab: een klassendiagram van uw modellen met hun overerving en verwijzingen. Enums tonen hun waarden naast de naam.
- **Eén plek om te hernoemen.** Een model, enum of route hernoemt u vanuit de grote titel (het potlood), en een lege naam toont **‘<naamloos>’** zodat het potlood altijd bereikbaar blijft — de naam staat niet langer twee keer op de pagina.
- **Validatiefouten wijzen het item aan.** Als er iets mis is — een model en een enum met dezelfde naam, een verwijzing naar iets dat niet meer bestaat — legt een melding boven het model, de enum of de route het uit.
- **Een volledig kruimelpad.** Het pad weerspiegelt de volledige zijbalkhiërarchie — mappen › ontwerp › sectie › groep › item — en elk segment is klikbaar.
- **Selecteer er meerdere, verwijder in één keer.** Selecteer meerdere modellen, enums of routes en verwijder ze in één keer, na een bevestiging.
- **Kopieer of open de bron van een codetemplate met één klik.** Op de pagina "</> Code" verschijnt bij het zweven over een template een knop om de URL of het pad te kopiëren en een om deze te openen: de repository in uw browser, of de map op schijf voor een lokale template.
- **Nieuwe routes beginnen met een naam.** Een van nul af opgebouwde route krijgt nu een standaardnaam, zodat u haar meteen kunt hernoemen.
- **Voorbeeldtabbladen, net als in uw editor.** Eén klik opent een item nu in een herbruikbaar **voorbeeld**tabblad (de naam schuin gedrukt); op een ander item klikken hergebruikt hetzelfde tabblad in plaats van een nieuw op te stapelen. Dubbelklik erop, bewerk iets of voer een verzoek uit om het definitief open te houden. Uit te schakelen via Instellingen › Gedrag.
- **Zet de tabbladen vast die u open houdt.** Klik met de rechtermuisknop op een tabblad en zet het vast: vastgezette tabbladen blijven vooraan, overleven ‘overige sluiten’ en worden per project onthouden.
- **Omgevingen krijgen een echte detailweergave.** Open een omgeving om haar via haar titel te hernoemen, haar pictogram en kleur in te stellen en een subomgeving toe te voegen — en het rechtsklikmenu dupliceert een omgeving nu met al haar variabelen en subomgevingen.

Oplossingen:

- **Een codetemplate kiezen sluit de bibliotheek.** "Gebruiken" brengt u nu direct terug naar de Code-pagina.
- **Het genereren van documentatie mislukt niet meer bij optionele velden.** Documentatie genereren uit een ontwerp waarvan het model of de parameter "required" niet had ingesteld, stopt niet meer met een templatefout.
- **Een enum verwijderen vraagt eerst.** Enums krijgen dezelfde bevestiging als modellen en routes.
- **De zijbalk onthult wat u selecteert.** Met ‘zijbalk synchroniseren met het actieve tabblad’ aan, klapt het selecteren of aanmaken van een model, enum of route de bovenliggende items uit zodat het zichtbaar blijft in de boom.
- **De omgevingsknop blijft leesbaar op elke kleur.** Het label schakelt nu naar donkere of lichte tekst om leesbaar te blijven op de kleur van de omgeving, net als de uitvoerknop.
- **Middelklik sluit een geopend bestand.** Met de middelste muisknop op een item in de lijst ‘Geopend’ van de zijbalk klikken sluit het tabblad ervan — en een nieuwe Gedrag-instelling laat u dat paneel helemaal verbergen.
- **Duidelijkere bewoording bij het starten vanuit de documentatie.** In de documentatie van een geïmporteerde API staat op de knop nu "Een nieuw verzoek maken vanuit deze documentatie."
- **Aanmelden werkt in de Microsoft Store-versie.** De callback met aangepast protocol die de browser na het inloggen teruggeeft, is nu gedeclareerd in het Store-pakket, zodat het aanmelden voltooit in plaats van te verlopen.

## v1.1.0

🎉 **Restorm is nu ook een API-designer.** Ontwerp uw API, serveer hem als live mock over vijf protocollen tegelijk en genereer zijn clients — allemaal zonder de app te verlaten, allemaal op uw eigen schijf.

- **Een visuele API-designer.** Modelleer uw API met de hand — modellen, enums (benoemd of inline), routes, parameters, benoemde voorbeelden, constraints, tags en deprecaties — zonder ook maar één regel spec te schrijven.
- **Serveer hem als mock, met één klik, over 5 protocollen tegelijk.** Het ontwerp wordt een server die tegelijk antwoordt in HTTP, GraphQL, SOAP, OData en gRPC. De antwoorden komen uit uw benoemde voorbeelden (of uit realistische data die uit uw modellen worden gegenereerd), met constraint-validatie, gesimuleerde latency en een stateful modus.
- **Direct uitvoerbare clients, automatisch gegenereerd.** Terwijl de mock draait, maakt de sectie Clients echte, uitvoerbare verzoeken voor elk ingeschakeld protocol, gericht op de endpoints van de mock. Eén klik opent een verzoek en raakt de server — geen herimporteren van uw API elders meer om hem te testen.
- **Genereer code** uit uw ontwerp met de meegeleverde templates en uw eigen aangepaste templates, gerenderd in een sandbox en pas naar schijf geschreven nadat u bevestigt. **Exporteer ook de descriptor** (OpenAPI en andere).
- **Bij import worden de verzoekbodies voorgevuld**: GraphQL selecteert de scalaire velden van het retourtype, gRPC vouwt geneste berichten uit — het verzoek draait zoals het is.

## v1.0.6

Correcties:

- **Een heel groot project mislukt bij het opslaan nu met een duidelijke melding in plaats van vast te lopen.** Als een project te groot wordt om in één keer naar schijf te schrijven — wat kan gebeuren na het importeren van een ongewoon groot API-schema — laat Restorm nu duidelijk weten dat het te groot is om op te slaan, in plaats van vast te lopen of stilletjes te mislukken.
- **Duidelijkere foutrapportage achter de schermen.** Het annuleren van een dialoogvenster 'Opslaan als' wordt niet langer als fout geregistreerd, en een mislukte import vermeldt nu de werkelijke oorzaak — zo zijn echte problemen makkelijker op te sporen en te verhelpen.

## v1.0.5

**Cookie jar — één pot cookies per omgeving.**

- **Elke omgeving houdt haar eigen cookies bij.** Meld u vanuit twee omgevingen aan bij uw dev-API en uw prod-API, en hun sessies raken nooit vermengd — een cookie die in de ene wordt vastgelegd, wordt alleen in die ene weer meegestuurd. Vervaldatum, `Path`, `Domain` en subdomeinen, `Secure`, `HttpOnly` en `SameSite` worden nu gerespecteerd in plaats van weggegooid.
- **Maak kennis met de Cookie jar.** Een nieuw werkbanktabblad — **Beeld ▸ Cookie jar** — toont de cookies van elke omgeving, gegroepeerd per domein in inklapbare deelvensters: bewerk een waarde, verwijder er een, wis een domein of de hele pot, of voeg handmatig een cookie toe. Het ververst live terwijl uw verzoeken cookies instellen.
- **Zie wat elk verzoek verzond en ontving.** Elk verzoek heeft nu een **Cookies**-tabblad naast Antwoord en Info, dat de cookies toont die met de aanroep zijn verzonden en de cookies die zijn terugontvangen — inclusief cookies die bij een omleiding worden ingesteld en die het uiteindelijke antwoord nooit bereiken. Het is er ook bij eerdere antwoorden in uw geschiedenis.
- **Inloggen met cookies werkt gewoon.** Een verzoek dat `Set-Cookie` teruggeeft, wordt vastgelegd en automatisch opnieuw meegestuurd bij de beschermde aanroepen die volgen — ook tijdens een scenario-uitvoering, waarbij elke stap dezelfde cookiepot van de omgeving deelt.
- **Cookies blijven bewaard zoals in een browser.** Cookies met een vervaldatum worden per project opgeslagen en opnieuw geladen wanneer u het project heropent; sessiecookies worden weggegooid wanneer u herstart — precies zoals een browser zou doen.
- **Verder dan REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC en SSE versturen en bewaren nu allemaal cookies, en WebSocket draagt ze mee tijdens de verbindingshandshake.
- **Cookies kunnen uw variabelen gebruiken.** Typ `{{token}}` in een cookie die u handmatig toevoegt, en die wordt tegen de actieve omgeving omgezet zodra het verzoek uitgaat.

Correcties:

- **Automatisch opslaan omvat nu ook omgevingen binnen mappen.** Een subomgeving toevoegen of hernoemen wordt in de modus voor automatisch opslaan meteen bewaard — geen "opslaan voor het sluiten?"-vraag meer voor een wijziging die al op schijf hoorde te staan.

## v1.0.4

**Eén keer aanmelden — elk venster volgt.**

- **Uw account volgt u nu van venster naar venster.** Meld u aan, meld u af of wissel van abonnement in één Restorm-venster en elk ander open venster neemt het direct over — zonder herstart, zonder tweede aanmelding. En wanneer u een aanmelding in de browser afrondt, komt de bevestiging nu aan in het venster dat erom vroeg, ook met meerdere vensters open.

Correcties:

- **Codeknooppunten starten weer op Intel-Macs** — de macOS-Intel-build bevatte een esbuild-binary die voor Apple Silicon was gecompileerd.
- **De actie "Nieuw venster" van de AppImage-launcher opent weer een venster**, en het door de .deb/.rpm-pakketten geïnstalleerde commando `restorm` werkt weer.
- **Opstarten op Windows is schoner** — het venster laadt nu via het app-protocol, zonder stille terugval na een interne fout bij elke start.

## v1.0.3

**Restorm draait in CI, zonder FUSE.**

- **`restorm-cli` werkt nu op CI-runners en in containers.** De Linux-build wordt uitgepakt in plaats van aangekoppeld: FUSE, dat Ubuntu niet meer meelevert, is niet langer nodig.

## v1.0.2

**Uw CLI/CI-tokens, zonder de app te verlaten.**

- **Maak, bekijk en trek uw tokens in vanuit Restorm** — voor Pro- en Enterprise-gebruikers, via de accountknop in de titelbalk. Geen omweg meer via het dashboard voor een pipeline die u nu aan het schrijven bent.
- **Tokens kunnen verlopen.** Kies bij het aanmaken een geldigheidsduur: 7 tot 365 dagen, of niet verlopen zoals voorheen. Een verlopen token wordt net zo geweigerd als een ingetrokken token.
- **Uw organisatie kan delegeren.** Een beheerder kan een specifiek lid tokens laten aanmaken en, los daarvan, toegang geven tot het auditlogboek, zonder er een beheerder van te maken.
- **Restorm installeert zichzelf nu via npm.** `npm i -g restorm-cli` en daarna `restorm`: de applicatie start op Linux, macOS en Windows zonder installatieprogramma. De build wordt één keer gedownload, gecontroleerd aan de hand van de gepubliceerde checksum en in de cache bewaard, zodat een pipeline hem niet meer bij elke taak opnieuw ophaalt.

## v1.0.1

**Eerste patch: slepen in de zijbalk, tabbladnamen en crashrapporten.**

- **Een item in de zijbalk verplaatsen breekt de app niet meer.** Met de minibrowser, Instellingen of de MCP-logboeken open sloopte elk slepen in de zijbalk de interface; alleen een herstart hielp.
- **Een item hernoemen werkt nu elk geopend tabblad bij** — ook tabbladen in een gesplitst deelvenster en tabbladen van elk aanvraagtype (gRPC, GraphQL, Redis…), die hun oude naam behielden tot ze opnieuw werden geopend.
- **Crashrapporten bereiken ons weer.** Met crashrapportage ingeschakeld stuurde 1.0.0 stilzwijgend niets: een crash bij u vertelde ons niets.
- **De illustratie ‘programmeertalen’ toont haar logo's weer.**

## v1.0.0

**Restorm 1.0 — de local-first API-client is er.**

Restorm is een snelle, offline-first desktopclient om API's te testen en aan te sturen via alle belangrijke protocollen.

- **Protocollen**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenario's**: koppel verzoeken visueel aan elkaar, vertak/herhaal, extraheer en hergebruik waarden, voer headless uit in CI.
- **Omgevingen & variabelen**: overal `{{handlebars}}`, getypeerde secrets, omgevingen per map.
- **Import/Export**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, code-export.
- **Git-native projecten**: uw `.restorm`-project is een gewoon bestand — beheer versies, vergelijk en los conflicten op in de app.
- **Local-first & privé**: alles draait op uw eigen machine; een uitgaande firewall bewaakt elke externe aanroep.
- **Platformonafhankelijk**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Gratis Community-editie, met Pro & Enterprise voor teams.
