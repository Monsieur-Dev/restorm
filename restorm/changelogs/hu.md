# Changelog

## v1.1.1

**Az API-tervezőt mostantól az oldalsávból lehet vezérelni.**

- **A modelljeid, enumjaid és útvonalaid az oldalsávban élnek.** A füleken lévő három lista eltűnik — a modellek (öröklődés szerinti beágyazásukkal), az enumok és az útvonalak (csoportok és útvonalaik) mostantól közvetlenül az oldalsáv fájában találhatók. Jobb kattintással átnevezhetsz, hozzáadhatsz almodellt vagy alcsoportot, klónozhatsz útvonalat, CRUD-ot generálhatsz vagy törölhetsz; húzással átrendezhetsz vagy új szülőt adhatsz — soha nem a terven kívülre. Minden oldal mostantól csak a kiválasztott elem részleteit mutatja.
- **Áttekintés a modellekről, enumokról és útvonalakról.** Minden szakasz gyökércsomópontja most felsorolja a tartalmát — és a Modellek egy **Gráf** fület kapnak: a modellek osztálydiagramját öröklődéssel és hivatkozásokkal. Az enumok az értékeiket a név mellett mutatják.
- **Egyetlen hely az átnevezéshez.** Egy modellt, enumot vagy útvonalat a nagy címéből (a ceruza) nevezhetsz át, üres név esetén pedig **„<névtelen>”** jelenik meg, hogy a ceruza mindig elérhető legyen — a név többé nem jelenik meg kétszer az oldalon.
- **A validációs hibák az elemre mutatnak.** Ha valami nem stimmel — egy modell és egy enum azonos névvel, egy már nem létező elemre mutató hivatkozás —, a modell, enum vagy útvonal tetején lévő jegyzet elmagyarázza.
- **Teljes morzsamenü.** Az útvonal az oldalsáv teljes hierarchiáját tükrözi — mappák › terv › szakasz › csoport › elem —, és minden szegmens kattintható.
- **Jelölj ki többet, törölj egyszerre.** Jelölj ki több modellt, enumot vagy útvonalat, és töröld őket egyszerre, megerősítés után.
- **Másold vagy nyisd meg egy kódsablon forrását egy kattintással.** A „</> Code” oldalon egy sablon fölé húzva megjelenik egy gomb az URL vagy az elérési út másolásához és egy a megnyitásához — a tároló a böngésződben, vagy a mappa a lemezen egy helyi sablon esetén.
- **Az új útvonalak névvel indulnak.** A nulláról létrehozott útvonal mostantól alapértelmezett nevet kap, így azonnal átnevezheted.
- **Előnézeti lapok, akár a szerkesztődben.** Egyetlen kattintás mostantól egy újrahasználható **előnézeti** lapon nyit meg egy elemet (a neve dőlt betűvel); egy másik elemre kattintva ugyanaz a lap kerül újrafelhasználásra, nem pedig egy új lap. Dupla kattintás, bármilyen szerkesztés vagy egy kérés futtatása véglegesen nyitva tartja. A Beállítások › Viselkedés alatt kapcsolható ki.
- **Rögzítsd a nyitva tartott lapokat.** Kattints jobb gombbal egy lapra, és rögzítsd: a rögzített lapok elöl maradnak, túlélik a „többi bezárása“ műveletet, és projektenként megjegyzésre kerülnek.
- **A környezetek rendes részletnézetet kapnak.** Nyiss meg egy környezetet, hogy a címéből átnevezd, beállítsd az ikonját és színét, és alkörnyezetet adj hozzá — a jobbklikk menü pedig mostantól az összes változójával és alkörnyezetével együtt sokszorozza a környezetet.

Javítások:

- **Egy kódsablon kiválasztása bezárja a könyvtárat.** A „Használat” mostantól egyenesen visszavisz a Code oldalra.
- **A dokumentációgenerálás már nem hibázik az opcionális mezőknél.** Egy olyan tervből való dokumentációgenerálás, amelynek modellje vagy paramétere a „required” értéket beállítatlanul hagyta, már nem áll le sablonhibával.
- **Egy enum törlése előbb rákérdez.** Az enumok ugyanazt a megerősítést kapják, mint a modellek és az útvonalak.
- **Az oldalsáv felfedi a kijelölést.** Ha az „oldalsáv szinkronizálása az aktív lappal” be van kapcsolva, egy modell, enum vagy útvonal kijelölése vagy létrehozása kibontja a szülőit, hogy látható maradjon a fában.
- **A környezet gomb minden színen olvasható marad.** A felirata mostantól sötét vagy világos szövegre vált, hogy olvasható maradjon a környezet színén, akárcsak a futtatás gomb.
- **A középső gombbal kattintás bezár egy megnyitott fájlt.** Az oldalsáv „Megnyitva“ listájában egy bejegyzésre középső gombbal kattintva bezárul annak lapja — és egy új Viselkedés beállítással teljesen elrejtheted ezt a panelt.
- **Világosabb szöveg, amikor a dokumentációból indulsz.** Egy importált API dokumentációjában a gomb felirata mostantól „Új kérés létrehozása ebből a dokumentációból“.
- **A bejelentkezés működik a Microsoft Store-os változatban.** Az egyéni protokollos visszahívás, amelyet a böngésző a bejelentkezés után visszaad, mostantól szerepel a Store-csomagban, így a bejelentkezés befejeződik, ahelyett hogy időtúllépéssel leállna.

## v1.1.0

🎉 **A Restorm mostantól API-tervező is.** Tervezze meg az API-ját, szolgálja ki élő mockként egyszerre öt protokollon, és generálja a klienseit — anélkül, hogy elhagyná az alkalmazást, mindezt a saját lemezén.

- **Vizuális API-tervező.** Modellezze az API-ját kézzel — modellek, enumok (elnevezett vagy inline), útvonalak, paraméterek, elnevezett példák, megszorítások, címkék és elavulások — anélkül, hogy egyetlen sor specifikációt is írna.
- **Szolgálja ki mockként, egyetlen kattintással, egyszerre 5 protokollon.** A tervből kiszolgáló lesz, amely egyszerre válaszol HTTP-ben, GraphQL-ben, SOAP-ban, OData-ban és gRPC-ben. A válaszok az elnevezett példáiból származnak (vagy a modelljeiből generált valósághű adatokból), megszorítás-ellenőrzéssel, szimulált késleltetéssel és állapottal rendelkező móddal.
- **Futtatásra kész kliensek, automatikusan generálva.** Amíg a mock fut, a Clients szakasz valódi, futtatható kéréseket hoz létre minden engedélyezett protokollhoz, a mock végpontjaira irányítva. Egy kattintás megnyit egy kérést, és eltalálja a kiszolgálót — nincs többé újraimportálás máshová, hogy tesztelhesse az API-ját.
- **Generáljon kódot** a tervéből a mellékelt sablonok és saját egyéni sablonjai segítségével, amely egy homokozóban jelenik meg, és csak a megerősítése után íródik lemezre. **Exportálja a leírót** is (OpenAPI és mások).
- **Importáláskor a kérések törzsei előre kitöltődnek**: a GraphQL kiválasztja a visszatérési típus skalármezőit, a gRPC kibontja a beágyazott üzeneteket — a kérés úgy futtatható, ahogy van.

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
