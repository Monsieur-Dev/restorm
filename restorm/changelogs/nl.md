# Changelog

## v1.0.5

**Cookies, netjes geregeld — één pot per omgeving.**

- **Elke omgeving houdt haar eigen cookies bij.** Meld u vanuit twee omgevingen aan bij uw dev-API en uw prod-API, en hun sessies raken nooit vermengd — een cookie die in de ene wordt vastgelegd, wordt alleen in die ene weer meegestuurd. Vervaldatum, `Path`, `Domain` en subdomeinen, `Secure`, `HttpOnly` en `SameSite` worden nu gerespecteerd in plaats van weggegooid.
- **Bekijk en bewerk wat er is opgeslagen.** Een nieuwe Cookiebeheerder — **Beeld → Cookies** — toont de cookies van elke omgeving, gegroepeerd per oorsprong: bewerk een waarde, verwijder er een, wis een oorsprong of de hele pot, of voeg handmatig een cookie toe. Wanneer een respons cookies instelt, opent een 🍪-chip op de respons de beheerder direct op die oorsprong.
- **Inloggen met cookies werkt gewoon.** Een verzoek dat `Set-Cookie` teruggeeft, wordt vastgelegd en automatisch opnieuw meegestuurd bij de beschermde aanroepen die volgen — ook tijdens een scenario-uitvoering, waarbij elke stap dezelfde cookiepot van de omgeving deelt.
- **Verder dan REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC en SSE versturen en bewaren nu allemaal cookies, en WebSocket, Socket.IO en STOMP dragen ze mee tijdens de verbindingshandshake.
- **Cookies kunnen uw variabelen gebruiken.** Typ `{{token}}` in een cookie die u handmatig toevoegt, en die wordt tegen de actieve omgeving omgezet zodra het verzoek uitgaat.

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
- **Git-native projecten**: je `.restorm`-project is een gewoon bestand — beheer versies, vergelijk en los conflicten op in de app.
- **Local-first & privé**: alles draait op je eigen machine; een uitgaande firewall bewaakt elke externe aanroep.
- **Platformonafhankelijk**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Gratis Community-editie, met Pro & Enterprise voor teams.
