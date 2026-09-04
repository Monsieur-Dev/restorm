# Changelog

## v1.1.0

🎉 **Restorm ist jetzt auch ein API-Designer.** Entwerfen Sie Ihre API, stellen Sie sie als Live-Mock über fünf Protokolle gleichzeitig bereit und generieren Sie ihre Clients — alles ohne die App zu verlassen, alles auf Ihrer eigenen Festplatte.

- **Ein visueller API-Designer.** Modellieren Sie Ihre API von Hand — Modelle, Enums (benannt oder inline), Routen, Parameter, benannte Beispiele, Constraints, Tags und Deprecations — ohne eine einzige Zeile Spezifikation zu schreiben.
- **Stellen Sie sie als Mock bereit, mit einem Klick, über 5 Protokolle gleichzeitig.** Der Entwurf wird zu einem Server, der in HTTP, GraphQL, SOAP, OData und gRPC gleichzeitig antwortet. Die Antworten stammen aus Ihren benannten Beispielen (oder aus realistischen, aus Ihren Modellen generierten Daten), mit Constraint-Validierung, simulierter Latenz und einem Stateful-Modus.
- **Sofort ausführbare Clients, automatisch generiert.** Während der Mock läuft, erstellt der Bereich Clients echte, ausführbare Anfragen für jedes aktivierte Protokoll, ausgerichtet auf die Endpunkte des Mocks. Ein Klick öffnet eine Anfrage und trifft den Server — kein erneutes Importieren Ihrer API anderswo mehr, um sie zu testen.
- **Generieren Sie Code** aus Ihrem Entwurf mit den mitgelieferten Templates und Ihren eigenen, in einer Sandbox gerendert und erst nach Ihrer Bestätigung auf die Festplatte geschrieben. **Exportieren Sie auch den Deskriptor** (OpenAPI und mehr).
- **Beim Import werden Anfrage-Bodies vorausgefüllt**: GraphQL wählt die Skalarfelder des Rückgabetyps aus, gRPC entfaltet verschachtelte Nachrichten — die Anfrage läuft unverändert.

## v1.0.6

Korrekturen:

- **Ein sehr großes Projekt scheitert beim Speichern jetzt mit einer klaren Meldung, statt einzufrieren.** Wird ein Projekt zu groß, um am Stück auf die Festplatte geschrieben zu werden — was nach dem Import eines ungewöhnlich großen API-Schemas passieren kann —, sagt Restorm klar, dass es zu groß zum Speichern ist, anstatt abzustürzen oder still zu scheitern.
- **Klarere Fehlerberichte im Hintergrund.** Das Abbrechen eines „Speichern unter“-Dialogs wird nicht mehr als Fehler erfasst, und ein fehlgeschlagener Import meldet nun seine tatsächliche Ursache — so lassen sich echte Probleme leichter erkennen und beheben.

## v1.0.5

**Cookie jar — ein Cookie-Glas pro Umgebung.**

- **Jede Umgebung behält ihre eigenen Cookies.** Melden Sie sich aus zwei Umgebungen an Ihrer Dev-API und Ihrer Prod-API an – ihre Sitzungen vermischen sich nie: Ein in der einen erfasstes Cookie wird auch nur an diese zurückgesendet. Ablaufdatum, `Path`, `Domain` samt Subdomains, `Secure`, `HttpOnly` und `SameSite` werden jetzt beachtet statt verworfen.
- **Lernen Sie die Cookie jar kennen.** Ein neuer Tab der Arbeitsfläche — **Ansicht ▸ Cookie jar** — listet die Cookies jeder Umgebung, nach Domain gruppiert in einklappbaren Bereichen: Bearbeiten Sie einen Wert, löschen Sie eines, leeren Sie eine Domain oder das ganze Glas, oder fügen Sie ein Cookie von Hand hinzu. Er aktualisiert sich live, während Ihre Anfragen Cookies setzen.
- **Sehen Sie, was jede Anfrage gesendet und empfangen hat.** Jede Anfrage hat jetzt einen **Cookies**-Tab neben Antwort und Infos, der die mit dem Aufruf gesendeten Cookies und die zurückempfangenen Cookies zeigt — einschließlich der bei einer Weiterleitung gesetzten Cookies, die die endgültige Antwort nie erreichen. Er ist auch bei früheren Antworten in Ihrem Verlauf vorhanden.
- **Cookie-Logins funktionieren einfach.** Eine Anfrage, die `Set-Cookie` zurückgibt, wird erfasst und bei den folgenden geschützten Aufrufen automatisch wieder mitgesendet – auch über einen ganzen Szenario-Lauf hinweg, bei dem jeder Schritt dasselbe Glas der Umgebung nutzt.
- **Cookies bleiben erhalten wie im Browser.** Cookies mit einem Ablaufdatum werden pro Projekt gespeichert und beim erneuten Öffnen wieder geladen; Sitzungs-Cookies werden beim Neustart verworfen — genau wie es ein Browser täte.
- **Mehr als nur REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC und SSE senden und speichern jetzt alle Cookies, und WebSocket überträgt sie beim Verbindungs-Handshake.
- **Cookies können Ihre Variablen nutzen.** Tippen Sie `{{token}}` in ein von Hand hinzugefügtes Cookie, und es wird beim Absenden der Anfrage gegen die aktive Umgebung aufgelöst.

Korrekturen:

- **Das automatische Speichern erfasst jetzt auch Umgebungen in Ordnern.** Das Hinzufügen oder Umbenennen einer Unterumgebung wird im Modus für automatisches Speichern sofort gespeichert — keine „Vor dem Schließen speichern?“-Abfrage mehr für eine Änderung, die ohnehin auf der Festplatte landen sollte.

## v1.0.4

**Einmal anmelden — alle Fenster folgen.**

- **Ihr Konto folgt Ihnen jetzt über alle Fenster hinweg.** Melden Sie sich in einem Restorm-Fenster an oder ab oder wechseln Sie den Plan: Jedes andere offene Fenster übernimmt es sofort — ohne Neustart, ohne zweite Anmeldung. Und wenn Sie eine Anmeldung im Browser abschließen, erreicht die Bestätigung nun das Fenster, das sie angefordert hat, auch bei mehreren offenen Fenstern.

Korrekturen:

- **Code-Knoten starten auf Intel-Macs wieder** — der macOS-Intel-Build enthielt ein für Apple Silicon kompiliertes esbuild-Binary.
- **Die Aktion „Neues Fenster" des AppImage-Launchers öffnet wieder ein Fenster**, und der von den .deb/.rpm-Paketen installierte Befehl `restorm` funktioniert wieder.
- **Der Windows-Start ist sauberer** — das Fenster lädt jetzt über das App-Protokoll, ohne stillen Rückfall nach einem internen Fehler bei jedem Start.

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
