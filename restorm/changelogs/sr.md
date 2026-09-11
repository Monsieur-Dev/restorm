# Changelog

## v1.1.3

**Povežite svog AI asistenta sa Restormom.**

- **Jednim klikom, direktno iz aplikacije.** Meni MCP u statusnoj traci sada nudi „Dodaj Restorm u svog AI asistenta“ — podešavanje spremno za lepljenje za Claude Code, Claude Desktop i Cursor, uz „Dodaj u Claude Code“ jednim klikom.
- **Ili jednim redom, bilo gde.** Usmerite bilo kog MCP klijenta na svoj pokrenuti Restorm pomoću `npx -y restorm-mcp` — most ga pronalazi sam, bez porta ili tokena za kopiranje.
- **Dodatak za Claude Code.** Pokrenite `/plugin marketplace add Monsieur-Dev/restorm`, zatim instalirajte dodatak `restorm`.

Pogledajte [Povezivanje AI asistenta](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Podrška za OpenAPI 3.2.**

- **Uvoz OpenAPI 3.2 specifikacija.** Metoda `QUERY`, prilagođeni glagoli (`additionalOperations`), parametar query string i striming tipovi medija uvoze se kao zahtevi spremni za izvršavanje.
- **Pronađite datoteku za uvoz.** Dugme Pregledaj u dijalogu uvoza otvara nativni izbor datoteke — nema više kucanja ili prevlačenja putanje.
- **Podeljeni prikaz za velika lepljenja.** Lepljenje višelinijske specifikacije otvara uređivač koda levo i pregled desno, sa pomičnim razdvajačem.
- **Tolerantan uvoz.** Specifikacija sa nekoliko pokvarenih `$ref`-ova uvozi sve moguće rute i prikazuje upozorenje sa onim što je morala da preskoči.

Ispravke:

- Uvoz nevažeće ili nedostupne specifikacije prikazuje jasnu poruku umesto otvaranja dijaloga izveštaja o padu.
- Detaljni prikaz izveštaja o padu ponovo se pomera.
- Pozadine dijaloga više nisu zamućene.

## v1.1.1

**Dizajner API-ja se sada kontroliše iz bočne trake.**

- **Vaši modeli, enumi i rute žive u bočnoj traci.** Tri liste u karticama nestaju — modeli (sa svojim ugnežđavanjem po nasleđivanju), enumi i rute (grupe i njihove rute) sada se nalaze direktno u stablu bočne trake. Desnim klikom preimenujte, dodajte podmodel ili podgrupu, klonirajte rutu, generišite CRUD ili obrišite; prevucite da promenite redosled ili roditelja — nikada van dizajna. Svaka stranica sada prikazuje samo detalje izabrane stavke.
- **Pregled vaših modela, enuma i ruta.** Koreni čvor svake sekcije sada navodi sve u sebi — a Modeli dobijaju karticu **Graf**: dijagram klasa vaših modela sa nasleđivanjem i referencama. Enumi prikazuju svoje vrednosti odmah pored naziva.
- **Jedno mesto za preimenovanje.** Model, enum ili rutu preimenujete iz velikog naslova (olovka), a prazan naziv prikazuje **„<bez naziva>”** kako bi olovka uvek bila nadohvat — naziv se više ne prikazuje dvaput na stranici.
- **Greške provere ukazuju na element.** Kada nešto nije u redu — model i enum sa istim nazivom, referenca na nešto što više ne postoji — napomena na vrhu modela, enuma ili rute to objašnjava.
- **Potpuna putanja navigacije.** Trag odražava celu hijerarhiju bočne trake — fascikle › dizajn › sekcija › grupa › stavka — i svaki segment je klikabilan.
- **Izaberite više, obrišite odjednom.** Izaberite nekoliko modela, enuma ili ruta i obrišite ih odjednom, nakon potvrde.
- **Kopirajte ili otvorite izvor šablona koda jednim klikom.** Na stranici „</> Code”, prelaskom preko šablona pojavljuje se dugme za kopiranje njegovog URL-a ili putanje i dugme za njegovo otvaranje — repozitorijum u pregledaču ili fascikla na disku za lokalni šablon.
- **Nove rute odmah imaju naziv.** Ruta napravljena od nule sada dobija podrazumevani naziv, pa možete odmah da je preimenujete.
- **Kartice pregleda, kao u vašem uređivaču.** Jedan klik sada otvara stavku u kartici **pregleda** koja se ponovo koristi (naziv joj je u kurzivu); klik na drugu stavku ponovo koristi istu karticu umesto da slaže novu. Dvoklik, bilo kakva izmena ili izvršavanje zahteva ostavlja je trajno otvorenom. Isključite to u Podešavanja › Ponašanje.
- **Prikačite kartice koje držite otvorenima.** Desnim klikom kliknite karticu i prikačite je: prikačene kartice ostaju prve, preživljavaju „zatvori ostale“ i pamte se po projektu.
- **Okruženja dobijaju pravi prikaz detalja.** Otvorite okruženje da biste ga preimenovali iz njegovog naslova, postavili mu ikonu i boju i dodali podokruženje — a meni desnog klika sada duplira okruženje sa svim njegovim promenljivama i podokruženjima.

Ispravke:

- **Izbor šablona koda zatvara biblioteku.** „Koristi” vas sada vraća pravo na stranicu Code.
- **Generisanje dokumentacije više ne otkazuje na opcionim poljima.** Generisanje dokumentacije iz dizajna čiji je model ili parametar ostavio „required” nepostavljenim više se ne zaustavlja greškom šablona.
- **Brisanje enuma prvo pita.** Enumi dobijaju istu potvrdu kao modeli i rute.
- **Bočna traka otkriva vaš izbor.** Uz uključeno „sinhronizuj bočnu traku sa aktivnom karticom”, izbor ili kreiranje modela, enuma ili rute proširuje njegove roditelje kako bi ostao vidljiv u stablu.
- **Dugme okruženja ostaje čitljivo na bilo kojoj boji.** Njegova oznaka sada prelazi na taman ili svetao tekst kako bi ostala čitljiva na boji okruženja, kao dugme za izvršavanje.
- **Klik srednjim tasterom zatvara otvoreni fajl.** Klik srednjim tasterom na stavku u listi „Otvoreno“ u bočnoj traci zatvara njenu karticu — a novo podešavanje Ponašanja omogućava da se ta ploča potpuno sakrije.
- **Jasniji tekst pri kretanju od dokumentacije.** U dokumentaciji uvezenog API-ja dugme sada glasi „Napravi novi zahtev iz ove dokumentacije“.
- **Prijava radi u verziji iz Microsoft Store-a.** Povratni poziv prilagođenog protokola koji pregledač vraća nakon prijave sada je deklarisan u Store paketu, pa se prijava završava umesto da istekne.

## v1.1.0

🎉 **Restorm je sada i dizajner API-ja.** Osmislite svoj API, poslužite ga kao živi mock na pet protokola odjednom i generišite njegove klijente — bez napuštanja aplikacije, sve na vašem sopstvenom disku.

- **Vizuelni dizajner API-ja.** Modelujte svoj API ručno — modele, enume (imenovane ili ugrađene), rute, parametre, imenovane primere, ograničenja, oznake i zastarelosti — bez pisanja ijedne linije specifikacije.
- **Poslužite ga kao mock, jednim klikom, na 5 protokola odjednom.** Dizajn postaje server koji istovremeno odgovara u HTTP-u, GraphQL-u, SOAP-u, OData-i i gRPC-u. Odgovori dolaze iz vaših imenovanih primera (ili iz realističnih podataka generisanih iz vaših modela), uz validaciju ograničenja, simuliranu latenciju i stateful režim.
- **Klijenti spremni za pokretanje, generisani automatski.** Dok mock radi, odeljak Clients kreira prave, izvršive zahteve za svaki omogućeni protokol, usmerene ka endpointovima mocka. Jedan klik otvara zahtev i pogađa server — nema više ponovnog uvoza vašeg API-ja negde drugde da biste ga testirali.
- **Generišite kôd** iz svog dizajna koristeći ponuđene šablone i sopstvene prilagođene, prikazan u sandboxu i zapisan na disk tek nakon što potvrdite. **Izvezite i deskriptor** (OpenAPI i drugi).
- **Pri uvozu se tela zahteva unapred popunjavaju**: GraphQL bira skalarna polja povratnog tipa, gRPC razvija ugneždene poruke — zahtev se pokreće takav kakav jeste.

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
