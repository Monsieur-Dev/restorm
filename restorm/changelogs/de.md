# Changelog

## v1.0.2

**Ihre CLI/CI-Token, ohne die App zu verlassen.**

- **Token in Restorm erstellen, ansehen und widerrufen** — für Pro- und Enterprise-Nutzerinnen und -Nutzer, über die Konto-Schaltfläche in der Titelleiste. Kein Umweg mehr über das Dashboard für eine Pipeline, die Sie gerade schreiben.
- **Token können ablaufen.** Wählen Sie beim Erstellen eine Gültigkeitsdauer — 7 bis 365 Tage oder wie bisher kein Ablauf. Ein abgelaufenes Token wird genauso abgelehnt wie ein widerrufenes.
- **Ihre Organisation kann delegieren.** Eine Administratorin kann einem bestimmten Mitglied erlauben, Token zu erstellen, und getrennt davon das Auditprotokoll freigeben — ohne es zur Administratorin zu machen.

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
