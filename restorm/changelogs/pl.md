# Changelog

## v1.2.0

**Proszę nagrać stronę internetową i otrzymać jej API w postaci żądań.**

- **Sesje nagrywania.** Nowy rodzaj elementu w panelu bocznym otwiera stronę internetową we wbudowanej mini-przeglądarce i przechwytuje na żywo każde wykonywane przez nią wywołanie API — REST, GraphQL, gRPC-web i WebSocket — z białą i czarną listą w postaci wyrażeń regularnych, wstrzymywaniem i zatrzymywaniem z paska adresu oraz czerwoną plakietką „na antenie” w trakcie nagrywania. Każde przechwycone wywołanie czyta się dokładnie jak odpowiedź żądania (treść, informacje, cookies, graf); menu kontekstowe wywołania dodaje jego adres url do listy, z możliwością oczyszczenia tego, co już przechwycono. Przechwycenia pozostają w pamięci, ograniczone nowym ustawieniem aplikacji, i nigdy nie dotykają pliku projektu.
- **Wywnioskuj trasy (Pro).** Jeden przycisk zamienia przechwycenia w drzewo folderów z prawdziwymi żądaniami do ponownego uruchomienia: zmienne segmenty ścieżki stają się parametrami ścieżki `{{param}}`, foldery odpowiadają statycznym prefiksom, wywołania gRPC-web są porządkowane według usługi, a każde żądanie jest wstępnie wypełnione na podstawie ostatniego udanego wywołania, z przechwyconymi wywołaniami w historii odpowiedzi. Ponowne wnioskowanie scala wyniki — wprowadzone zmiany zostają zachowane.
- **Sterowanie z asystenta AI.** Dziesięć narzędzi MCP tworzy i konfiguruje sesje, rozpoczyna i zatrzymuje nagrywanie, odczytuje przechwycenia i wnioskuje trasy.
- **Udostępnianie lokalizacji mini-przeglądarce (opcjonalne).** Nowe ustawienie w sekcji Prywatność, domyślnie wyłączone, pozwala stronom otwieranym we wbudowanej przeglądarce — podczas nagrywania lub poza nim — odczytywać Państwa przybliżoną lokalizację, tak jak zrobiłaby to funkcja lokalizacji witryny w zwykłej przeglądarce. Włączenie najpierw prosi o Państwa zgodę; lokalizacja pochodzi z systemowej usługi lokalizacji (GeoClue w systemie Linux), a w razie jej braku z oszacowania na poziomie miasta na podstawie Państwa adresu IP. Wyłączenie natychmiast zapomina lokalizację.
- **Bogatsza karta Odpowiedź.** Obrazy wyświetlają się teraz bezpośrednio, wideo i dźwięk są odtwarzane, Markdown jest renderowany, a edytor kodu dobiera język na podstawie Content-Type — z przetłumaczonym przyciskiem Pobierz zawsze pod ręką. Odpowiedź binarna uruchomiona ponownie z historii nie pokazuje już swojego base64.
- **Długie listy pozostają szybkie.** Lista przechwyceń (oraz panel boczny powyżej 400 wierszy) renderuje tylko to, co widać na ekranie.
- Pliki projektu zawierające sesję nagrywania są zapisywane w formacie 1.2; wcześniejsze wersje Restorma proszą o aktualizację przed ich otwarciem.

## v1.1.4

**Proszę podłączyć swojego asystenta AI na macOS — teraz niezawodnie.**

- **Naprawiono: Claude Desktop i Cursor na macOS.** Podłączenie asystenta AI ładowało narzędzia Restorma, ale potem każde wywołanie kończyło się błędem „brak działającej instancji”, nawet przy otwartym Restormie — aplikacja i łącznik szukały się nawzajem w różnych folderach tymczasowych. Teraz odnajdują się niezawodnie, niezależnie od tego, co uruchomiło łącznik.
- **Formalne zwroty w języku włoskim, polskim i fińskim.** Interfejs zwraca się teraz do Pana/Pani w tych trzech językach w formie formalnej, spójnie z resztą.
- **Akcja Code w scenariuszach — czytelniejsza, z wbudowanymi przykładami.** Węzeł Code nie rozciąga się już przy długim skrypcie, a jego edytor zyskuje kartę **Potrzebna pomoc?** z gotowym do uruchomienia przykładem w wybranym języku (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). Wklejanie przy otwartym edytorze nie dodaje już przypadkowego węzła Code na kanwie.
- **Proszę wychwycić problemy projektowe w zaimportowanych API.** Po zaimportowaniu API — lub po ponownym otwarciu pliku — Restorm dyskretnie sprawdza każde API pod kątem problemów strukturalnych (zduplikowane trasy, brakujące odpowiedzi, ścieżki kolidujące z Mock Serverem…), oznacza je na pasku bocznym znakiem „!“ i dodaje kartę „Problemy“, która wymienia każdy problem oraz dokładnie te trasy, których dotyczy, przy czym każdą trasę można rozwinąć do jej dokumentacji.

## v1.1.3

**Proszę podłączyć swojego asystenta AI do Restorma.**

- **Jednym kliknięciem, z poziomu aplikacji.** Menu MCP na pasku stanu oferuje teraz „Dodaj Restorm do swojego asystenta AI“ — gotową do wklejenia konfigurację dla Claude Code, Claude Desktop i Cursor, a także „Dodaj do Claude Code“ jednym kliknięciem.
- **Albo jedną linią, wszędzie.** Proszę skierować dowolnego klienta MCP na swój działający Restorm poleceniem `npx -y restorm-mcp` — most sam go znajdzie, bez żadnego portu ani tokena do skopiowania.
- **Wtyczka dla Claude Code.** Proszę uruchomić `/plugin marketplace add Monsieur-Dev/restorm`, a następnie zainstalować wtyczkę `restorm`.

Proszę zobaczyć [Podłączanie asystenta AI](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Obsługa OpenAPI 3.2.**

- **Import specyfikacji OpenAPI 3.2.** Metoda `QUERY`, niestandardowe czasowniki (`additionalOperations`), parametr query string i strumieniowe typy mediów są importowane jako gotowe do uruchomienia żądania.
- **Proszę wskazać plik do importu.** Przycisk Przeglądaj w oknie importu otwiera natywny wybór pliku — koniec z wpisywaniem lub przeciąganiem ścieżki.
- **Widok podzielony dla dużych wklejeń.** Wklejenie wielowierszowej specyfikacji otwiera edytor kodu po lewej i podgląd po prawej, z przesuwanym separatorem.
- **Tolerancyjny import.** Specyfikacja z kilkoma zepsutymi `$ref` importuje wszystkie możliwe trasy i pokazuje ostrzeżenie z tym, co trzeba było pominąć.

Poprawki:

- Import nieprawidłowej lub nieosiągalnej specyfikacji pokazuje jasny komunikat zamiast otwierać okno raportu awarii.
- Widok szczegółów raportu awarii znów się przewija.
- Tła okien nie są już rozmyte.

## v1.1.1

**Projektant API jest teraz obsługiwany z paska bocznego.**

- **Pana/Pani modele, enumy i trasy żyją na pasku bocznym.** Trzy listy w kartach znikają — modele (z zagnieżdżeniem dziedziczenia), enumy i trasy (grupy i ich trasy) znajdują się teraz bezpośrednio w drzewie paska bocznego. Proszę kliknąć prawym przyciskiem, aby zmienić nazwę, dodać podmodel lub podgrupę, sklonować trasę, wygenerować CRUD lub usunąć; proszę przeciągnąć, aby zmienić kolejność lub rodzica — nigdy poza projekt. Każda strona pokazuje teraz tylko szczegóły wybranego elementu.
- **Widok ogólny modeli, enumów i tras.** Węzeł główny każdej sekcji wyświetla teraz wszystko, co zawiera — a Modele zyskują kartę **Graf**: diagram klas modeli z ich dziedziczeniem i odniesieniami. Enumy pokazują swoje wartości obok nazwy.
- **Jedno miejsce do zmiany nazwy.** Model, enum lub trasę zmienia się z dużego tytułu (ołówek), a pusta nazwa pokazuje **„<bez nazwy>”**, aby ołówek był zawsze dostępny — nazwa nie pojawia się już dwukrotnie na stronie.
- **Błędy walidacji wskazują element.** Gdy coś jest nie tak — model i enum o tej samej nazwie, odwołanie do czegoś, czego już nie ma — notatka u góry modelu, enuma lub trasy to wyjaśnia.
- **Pełna ścieżka nawigacji.** Ślad odzwierciedla całą hierarchię paska bocznego — foldery › projekt › sekcja › grupa › element — a każdy segment jest klikalny.
- **Proszę zaznaczyć wiele, usunąć naraz.** Proszę zaznaczyć kilka modeli, enumów lub tras i usunąć je za jednym razem, po potwierdzeniu.
- **Proszę skopiować lub otworzyć źródło szablonu kodu jednym kliknięciem.** Na stronie „</> Code” po najechaniu na szablon pojawia się przycisk do skopiowania jego adresu URL lub ścieżki oraz przycisk do jego otwarcia — repozytorium w przeglądarce lub folder na dysku dla szablonu lokalnego.
- **Nowe trasy mają od razu nazwę.** Trasa utworzona od zera otrzymuje teraz nazwę domyślną, więc może Pan/Pani od razu zmienić jej nazwę.
- **Karty podglądu, jak w Pana/Pani edytorze.** Pojedyncze kliknięcie otwiera teraz element w karcie **podglądu** wielokrotnego użytku (jego nazwa kursywą); kliknięcie innego elementu używa ponownie tej samej karty, zamiast dokładać nową. Dwuklik, dowolna edycja lub uruchomienie żądania zostawia ją otwartą na stałe. Można to wyłączyć w Ustawienia › Zachowanie.
- **Proszę przypiąć karty, które trzyma Pan/Pani otwarte.** Proszę kliknąć kartę prawym przyciskiem i przypiąć ją: przypięte karty pozostają na początku, przetrwają „zamknij pozostałe“ i są zapamiętywane dla każdego projektu.
- **Środowiska zyskują pełny widok szczegółów.** Proszę otworzyć środowisko, aby zmienić jego nazwę z tytułu, ustawić ikonę i kolor oraz dodać podśrodowisko — a menu prawego przycisku duplikuje teraz środowisko wraz ze wszystkimi jego zmiennymi i podśrodowiskami.

Poprawki:

- **Wybór szablonu kodu zamyka bibliotekę.** „Użyj” przenosi Pana/Panią teraz prosto z powrotem na stronę Code.
- **Generowanie dokumentacji nie zawodzi już na polach opcjonalnych.** Wygenerowanie dokumentacji z projektu, którego model lub parametr pozostawiał „required” nieustawione, nie zatrzymuje się już z błędem szablonu.
- **Usunięcie enuma pyta o potwierdzenie.** Enumy otrzymują takie samo potwierdzenie jak modele i trasy.
- **Pasek boczny ujawnia zaznaczenie.** Przy włączonej opcji „synchronizuj pasek boczny z aktywną kartą” zaznaczenie lub utworzenie modelu, enuma lub trasy rozwija jego elementy nadrzędne, aby był widoczny w drzewie.
- **Przycisk środowiska pozostaje czytelny na każdym kolorze.** Jego etykieta przełącza się teraz na ciemny lub jasny tekst, aby pozostać czytelną na kolorze środowiska, tak jak przycisk uruchamiania.
- **Kliknięcie środkowym przyciskiem zamyka otwarty plik.** Kliknięcie środkowym przyciskiem pozycji na liście „Otwarte“ na pasku bocznym zamyka jej kartę — a nowe ustawienie Zachowania pozwala całkowicie ukryć ten panel.
- **Jaśniejsze sformułowanie przy starcie z dokumentacji.** W dokumentacji zaimportowanego API przycisk brzmi teraz „Utwórz nowe żądanie z tej dokumentacji“.
- **Logowanie działa w wersji z Microsoft Store.** Wywołanie zwrotne protokołu niestandardowego, które przeglądarka zwraca po zalogowaniu, jest teraz zadeklarowane w pakiecie Store, więc logowanie kończy się zamiast wygasać.

## v1.1.0

🎉 **Restorm jest teraz także projektantem API.** Proszę zaprojektować swoje API, udostępnić je jako mock na żywo na pięciu protokołach naraz i wygenerować jego klientów — bez opuszczania aplikacji, wszystko na własnym dysku.

- **Wizualny projektant API.** Proszę modelować swoje API ręcznie — modele, enumy (nazwane lub inline), trasy, parametry, nazwane przykłady, ograniczenia, tagi i wycofania — bez pisania ani jednej linijki specyfikacji.
- **Proszę udostępnić je jako mock, jednym kliknięciem, na 5 protokołach naraz.** Projekt staje się serwerem, który odpowiada jednocześnie w HTTP, GraphQL, SOAP, OData i gRPC. Odpowiedzi pochodzą z Pana/Pani nazwanych przykładów (lub z realistycznych danych wygenerowanych z Pana/Pani modeli), z walidacją ograniczeń, symulowanym opóźnieniem i trybem stanowym.
- **Gotowi do uruchomienia klienci, generowani automatycznie.** Gdy mock działa, sekcja Clients tworzy prawdziwe, wykonywalne żądania dla każdego włączonego protokołu, skierowane na endpointy mocka. Jedno kliknięcie otwiera żądanie i uderza w serwer — koniec z ponownym importowaniem API gdzie indziej, żeby je przetestować.
- **Proszę wygenerować kod** ze swojego projektu, korzystając z dostarczonych szablonów oraz własnych, niestandardowych, renderowany w piaskownicy i zapisywany na dysk dopiero po Pana/Pani potwierdzeniu. **Proszę też wyeksportować deskryptor** (OpenAPI i inne).
- **Przy imporcie treści żądań wypełniają się automatycznie**: GraphQL wybiera pola skalarne typu zwracanego, gRPC rozwija zagnieżdżone komunikaty — żądanie działa bez zmian.

## v1.0.6

Poprawki:

- **Bardzo duży projekt kończy się teraz niepowodzeniem zapisu z czytelnym komunikatem, zamiast się zawieszać.** Jeśli projekt stanie się zbyt duży, aby zapisać go na dysku w całości — co może się zdarzyć po zaimportowaniu wyjątkowo dużego schematu API — Restorm wyraźnie informuje, że jest zbyt duży do zapisania, zamiast się zawieszać lub po cichu zawodzić.
- **Czytelniejsze raportowanie błędów w tle.** Anulowanie okna „Zapisz jako” nie jest już zapisywane jako błąd, a nieudany import podaje teraz swoją rzeczywistą przyczynę — dzięki czemu prawdziwe problemy łatwiej wykryć i naprawić.

## v1.0.5

**Cookie jar — jeden słoik ciasteczek na środowisko.**

- **Każde środowisko przechowuje własne ciasteczka.** Proszę zalogować się do swojego API deweloperskiego i produkcyjnego z dwóch środowisk, a ich sesje nigdy się nie przenikają — ciasteczko przechwycone w jednym jest odsyłane wyłącznie w tym samym. Wygasanie, `Path`, `Domain` i subdomeny, `Secure`, `HttpOnly` oraz `SameSite` są teraz respektowane, a nie odrzucane.
- **Proszę poznać Cookie jar.** Nowa zakładka warsztatu — **Widok ▸ Cookie jar** — wyświetla ciasteczka każdego środowiska pogrupowane według domeny w zwijanych panelach: proszę zmienić wartość, usunąć pojedyncze, wyczyścić domenę lub cały słoik albo dodać ciasteczko ręcznie. Odświeża się na żywo, w miarę jak Pana/Pani żądania ustawiają ciasteczka.
- **Proszę zobaczyć, co każde żądanie wysłało i otrzymało.** Każde żądanie ma teraz zakładkę **Cookies** obok Odpowiedzi i Informacji, pokazującą ciasteczka wysłane wraz z wywołaniem oraz ciasteczka otrzymane w odpowiedzi — w tym ciasteczka ustawione przy przekierowaniu, które nigdy nie trafiają do końcowej odpowiedzi. Jest dostępna także dla wcześniejszych odpowiedzi z Pana/Pani historii.
- **Logowanie przez ciasteczka po prostu działa.** Żądanie, które zwraca `Set-Cookie`, jest przechwytywane i automatycznie odtwarzane w kolejnych chronionych wywołaniach — również w trakcie uruchomienia scenariusza, gdzie każdy krok korzysta ze wspólnego słoika środowiska.
- **Ciasteczka są utrwalane jak w przeglądarce.** Ciasteczka z datą wygaśnięcia są zapisywane osobno dla każdego projektu i wczytywane ponownie po jego otwarciu; ciasteczka sesyjne są odrzucane przy ponownym uruchomieniu — dokładnie tak, jak zrobiłaby to przeglądarka.
- **Więcej niż REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC i SSE wysyłają i przechowują teraz ciasteczka, a WebSocket przenosi je podczas nawiązywania połączenia.
- **Ciasteczka mogą korzystać z Pana/Pani zmiennych.** Proszę wpisać `{{token}}` w ręcznie dodanym ciasteczku, a jego wartość zostanie rozwinięta względem aktywnego środowiska w chwili wysłania żądania.

Poprawki:

- **Automatyczny zapis obejmuje teraz środowiska wewnątrz folderów.** Dodanie lub zmiana nazwy podśrodowiska jest w trybie automatycznego zapisu zapisywane od razu — koniec z pytaniem „zapisać przed zamknięciem?" o zmianę, która i tak miała już znaleźć się na dysku.

## v1.0.4

**Jedno logowanie — wszystkie okna podążają.**

- **Pana/Pani konto podąża teraz za Panem/Panią między oknami.** Proszę zalogować się, wylogować lub zmienić plan w jednym oknie Restorm, a każde inne otwarte okno natychmiast to przejmie — bez restartu, bez drugiego logowania. A gdy kończy Pan/Pani logowanie w przeglądarce, potwierdzenie trafia teraz do okna, które o nie poprosiło, nawet przy kilku otwartych oknach.

Poprawki:

- **Węzły kodu znów startują na Macach z procesorem Intel** — build macOS Intel zawierał binarkę esbuild skompilowaną dla Apple Silicon.
- **Akcja „Nowe okno" launchera AppImage znów otwiera okno**, a polecenie `restorm` instalowane przez pakiety .deb/.rpm znów działa.
- **Start w systemie Windows jest czystszy** — okno ładuje się teraz przez protokół aplikacji, bez cichego obejścia po wewnętrznym błędzie przy każdym uruchomieniu.

## v1.0.3

**Restorm działa w CI, bez FUSE.**

- **`restorm-cli` działa teraz na runnerach CI i w kontenerach.** Kompilacja dla Linuksa jest rozpakowywana zamiast montowana: FUSE, którego Ubuntu już nie dostarcza, nie jest już potrzebny.

## v1.0.2

**Pana/Pani tokeny CLI/CI, bez opuszczania aplikacji.**

- **Proszę tworzyć, przeglądać i unieważniać tokeny w Restorm** — dla użytkowników Pro i Enterprise, z przycisku konta na pasku tytułu. Koniec z wycieczką do panelu po token do potoku, który właśnie Pan/Pani pisze.
- **Tokeny mogą wygasać.** Proszę wybrać czas życia przy tworzeniu: od 7 do 365 dni albo bez wygaśnięcia, jak dotąd. Token wygasły jest odrzucany tak samo jak unieważniony.
- **Pana/Pani organizacja może delegować.** Administrator może pozwolić konkretnej osobie tworzyć tokeny i osobno dać jej dostęp do dziennika audytu, bez czynienia jej administratorem.
- **Restorm instaluje się teraz z npm.** `npm i -g restorm-cli`, a potem `restorm` — aplikacja uruchamia się w systemach Linux, macOS i Windows bez instalatora. Kompilacja jest pobierana raz, weryfikowana opublikowaną sumą kontrolną i przechowywana w pamięci podręcznej, więc potok nie pobiera jej ponownie przy każdym zadaniu.

## v1.0.1

**Pierwsza poprawka: przenoszenie w panelu bocznym, nazwy kart i raporty o awariach.**

- **Przeniesienie elementu w panelu bocznym nie psuje już aplikacji.** Przy otwartej mini przeglądarce, Ustawieniach lub dziennikach MCP każde przeciągnięcie w panelu bocznym rozbijało interfejs, a pomagał tylko restart.
- **Zmiana nazwy elementu aktualizuje teraz każdą otwartą kartę** — w tym karty w podzielonym panelu i karty każdego typu żądania (gRPC, GraphQL, Redis…), które zachowywały starą nazwę do ponownego otwarcia.
- **Raporty o awariach znowu do nas docierają.** Przy włączonym wysyłaniu raportów wersja 1.0.0 po cichu nie wysyłała nic: napotkana awaria nic nam nie mówiła.
- **Ilustracja „języki programowania” znów pokazuje swoje logotypy.**

## v1.0.0

**Restorm 1.0 — lokalny klient API, już dostępny.**

Restorm to szybki, działający offline klient desktopowy do testowania i obsługi API we wszystkich najważniejszych protokołach.

- **Protokoły**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenariusze**: łącz żądania wizualnie, rozgałęziaj/zapętlaj, wyodrębniaj i używaj ponownie wartości, uruchamiaj bezinterfejsowo w CI.
- **Środowiska i zmienne**: `{{handlebars}}` wszędzie, typowane sekrety, środowiska dla każdego folderu.
- **Import/Eksport**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, eksport kodu.
- **Projekty natywne dla Gita**: Pana/Pani projekt `.restorm` to zwykły plik — proszę wersjonować go, porównywać i rozwiązywać konflikty w aplikacji.
- **Lokalnie i prywatnie**: wszystko działa na Pana/Pani komputerze; zapora wychodząca kontroluje każde połączenie zewnętrzne.
- **Wieloplatformowość**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Darmowa edycja Community, z Pro i Enterprise dla zespołów.
