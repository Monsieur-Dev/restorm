# Changelog

Notable changes per released version. Each release is a `## vX.Y.Z` section; the
in-app "What's new" notification renders the entries added since the version you
last ran. Newest version on top.

Localized "What's new": these English notes are the source; hand-written
per-language copies live in `changelogs/<locale>.md`. This is deliberate
release-communication copy, written per release — not generated from tickets. See
[docs/contributing/release-notes.md](docs/contributing/release-notes.md) for the
per-release process.

## v1.0.1

**First patch — sidebar moves, tab names, and crash reports.**

- **Moving an item in the sidebar no longer breaks the app.** With the mini browser, Settings or the MCP logs open, dragging any row in the sidebar tore the interface down, and only a restart brought it back.
- **Renaming an item now updates every open tab** — including tabs in a split pane, and tabs of every request kind (gRPC, GraphQL, Redis…), which used to keep their old name until reopened.
- **Crash reports reach us again.** With crash reporting turned on, 1.0.0 silently sent nothing: a crash you hit told us nothing.
- **The "code languages" tip illustration shows its logos again.**

## v1.0.0

**Restorm 1.0 — the local-first API client, launched.**

Restorm is a fast, offline-first desktop client for testing and driving APIs across every major protocol.

- **Protocols**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenarios**: chain requests visually, branch/loop, extract & reuse values, run headless in CI.
- **Environments & variables**: `{{handlebars}}` everywhere, typed secrets, per-folder environments.
- **Import/Export**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, code export.
- **Git-native projects**: your `.restorm` project is a plain file — version it, diff it, resolve conflicts in-app.
- **Local-first & private**: everything runs on your machine; an outbound firewall gates every external call.
- **Cross-platform**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Free Community edition, with Pro & Enterprise for teams.
