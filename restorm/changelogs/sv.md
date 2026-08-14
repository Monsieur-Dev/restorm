# Changelog

## v1.0.1

**Första rättelsen: flytt i sidopanelen, flikarnas namn och kraschrapporter.**

- **Att flytta ett objekt i sidopanelen kraschar inte längre appen.** Med minisurfaren, Inställningar eller MCP-loggarna öppna rev varje drag i sidopanelen ned gränssnittet, och bara en omstart hjälpte.
- **Att byta namn på ett objekt uppdaterar nu alla öppna flikar** — även flikar i en delad panel och flikar för alla förfrågningstyper (gRPC, GraphQL, Redis…), som behöll sitt gamla namn tills de öppnades igen.
- **Kraschrapporter når oss igen.** Med rapportering påslagen skickade 1.0.0 tyst ingenting: en krasch hos dig berättade ingenting för oss.
- **Illustrationen ”kodspråk” visar sina logotyper igen.**

## v1.0.0

**Restorm 1.0 — den local-first API-klienten är här.**

Restorm är en snabb, offline-first skrivbordsklient för att testa och styra API:er över alla större protokoll.

- **Protokoll**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenarier**: kedja ihop förfrågningar visuellt, förgrena/loopa, extrahera och återanvänd värden, kör headless i CI.
- **Miljöer och variabler**: `{{handlebars}}` överallt, typade hemligheter, miljöer per mapp.
- **Import/Export**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, kodexport.
- **Git-native projekt**: ditt `.restorm`-projekt är en vanlig fil — versionshantera, jämför och lös konflikter i appen.
- **Local-first och privat**: allt körs på din egen maskin; en utgående brandvägg kontrollerar varje externt anrop.
- **Plattformsoberoende**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Gratis Community-utgåva, med Pro och Enterprise för team.
