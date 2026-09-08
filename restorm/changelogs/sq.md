# Changelog

## v1.1.1

**Projektuesi i API-t tani drejtohet nga shiriti anësor.**

- **Modelet, enum-et dhe rrugët tuaja jetojnë në shiritin anësor.** Të tri listat brenda skedave zhduken — modelet (me foletimin e tyre nga trashëgimia), enum-et dhe rrugët (grupet dhe rrugët e tyre) tani ndodhen drejtpërdrejt në pemën e shiritit anësor. Me klik të djathtë riemërtoni, shtoni një nën-model ose nën-grup, klononi një rrugë, gjeneroni CRUD ose fshini; tërhiqni për të rirenditur ose për të ndryshuar prindin — kurrë jashtë projektit. Çdo faqe tani shfaq vetëm detajet e elementit të zgjedhur.
- **Një pamje e përgjithshme e modeleve, enum-eve dhe rrugëve.** Nyja rrënjë e çdo seksioni tani rendit gjithçka nën të — dhe Modelet shtojnë një skedë **Grafik**: një diagram klasash të modeleve me trashëgiminë dhe referencat. Enum-et shfaqin vlerat pranë emrit.
- **Një vend i vetëm për riemërtim.** Një model, enum ose rrugë riemërtohet nga titulli i madh (lapsi), dhe një emër bosh shfaq **«<pa emër>»** që lapsi të jetë gjithmonë i arritshëm — emri nuk shfaqet më dy herë në faqe.
- **Gabimet e validimit tregojnë elementin.** Kur diçka nuk shkon — një model dhe një enum me të njëjtin emër, një referencë te diçka që nuk ekziston më — një shënim në krye të modelit, enum-it ose rrugës e shpjegon.
- **Një shteg i plotë navigimi.** Gjurma pasqyron gjithë hierarkinë e shiritit anësor — dosje › dizajn › seksion › grup › element — dhe çdo segment mund të klikohet.
- **Zgjidh disa, fshi njëherësh.** Zgjidh disa modele, enum-e ose rrugë dhe fshiji njëherësh, pas një konfirmimi.
- **Kopjoni ose hapni burimin e një shablloni kodi me një klik.** Në faqen "</> Code", kur kaloni mbi një shabllon shfaqet një buton për të kopjuar URL-në ose shtegun e tij dhe një për ta hapur — depoja në shfletuesin tuaj, ose dosja në disk për një shabllon lokal.
- **Rrugët e reja fillojnë me një emër.** Një rrugë e krijuar nga e para tani merr një emër të parazgjedhur, kështu që mund ta riemërtoni menjëherë.

Rregullime:

- **Zgjedhja e një shablloni kodi mbyll bibliotekën.** "Përdor" tani ju kthen drejtpërdrejt te faqja Code.
- **Gjenerimi i dokumentacionit nuk dështon më te fushat opsionale.** Gjenerimi i dokumentacionit nga një projekt modeli ose parametri i të cilit e linte "required" të pacaktuar nuk ndalet më me një gabim shablloni.
- **Fshirja e një enum-i pyet fillimisht.** Enum-et marrin të njëjtin konfirmim si modelet dhe rrugët.
- **Shiriti anësor zbulon zgjedhjen tuaj.** Me «sinkronizo shiritin anësor me skedën aktive» të ndezur, zgjedhja ose krijimi i një modeli, enum-i ose rruge zgjeron prindërit e tij që të mbetet i dukshëm në pemë.

## v1.1.0

🎉 **Tani Restorm është edhe një projektues API-sh.** Projektoni API-n tuaj, shërbejeni si një mock live në pesë protokolle njëherësh dhe gjeneroni klientët e saj — pa dalë nga aplikacioni, gjithçka në diskun tuaj.

- **Një projektues vizual API-sh.** Modeloni API-n tuaj me dorë — modele, enum-e (të emërtuar ose inline), rrugë, parametra, shembuj të emërtuar, kufizime, etiketa dhe vjetërsime — pa shkruar asnjë rresht specifikimi.
- **Shërbejeni si mock, me një klik, në 5 protokolle njëherësh.** Projektimi bëhet një server që përgjigjet njëkohësisht në HTTP, GraphQL, SOAP, OData dhe gRPC. Përgjigjet vijnë nga shembujt tuaj të emërtuar (ose nga të dhëna realiste të gjeneruara prej modeleve tuaja), me validim kufizimesh, vonesë të simuluar dhe një modalitet me gjendje.
- **Klientë gati për ekzekutim, të gjeneruar automatikisht.** Ndërsa mock-u është duke punuar, seksioni Clients krijon kërkesa reale, të ekzekutueshme për çdo protokoll të aktivizuar, të drejtuara te endpoint-et e mock-ut. Një klik hap një kërkesë dhe godet serverin — s'ka më nevojë të riimportoni API-n tuaj gjetkë për ta testuar.
- **Gjeneroni kod** nga projektimi juaj duke përdorur shabllonet e ofruara dhe tuajat të personalizuara, i renderuar në një sandbox dhe i shkruar në disk vetëm pasi ju konfirmoni. **Eksportoni edhe përshkruesin** (OpenAPI dhe të tjerë).
- **Gjatë importimit, trupat e kërkesave paraplotësohen**: GraphQL zgjedh fushat skalare të tipit të kthimit, gRPC shpalos mesazhet e ndërthurura — kërkesa ekzekutohet ashtu siç është.

## v1.0.6

Rregullime:

- **Një projekt shumë i madh tani dështon në ruajtje me një mesazh të qartë në vend që të ngrijë.** Nëse një projekt bëhet shumë i madh për t'u shkruar në disk njëherësh — gjë që mund të ndodhë pas importimit të një skeme API pazakonisht të madhe — Restorm ju njofton qartë se është shumë i madh për t'u ruajtur, në vend që të rrëzohet ose të dështojë në heshtje.
- **Raportim më i qartë i gabimeve prapa skenave.** Anulimi i dritares «Ruaj si» nuk regjistrohet më si gabim, dhe një importim i dështuar tani raporton shkakun e vërtetë — kështu problemet e vërteta gjenden dhe rregullohen më lehtë.

## v1.0.5

**Cookie jar — një kavanoz cookie-sh për çdo mjedis.**

- **Çdo mjedis i ruan cookie-t e veta.** Identifikohuni në API-n tuaj të zhvillimit dhe në atë të prodhimit nga dy mjedise dhe sesionet e tyre nuk ndërthuren kurrë — një cookie e kapur në njërin ridërgohet vetëm në atë. Skadimi, `Path`, `Domain` dhe nëndomenet, `Secure`, `HttpOnly` dhe `SameSite` tani respektohen, jo hidhen tej.
- **Njihuni me Cookie jar.** Një skedë e re e hapësirës së punës — **Pamja ▸ Cookie jar** — rendit cookie-t e çdo mjedisi të grupuara sipas domenit në panele të palosshme: modifikoni një vlerë, fshini një, pastroni një domen ose të gjithë kavanozin, ose shtoni një cookie me dorë. Rifreskohet në kohë reale ndërsa kërkesat tuaja vendosin cookie.
- **Shihni çfarë dërgoi dhe mori çdo kërkesë.** Çdo kërkesë tani ka një skedë **Cookies** pranë Përgjigjes dhe Informacioneve, që tregon cookie-t e dërguara me thirrjen dhe cookie-t e marra prapa — përfshirë cookie-t e vendosura gjatë një ridrejtimi, që nuk arrijnë kurrë te përgjigjja përfundimtare. Është e pranishme edhe në përgjigjet e kaluara në historikun tuaj.
- **Identifikimet me cookie thjesht funksionojnë.** Një kërkesë që kthen `Set-Cookie` kapet dhe riluhet automatikisht në thirrjet e mbrojtura që pasojnë — përfshirë gjatë ekzekutimit të një skenari, ku çdo hap ndan të njëjtin kavanoz të mjedisit.
- **Cookie-t qëndrojnë si te një shfletues.** Cookie-t me një skadim ruhen për çdo projekt dhe ringarkohen kur e rihapni; cookie-t e sesionit hidhen kur e riniseni — pikërisht ashtu si do të bënte një shfletues.
- **Përtej REST-it.** GraphQL, SOAP, OData, JSON-RPC, tRPC dhe SSE tani dërgojnë dhe ruajnë cookie, ndërsa WebSocket i mbart gjatë shtrëngimit të duarve të lidhjes.
- **Cookie-t mund të përdorin variablat tuaja.** Shkruani `{{token}}` në një cookie që e shtoni me dorë dhe ajo zgjidhet sipas mjedisit aktiv kur niset kërkesa.

Rregullime:

- **Ruajtja automatike tani mbulon mjediset brenda dosjeve.** Shtimi ose riemërtimi i një nën-mjedisi ruhet menjëherë në modalitetin e ruajtjes automatike — pa më asnjë pyetje «të ruhet para mbylljes?» për një ndryshim që gjithsesi duhej të ishte në disk.

## v1.0.4

**Një hyrje — të gjitha dritaret ndjekin.**

- **Llogaria juaj tani ju ndjek nga dritarja në dritare.** Hyni, dilni ose ndryshoni planin në një dritare të Restorm dhe çdo dritare tjetër e hapur e adopton menjëherë — pa rinisje, pa një hyrje të dytë. Dhe kur përfundoni një hyrje në shfletues, konfirmimi tani mbërrin te dritarja që e kërkoi, edhe me disa dritare të hapura.

Rregullime:

- **Nyjet e kodit nisin sërish në Mac-et me Intel** — versioni macOS Intel përmbante një binar esbuild të përpiluar për Apple Silicon.
- **Veprimi «Dritare e re» i nisësit AppImage hap sërish një dritare**, dhe komanda `restorm` e instaluar nga paketat .deb/.rpm funksionon sërish.
- **Nisja në Windows është më e pastër** — dritarja tani ngarkohet përmes protokollit të aplikacionit, pa një zgjidhje rezervë të heshtur pas një gabimi të brendshëm në çdo nisje.

## v1.0.3

**Restorm punon në CI, pa FUSE.**

- **`restorm-cli` tani funksionon në runner-at e CI-së dhe në kontejnerë.** Ndërtimi për Linux shpaketohet në vend që të montohet: FUSE, që Ubuntu nuk e ofron më, nuk nevojitet.

## v1.0.2

**Tokenat tuaj CLI/CI, pa dalë nga aplikacioni.**

- **Krijoni, shikoni dhe revokoni tokena nga Restorm** — për përdoruesit Pro dhe Enterprise, nga butoni i llogarisë në shiritin e titullit. Mbaroi vajtja te paneli për një token të tubacionit që po shkruani tani.
- **Tokenat mund të skadojnë.** Zgjidhni një kohëzgjatje gjatë krijimit: 7 deri në 365 ditë, ose pa skadim si më parë. Një token i skaduar refuzohet njësoj si një i revokuar.
- **Organizata juaj mund të delegojë.** Një administrator mund t'i lejojë një anëtari të caktuar të krijojë tokena dhe, veçmas, t'i japë qasje te regjistri i auditimit, pa e bërë administrator.
- **Restorm tani instalohet nga npm.** `npm i -g restorm-cli`, pastaj `restorm` — aplikacioni niset në Linux, macOS dhe Windows pa program instalimi. Ndërtimi shkarkohet një herë, verifikohet me shumën e kontrollit të publikuar dhe ruhet në memorien e fshehtë, kështu që një tubacion nuk e shkarkon më në çdo punë.

## v1.0.1

**Rregullimi i parë: zhvendosja në shiritin anësor, emrat e skedave dhe raportet e rrëzimeve.**

- **Zhvendosja e një elementi në shiritin anësor nuk e prish më aplikacionin.** Me mini-shfletuesin, Cilësimet ose regjistrat MCP të hapur, çdo tërheqje në shiritin anësor e shkatërronte ndërfaqen dhe vetëm rinisja e kthente.
- **Riemërtimi i një elementi tani përditëson çdo skedë të hapur** — përfshirë skedat në një panel të ndarë dhe skedat e çdo lloji kërkese (gRPC, GraphQL, Redis…), të cilat ruanin emrin e vjetër derisa t'i rihapnit.
- **Raportet e rrëzimeve na mbërrijnë sërish.** Me raportimin të aktivizuar, 1.0.0 nuk dërgonte asgjë në heshtje: një rrëzim që hasnit nuk na tregonte asgjë.
- **Ilustrimi «gjuhët e kodit» i shfaq sërish logot e veta.**

## v1.0.0

**Restorm 1.0 — klienti API local-first, tashmë i disponueshëm.**

Restorm është një klient desktop i shpejtë, offline-first, për të testuar dhe drejtuar API-të në të gjitha protokollet kryesore.

- **Protokollet**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Skenarët**: lidhni kërkesat në mënyrë vizuale, degëzim/cikël, nxirrni dhe ripërdorni vlera, ekzekutoni pa ndërfaqe në CI.
- **Mjediset & variablat**: `{{handlebars}}` kudo, sekrete të tipizuara, mjedise për çdo dosje.
- **Importim/Eksportim**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, eksportim kodi.
- **Projekte nativë për Git**: projekti juaj `.restorm` është një skedar i thjeshtë — versionojeni, krahasojeni dhe zgjidhni konfliktet brenda aplikacionit.
- **Local-first & privat**: gjithçka ekzekutohet në makinën tuaj; një mur zjarri dalës kontrollon çdo thirrje të jashtme.
- **Ndërplatformë**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Edicioni Community falas, me Pro & Enterprise për ekipet.
