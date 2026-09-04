# Changelog

## v1.1.0

🎉 **Restorm jest teraz także projektantem API.** Zaprojektuj swoje API, udostępnij je jako mock na żywo na pięciu protokołach naraz i wygeneruj jego klientów — bez opuszczania aplikacji, wszystko na własnym dysku.

- **Wizualny projektant API.** Modeluj swoje API ręcznie — modele, enumy (nazwane lub inline), trasy, parametry, nazwane przykłady, ograniczenia, tagi i wycofania — bez pisania ani jednej linijki specyfikacji.
- **Udostępnij je jako mock, jednym kliknięciem, na 5 protokołach naraz.** Projekt staje się serwerem, który odpowiada jednocześnie w HTTP, GraphQL, SOAP, OData i gRPC. Odpowiedzi pochodzą z Twoich nazwanych przykładów (lub z realistycznych danych wygenerowanych z Twoich modeli), z walidacją ograniczeń, symulowanym opóźnieniem i trybem stanowym.
- **Gotowi do uruchomienia klienci, generowani automatycznie.** Gdy mock działa, sekcja Clients tworzy prawdziwe, wykonywalne żądania dla każdego włączonego protokołu, skierowane na endpointy mocka. Jedno kliknięcie otwiera żądanie i uderza w serwer — koniec z ponownym importowaniem API gdzie indziej, żeby je przetestować.
- **Wygeneruj kod** ze swojego projektu, korzystając z dostarczonych szablonów oraz własnych, niestandardowych, renderowany w piaskownicy i zapisywany na dysk dopiero po Twoim potwierdzeniu. **Wyeksportuj też deskryptor** (OpenAPI i inne).
- **Przy imporcie treści żądań wypełniają się automatycznie**: GraphQL wybiera pola skalarne typu zwracanego, gRPC rozwija zagnieżdżone komunikaty — żądanie działa bez zmian.

## v1.0.6

Poprawki:

- **Bardzo duży projekt kończy się teraz niepowodzeniem zapisu z czytelnym komunikatem, zamiast się zawieszać.** Jeśli projekt stanie się zbyt duży, aby zapisać go na dysku w całości — co może się zdarzyć po zaimportowaniu wyjątkowo dużego schematu API — Restorm wyraźnie informuje, że jest zbyt duży do zapisania, zamiast się zawieszać lub po cichu zawodzić.
- **Czytelniejsze raportowanie błędów w tle.** Anulowanie okna „Zapisz jako” nie jest już zapisywane jako błąd, a nieudany import podaje teraz swoją rzeczywistą przyczynę — dzięki czemu prawdziwe problemy łatwiej wykryć i naprawić.

## v1.0.5

**Cookie jar — jeden słoik ciasteczek na środowisko.**

- **Każde środowisko przechowuje własne ciasteczka.** Zaloguj się do swojego API deweloperskiego i produkcyjnego z dwóch środowisk, a ich sesje nigdy się nie przenikają — ciasteczko przechwycone w jednym jest odsyłane wyłącznie w tym samym. Wygasanie, `Path`, `Domain` i subdomeny, `Secure`, `HttpOnly` oraz `SameSite` są teraz respektowane, a nie odrzucane.
- **Poznaj Cookie jar.** Nowa zakładka warsztatu — **Widok ▸ Cookie jar** — wyświetla ciasteczka każdego środowiska pogrupowane według domeny w zwijanych panelach: zmień wartość, usuń pojedyncze, wyczyść domenę lub cały słoik albo dodaj ciasteczko ręcznie. Odświeża się na żywo, w miarę jak Twoje żądania ustawiają ciasteczka.
- **Zobacz, co każde żądanie wysłało i otrzymało.** Każde żądanie ma teraz zakładkę **Cookies** obok Odpowiedzi i Informacji, pokazującą ciasteczka wysłane wraz z wywołaniem oraz ciasteczka otrzymane w odpowiedzi — w tym ciasteczka ustawione przy przekierowaniu, które nigdy nie trafiają do końcowej odpowiedzi. Jest dostępna także dla wcześniejszych odpowiedzi z Twojej historii.
- **Logowanie przez ciasteczka po prostu działa.** Żądanie, które zwraca `Set-Cookie`, jest przechwytywane i automatycznie odtwarzane w kolejnych chronionych wywołaniach — również w trakcie uruchomienia scenariusza, gdzie każdy krok korzysta ze wspólnego słoika środowiska.
- **Ciasteczka są utrwalane jak w przeglądarce.** Ciasteczka z datą wygaśnięcia są zapisywane osobno dla każdego projektu i wczytywane ponownie po jego otwarciu; ciasteczka sesyjne są odrzucane przy ponownym uruchomieniu — dokładnie tak, jak zrobiłaby to przeglądarka.
- **Więcej niż REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC i SSE wysyłają i przechowują teraz ciasteczka, a WebSocket przenosi je podczas nawiązywania połączenia.
- **Ciasteczka mogą korzystać z Twoich zmiennych.** Wpisz `{{token}}` w ręcznie dodanym ciasteczku, a jego wartość zostanie rozwinięta względem aktywnego środowiska w chwili wysłania żądania.

Poprawki:

- **Automatyczny zapis obejmuje teraz środowiska wewnątrz folderów.** Dodanie lub zmiana nazwy podśrodowiska jest w trybie automatycznego zapisu zapisywane od razu — koniec z pytaniem „zapisać przed zamknięciem?" o zmianę, która i tak miała już znaleźć się na dysku.

## v1.0.4

**Jedno logowanie — wszystkie okna podążają.**

- **Twoje konto podąża teraz za tobą między oknami.** Zaloguj się, wyloguj lub zmień plan w jednym oknie Restorm, a każde inne otwarte okno natychmiast to przejmie — bez restartu, bez drugiego logowania. A gdy kończysz logowanie w przeglądarce, potwierdzenie trafia teraz do okna, które o nie poprosiło, nawet przy kilku otwartych oknach.

Poprawki:

- **Węzły kodu znów startują na Macach z procesorem Intel** — build macOS Intel zawierał binarkę esbuild skompilowaną dla Apple Silicon.
- **Akcja „Nowe okno" launchera AppImage znów otwiera okno**, a polecenie `restorm` instalowane przez pakiety .deb/.rpm znów działa.
- **Start w systemie Windows jest czystszy** — okno ładuje się teraz przez protokół aplikacji, bez cichego obejścia po wewnętrznym błędzie przy każdym uruchomieniu.

## v1.0.3

**Restorm działa w CI, bez FUSE.**

- **`restorm-cli` działa teraz na runnerach CI i w kontenerach.** Kompilacja dla Linuksa jest rozpakowywana zamiast montowana: FUSE, którego Ubuntu już nie dostarcza, nie jest już potrzebny.

## v1.0.2

**Twoje tokeny CLI/CI, bez opuszczania aplikacji.**

- **Twórz, przeglądaj i unieważniaj tokeny w Restorm** — dla użytkowników Pro i Enterprise, z przycisku konta na pasku tytułu. Koniec z wycieczką do panelu po token do potoku, który właśnie piszesz.
- **Tokeny mogą wygasać.** Wybierz czas życia przy tworzeniu: od 7 do 365 dni albo bez wygaśnięcia, jak dotąd. Token wygasły jest odrzucany tak samo jak unieważniony.
- **Twoja organizacja może delegować.** Administrator może pozwolić konkretnej osobie tworzyć tokeny i osobno dać jej dostęp do dziennika audytu, bez czynienia jej administratorem.
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
- **Projekty natywne dla Gita**: Twój projekt `.restorm` to zwykły plik — wersjonuj go, porównuj i rozwiązuj konflikty w aplikacji.
- **Lokalnie i prywatnie**: wszystko działa na Twoim komputerze; zapora wychodząca kontroluje każde połączenie zewnętrzne.
- **Wieloplatformowość**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Darmowa edycja Community, z Pro i Enterprise dla zespołów.
