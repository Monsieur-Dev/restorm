# Changelog

## v1.1.1

**API-designern styrs nu från sidofältet.**

- **Dina modeller, enums och rutter bor i sidofältet.** De tre listorna i flikarna försvinner — modeller (med sin arvsnästling), enums och rutter (grupper och deras rutter) sitter nu direkt i sidofältets träd. Högerklicka för att byta namn, lägga till en undermodell eller undergrupp, klona en rutt, generera CRUD eller ta bort; dra för att ändra ordning eller förälder — aldrig ut ur designen. Varje sida visar nu bara detaljerna för det valda objektet.
- **En överblick över dina modeller, enums och rutter.** Rotnoden i varje sektion listar nu allt under den — och Modeller får en **Graf**-flik: ett klassdiagram över dina modeller med arv och referenser. Enums visar sina värden intill namnet.
- **Ett ställe att byta namn.** En modell, enum eller rutt byter namn från sin stora titel (pennan), och ett tomt namn visar **”<namnlös>”** så att pennan alltid går att nå — namnet visas inte längre två gånger på sidan.
- **Valideringsfel pekar på elementet.** När något är fel — en modell och en enum med samma namn, en referens till något som inte längre finns — förklarar en notis högst upp på modellen, enumen eller rutten det.
- **En komplett sökväg.** Spåret speglar hela sidopanelens hierarki — mappar › design › sektion › grupp › objekt — och varje segment är klickbart.
- **Markera flera, radera på en gång.** Markera flera modeller, enums eller rutter och radera dem på en gång, efter en bekräftelse.
- **Kopiera eller öppna källan till en kodmall med ett klick.** På sidan "</> Code" visar en mall vid hovring en knapp för att kopiera dess URL eller sökväg och en för att öppna den — repot i din webbläsare, eller mappen på disken för en lokal mall.
- **Nya rutter börjar med ett namn.** En rutt skapad från grunden får nu ett standardnamn, så att du kan byta namn på den direkt.
- **Förhandsvisningsflikar, som i din editor.** Ett enda klick öppnar nu ett objekt i en återanvändbar **förhandsvisnings**flik (namnet i kursiv stil); att klicka på ett annat objekt återanvänder samma flik i stället för att stapla en ny. Dubbelklicka på den, redigera något eller kör en förfrågan för att hålla den öppen permanent. Stäng av det under Inställningar › Beteende.
- **Fäst flikarna du håller öppna.** Högerklicka på en flik och fäst den: fästa flikar ligger först, överlever ”stäng övriga” och kommer ihåg per projekt.
- **Miljöer får en riktig detaljvy.** Öppna en miljö för att byta namn på den från dess titel, ange dess ikon och färg och lägga till en undermiljö — och högerklicksmenyn duplicerar nu en miljö med alla dess variabler och undermiljöer.

Korrigeringar:

- **Att välja en kodmall stänger biblioteket.** "Använd" tar dig nu direkt tillbaka till Code-sidan.
- **Dokumentationsgenerering misslyckas inte längre på valfria fält.** Att generera dokumentation från en design vars modell eller parameter lämnade "required" oinställt stannar inte längre med ett mallfel.
- **Att radera en enum frågar först.** Enums får samma bekräftelse som modeller och rutter.
- **Sidopanelen avslöjar det du markerar.** Med ”synkronisera sidopanelen med aktiv flik” på fäller markering eller skapande av en modell, enum eller rutt ut dess föräldrar så att den hålls synlig i trädet.
- **Miljöknappen förblir läsbar på vilken färg som helst.** Dess etikett växlar nu till mörk eller ljus text för att förbli läsbar mot miljöns färg, precis som körknappen.
- **Mittklick stänger en öppen fil.** Att mittklicka på en post i sidopanelens ”Öppnade”-lista stänger dess flik — och en ny Beteende-inställning låter dig dölja den panelen helt.
- **Tydligare formulering när du utgår från dokumentationen.** I ett importerat API:s dokumentation står det nu "Skapa en ny förfrågan från den här dokumentationen" på knappen.
- **Inloggning fungerar i Microsoft Store-versionen.** Återanropet med anpassat protokoll som webbläsaren lämnar tillbaka efter inloggning deklareras nu i Store-paketet, så att inloggningen slutförs i stället för att få timeout.

## v1.1.0

🎉 **Restorm är nu också en API-designer.** Designa ditt API, servera det som en live-mock över fem protokoll samtidigt, och generera dess klienter — utan att lämna appen, allt på din egen disk.

- **En visuell API-designer.** Modellera ditt API för hand — modeller, enums (namngivna eller inline), rutter, parametrar, namngivna exempel, villkor, taggar och utfasningar — utan att skriva en enda rad specifikation.
- **Servera det som en mock, med ett klick, över 5 protokoll samtidigt.** Designen blir en server som svarar i HTTP, GraphQL, SOAP, OData och gRPC samtidigt. Svaren kommer från dina namngivna exempel (eller realistiska data som genereras från dina modeller), med villkorsvalidering, simulerad latens och ett stateful läge.
- **Körklara klienter, genererade automatiskt.** Medan mocken körs skapar Clients-sektionen riktiga, körbara förfrågningar för varje aktiverat protokoll, riktade mot mockens endpoints. Ett klick öppnar en förfrågan och träffar servern — inget mer återimporterande av ditt API någon annanstans för att testa det.
- **Generera kod** från din design med de medföljande mallarna och dina egna anpassade, renderad i en sandlåda och skriven till disk först efter att du bekräftat. **Exportera även deskriptorn** (OpenAPI med flera).
- **Vid import förifylls förfrågningarnas kroppar**: GraphQL väljer returtypens skalärfält, gRPC expanderar nästlade meddelanden — förfrågan körs som den är.

## v1.0.6

Rättningar:

- **Ett mycket stort projekt misslyckas nu med att sparas med ett tydligt meddelande i stället för att frysa.** Om ett projekt blir för stort för att skrivas till disk i ett svep — vilket kan hända efter import av ett ovanligt stort API-schema — talar Restorm nu tydligt om att det är för stort för att sparas, i stället för att krascha eller misslyckas tyst.
- **Tydligare felrapportering bakom kulisserna.** Att avbryta dialogrutan ”Spara som” registreras inte längre som ett fel, och en misslyckad import rapporterar nu sin verkliga orsak — så att de verkliga problemen är lättare att upptäcka och åtgärda.

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
