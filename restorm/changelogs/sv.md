# Changelog

## v1.2.0

**Spela in en webbsida, få dess API som förfrågningar.**

- **Inspelningssessioner.** En ny sorts objekt i sidopanelen öppnar en webbsida i den inbyggda mini-webbläsaren och fångar varje API-anrop den gör — REST, GraphQL, gRPC-web och WebSocket — live, med vit- och svartlistor i reguljära uttryck, paus och stopp från adressraden och ett pulserande sken runt sessionen medan den kör. Varje fångat anrop läses exakt som en förfrågans svar (body, info, cookies, graf); ett anrops snabbmeny lägger till dess url i en lista, med möjlighet att rensa det som redan fångats. Inspelningarna stannar i minnet, begränsade av en ny appinställning, och rör aldrig din projektfil.
- **Härled rutterna (Pro).** En knapp gör om inspelningarna till ett mappträd med riktiga förfrågningar som kan köras igen: varierande sökvägssegment blir sökvägsparametrar `{{param}}`, mapparna följer de statiska prefixen, gRPC-web-anrop sorteras per tjänst och varje förfrågan förifylls från det senaste lyckade anropet, med de fångade anropen i dess svarshistorik. Att härleda igen slår samman — dina ändringar behålls.
- **Styr det från din AI-assistent.** Tio MCP-verktyg skapar och konfigurerar sessioner, startar och stoppar en inspelning, läser inspelningarna och härleder rutterna.
- **Dela din plats med mini-webbläsaren (valfritt).** En ny inställning under Integritet, avstängd som standard, låter sidorna som öppnas i den inbyggda webbläsaren — under en inspelning eller inte — läsa din ungefärliga position, precis som webbplatsens egen platsfunktion skulle göra i en vanlig webbläsare. När du slår på den ombeds du först om ditt samtycke; positionen kommer från systemets platstjänst (GeoClue på Linux), annars från en uppskattning på stadsnivå baserad på din IP-adress. Stänger du av den glöms positionen genast.
- **Rikare Svar-flik.** Bilder visas nu direkt, video och ljud spelas upp, Markdown renderas och kodredigeraren väljer språk utifrån Content-Type — med en översatt Ladda ned-knapp alltid till hands. Ett binärt svar som körs igen från historiken visar inte längre sin base64.
- **Import: en inklistrad JSON-specifikation är lätt att läsa.** Ett JSON-dokument på en rad som klistras in i det tomma importfältet formateras snyggt innan det öppnas i redigeraren.
- **Långa listor förblir snabba.** Inspelningslistan (och sidopanelen bortom 400 rader) renderar bara det som syns på skärmen.
- Projektfiler som innehåller en inspelningssession sparas i format 1.2; äldre versioner av Restorm ber dig uppdatera innan de öppnas.

## v1.1.4

**Anslut din AI-assistent på macOS — nu pålitligt.**

- **Rättat: Claude Desktop och Cursor på macOS.** Att ansluta en AI-assistent laddade Restorms verktyg men lät sedan varje anrop misslyckas med ”ingen körande instans”, även med Restorm öppet — appen och anslutaren letade efter varandra i olika temporära mappar. De hittar nu varandra pålitligt, oavsett vad som startade anslutaren.
- **Formell tilltalsform på italienska, polska och finska.** Gränssnittet tilltalar dig nu i formell form på dessa tre språk, i linje med resten.
- **Code-åtgärd i scenarier — renare, med inbyggda exempel.** Code-noden sträcks inte längre ut när skriptet är långt, och dess redigerare får en flik **Behöver du hjälp?** som visar ett körklart exempel i språket du har valt (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). Att klistra in medan redigeraren är öppen lämnar inte längre en lös Code-nod på arbetsytan.
- **Hitta designproblem i dina importerade API:er.** Efter import av ett API — eller när du öppnar en fil igen — kontrollerar Restorm diskret varje API för strukturella problem (dubblerade vägar, saknade svar, sökvägar som krockar med mockservern…), markerar det i sidofältet med ett ”!” och lägger till en ”Problem”-flik som listar varje problem och exakt vilka vägar det berör, där varje väg kan fällas ut till sin dokumentation.

## v1.1.3

**Anslut din AI-assistent till Restorm.**

- **Med ett klick, direkt i appen.** MCP-menyn i statusfältet erbjuder nu ”Lägg till Restorm i din AI-assistent” — färdig konfiguration att klistra in för Claude Code, Claude Desktop och Cursor, plus ”Lägg till i Claude Code” med ett klick.
- **Eller en rad, var som helst.** Rikta valfri MCP-klient mot ditt körande Restorm med `npx -y restorm-mcp` — bryggan hittar det på egen hand, ingen port eller token att kopiera.
- **En plugin för Claude Code.** Kör `/plugin marketplace add Monsieur-Dev/restorm` och installera sedan pluginen `restorm`.

Se [Anslut din AI-assistent](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Stöd för OpenAPI 3.2.**

- **Importera OpenAPI 3.2-specifikationer.** `QUERY`-metoden, anpassade verb (`additionalOperations`), query string-parametern och strömmande medietyper importeras som färdiga förfrågningar.
- **Bläddra efter en fil att importera.** En Bläddra-knapp i importdialogen öppnar en inbyggd filväljare — inget mer att skriva eller dra en sökväg.
- **Delad vy för stora inklistringar.** Att klistra in en flerradsspecifikation öppnar en kodredigerare till vänster och förhandsvisningen till höger, med en dragbar avdelare.
- **Tolerant import.** En specifikation med några trasiga `$ref`:er importerar alla rutter den kan och visar en varning med det som hoppades över.

Rättningar:

- Att importera en ogiltig eller onåbar specifikation visar ett tydligt meddelande i stället för att öppna dialogen för kraschrapport.
- Detaljvyn för kraschrapporten går att rulla igen.
- Bakgrunder bakom dialoger är inte längre suddiga.

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
