# Changelog

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
- **Scenarii**: înlănțuiește cereri vizual, ramifică/buclă, extrage și reutilizează valori, rulează fără interfață în CI.
- **Medii și variabile**: `{{handlebars}}` peste tot, secrete tipizate, medii per folder.
- **Import/Export**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, export de cod.
- **Proiecte native Git**: proiectul tău `.restorm` este un simplu fișier — versionează-l, compară-l și rezolvă conflictele în aplicație.
- **Local-first și privat**: totul rulează pe mașina ta; un firewall de ieșire controlează fiecare apel extern.
- **Multiplatformă**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Ediție Community gratuită, cu Pro și Enterprise pentru echipe.
