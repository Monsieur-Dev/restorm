# Changelog

## v1.0.4

**Jedna prijava — svi prozori slijede.**

- **Vaš vas račun sada prati iz prozora u prozor.** Prijavite se, odjavite ili promijenite plan u jednom prozoru Restorma i svaki drugi otvoreni prozor to odmah preuzima — bez ponovnog pokretanja, bez druge prijave. A kad dovršite prijavu u pregledniku, potvrda sada stiže u prozor koji ju je zatražio, čak i s više otvorenih prozora.

Ispravci:

- **Čvorovi koda ponovno se pokreću na Intel Macovima** — macOS Intel build sadržavao je esbuild binarnu datoteku kompajliranu za Apple Silicon.
- **Radnja „Novi prozor" AppImage pokretača ponovno otvara prozor**, a naredba `restorm` koju instaliraju .deb/.rpm paketi ponovno radi.

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
