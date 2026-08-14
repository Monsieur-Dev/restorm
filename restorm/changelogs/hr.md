# Changelog

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
