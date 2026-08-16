# Changelog

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
