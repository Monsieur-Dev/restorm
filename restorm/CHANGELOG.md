# Changelog

Notable changes per released version. Each release is a `## vX.Y.Z` section; the
in-app "What's new" notification renders the entries added since the version you
last ran. Newest version on top.

Localized "What's new": these English notes are the source; hand-written
per-language copies live in `changelogs/<locale>.md`. This is deliberate
release-communication copy, written per release — not generated from tickets. See
[docs/contributing/release-notes.md](docs/contributing/release-notes.md) for the
per-release process.

## v1.0.5

**Cookies, done properly — one jar per environment.**

- **Every environment keeps its own cookies.** Sign in against your dev API and your prod API from two environments and their sessions never cross — a cookie captured in one is only ever sent back in that one. Expiry, `Path`, `Domain` and sub-domains, `Secure`, `HttpOnly` and `SameSite` are honoured now, not discarded.
- **See and edit what's stored.** A new Cookie Manager — **View → Cookies** — lists each environment's cookies grouped by origin: edit a value, delete one, clear an origin or the whole jar, or add a cookie by hand. When a response sets cookies, a 🍪 chip on the response opens the manager straight on that origin.
- **Cookie logins just work.** A request that returns `Set-Cookie` is captured and replayed automatically on the protected calls that follow — including across a scenario run, where every step shares the environment's jar.
- **Beyond REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC and SSE all send and store cookies now, and WebSocket, Socket.IO and STOMP carry them on the connection handshake.
- **Cookies can use your variables.** Type `{{token}}` in a cookie you add by hand and it resolves against the active environment when the request goes out.

## v1.0.4

**Sign in once — every window follows.**

- **Your account now follows you across windows.** Sign in, sign out or change plan in one Restorm window, and every other open window adopts it instantly — no restart, no second login. And when you finish signing in through the browser, the confirmation now reaches the window that asked for it, even with several windows open.

Fixes:

- **Code nodes start again on Intel Macs** — the macOS Intel build shipped an esbuild binary built for Apple Silicon.
- **The AppImage's "New window" launcher action opens a window again**, and the `restorm` command installed by the .deb/.rpm packages works again.
- **Windows startup is cleaner** — the window now loads through the app protocol instead of silently falling back after an internal error on every launch.

## v1.0.3

**Restorm runs in CI, without FUSE.**

- **`restorm-cli` now works on CI runners and in containers.** The Linux build is unpacked instead of mounted, so FUSE — which Ubuntu no longer ships — is no longer needed.

## v1.0.2

**Your CLI/CI tokens, without leaving the app.**

- **Create, see and revoke your tokens from Restorm** — for Pro and Enterprise users, from the account button in the title bar. No more round trip to the dashboard to get a token for a pipeline you are setting up right now.
- **Tokens can expire.** Choose a lifetime when you create one — 7 to 365 days, or no expiration, as before. An expired token is refused exactly like a revoked one.
- **Your organization can delegate.** An administrator can now let a specific member create tokens, and separately let a member read the audit log, without making them an administrator.
- **Restorm now installs itself from npm.** `npm i -g restorm-cli`, then `restorm` — the application starts on Linux, macOS and Windows without going through an installer. The build is downloaded once, checked against its published checksum and kept in a cache, so a pipeline stops re-downloading it on every job.

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
