# Changelog

## v1.0.6

Javítások:

- **Egy nagyon nagy projekt mentése mostantól egyértelmű üzenettel hiúsul meg, ahelyett hogy lefagyna.** Ha egy projekt túl nagyra nő ahhoz, hogy egyben lemezre lehessen írni — ami egy szokatlanul nagy API-séma importálása után előfordulhat — a Restorm világosan jelzi, hogy túl nagy a mentéshez, ahelyett hogy összeomlana vagy csendben hibázna.
- **Áttekinthetőbb hibajelentés a háttérben.** A „Mentés másként” párbeszédablak megszakítása többé nem naplózódik hibaként, egy sikertelen import pedig mostantól a valódi okát jelzi — így a valódi problémák könnyebben észrevehetők és javíthatók.

## v1.0.5

**Cookie jar — környezetenként egy cookie-tároló.**

- **Minden környezet a saját cookie-jait tartja meg.** Jelentkezz be a dev API-dba és a prod API-dba két külön környezetből, és a munkameneteik sosem keverednek — az egyikben elmentett cookie mindig csak abban megy vissza. A lejárat, a `Path`, a `Domain` és az aldomainek, a `Secure`, a `HttpOnly` és a `SameSite` mostantól érvényesül, nem vész el.
- **Íme a Cookie jar.** Egy új munkaterület-lap — **Nézet ▸ Cookie jar** — minden környezet cookie-jait domain szerint csoportosítva sorolja fel összecsukható paneleken: szerkessz egy értéket, törölj egyet, üríts ki egy domaint vagy az egész tárolót, vagy adj hozzá cookie-t kézzel. Élőben frissül, ahogy a kéréseid cookie-kat állítanak be.
- **Lásd, mit küldött és kapott az egyes kérések.** Minden kérés mostantól kap egy **Sütik** lapot a Válasz és az Információk mellett, amely megmutatja a hívással elküldött cookie-kat és a visszakapott cookie-kat — beleértve az átirányításkor beállított, a végső válaszba soha el nem jutó cookie-kat is. Ott van az előzményeid korábbi válaszain is.
- **A cookie-alapú bejelentkezés egyszerűen működik.** A `Set-Cookie`-t visszaadó kérést a rendszer elmenti, és automatikusan újrajátssza az utána következő védett hívásokon — akár egy forgatókönyv futása során is, ahol minden lépés ugyanazt a környezeti tárolót használja.
- **A cookie-k úgy maradnak meg, mint a böngészőben.** A lejárattal rendelkező cookie-k projektenként mentődnek, és újratöltődnek, amikor újra megnyitod; a munkamenet-cookie-k eldobódnak, amikor újraindítod — pontosan úgy, ahogy egy böngésző tenné.
- **Túl a REST-en.** A GraphQL, a SOAP, az OData, a JSON-RPC, a tRPC és az SSE mostantól mind küld és tárol cookie-kat, a WebSocket pedig a kapcsolat kézfogásán viszi őket.
- **A cookie-k használhatják a változóidat.** Írj `{{token}}`-t egy kézzel hozzáadott cookie-ba, és az az aktív környezet alapján oldódik fel, amikor a kérés elindul.

Javítások:

- **Az automatikus mentés mostantól a mappákon belüli környezetekre is kiterjed.** Egy alkörnyezet hozzáadása vagy átnevezése automatikus mentés módban azonnal mentődik — nincs többé „mentés bezárás előtt?” kérdés egy olyan változtatásnál, aminek amúgy is a lemezen volt a helye.

## v1.0.4

**Egy bejelentkezés — minden ablak követi.**

- **A fiókja mostantól ablakról ablakra követi.** Jelentkezzen be, ki, vagy váltson csomagot az egyik Restorm-ablakban, és az összes többi nyitott ablak azonnal átveszi — újraindítás és második bejelentkezés nélkül. És amikor a böngészőben befejez egy bejelentkezést, a megerősítés mostantól abba az ablakba érkezik, amelyik kérte, több nyitott ablak esetén is.

Javítások:

- **A kódcsomópontok újra elindulnak az Intel-es Maceken** — a macOS Intel build Apple Siliconra fordított esbuild binárist tartalmazott.
- **Az AppImage-indító „Új ablak" művelete újra ablakot nyit**, és a .deb/.rpm csomagok által telepített `restorm` parancs újra működik.
- **A Windows-indítás tisztább** — az ablak mostantól az alkalmazásprotokollon keresztül töltődik be, minden indításnál fellépő belső hiba utáni csendes tartalék nélkül.

## v1.0.3

**A Restorm fut a CI-ben, FUSE nélkül.**

- **A `restorm-cli` mostantól működik CI-futtatókon és konténerekben.** A Linux-build kicsomagolásra kerül csatolás helyett: a FUSE, amelyet az Ubuntu már nem szállít, nem kell többé.

## v1.0.2

**A CLI/CI tokenjei, az alkalmazás elhagyása nélkül.**

- **Hozzon létre, nézzen meg és vonjon vissza tokeneket a Restormban** — Pro és Enterprise felhasználóknak, a címsor fiók gombjából. Nincs többé kitérő az irányítópultra egy éppen írt folyamat tokenjéért.
- **A tokenek lejárhatnak.** Létrehozáskor válasszon élettartamot: 7–365 nap, vagy nem jár le, mint eddig. A lejárt tokent ugyanúgy elutasítja a rendszer, mint a visszavontat.
- **Szervezete delegálhat.** Egy rendszergazda engedélyezheti egy adott tagnak a tokenek létrehozását, és külön hozzáférést adhat az auditnaplóhoz, anélkül hogy rendszergazdát csinálna belőle.
- **A Restorm mostantól npm-ből telepíthető.** `npm i -g restorm-cli`, majd `restorm` — az alkalmazás Linuxon, macOS-en és Windowson is elindul telepítő nélkül. A build egyszer töltődik le, a közzétett ellenőrzőösszeggel igazolva, és gyorsítótárba kerül, így a folyamat nem tölti le újra minden feladatnál.

## v1.0.1

**Első javítás: mozgatás az oldalsávban, lapnevek és összeomlási jelentések.**

- **Egy elem mozgatása az oldalsávban többé nem töri össze az alkalmazást.** Nyitott miniböngésző, Beállítások vagy MCP-naplók mellett bármelyik húzás az oldalsávban szétverte a felületet, és csak újraindítás segített.
- **Egy elem átnevezése mostantól minden nyitott lapot frissít** — beleértve az osztott panelen lévő lapokat és minden kéréstípus lapját (gRPC, GraphQL, Redis…), amelyek újranyitásig megtartották a régi nevüket.
- **Az összeomlási jelentések ismét eljutnak hozzánk.** Bekapcsolt küldés mellett az 1.0.0 csendben semmit sem küldött: egy Önnél történt összeomlás semmit sem mondott nekünk.
- **A „kódnyelvek” illusztráció ismét megjeleníti a logókat.**

## v1.0.0

**Restorm 1.0 — a local-first API-kliens megjelent.**

A Restorm egy gyors, offline-first asztali kliens API-k teszteléséhez és vezérléséhez az összes fontosabb protokollon.

- **Protokollok**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Forgatókönyvek**: fűzz össze kéréseket vizuálisan, elágazás/ciklus, értékek kinyerése és újrafelhasználása, futtatás felület nélkül CI-ben.
- **Környezetek és változók**: `{{handlebars}}` mindenhol, típusos titkok, mappánkénti környezetek.
- **Importálás/Exportálás**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, kódexportálás.
- **Git-natív projektek**: a `.restorm` projekted egy egyszerű fájl — verziózd, hasonlítsd össze és oldd fel az ütközéseket az alkalmazásban.
- **Local-first és privát**: minden a saját gépeden fut; egy kimenő tűzfal minden külső hívást ellenőriz.
- **Platformfüggetlen**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Ingyenes Community kiadás, valamint Pro és Enterprise csapatoknak.
