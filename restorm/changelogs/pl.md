# Changelog

## v1.0.2

**Twoje tokeny CLI/CI, bez opuszczania aplikacji.**

- **Twórz, przeglądaj i unieważniaj tokeny w Restorm** — dla użytkowników Pro i Enterprise, z przycisku konta na pasku tytułu. Koniec z wycieczką do panelu po token do potoku, który właśnie piszesz.
- **Tokeny mogą wygasać.** Wybierz czas życia przy tworzeniu: od 7 do 365 dni albo bez wygaśnięcia, jak dotąd. Token wygasły jest odrzucany tak samo jak unieważniony.
- **Twoja organizacja może delegować.** Administrator może pozwolić konkretnej osobie tworzyć tokeny i osobno dać jej dostęp do dziennika audytu, bez czynienia jej administratorem.

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
