# Changelog

## v1.0.3

**Restorm toimii CI:ssä, ilman FUSEa.**

- **`restorm-cli` toimii nyt CI-suorittimilla ja konteissa.** Linux-koontiversio puretaan liittämisen sijaan: FUSEa, jota Ubuntu ei enää toimita, ei enää tarvita.

## v1.0.2

**CLI/CI-tunnuksesi ilman sovelluksesta poistumista.**

- **Luo, katsele ja kumoa tunnuksesi Restormissa** — Pro- ja Enterprise-käyttäjille, tilipainikkeesta otsikkopalkissa. Ei enää käyntiä hallintapaneelissa juuri kirjoittamasi putken tunnuksen takia.
- **Tunnukset voivat vanhentua.** Valitse luodessasi voimassaoloaika: 7–365 päivää tai ei vanhene, kuten ennen. Vanhentunut tunnus hylätään samoin kuin kumottu.
- **Organisaatiosi voi delegoida.** Ylläpitäjä voi antaa tietylle jäsenelle oikeuden luoda tunnuksia ja erikseen pääsyn valvontalokiin tekemättä hänestä ylläpitäjää.
- **Restorm asentuu nyt npm:stä.** `npm i -g restorm-cli` ja sitten `restorm` — sovellus käynnistyy Linuxissa, macOS:ssä ja Windowsissa ilman asennusohjelmaa. Koontiversio ladataan kerran, varmennetaan julkaistulla tarkistussummalla ja säilytetään välimuistissa, joten putki ei lataa sitä uudelleen joka työssä.

## v1.0.1

**Ensimmäinen korjaus: siirtäminen sivupalkissa, välilehtien nimet ja kaatumisraportit.**

- **Kohteen siirtäminen sivupalkissa ei enää riko sovellusta.** Kun miniselain, Asetukset tai MCP-lokit olivat auki, mikä tahansa raahaus sivupalkissa hajotti käyttöliittymän, ja vain uudelleenkäynnistys auttoi.
- **Kohteen uudelleennimeäminen päivittää nyt jokaisen avoimen välilehden** — myös jaetun ruudun välilehdet ja kaikkien pyyntötyyppien välilehdet (gRPC, GraphQL, Redis…), jotka säilyttivät vanhan nimensä uudelleen avaamiseen asti.
- **Kaatumisraportit tavoittavat meidät jälleen.** Raportoinnin ollessa päällä 1.0.0 ei lähettänyt mitään äänettömästi: kohtaamasi kaatuminen ei kertonut meille mitään.
- **”Koodikielet”-vinkkikuva näyttää taas logonsa.**

## v1.0.0

**Restorm 1.0 — local-first-API-asiakas on julkaistu.**

Restorm on nopea, offline-first-työpöytäasiakas API-rajapintojen testaamiseen ja ajamiseen kaikissa keskeisissä protokollissa.

- **Protokollat**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Skenaariot**: ketjuta pyyntöjä visuaalisesti, haaroita/toista, poimi ja käytä arvoja uudelleen, aja ilman käyttöliittymää CI:ssä.
- **Ympäristöt ja muuttujat**: `{{handlebars}}` kaikkialla, tyypitetyt salaisuudet, kansiokohtaiset ympäristöt.
- **Tuonti/Vienti**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, koodin vienti.
- **Git-natiiviset projektit**: `.restorm`-projektisi on tavallinen tiedosto — versioi, vertaile ja ratkaise ristiriidat sovelluksessa.
- **Local-first ja yksityinen**: kaikki toimii omalla koneellasi; lähtevä palomuuri valvoo jokaista ulkoista kutsua.
- **Alustariippumaton**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Ilmainen Community-versio, sekä Pro ja Enterprise tiimeille.
