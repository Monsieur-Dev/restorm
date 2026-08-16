# Changelog

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
