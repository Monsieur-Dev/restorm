# Changelog

## v1.1.4

**Yhdistäkää tekoälyavustajanne macOS:ssä — nyt luotettavasti.**

- **Korjattu: Claude Desktop ja Cursor macOS:ssä.** Tekoälyavustajan yhdistäminen latasi Restormin työkalut, mutta sen jälkeen jokainen kutsu epäonnistui ilmoituksella ”ei käynnissä olevaa instanssia”, vaikka Restorm oli auki — sovellus ja connector etsivät toisiaan eri väliaikaiskansioista. Nyt ne löytävät toisensa luotettavasti riippumatta siitä, mikä connectorin käynnisti.
- **Muodollinen puhuttelu italiaksi, puolaksi ja suomeksi.** Käyttöliittymä puhuttelee teitä nyt näissä kolmessa kielessä muodollisessa muodossa, muun sisällön mukaisesti.

## v1.1.3

**Yhdistäkää tekoälyavustajanne Restormiin.**

- **Yhdellä klikkauksella, suoraan sovelluksesta.** Tilarivin MCP-valikko tarjoaa nyt ”Lisää Restorm tekoälyavustajaanne” — valmiiksi liitettävät asetukset Claude Codelle, Claude Desktopille ja Cursorille sekä ”Lisää Claude Codeen” yhdellä klikkauksella.
- **Tai yhdellä rivillä, missä tahansa.** Osoittakaa mikä tahansa MCP-asiakas käynnissä olevaan Restormiinne komennolla `npx -y restorm-mcp` — silta löytää sen itse, ei kopioitavaa porttia tai tokenia.
- **Laajennus Claude Codelle.** Suorittakaa `/plugin marketplace add Monsieur-Dev/restorm` ja asentakaa sitten `restorm`-laajennus.

Katsokaa [Tekoälyavustajan yhdistäminen](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**OpenAPI 3.2 -tuki.**

- **Tuo OpenAPI 3.2 -määrityksiä.** `QUERY`-metodi, mukautetut verbit (`additionalOperations`), query string -parametri ja suoratoistomediatyypit tuodaan valmiina ajettavina pyyntöinä.
- **Selatkaa tuotava tiedosto.** Tuontivalintaikkunan Selaa-painike avaa natiivin tiedostonvalitsimen — ei enää polun kirjoittamista tai raahaamista.
- **Jaettu näkymä suurille liitoksille.** Monirivisen määrityksen liittäminen avaa koodieditorin vasemmalle ja esikatselun oikealle säädettävällä jakajalla.
- **Salliva tuonti.** Määritys, jossa on muutama rikkinäinen `$ref`, tuo kaikki mahdolliset reitit ja näyttää varoituksen siitä, mitä jäi pois.

Korjaukset:

- Virheellisen tai tavoittamattoman määrityksen tuonti näyttää selkeän viestin sen sijaan, että avaisi kaatumisraportti-ikkunan.
- Kaatumisraportin yksityiskohtanäkymä vierii taas.
- Valintaikkunoiden taustoja ei enää sumenneta.

## v1.1.1

**API-suunnittelijaa ohjataan nyt sivupalkista.**

- **Mallinne, enumit ja reitit elävät sivupalkissa.** Kolme välilehtien listaa katoaa — mallit (perintähierarkioineen), enumit ja reitit (ryhmät ja niiden reitit) ovat nyt suoraan sivupalkin puussa. Napsauttakaa hiiren oikealla nimetäksenne uudelleen, lisätäksenne alimallin tai aliryhmän, kloonataksenne reitin, luodaksenne CRUD:n tai poistaaksenne; vetäkää järjestääksenne uudelleen tai vaihtaaksenne vanhempaa — ei koskaan ulos suunnitelmasta. Jokainen sivu näyttää nyt vain valitun kohteen tiedot.
- **Yleiskatsaus malleihinne, enumeihinne ja reitteihinne.** Kunkin osion juurisolmu listaa nyt kaiken sen alla — ja Mallit saavat **Graafi**-välilehden: luokkakaavion malleistanne perintöineen ja viittauksineen. Enumit näyttävät arvonsa heti nimen vieressä.
- **Yksi paikka nimeämiseen.** Malli, enum tai reitti nimetään sen suuresta otsikosta (kynä), ja tyhjä nimi näyttää **”<nimetön>”**, jotta kynä on aina ulottuvilla — nimeä ei enää näytetä sivulla kahdesti.
- **Validointivirheet osoittavat kohteeseen.** Kun jokin on pielessä — malli ja enum, joilla on sama nimi, viittaus johonkin, jota ei enää ole — huomautus mallin, enumin tai reitin yläreunassa selittää sen.
- **Täydellinen navigointipolku.** Polku heijastaa koko sivupalkin hierarkiaa — kansiot › suunnitelma › osio › ryhmä › kohde — ja jokainen segmentti on napsautettavissa.
- **Valitkaa monta, poistakaa kerralla.** Valitkaa useita malleja, enumeja tai reittejä ja poistakaa ne kerralla, vahvistuksen jälkeen.
- **Kopioikaa tai avatkaa koodimallin lähde yhdellä napsautuksella.** "</> Code" -sivulla mallin päälle vietäessä ilmestyy painike sen URL:n tai polun kopioimiseen ja toinen sen avaamiseen — repositorio selaimessa tai kansio levyllä paikallisen mallin tapauksessa.
- **Uusilla reiteillä on heti nimi.** Tyhjästä luotu reitti saa nyt oletusnimen, joten voitte nimetä sen heti uudelleen.
- **Esikatseluvälilehdet, kuten editorissanne.** Yksi napsautus avaa kohteen nyt uudelleenkäytettävään **esikatselu**välilehteen (sen nimi kursiivilla); toisen kohteen napsauttaminen käyttää samaa välilehteä sen sijaan, että pinoaisi uuden. Kaksoisnapsautus, mikä tahansa muokkaus tai pyynnön suoritus jättää sen pysyvästi auki. Poistakaa käytöstä kohdassa Asetukset › Toiminta.
- **Kiinnittäkää auki pitämänne välilehdet.** Napsauttakaa välilehteä hiiren oikealla ja kiinnittäkää se: kiinnitetyt välilehdet pysyvät ensimmäisinä, säilyvät ”sulje muut” -toiminnon läpi ja muistetaan projektikohtaisesti.
- **Ympäristöt saavat kunnon näkymän.** Avatkaa ympäristö nimetäksenne sen otsikostaan, asettaaksenne sen kuvakkeen ja värin sekä lisätäksenne aliympäristön — ja hiiren oikean painikkeen valikko monistaa nyt ympäristön kaikkine muuttujineen ja aliympäristöineen.

Korjaukset:

- **Koodimallin valitseminen sulkee kirjaston.** "Käytä" vie teidät nyt suoraan takaisin Code-sivulle.
- **Dokumentaation luonti ei enää epäonnistu valinnaisilla kentillä.** Dokumentaation luominen suunnitelmasta, jonka malli tai parametri jätti "required"-arvon asettamatta, ei enää pysähdy mallivirheeseen.
- **Enumin poisto kysyy ensin.** Enumit saavat saman vahvistuksen kuin mallit ja reitit.
- **Sivupalkki paljastaa valintanne.** Kun ”synkronoi sivupalkki aktiivisen välilehden kanssa” on käytössä, mallin, enumin tai reitin valinta tai luonti avaa sen ylätasot, jotta se pysyy näkyvissä puussa.
- **Ympäristöpainike pysyy luettavana millä tahansa värillä.** Sen teksti vaihtuu nyt tummaksi tai vaaleaksi pysyäkseen luettavana ympäristön väriä vasten, kuten suorituspainike.
- **Keskipainikkeen napsautus sulkee avoimen tiedoston.** Sivupalkin ”Avatut”-luettelon kohteen napsauttaminen keskipainikkeella sulkee sen välilehden — ja uusi Toiminta-asetus antaa piilottaa koko paneelin.
- **Selkeämpi sanamuoto dokumentaatiosta aloitettaessa.** Tuodun API:n dokumentaatiossa painikkeessa lukee nyt ”Luo uusi pyyntö tästä dokumentaatiosta”.
- **Kirjautuminen toimii Microsoft Store -versiossa.** Mukautetun protokollan takaisinkutsu, jonka selain palauttaa kirjautumisen jälkeen, on nyt ilmoitettu Store-paketissa, joten kirjautuminen valmistuu sen sijaan, että se aikakatkaistaisiin.

## v1.1.0

🎉 **Restorm on nyt myös API-suunnittelija.** Suunnitelkaa API:nne, tarjoilkaa se live-mockina viidellä protokollalla kerralla ja generoikaa sen asiakkaat — poistumatta sovelluksesta, kaikki omalla levyllänne.

- **Visuaalinen API-suunnittelija.** Mallintakaa API:nne käsin — mallit, enumit (nimetyt tai inline), reitit, parametrit, nimetyt esimerkit, rajoitteet, tunnisteet ja vanhentumiset — kirjoittamatta riviäkään määrittelyä.
- **Tarjoilkaa se mockina, yhdellä napsautuksella, viidellä protokollalla kerralla.** Suunnitelmasta tulee palvelin, joka vastaa HTTP:llä, GraphQL:llä, SOAP:lla, OData:lla ja gRPC:llä samanaikaisesti. Vastaukset tulevat nimetyistä esimerkeistänne (tai malleistanne generoidusta realistisesta datasta), rajoitteiden validoinnilla, simuloidulla viiveellä ja tilallisella tilalla.
- **Käyttövalmiit asiakkaat, generoituna automaattisesti.** Mockin ollessa käynnissä Clients-osio luo aitoja, suoritettavia pyyntöjä jokaiselle käytössä olevalle protokollalle, kohdistettuna mockin päätepisteisiin. Yksi napsautus avaa pyynnön ja osuu palvelimeen — ei enää API:nne uudelleentuontia muualle sen testaamiseksi.
- **Generoikaa koodia** suunnitelmastanne käyttäen valmiita mallipohjia ja omia mukautettuja, renderöitynä hiekkalaatikossa ja levylle kirjoitettuna vasta, kun vahvistatte. **Viekää myös deskriptori** (OpenAPI ja muut).
- **Tuonnissa pyyntöjen rungot esitäytetään**: GraphQL valitsee paluutyypin skalaarikentät, gRPC laajentaa sisäkkäiset viestit — pyyntö toimii sellaisenaan.

## v1.0.6

Korjaukset:

- **Erittäin suuri projekti epäonnistuu nyt tallennuksessa selkeällä viestillä jäätymisen sijaan.** Jos projekti kasvaa liian suureksi kirjoitettavaksi levylle yhdellä kertaa — mikä voi tapahtua epätavallisen suuren API-skeeman tuonnin jälkeen — Restorm kertoo selkeästi, että se on liian suuri tallennettavaksi, sen sijaan että kaatuisi tai epäonnistuisi hiljaa.
- **Selkeämpi virheraportointi taustalla.** ”Tallenna nimellä” -valintaikkunan peruuttamista ei enää kirjata virheeksi, ja epäonnistunut tuonti ilmoittaa nyt todellisen syynsä — niin todelliset ongelmat on helpompi havaita ja korjata.

## v1.0.5

**Cookie jar – yksi evästepurkki jokaiselle ympäristölle.**

- **Jokainen ympäristö pitää omat evästeensä.** Kirjautukaa kehitys-API:inne ja tuotanto-API:inne kahdesta ympäristöstä, eivätkä niiden istunnot koskaan mene ristiin – yhdessä talteen otettu eväste lähetetään takaisin vain siinä samassa. Vanheneminen, `Path`, `Domain` ja alitoimialueet, `Secure`, `HttpOnly` ja `SameSite` otetaan nyt huomioon eikä niitä enää hylätä.
- **Tässä on Cookie jar.** Uusi työtila-välilehti – **Näytä ▸ Cookie jar** – listaa kaikkien ympäristöjen evästeet verkkotunnuksen mukaan ryhmiteltyinä pienennettävissä paneeleissa: muokatkaa arvoa, poistakaa yksittäinen, tyhjentäkää verkkotunnus tai koko purkki, tai lisätkää eväste käsin. Se päivittyy reaaliaikaisesti, kun pyyntönne asettavat evästeitä.
- **Nähkää, mitä kukin pyyntö lähetti ja vastaanotti.** Jokaisella pyynnöllä on nyt **Evästeet**-välilehti Vastaus- ja Tiedot-välilehtien vieressä, ja se näyttää kutsun mukana lähetetyt evästeet sekä takaisin vastaanotetut evästeet – mukaan lukien uudelleenohjauksessa asetetut evästeet, jotka eivät koskaan päädy lopulliseen vastaukseen. Se löytyy myös historian aiemmista vastauksista.
- **Evästekirjautumiset vain toimivat.** Pyyntö, joka palauttaa `Set-Cookie`, otetaan talteen ja lähetetään automaattisesti uudelleen seuraavissa suojatuissa kutsuissa – myös läpi skenaarioajon, jossa jokainen vaihe jakaa ympäristön purkin.
- **Evästeet säilyvät kuten selaimessa.** Vanhenemisajan sisältävät evästeet tallennetaan projektikohtaisesti ja ladataan uudelleen, kun avaatte projektin uudelleen; istuntoevästeet hylätään, kun käynnistätte sovelluksen uudelleen – täsmälleen kuten selain tekisi.
- **REST-rajapintaa laajemmin.** GraphQL, SOAP, OData, JSON-RPC, tRPC ja SSE lähettävät ja tallentavat nyt evästeitä, ja WebSocket kuljettaa ne yhteyden kättelyssä (handshake).
- **Evästeet voivat käyttää muuttujianne.** Kirjoittakaa `{{token}}` käsin lisäämäänne evästeeseen, niin se ratkaistaan aktiivista ympäristöä vasten, kun pyyntö lähtee.

Korjaukset:

- **Automaattitallennus kattaa nyt kansioiden sisällä olevat ympäristöt.** Alaympäristön lisääminen tai uudelleennimeäminen tallentuu heti automaattitallennustilassa – ei enää ”tallennetaanko ennen sulkemista?” -kehotetta muutokselle, jonka oli jo tarkoitus olla levyllä.

## v1.0.4

**Kirjautukaa kerran — kaikki ikkunat seuraavat.**

- **Tilinne seuraa teitä nyt ikkunasta toiseen.** Kirjautukaa sisään, ulos tai vaihtakaa tilausta yhdessä Restorm-ikkunassa, ja kaikki muut avoimet ikkunat omaksuvat sen heti — ilman uudelleenkäynnistystä, ilman toista kirjautumista. Ja kun viimeistelette kirjautumisen selaimessa, vahvistus saapuu nyt siihen ikkunaan, joka sitä pyysi, vaikka ikkunoita olisi auki useita.

Korjaukset:

- **Koodisolmut käynnistyvät jälleen Intel-Maceissa** — macOS Intel -versio sisälsi Apple Siliconille käännetyn esbuild-binäärin.
- **AppImage-käynnistimen "Uusi ikkuna" -toiminto avaa jälleen ikkunan**, ja .deb/.rpm-pakettien asentama `restorm`-komento toimii jälleen.
- **Windows-käynnistys on siistimpi** — ikkuna latautuu nyt sovellusprotokollan kautta ilman hiljaista varamenettelyä jokaisen käynnistyksen sisäisen virheen jälkeen.

## v1.0.3

**Restorm toimii CI:ssä, ilman FUSEa.**

- **`restorm-cli` toimii nyt CI-suorittimilla ja konteissa.** Linux-koontiversio puretaan liittämisen sijaan: FUSEa, jota Ubuntu ei enää toimita, ei enää tarvita.

## v1.0.2

**CLI/CI-tunnuksenne ilman sovelluksesta poistumista.**

- **Luokaa, katselkaa ja kumotkaa tunnuksenne Restormissa** — Pro- ja Enterprise-käyttäjille, tilipainikkeesta otsikkopalkissa. Ei enää käyntiä hallintapaneelissa juuri kirjoittamanne putken tunnuksen takia.
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
