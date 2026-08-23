# Changelog

## v1.0.5

**Cookie jar – yksi evästepurkki jokaiselle ympäristölle.**

- **Jokainen ympäristö pitää omat evästeensä.** Kirjaudu kehitys-API:isi ja tuotanto-API:isi kahdesta ympäristöstä, eivätkä niiden istunnot koskaan mene ristiin – yhdessä talteen otettu eväste lähetetään takaisin vain siinä samassa. Vanheneminen, `Path`, `Domain` ja alitoimialueet, `Secure`, `HttpOnly` ja `SameSite` otetaan nyt huomioon eikä niitä enää hylätä.
- **Tässä on Cookie jar.** Uusi työtila-välilehti – **Näytä ▸ Cookie jar** – listaa kaikkien ympäristöjen evästeet verkkotunnuksen mukaan ryhmiteltyinä pienennettävissä paneeleissa: muokkaa arvoa, poista yksittäinen, tyhjennä verkkotunnus tai koko purkki, tai lisää eväste käsin. Se päivittyy reaaliaikaisesti, kun pyyntösi asettavat evästeitä.
- **Näe, mitä kukin pyyntö lähetti ja vastaanotti.** Jokaisella pyynnöllä on nyt **Evästeet**-välilehti Vastaus- ja Tiedot-välilehtien vieressä, ja se näyttää kutsun mukana lähetetyt evästeet sekä takaisin vastaanotetut evästeet – mukaan lukien uudelleenohjauksessa asetetut evästeet, jotka eivät koskaan päädy lopulliseen vastaukseen. Se löytyy myös historian aiemmista vastauksista.
- **Evästekirjautumiset vain toimivat.** Pyyntö, joka palauttaa `Set-Cookie`, otetaan talteen ja lähetetään automaattisesti uudelleen seuraavissa suojatuissa kutsuissa – myös läpi skenaarioajon, jossa jokainen vaihe jakaa ympäristön purkin.
- **Evästeet säilyvät kuten selaimessa.** Vanhenemisajan sisältävät evästeet tallennetaan projektikohtaisesti ja ladataan uudelleen, kun avaat projektin uudelleen; istuntoevästeet hylätään, kun käynnistät sovelluksen uudelleen – täsmälleen kuten selain tekisi.
- **REST-rajapintaa laajemmin.** GraphQL, SOAP, OData, JSON-RPC, tRPC ja SSE lähettävät ja tallentavat nyt evästeitä, ja WebSocket kuljettaa ne yhteyden kättelyssä (handshake).
- **Evästeet voivat käyttää muuttujiasi.** Kirjoita `{{token}}` käsin lisäämääsi evästeeseen, niin se ratkaistaan aktiivista ympäristöä vasten, kun pyyntö lähtee.

Korjaukset:

- **Automaattitallennus kattaa nyt kansioiden sisällä olevat ympäristöt.** Alaympäristön lisääminen tai uudelleennimeäminen tallentuu heti automaattitallennustilassa – ei enää ”tallennetaanko ennen sulkemista?” -kehotetta muutokselle, jonka oli jo tarkoitus olla levyllä.

## v1.0.4

**Kirjaudu kerran — kaikki ikkunat seuraavat.**

- **Tilisi seuraa sinua nyt ikkunasta toiseen.** Kirjaudu sisään, ulos tai vaihda tilausta yhdessä Restorm-ikkunassa, ja kaikki muut avoimet ikkunat omaksuvat sen heti — ilman uudelleenkäynnistystä, ilman toista kirjautumista. Ja kun viimeistelet kirjautumisen selaimessa, vahvistus saapuu nyt siihen ikkunaan, joka sitä pyysi, vaikka ikkunoita olisi auki useita.

Korjaukset:

- **Koodisolmut käynnistyvät jälleen Intel-Maceissa** — macOS Intel -versio sisälsi Apple Siliconille käännetyn esbuild-binäärin.
- **AppImage-käynnistimen "Uusi ikkuna" -toiminto avaa jälleen ikkunan**, ja .deb/.rpm-pakettien asentama `restorm`-komento toimii jälleen.
- **Windows-käynnistys on siistimpi** — ikkuna latautuu nyt sovellusprotokollan kautta ilman hiljaista varamenettelyä jokaisen käynnistyksen sisäisen virheen jälkeen.

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
