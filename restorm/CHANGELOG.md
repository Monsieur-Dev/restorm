# Changelog

Notable changes per released version. Each release is a `## vX.Y.Z` section; the
in-app "What's new" notification renders the entries added since the version you
last ran. Newest version on top.

Localized "What's new": these English notes are the source; hand-written
per-language copies live in `changelogs/<locale>.md`. This is deliberate
release-communication copy, written per release — not generated from tickets. See
[docs/contributing/release-notes.md](docs/contributing/release-notes.md) for the
per-release process.

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
