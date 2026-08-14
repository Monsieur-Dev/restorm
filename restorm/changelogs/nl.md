# Changelog

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
