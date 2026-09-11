# Changelog

## v1.1.4

**Conectați-vă asistentul AI pe macOS — acum fiabil.**

- **Remediat: Claude Desktop și Cursor pe macOS.** Conectarea unui asistent AI încărca instrumentele Restorm, dar apoi fiecare apel eșua cu „nicio instanță pornită”, chiar și cu Restorm deschis — aplicația și conectorul se căutau reciproc în foldere temporare diferite. Acum se găsesc în mod fiabil, indiferent ce a lansat conectorul.
- **Formulare formală în italiană, poloneză și finlandeză.** Interfața vi se adresează acum la registrul formal în aceste trei limbi, în concordanță cu restul.
- **Acțiunea Code din scenarii — mai curată, cu exemple integrate.** Nodul Code nu se mai întinde când scriptul este lung, iar editorul său primește o filă **Aveți nevoie de ajutor?** care arată un exemplu gata de rulat în limbajul ales (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). Lipirea cu editorul deschis nu mai lasă un nod Code rătăcit pe pânză.

## v1.1.3

**Conectați-vă asistentul AI la Restorm.**

- **Cu un singur clic, direct din aplicație.** Meniul MCP din bara de stare oferă acum „Adăugați Restorm la asistentul dumneavoastră AI” — o configurație gata de lipit pentru Claude Code, Claude Desktop și Cursor, plus „Adăugați la Claude Code” cu un singur clic.
- **Sau o singură linie, oriunde.** Îndreptați orice client MCP către instanța dumneavoastră Restorm pornită cu `npx -y restorm-mcp` — puntea o găsește singură, fără niciun port sau token de copiat.
- **Un plugin pentru Claude Code.** Rulați `/plugin marketplace add Monsieur-Dev/restorm`, apoi instalați pluginul `restorm`.

Vedeți [Conectarea asistentului AI](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Suport pentru OpenAPI 3.2.**

- **Importați specificații OpenAPI 3.2.** Metoda `QUERY`, verbele personalizate (`additionalOperations`), parametrul query string și tipurile media în streaming se importă ca cereri gata de rulat.
- **Răsfoiți un fișier de importat.** Un buton Răsfoiește în fereastra de import deschide un selector de fișiere nativ — gata cu tastarea sau tragerea unei căi.
- **Vedere împărțită pentru lipiri mari.** Lipirea unei specificații pe mai multe linii deschide un editor de cod în stânga și previzualizarea în dreapta, cu un separator reglabil.
- **Import tolerant.** O specificație cu câteva `$ref` stricate importă toate rutele posibile și afișează un avertisment cu ce a trebuit să omită.

Remedieri:

- Importul unei specificații nevalide sau inaccesibile afișează un mesaj clar în loc să deschidă fereastra de raport de eroare.
- Vederea detaliată a raportului de eroare se derulează din nou.
- Fundalurile ferestrelor nu mai sunt neclare.

## v1.1.1

**Designerul de API se controlează acum din bara laterală.**

- **Modelele, enum-urile și rutele dumneavoastră trăiesc în bara laterală.** Cele trei liste din file dispar — modelele (cu imbricarea lor prin moștenire), enum-urile și rutele (grupurile și rutele lor) se află acum direct în arborele barei laterale. Clic dreapta pentru a redenumi, a adăuga un submodel sau un subgrup, a clona o rută, a genera CRUD sau a șterge; trageți pentru a reordona sau a schimba părintele — niciodată în afara designului. Fiecare pagină afișează acum doar detaliile elementului selectat.
- **O privire de ansamblu asupra modelelor, enum-urilor și rutelor.** Nodul rădăcină al fiecărei secțiuni listează acum tot ce conține — iar Modelele adaugă o filă **Grafic**: o diagramă de clase a modelelor dumneavoastră cu moștenirea și referințele lor. Enum-urile își arată valorile chiar lângă nume.
- **Un singur loc pentru redenumire.** Un model, enum sau rută se redenumește din titlul mare (creionul), iar un nume gol afișează **„<fără nume>”** ca să rămână creionul mereu accesibil — numele nu mai apare de două ori pe pagină.
- **Erorile de validare indică elementul.** Când ceva nu e în regulă — un model și un enum cu același nume, o referință către ceva ce nu mai există — o notă în partea de sus a modelului, enum-ului sau rutei o explică.
- **O cale de navigare completă.** Traseul reflectă întreaga ierarhie a barei laterale — foldere › design › secțiune › grup › element — și fiecare segment poate fi apăsat.
- **Selectați mai multe, ștergeți dintr-o dată.** Selectați mai multe modele, enum-uri sau rute și ștergeți-le dintr-o dată, după o confirmare.
- **Copiați sau deschideți sursa unui șablon de cod dintr-un clic.** Pe pagina „</> Code”, la trecerea peste un șablon apar un buton pentru a-i copia URL-ul sau calea și unul pentru a-l deschide — depozitul în browser sau folderul de pe disc pentru un șablon local.
- **Rutele noi pornesc cu un nume.** O rută creată de la zero primește acum un nume implicit, așa că o puteți redenumi imediat.
- **File de previzualizare, ca în editorul dumneavoastră.** Un singur clic deschide acum un element într-o filă de **previzualizare** reutilizabilă (numele afișat cu cursive); clic pe alt element reutilizează aceeași filă în loc să stivuiască una nouă. Un dublu clic, orice modificare sau rularea unei cereri o păstrează deschisă definitiv. Dezactivați din Setări › Comportament.
- **Fixați filele pe care le țineți deschise.** Clic dreapta pe o filă și fixați-o: filele fixate rămân primele, supraviețuiesc la „închideți celelalte“ și sunt reținute pentru fiecare proiect.
- **Mediile primesc o vedere de detaliu ca lumea.** Deschideți un mediu pentru a-l redenumi din titlul său, a-i seta pictograma și culoarea și a adăuga un submediu — iar meniul de clic dreapta duplică acum un mediu cu toate variabilele și submediile sale.

Remedieri:

- **Alegerea unui șablon de cod închide biblioteca.** „Utilizați“ vă duce acum direct înapoi la pagina Code.
- **Generarea documentației nu mai eșuează la câmpurile opționale.** Generarea documentației dintr-un design al cărui model sau parametru lăsa „required” nesetat nu se mai oprește cu o eroare de șablon.
- **Ștergerea unui enum cere confirmare.** Enum-urile primesc aceeași confirmare ca modelele și rutele.
- **Bara laterală dezvăluie selecția.** Cu „sincronizați bara laterală cu fila activă” activat, selectarea sau crearea unui model, enum sau rute îi extinde părinții ca să rămână vizibil în arbore.
- **Butonul de mediu rămâne lizibil pe orice culoare.** Eticheta sa trece acum la text închis sau deschis pentru a rămâne lizibilă pe culoarea mediului, ca butonul de rulare.
- **Clicul din mijloc închide un fișier deschis.** Un clic din mijloc pe o intrare din lista „Deschise“ a barei laterale îi închide fila — iar o nouă setare de Comportament vă permite să ascundeți complet acel panou.
- **Formulare mai clară când porniți de la documentație.** În documentația unui API importat, butonul afișează acum „Creați o cerere nouă din această documentație“.
- **Autentificarea funcționează în versiunea Microsoft Store.** Apelul de retur cu protocol personalizat pe care browserul îl întoarce după autentificare este acum declarat în pachetul Store, așa că autentificarea se finalizează în loc să expire.

## v1.1.0

🎉 **Restorm este acum și un designer de API.** Proiectați-vă API-ul, serviți-l ca mock live pe cinci protocoale deodată și generați-i clienții — fără a părăsi aplicația, totul pe propriul disc.

- **Un designer vizual de API.** Modelați-vă API-ul manual — modele, enum-uri (denumite sau inline), rute, parametri, exemple denumite, constrângeri, etichete și deprecieri — fără să scrieți nici măcar o linie de specificație.
- **Serviți-l ca mock, dintr-un clic, pe 5 protocoale deodată.** Designul devine un server care răspunde simultan în HTTP, GraphQL, SOAP, OData și gRPC. Răspunsurile provin din exemplele dumneavoastră denumite (sau din date realiste generate din modelele dumneavoastră), cu validarea constrângerilor, latență simulată și un mod cu stare.
- **Clienți gata de rulat, generați automat.** În timp ce mock-ul rulează, secțiunea Clients creează cereri reale, executabile pentru fiecare protocol activat, orientate către endpoint-urile mock-ului. Un clic deschide o cerere și lovește serverul — gata cu reimportarea API-ului în altă parte pentru a-l testa.
- **Generați cod** din designul dumneavoastră folosind șabloanele furnizate și pe cele personalizate proprii, redat într-un sandbox și scris pe disc doar după ce confirmați. **Exportați și descriptorul** (OpenAPI și altele).
- **La import, corpurile cererilor se precompletează**: GraphQL selectează câmpurile scalare ale tipului de retur, gRPC desfășoară mesajele imbricate — cererea rulează așa cum este.

## v1.0.6

Remedieri:

- **Un proiect foarte mare eșuează acum la salvare cu un mesaj clar, în loc să se blocheze.** Dacă un proiect devine prea mare pentru a fi scris pe disc dintr-o dată — ceea ce se poate întâmpla după importul unei scheme API neobișnuit de mari — Restorm vă spune clar că este prea mare pentru a fi salvat, în loc să se blocheze sau să eșueze în tăcere.
- **Raportare a erorilor mai clară în culise.** Anularea ferestrei „Salvare ca” nu mai este înregistrată ca eroare, iar un import eșuat își raportează acum cauza reală — astfel, problemele reale sunt mai ușor de depistat și de remediat.

## v1.0.5

**Cookie jar — câte un borcan de cookie-uri pentru fiecare mediu.**

- **Fiecare mediu își păstrează propriile cookie-uri.** Autentificați-vă la API-ul dvs. de dezvoltare și la cel de producție din două medii, iar sesiunile lor nu se amestecă niciodată — un cookie capturat într-unul este retrimis doar în acela. Expirarea, `Path`, `Domain` și subdomeniile, `Secure`, `HttpOnly` și `SameSite` sunt acum respectate, nu ignorate.
- **Faceți cunoștință cu Cookie jar.** O nouă filă a spațiului de lucru — **Vizualizare ▸ Cookie jar** — listează cookie-urile fiecărui mediu grupate după domeniu în panouri pliabile: editați o valoare, ștergeți unul, goliți un domeniu sau întregul borcan ori adăugați un cookie manual. Se reîmprospătează în direct pe măsură ce cererile dvs. setează cookie-uri.
- **Vedeți ce a trimis și a primit fiecare cerere.** Fiecare cerere are acum o filă **Cookie-uri** lângă Răspuns și Informații, care arată cookie-urile trimise cu apelul și cookie-urile primite înapoi — inclusiv cookie-urile setate la o redirecționare, care nu ajung niciodată la răspunsul final. Este prezentă și pe răspunsurile trecute din istoricul dvs.
- **Autentificările prin cookie funcționează pur și simplu.** O cerere care returnează `Set-Cookie` este capturată și reluată automat în apelurile protejate care urmează — inclusiv pe parcursul rulării unui scenariu, unde fiecare pas folosește același borcan al mediului.
- **Cookie-urile persistă precum într-un browser.** Cookie-urile cu o dată de expirare sunt salvate pentru fiecare proiect și reîncărcate când îl redeschideți; cookie-urile de sesiune sunt eliminate la repornire — exact cum ar face un browser.
- **Dincolo de REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC și SSE trimit și stochează acum cookie-uri, iar WebSocket le transportă în timpul handshake-ului conexiunii.
- **Cookie-urile pot folosi variabilele dvs.** Scrieți `{{token}}` într-un cookie adăugat manual, iar acesta este rezolvat în funcție de mediul activ atunci când cererea este trimisă.

Remedieri:

- **Salvarea automată acoperă acum mediile din interiorul folderelor.** Adăugarea sau redenumirea unui submediu este salvată imediat în modul de salvare automată — fără a mai apărea întrebarea „salvați înainte de închidere?” pentru o modificare care oricum trebuia să ajungă pe disc.

## v1.0.4

**O singură autentificare — toate ferestrele urmează.**

- **Contul dvs. vă urmează acum dintr-o fereastră în alta.** Autentificați-vă, deconectați-vă sau schimbați planul într-o fereastră Restorm și toate celelalte ferestre deschise îl adoptă instantaneu — fără repornire, fără o a doua autentificare. Iar când finalizați o autentificare în browser, confirmarea ajunge acum în fereastra care a cerut-o, chiar și cu mai multe ferestre deschise.

Remedieri:

- **Nodurile de cod pornesc din nou pe Mac-urile Intel** — build-ul macOS Intel includea un binar esbuild compilat pentru Apple Silicon.
- **Acțiunea „Fereastră nouă" a lansatorului AppImage deschide din nou o fereastră**, iar comanda `restorm` instalată de pachetele .deb/.rpm funcționează din nou.
- **Pornirea pe Windows este mai curată** — fereastra se încarcă acum prin protocolul aplicației, fără o soluție de rezervă silențioasă după o eroare internă la fiecare pornire.

## v1.0.3

**Restorm rulează în CI, fără FUSE.**

- **`restorm-cli` funcționează acum pe runnere CI și în containere.** Versiunea Linux este dezarhivată în loc să fie montată: FUSE, pe care Ubuntu nu îl mai livrează, nu mai este necesar.

## v1.0.2

**Jetoanele dumneavoastră CLI/CI, fără a părăsi aplicația.**

- **Creați, consultați și revocați jetoane din Restorm** — pentru utilizatorii Pro și Enterprise, din butonul de cont din bara de titlu. Gata cu drumul până la panoul de control pentru un jeton al fluxului pe care tocmai îl scrieți.
- **Jetoanele pot expira.** Alegeți o durată la creare: 7 până la 365 de zile sau fără expirare, ca până acum. Un jeton expirat este refuzat la fel ca unul revocat.
- **Organizația dumneavoastră poate delega.** Un administrator poate permite unui anumit membru să creeze jetoane și, separat, să îi dea acces la jurnalul de audit, fără a-l face administrator.
- **Restorm se instalează acum din npm.** `npm i -g restorm-cli`, apoi `restorm` — aplicația pornește pe Linux, macOS și Windows fără program de instalare. Versiunea este descărcată o singură dată, verificată cu suma de control publicată și păstrată în cache, astfel încât o conductă să nu o mai descarce la fiecare sarcină.

## v1.0.1

**Primul patch: mutarea în bara laterală, numele filelor și rapoartele de eroare.**

- **Mutarea unui element în bara laterală nu mai strică aplicația.** Cu mini-browserul, Setările sau jurnalele MCP deschise, orice tragere în bara laterală dărâma interfața și doar o repornire o readucea.
- **Redenumirea unui element actualizează acum fiecare filă deschisă** — inclusiv filele dintr-un panou divizat și filele oricărui tip de cerere (gRPC, GraphQL, Redis…), care își păstrau vechiul nume până la redeschidere.
- **Rapoartele de eroare ajung din nou la noi.** Cu trimiterea activată, 1.0.0 nu trimitea nimic în tăcere: o eroare pe care ați întâlnit-o nu ne spunea nimic.
- **Ilustrația „limbaje de programare” își afișează din nou logourile.**

## v1.0.0

**Restorm 1.0 — clientul API local-first a fost lansat.**

Restorm este un client desktop rapid, offline-first, pentru testarea și rularea API-urilor pe toate protocoalele majore.

- **Protocoale**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenarii**: înlănțuiți cereri vizual, ramificați/buclați, extrageți și reutilizați valori, rulați fără interfață în CI.
- **Medii și variabile**: `{{handlebars}}` peste tot, secrete tipizate, medii per folder.
- **Import/Export**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, export de cod.
- **Proiecte native Git**: proiectul dumneavoastră `.restorm` este un simplu fișier — versionați-l, comparați-l și rezolvați conflictele în aplicație.
- **Local-first și privat**: totul rulează pe mașina dumneavoastră; un firewall de ieșire controlează fiecare apel extern.
- **Multiplatformă**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Ediție Community gratuită, cu Pro și Enterprise pentru echipe.
