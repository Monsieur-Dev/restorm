# Changelog

## v1.0.4

**Einmal anmelden — alle Fenster folgen.**

- **Ihr Konto folgt Ihnen jetzt über alle Fenster hinweg.** Melden Sie sich in einem Restorm-Fenster an oder ab oder wechseln Sie den Plan: Jedes andere offene Fenster übernimmt es sofort — ohne Neustart, ohne zweite Anmeldung. Und wenn Sie eine Anmeldung im Browser abschließen, erreicht die Bestätigung nun das Fenster, das sie angefordert hat, auch bei mehreren offenen Fenstern.

Korrekturen:

- **Code-Knoten starten auf Intel-Macs wieder** — der macOS-Intel-Build enthielt ein für Apple Silicon kompiliertes esbuild-Binary.
- **Die Aktion „Neues Fenster" des AppImage-Launchers öffnet wieder ein Fenster**, und der von den .deb/.rpm-Paketen installierte Befehl `restorm` funktioniert wieder.

## v1.0.3

**Restorm läuft in der CI, ohne FUSE.**

- **`restorm-cli` funktioniert jetzt auf CI-Runnern und in Containern.** Der Linux-Build wird entpackt statt eingehängt — FUSE, das Ubuntu nicht mehr mitliefert, wird nicht mehr gebraucht.

## v1.0.2

**Ihre CLI/CI-Token, ohne die App zu verlassen.**

- **Token in Restorm erstellen, ansehen und widerrufen** — für Pro- und Enterprise-Nutzerinnen und -Nutzer, über die Konto-Schaltfläche in der Titelleiste. Kein Umweg mehr über das Dashboard für eine Pipeline, die Sie gerade schreiben.
- **Token können ablaufen.** Wählen Sie beim Erstellen eine Gültigkeitsdauer — 7 bis 365 Tage oder wie bisher kein Ablauf. Ein abgelaufenes Token wird genauso abgelehnt wie ein widerrufenes.
- **Ihre Organisation kann delegieren.** Eine Administratorin kann einem bestimmten Mitglied erlauben, Token zu erstellen, und getrennt davon das Auditprotokoll freigeben — ohne es zur Administratorin zu machen.
- **Restorm installiert sich jetzt über npm.** `npm i -g restorm-cli`, dann `restorm` — die Anwendung startet unter Linux, macOS und Windows ohne Installationsprogramm. Der Build wird einmal heruntergeladen, anhand seiner veröffentlichten Prüfsumme verifiziert und zwischengespeichert, sodass eine Pipeline ihn nicht mehr bei jedem Job neu lädt.

## v1.0.1

**Erstes Patch — Verschieben in der Seitenleiste, Tab-Namen und Absturzberichte.**

- **Das Verschieben eines Elements in der Seitenleiste bricht die App nicht mehr.** Bei geöffnetem Mini-Browser, geöffneten Einstellungen oder MCP-Protokollen zerlegte jedes Ziehen in der Seitenleiste die Oberfläche; nur ein Neustart half.
- **Das Umbenennen eines Elements aktualisiert jetzt jeden offenen Tab** — auch Tabs in einem geteilten Bereich und Tabs jeder Anfrageart (gRPC, GraphQL, Redis…), die bis zum erneuten Öffnen ihren alten Namen behielten.
- **Absturzberichte erreichen uns wieder.** Bei aktivierten Absturzberichten sendete 1.0.0 stillschweigend nichts: Ein Absturz bei Ihnen sagte uns nichts.
- **Die Illustration „Code-Sprachen“ zeigt ihre Logos wieder an.**

## v1.0.0

**Restorm 1.0 — der local-first API-Client ist da.**

Restorm ist ein schneller, offline-first Desktop-Client zum Testen und Steuern von APIs über alle wichtigen Protokolle hinweg.

- **Protokolle**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Szenarien**: Anfragen visuell verketten, verzweigen/schleifen, Werte extrahieren und wiederverwenden, headless in der CI ausführen.
- **Umgebungen & Variablen**: `{{handlebars}}` überall, typisierte Secrets, Umgebungen pro Ordner.
- **Import/Export**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, Code-Export.
- **Git-native Projekte**: Ihr `.restorm`-Projekt ist eine einfache Datei — versionieren, vergleichen und Konflikte direkt in der App lösen.
- **Local-first & privat**: Alles läuft auf Ihrem Rechner; eine ausgehende Firewall kontrolliert jeden externen Aufruf.
- **Plattformübergreifend**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Kostenlose Community-Edition, mit Pro & Enterprise für Teams.
