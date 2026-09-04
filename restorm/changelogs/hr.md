# Changelog

## v1.1.0

🎉 **Restorm je sada i dizajner API-ja.** Dizajnirajte svoj API, poslužite ga kao živi mock na pet protokola odjednom i generirajte njegove klijente — bez napuštanja aplikacije, sve na vašem vlastitom disku.

- **Vizualni dizajner API-ja.** Modelirajte svoj API ručno — modele, enume (imenovane ili ugrađene), rute, parametre, imenovane primjere, ograničenja, oznake i zastarjelosti — bez pisanja ijednog retka specifikacije.
- **Poslužite ga kao mock, jednim klikom, na 5 protokola odjednom.** Dizajn postaje poslužitelj koji istovremeno odgovara u HTTP-u, GraphQL-u, SOAP-u, OData-i i gRPC-u. Odgovori dolaze iz vaših imenovanih primjera (ili iz realističnih podataka generiranih iz vaših modela), uz validaciju ograničenja, simuliranu latenciju i stateful način rada.
- **Klijenti spremni za pokretanje, generirani automatski.** Dok mock radi, odjeljak Clients stvara prave, izvršive zahtjeve za svaki omogućeni protokol, usmjerene na endpointove mocka. Jedan klik otvara zahtjev i pogađa poslužitelj — nema više ponovnog uvoza vašeg API-ja drugdje da biste ga testirali.
- **Generirajte kôd** iz svog dizajna koristeći ponuđene predloške i vlastite prilagođene, prikazan u sandboxu i zapisan na disk tek nakon što potvrdite. **Izvezite i deskriptor** (OpenAPI i drugi).
- **Pri uvozu se tijela zahtjeva unaprijed popunjavaju**: GraphQL odabire skalarna polja povratnog tipa, gRPC razvija ugniježđene poruke — zahtjev se pokreće takav kakav jest.

## v1.0.6

Ispravci:

- **Vrlo velik projekt sada ne uspijeva pri spremanju uz jasnu poruku umjesto zamrzavanja.** Ako projekt postane prevelik da bi se odjednom zapisao na disk — što se može dogoditi nakon uvoza neobično velike API sheme — Restorm vas jasno obavještava da je prevelik za spremanje, umjesto da se sruši ili tiho zakaže.
- **Jasnije prijavljivanje pogrešaka u pozadini.** Odustajanje od dijaloga „Spremi kao” više se ne bilježi kao pogreška, a neuspjeli uvoz sada prijavljuje svoj stvarni uzrok — pa se stvarni problemi lakše uočavaju i ispravljaju.

## v1.0.5

**Cookie jar – jedna staklenka kolačića po okruženju.**

- **Svako okruženje čuva vlastite kolačiće.** Prijavite se na svoj razvojni API i produkcijski API iz dva okruženja i njihove se sesije nikad ne miješaju – kolačić zabilježen u jednom šalje se natrag samo u tom istom. Istek, `Path`, `Domain` i poddomene, `Secure`, `HttpOnly` i `SameSite` sada se poštuju umjesto da se odbacuju.
- **Predstavljamo Cookie jar.** Nova kartica radne površine – **Prikaz ▸ Cookie jar** – navodi kolačiće svih okruženja grupirane po domeni u sklopivim panelima: uredite vrijednost, izbrišite jedan, ispraznite domenu ili cijelu staklenku, ili dodajte kolačić ručno. Osvježava se uživo dok vaši zahtjevi postavljaju kolačiće.
- **Vidite što je svaki zahtjev poslao i primio.** Svaki zahtjev sada ima karticu **Kolačići** uz Odgovor i Informacije, koja prikazuje kolačiće poslane s pozivom i kolačiće primljene natrag – uključujući kolačiće postavljene pri preusmjeravanju koji nikada ne stignu do konačnog odgovora. Tu je i na prošlim odgovorima iz vaše povijesti.
- **Prijave putem kolačića jednostavno rade.** Zahtjev koji vraća `Set-Cookie` bilježi se i automatski ponovno šalje na zaštićenim pozivima koji slijede – uključujući tijekom izvođenja scenarija, gdje svaki korak dijeli staklenku okruženja.
- **Kolačići su trajni kao u pregledniku.** Kolačići s istekom spremaju se po projektu i ponovno učitavaju kad ga ponovno otvorite; sesijski kolačići odbacuju se pri ponovnom pokretanju – točno kao što bi to učinio preglednik.
- **Više od REST-a.** GraphQL, SOAP, OData, JSON-RPC, tRPC i SSE sada svi šalju i pohranjuju kolačiće, a WebSocket ih nosi pri rukovanju (handshake) prilikom uspostave veze.
- **Kolačići mogu koristiti vaše varijable.** Upišite `{{token}}` u kolačić koji dodate ručno i on će se razriješiti prema aktivnom okruženju kad zahtjev krene.

Ispravci:

- **Automatsko spremanje sada obuhvaća okruženja unutar mapa.** Dodavanje ili preimenovanje podokruženja odmah se sprema u načinu automatskog spremanja – nema više upita „spremiti prije zatvaranja?” za promjenu koja je ionako trebala biti na disku.

## v1.0.4

**Jedna prijava — svi prozori slijede.**

- **Vaš vas račun sada prati iz prozora u prozor.** Prijavite se, odjavite ili promijenite plan u jednom prozoru Restorma i svaki drugi otvoreni prozor to odmah preuzima — bez ponovnog pokretanja, bez druge prijave. A kad dovršite prijavu u pregledniku, potvrda sada stiže u prozor koji ju je zatražio, čak i s više otvorenih prozora.

Ispravci:

- **Čvorovi koda ponovno se pokreću na Intel Macovima** — macOS Intel build sadržavao je esbuild binarnu datoteku kompajliranu za Apple Silicon.
- **Radnja „Novi prozor" AppImage pokretača ponovno otvara prozor**, a naredba `restorm` koju instaliraju .deb/.rpm paketi ponovno radi.
- **Pokretanje na Windowsima je čišće** — prozor se sada učitava putem aplikacijskog protokola, bez tihog rezervnog rješenja nakon interne pogreške pri svakom pokretanju.

## v1.0.3

**Restorm radi u CI-ju, bez FUSE-a.**

- **`restorm-cli` sada radi na CI runnerima i u spremnicima.** Linux verzija se raspakirava umjesto da se montira: FUSE, koji Ubuntu više ne isporučuje, više nije potreban.

## v1.0.2

**Vaši CLI/CI tokeni, bez izlaska iz aplikacije.**

- **Stvarajte, pregledavajte i opozivajte tokene u Restormu** — za korisnike Pro i Enterprise, s gumba računa u naslovnoj traci. Nema više odlaska na nadzornu ploču po token za cjevovod koji upravo pišete.
- **Tokeni mogu isteći.** Pri stvaranju odaberite trajanje: 7 do 365 dana ili bez isteka, kao dosad. Istekli se token odbija jednako kao opozvani.
- **Vaša organizacija može delegirati.** Administrator može određenom članu dopustiti stvaranje tokena i zasebno mu dati pristup zapisniku revizije, bez da ga učini administratorom.
- **Restorm se sada instalira s npm-a.** `npm i -g restorm-cli`, zatim `restorm` — aplikacija se pokreće na Linuxu, macOS-u i Windowsu bez instalacijskog programa. Verzija se preuzima jednom, provjerava objavljenim kontrolnim zbrojem i sprema u predmemoriju, pa je cjevovod ne preuzima ponovno u svakom poslu.

## v1.0.1

**Prva zakrpa: premještanje u bočnoj traci, nazivi kartica i izvješća o rušenju.**

- **Premještanje stavke u bočnoj traci više ne ruši aplikaciju.** Uz otvoren mini preglednik, Postavke ili MCP zapise, svako povlačenje u bočnoj traci raspalo bi sučelje, a pomoglo je samo ponovno pokretanje.
- **Preimenovanje stavke sada osvježava svaku otvorenu karticu** — uključujući kartice u podijeljenom oknu i kartice svih vrsta zahtjeva (gRPC, GraphQL, Redis…), koje su zadržavale stari naziv do ponovnog otvaranja.
- **Izvješća o rušenju ponovno stižu do nas.** Uz uključeno slanje, 1.0.0 nije slala ništa u tišini: rušenje na koje ste naišli nama nije govorilo ništa.
- **Ilustracija „jezici koda“ ponovno prikazuje svoje logotipe.**

## v1.0.0

**Restorm 1.0 — local-first API klijent je stigao.**

Restorm je brz, offline-first stolni klijent za testiranje i pokretanje API-ja preko svih glavnih protokola.

- **Protokoli**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenariji**: vizualno povežite zahtjeve, grananje/petlje, izdvojite i ponovno koristite vrijednosti, pokrećite bez sučelja u CI-ju.
- **Okruženja i varijable**: `{{handlebars}}` posvuda, tipizirane tajne, okruženja po mapi.
- **Uvoz/Izvoz**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, izvoz koda.
- **Projekti izvorno za Git**: vaš `.restorm` projekt je obična datoteka — verzionirajte ga, uspoređujte i rješavajte sukobe u aplikaciji.
- **Local-first i privatno**: sve se izvodi na vašem računalu; izlazni vatrozid nadzire svaki vanjski poziv.
- **Višeplatformski**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Besplatno Community izdanje, uz Pro i Enterprise za timove.
