# Changelog

## v1.0.5

**Cookie jar — en burk cookies per miljö.**

- **Varje miljö har sina egna cookies.** Logga in mot ditt dev-API och ditt prod-API från två miljöer, och deras sessioner blandas aldrig — en cookie som fångas i den ena skickas bara tillbaka i just den. Utgång, `Path`, `Domain` och underdomäner, `Secure`, `HttpOnly` och `SameSite` respekteras nu i stället för att kastas bort.
- **Möt Cookie jar.** En ny flik i arbetsytan — **Visa ▸ Cookie jar** — listar varje miljös cookies grupperade efter domän i hopfällbara paneler: redigera ett värde, ta bort en, rensa en domän eller hela burken, eller lägg till en cookie för hand. Den uppdateras i realtid när dina förfrågningar sätter cookies.
- **Se vad varje förfrågan skickade och tog emot.** Varje förfrågan har nu en **Cookies**-flik bredvid Svar och Info, som visar de cookies som skickades med anropet och de cookies som togs emot tillbaka — inklusive cookies som sätts vid en omdirigering och aldrig når det slutliga svaret. Den finns även på tidigare svar i din historik.
- **Cookie-inloggningar bara fungerar.** En förfrågan som returnerar `Set-Cookie` fångas och spelas upp automatiskt i de skyddade anrop som följer — även genom en scenariokörning, där varje steg delar miljöns burk.
- **Cookies består som i en webbläsare.** Cookies med en utgång sparas per projekt och läses in igen när du öppnar det på nytt; sessionscookies kastas när du startar om — precis som en webbläsare skulle göra.
- **Bortom REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC och SSE skickar och lagrar nu cookies, och WebSocket bär med dem i anslutningens handskakning.
- **Cookies kan använda dina variabler.** Skriv `{{token}}` i en cookie som du lägger till för hand, så löses den mot den aktiva miljön när förfrågan skickas.

Rättningar:

- **Autospar omfattar nu miljöer inuti mappar.** Att lägga till eller byta namn på en undermiljö sparas direkt i autospar-läget — inget mer ”spara innan stängning?”-meddelande för en ändring som ändå var tänkt att ligga på disk.

## v1.0.4

**Logga in en gång — alla fönster följer med.**

- **Ditt konto följer dig nu mellan fönstren.** Logga in, logga ut eller byt plan i ett Restorm-fönster så tar alla andra öppna fönster över det direkt — utan omstart, utan en andra inloggning. Och när du slutför en inloggning i webbläsaren når bekräftelsen nu det fönster som bad om den, även med flera fönster öppna.

Rättningar:

- **Kodnoder startar igen på Intel-Macar** — macOS-Intel-bygget innehöll en esbuild-binär kompilerad för Apple Silicon.
- **AppImage-startarens åtgärd "Nytt fönster" öppnar ett fönster igen**, och kommandot `restorm` som installeras av .deb/.rpm-paketen fungerar igen.
- **Uppstarten på Windows är renare** — fönstret läses nu in via appprotokollet utan tyst reservlösning efter ett internt fel vid varje start.

## v1.0.3

**Restorm kör i CI, utan FUSE.**

- **`restorm-cli` fungerar nu på CI-runners och i containrar.** Linux-bygget packas upp i stället för att monteras: FUSE, som Ubuntu inte längre levererar, behövs inte mer.

## v1.0.2

**Dina CLI/CI-token, utan att lämna appen.**

- **Skapa, se och återkalla token från Restorm** — för Pro- och Enterprise-användare, från kontoknappen i namnlisten. Slut på turen till instrumentpanelen för ett token till pipelinen du skriver just nu.
- **Token kan upphöra.** Välj livslängd när du skapar: 7 till 365 dagar, eller ingen utgång som förut. Ett utgånget token avvisas precis som ett återkallat.
- **Din organisation kan delegera.** En administratör kan låta en viss medlem skapa token och separat ge åtkomst till granskningsloggen — utan att göra personen till administratör.
- **Restorm installeras nu från npm.** `npm i -g restorm-cli` och sedan `restorm` — programmet startar på Linux, macOS och Windows utan installationsprogram. Bygget hämtas en gång, verifieras mot sin publicerade kontrollsumma och sparas i cachen, så att en pipeline inte hämtar det på nytt vid varje jobb.

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
