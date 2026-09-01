# Changelog

## v1.0.6

Ispravke:

- **Veoma velik projekat sada ne uspeva pri čuvanju uz jasnu poruku umesto da se zamrzne.** Ako projekat postane prevelik da bi se odjednom upisao na disk — što se može desiti nakon uvoza neobično velike API šeme — Restorm vas jasno obaveštava da je prevelik za čuvanje, umesto da se sruši ili tiho zakaže.
- **Jasnije prijavljivanje grešaka u pozadini.** Otkazivanje dijaloga „Sačuvaj kao” više se ne beleži kao greška, a neuspeli uvoz sada prijavljuje svoj stvarni uzrok — pa se pravi problemi lakše uočavaju i ispravljaju.

## v1.0.5

**Cookie jar — po jedna tegla kolačića za svako okruženje.**

- **Svako okruženje čuva sopstvene kolačiće.** Prijavite se na svoj razvojni i produkcioni API iz dva okruženja i njihove sesije se nikada ne mešaju — kolačić uhvaćen u jednom šalje se nazad samo u tom istom. Isticanje, `Path`, `Domain` i poddomeni, `Secure`, `HttpOnly` i `SameSite` sada se poštuju, a ne odbacuju.
- **Upoznajte Cookie jar.** Nova kartica radnog prostora — **Prikaz ▸ Cookie jar** — prikazuje kolačiće svakog okruženja grupisane po domenu u sklopivim oknima: uredite vrednost, obrišite jedan, očistite domen ili celu teglu, ili dodajte kolačić ručno. Osvežava se uživo dok vaši zahtevi postavljaju kolačiće.
- **Vidite šta je svaki zahtev poslao i primio.** Svaki zahtev sada ima karticu **Kolačići** pored Odgovora i Informacija, koja prikazuje kolačiće poslate uz poziv i kolačiće primljene nazad — uključujući kolačiće postavljene pri preusmeravanju, koji nikada ne stižu do konačnog odgovora. Prisutna je i na prošlim odgovorima u vašoj istoriji.
- **Prijave putem kolačića jednostavno rade.** Zahtev koji vraća `Set-Cookie` hvata se i automatski ponavlja u zaštićenim pozivima koji slede — uključujući i tokom izvršavanja scenarija, gde svaki korak deli istu teglu okruženja.
- **Kolačići traju kao u pregledaču.** Kolačići sa datumom isteka čuvaju se po projektu i ponovo se učitavaju kada ga ponovo otvorite; kolačići sesije se odbacuju pri ponovnom pokretanju — tačno onako kako bi to učinio pregledač.
- **Više od REST-a.** GraphQL, SOAP, OData, JSON-RPC, tRPC i SSE sada šalju i čuvaju kolačiće, a WebSocket ih nosi tokom rukovanja pri uspostavljanju veze.
- **Kolačići mogu koristiti vaše promenljive.** Ukucajte `{{token}}` u kolačić koji dodajete ručno i on se razrešava prema aktivnom okruženju kada zahtev bude poslat.

Ispravke:

- **Automatsko čuvanje sada obuhvata okruženja unutar fascikli.** Dodavanje ili preimenovanje podokruženja odmah se čuva u režimu automatskog čuvanja — nema više pitanja „sačuvati pre zatvaranja?“ za izmenu koja je ionako trebalo da bude na disku.

## v1.0.4

**Jedna prijava — svi prozori slede.**

- **Vaš nalog vas sada prati iz prozora u prozor.** Prijavite se, odjavite ili promenite plan u jednom prozoru Restorma i svaki drugi otvoreni prozor to odmah preuzima — bez ponovnog pokretanja, bez druge prijave. A kada završite prijavu u pregledaču, potvrda sada stiže u prozor koji ju je zatražio, čak i sa više otvorenih prozora.

Ispravke:

- **Čvorovi koda ponovo se pokreću na Intel Mac računarima** — macOS Intel build je sadržao esbuild binarni fajl kompajliran za Apple Silicon.
- **Radnja „Novi prozor" AppImage pokretača ponovo otvara prozor**, a komanda `restorm` koju instaliraju .deb/.rpm paketi ponovo radi.
- **Pokretanje na Windows-u je čistije** — prozor se sada učitava preko aplikacionog protokola, bez tihog rezervnog rešenja posle interne greške pri svakom pokretanju.

## v1.0.3

**Restorm radi u CI-ju, bez FUSE-a.**

- **`restorm-cli` sada radi na CI runnerima i u kontejnerima.** Linux verzija se raspakuje umesto da se montira: FUSE, koji Ubuntu više ne isporučuje, više nije potreban.

## v1.0.2

**Vaši CLI/CI tokeni, bez napuštanja aplikacije.**

- **Pravite, gledajte i opozivajte tokene iz Restorm-a** — za korisnike Pro i Enterprise, sa dugmeta naloga u naslovnoj traci. Nema više odlaska na kontrolnu tablu zbog tokena za cevovod koji upravo pišete.
- **Tokeni mogu da isteknu.** Pri pravljenju izaberite trajanje: 7 do 365 dana ili bez isteka, kao i do sada. Istekli token se odbija isto kao opozvani.
- **Vaša organizacija može da delegira.** Administrator može određenom članu dozvoliti pravljenje tokena i posebno mu dati pristup revizijskom dnevniku, bez da ga učini administratorom.
- **Restorm se sada instalira sa npm-a.** `npm i -g restorm-cli`, zatim `restorm` — aplikacija se pokreće na Linuxu, macOS-u i Windowsu bez instalacionog programa. Verzija se preuzima jednom, proverava objavljenim kontrolnim zbirom i čuva u kešu, pa je cevovod ne preuzima ponovo u svakom poslu.

## v1.0.1

**Prva ispravka: premeštanje u bočnoj traci, nazivi kartica i izveštaji o padovima.**

- **Premeštanje stavke u bočnoj traci više ne ruši aplikaciju.** Uz otvoren mini pregledač, Podešavanja ili MCP zapise, svako prevlačenje u bočnoj traci raspadalo bi interfejs, a pomagalo je samo ponovno pokretanje.
- **Preimenovanje stavke sada osvežava svaku otvorenu karticu** — uključujući kartice u podeljenom oknu i kartice svih vrsta zahteva (gRPC, GraphQL, Redis…), koje su zadržavale stari naziv do ponovnog otvaranja.
- **Izveštaji o padovima ponovo stižu do nas.** Uz uključeno slanje, 1.0.0 nije slala ništa u tišini: pad na koji ste naišli nama nije govorio ništa.
- **Ilustracija „jezici koda“ ponovo prikazuje svoje logotipe.**

## v1.0.0

**Restorm 1.0 — local-first API klijent je stigao.**

Restorm je brz, offline-first desktop klijent za testiranje i pokretanje API-ja preko svih glavnih protokola.

- **Protokoli**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenariji**: vizuelno povežite zahteve, grananje/petlje, izdvojte i ponovo koristite vrednosti, pokrećite bez interfejsa u CI-ju.
- **Okruženja i promenljive**: `{{handlebars}}` svuda, tipizirane tajne, okruženja po fascikli.
- **Uvoz/Izvoz**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, izvoz koda.
- **Projekti izvorno za Git**: vaš `.restorm` projekat je obična datoteka — verzionišite ga, upoređujte i rešavajte konflikte u aplikaciji.
- **Local-first i privatno**: sve se izvršava na vašem računaru; izlazni zaštitni zid nadzire svaki spoljni poziv.
- **Višeplatformski**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Besplatno Community izdanje, uz Pro i Enterprise za timove.
