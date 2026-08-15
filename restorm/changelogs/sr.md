# Changelog

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
