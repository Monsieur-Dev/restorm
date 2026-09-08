# Changelog

## v1.1.1

**Návrhář API se nyní ovládá z postranního panelu.**

- **Vaše modely, výčty a trasy žijí v postranním panelu.** Tři seznamy na kartách mizí — modely (s vnořením podle dědičnosti), výčty a trasy (skupiny a jejich trasy) jsou nyní přímo ve stromu postranního panelu. Pravým tlačítkem přejmenujete, přidáte podmodel nebo podskupinu, naklonujete trasu, vygenerujete CRUD nebo smažete; tažením změníte pořadí nebo rodiče — nikdy mimo návrh. Každá stránka nyní zobrazuje jen detail vybrané položky.
- **Přehled vašich modelů, enumů a tras.** Kořenový uzel každé sekce nyní vypisuje vše, co obsahuje — a Modely přidávají kartu **Graf**: diagram tříd vašich modelů s dědičností a odkazy. Enumy zobrazují své hodnoty hned vedle názvu.
- **Jedno místo pro přejmenování.** Model, enum nebo trasu přejmenujete z velkého názvu (tužka) a prázdný název zobrazí **„<bez názvu>“**, aby tužka byla vždy dosažitelná — název se už na stránce neobjevuje dvakrát.
- **Chyby validace ukazují na prvek.** Když je něco špatně — model a enum se stejným názvem, odkaz na něco, co už neexistuje — vysvětlí to poznámka v horní části modelu, enumu nebo trasy.
- **Úplná drobečková navigace.** Cesta odráží celou hierarchii postranního panelu — složky › návrh › sekce › skupina › položka — a každý segment je klikatelný.
- **Vyberte více, smažte najednou.** Vyberte několik modelů, enumů nebo tras a smažte je najednou, po potvrzení.
- **Zkopírujte nebo otevřete zdroj šablony kódu jedním kliknutím.** Na stránce „</> Code“ se po najetí na šablonu objeví tlačítko pro zkopírování její URL nebo cesty a tlačítko pro její otevření — repozitář v prohlížeči, nebo složka na disku u místní šablony.
- **Nové trasy mají hned název.** Trasa vytvořená od nuly nyní dostane výchozí název, takže ji můžete hned přejmenovat.

Opravy:

- **Výběr šablony kódu zavře knihovnu.** „Použít“ vás nyní vrátí přímo na stránku Code.
- **Generování dokumentace už neselhává u volitelných polí.** Generování dokumentace z návrhu, jehož model nebo parametr ponechal „required“ nenastavené, se už nezastaví chybou šablony.
- **Smazání enumu se nejprve zeptá.** Enumy získávají stejné potvrzení jako modely a trasy.
- **Postranní panel odhalí, co vyberete.** Když je zapnuto „synchronizovat postranní panel s aktivní kartou“, výběr nebo vytvoření modelu, enumu či trasy rozbalí jeho rodiče, aby zůstal v stromu viditelný.

## v1.1.0

🎉 **Restorm je teď také designer API.** Navrhněte své API, obsloužíte je jako živý mock na pěti protokolech současně a vygenerujte jeho klienty — aniž byste opustili aplikaci, vše na vlastním disku.

- **Vizuální designer API.** Modelujte své API ručně — modely, enumy (pojmenované nebo inline), cesty, parametry, pojmenované příklady, omezení, tagy a zastarání — bez jediného řádku specifikace.
- **Obsloužíte je jako mock, jedním kliknutím, na 5 protokolech naráz.** Návrh se stane serverem, který odpovídá v HTTP, GraphQL, SOAP, OData a gRPC současně. Odpovědi pocházejí z vašich pojmenovaných příkladů (nebo z realistických dat vygenerovaných z vašich modelů), s validací omezení, simulovanou latencí a stavovým režimem.
- **Klienti připravení ke spuštění, generovaní automaticky.** Zatímco mock běží, sekce Clients vytváří skutečné, spustitelné požadavky pro každý zapnutý protokol, mířené na endpointy mocku. Jedno kliknutí otevře požadavek a klepne na server — už žádné opětovné importování vašeho API jinam, abyste je otestovali.
- **Generujte kód** ze svého návrhu pomocí dodávaných šablon i vlastních, vykreslený v izolovaném prostředí a zapsaný na disk až po vašem potvrzení. **Exportujte i deskriptor** (OpenAPI a další).
- **Při importu se těla požadavků předvyplní**: GraphQL vybere skalární pole návratového typu, gRPC rozbalí vnořené zprávy — požadavek se spustí tak, jak je.

## v1.0.6

Opravy:

- **Velmi velký projekt se nyní neuloží s jasnou zprávou místo zamrznutí.** Pokud je projekt příliš velký na zápis na disk najednou — což se může stát po importu neobvykle velkého schématu API — Restorm vás jasně upozorní, že je příliš velký na uložení, místo aby spadl nebo tiše selhal.
- **Přehlednější hlášení chyb na pozadí.** Zrušení dialogu „Uložit jako“ se už nezaznamenává jako chyba a neúspěšný import nyní hlásí svou skutečnou příčinu — skutečné problémy tak lze snáz odhalit a opravit.

## v1.0.5

**Cookie jar — jedna sklenice cookies pro každé prostředí.**

- **Každé prostředí si drží vlastní cookies.** Přihlaste se ke svému vývojovému API i produkčnímu API ze dvou prostředí a jejich relace se nikdy nezkříží – cookie zachycená v jednom se posílá zpět jen v tomtéž. Platnost, `Path`, `Domain` i subdomény, `Secure`, `HttpOnly` a `SameSite` se nyní respektují, místo aby se zahazovaly.
- **Představujeme Cookie jar.** Nová karta pracovní plochy — **Zobrazení ▸ Cookie jar** — vypisuje cookies každého prostředí seskupené podle domény ve sbalitelných panelech: upravte hodnotu, jednu smažte, vyprázdněte doménu nebo celou sklenici, nebo přidejte cookie ručně. Obnovuje se živě, jak vaše požadavky nastavují cookies.
- **Uvidíte, co každý požadavek odeslal a přijal.** Každý požadavek má nyní kartu **Cookies** vedle karet Odpověď a Informace, která zobrazuje cookies odeslané s voláním a cookies přijaté zpět — včetně cookies nastavených při přesměrování, které se do finální odpovědi nikdy nedostanou. Je k dispozici i u minulých odpovědí ve vaší historii.
- **Přihlášení přes cookies prostě funguje.** Požadavek, který vrátí `Set-Cookie`, se zachytí a automaticky znovu odešle u navazujících chráněných volání – i napříč během scénáře, kde každý krok sdílí sklenici prostředí.
- **Cookies přetrvávají jako v prohlížeči.** Cookies s platností se ukládají pro každý projekt a znovu načtou, když jej otevřete; relační cookies se při restartu zahodí — přesně jako v prohlížeči.
- **Nejen REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC i SSE nyní posílají a ukládají cookies a WebSocket je nese už při navazování spojení (handshake).
- **Cookies mohou využívat vaše proměnné.** Napište `{{token}}` do cookie, kterou přidáte ručně, a při odeslání požadavku se vyhodnotí vůči aktivnímu prostředí.

Opravy:

- **Automatické ukládání nyní pokrývá i prostředí ve složkách.** Přidání nebo přejmenování podprostředí se v režimu automatického ukládání uloží okamžitě — už žádná výzva „uložit před zavřením?“ u změny, která už měla být na disku.

## v1.0.4

**Jedno přihlášení — všechna okna následují.**

- **Váš účet vás nyní následuje mezi okny.** Přihlaste se, odhlaste nebo změňte plán v jednom okně Restormu a každé další otevřené okno to okamžitě převezme — bez restartu, bez druhého přihlášení. A když dokončíte přihlášení v prohlížeči, potvrzení nyní dorazí do okna, které o něj požádalo, i s několika otevřenými okny.

Opravy:

- **Uzly kódu na Macích s procesorem Intel opět startují** — build pro macOS Intel obsahoval binárku esbuild zkompilovanou pro Apple Silicon.
- **Akce „Nové okno" spouštěče AppImage znovu otevře okno** a příkaz `restorm` instalovaný balíčky .deb/.rpm opět funguje.
- **Start ve Windows je čistší** — okno se nyní načítá přes aplikační protokol, bez tichého záložního režimu po interní chybě při každém spuštění.

## v1.0.3

**Restorm běží v CI, bez FUSE.**

- **`restorm-cli` nyní funguje na CI runnerech i v kontejnerech.** Linuxové sestavení se rozbaluje místo připojení: FUSE, který Ubuntu už nedodává, není potřeba.

## v1.0.2

**Vaše tokeny CLI/CI, bez opuštění aplikace.**

- **Vytvářejte, prohlížejte a odvolávejte tokeny přímo v Restormu** — pro uživatele Pro a Enterprise, z tlačítka účtu v záhlaví. Konec cesty do řídicího panelu kvůli tokenu pro pipeline, kterou právě píšete.
- **Tokeny mohou vypršet.** Při vytváření zvolte platnost: 7 až 365 dní, nebo bez vypršení jako dosud. Vypršelý token je odmítnut stejně jako odvolaný.
- **Vaše organizace může delegovat.** Správce může konkrétnímu členovi povolit vytváření tokenů a odděleně mu zpřístupnit protokol auditu, aniž by z něj udělal správce.
- **Restorm se nyní instaluje z npm.** `npm i -g restorm-cli` a poté `restorm` — aplikace se spustí v systémech Linux, macOS i Windows bez instalátoru. Sestavení se stáhne jen jednou, ověří se zveřejněným kontrolním součtem a uloží do mezipaměti, takže je pipeline nestahuje při každé úloze znovu.

## v1.0.1

**První oprava: přesouvání v postranním panelu, názvy karet a hlášení o pádech.**

- **Přesunutí položky v postranním panelu už aplikaci nerozbije.** Při otevřeném mini prohlížeči, Nastavení nebo protokolech MCP jakékoli přetažení v postranním panelu rozbilo rozhraní a pomohl jen restart.
- **Přejmenování položky nyní aktualizuje každou otevřenou kartu** — včetně karet v rozděleném panelu a karet všech typů požadavků (gRPC, GraphQL, Redis…), které si až do znovuotevření nechávaly starý název.
- **Hlášení o pádech se k nám opět dostávají.** Se zapnutým odesíláním verze 1.0.0 tiše neodeslala nic: pád, na který jste narazili, nám nic neřekl.
- **Ilustrace „programovací jazyky“ opět zobrazuje svá loga.**

## v1.0.0

**Restorm 1.0 — local-first API klient je tu.**

Restorm je rychlý desktopový klient fungující offline pro testování a ovládání API napříč všemi hlavními protokoly.

- **Protokoly**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scénáře**: vizuálně řetězte požadavky, větvete/opakujte, extrahujte a znovu používejte hodnoty, spouštějte bez rozhraní v CI.
- **Prostředí a proměnné**: `{{handlebars}}` všude, typované tajné hodnoty, prostředí pro každou složku.
- **Import/Export**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, export kódu.
- **Projekty nativní pro Git**: váš projekt `.restorm` je běžný soubor — verzujte jej, porovnávejte a řešte konflikty přímo v aplikaci.
- **Local-first a soukromé**: vše běží na vašem počítači; odchozí firewall hlídá každé externí volání.
- **Multiplatformní**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Bezplatná edice Community, s Pro a Enterprise pro týmy.
