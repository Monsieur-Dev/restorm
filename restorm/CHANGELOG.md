# Changelog

Notable changes per released version. Each release is a `## vX.Y.Z` section; the
in-app "What's new" notification renders the entries added since the version you
last ran. Newest version on top.

Localized "What's new": these English notes are the source; hand-written
per-language copies live in `changelogs/<locale>.md`. This is deliberate
release-communication copy, written per release — not generated from tickets. See
[docs/contributing/release-notes.md](docs/contributing/release-notes.md) for the
per-release process.

## v1.1.4

**Connect your AI assistant on macOS — now reliable.**

- **Fixed: Claude Desktop and Cursor on macOS.** Connecting an AI assistant loaded Restorm's tools but then failed every call with "no running instance", even with Restorm open — the app and the connector were looking for each other in different temp folders. They now rendezvous reliably, whatever launched the connector.
- **Formal wording in Italian, Polish and Finnish.** The interface now addresses you in the formal register in these three languages, consistent with the rest.
- **Scenario Code action — cleaner, with built-in examples.** The Code node no longer stretches when the script is long, and its editor gains a **Need help?** tab showing a ready-to-run example in the language you picked (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). Pasting while the editor is open no longer drops a stray Code node on the canvas.

## v1.1.3

**Connect your AI assistant to Restorm.**

- **In one click, from the app.** The MCP menu in the status bar now offers "Add Restorm to your AI assistant" — ready-to-paste setup for Claude Code, Claude Desktop and Cursor, plus a one-click "Add to Claude Code".
- **Or one line, anywhere.** Point any MCP client at your running Restorm with `npx -y restorm-mcp` — the bridge finds it on its own, no port or token to copy.
- **A plugin for Claude Code.** Run `/plugin marketplace add Monsieur-Dev/restorm`, then install the `restorm` plugin.

See [Connecting your AI assistant](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**OpenAPI 3.2 support.**

- **Import OpenAPI 3.2 specs.** The `QUERY` method, custom verbs (`additionalOperations`), the query-string parameter and streaming media types all import as ready-to-run requests.
- **Browse for a file to import.** A Browse button on the import dialog opens a native file picker — no more typing or dragging a path.
- **A split view for large pastes.** Pasting a multi-line spec opens a code editor on the left and the preview on the right, with a draggable divider between them.
- **Tolerant import.** A spec with a few broken `$ref`s imports every route it can and shows a warning listing exactly what it had to skip.

Fixes:

- Importing an invalid or unreachable spec shows a clear message instead of opening the crash-report dialog.
- The crash-report detail view scrolls again.
- Dialog backdrops are no longer blurred.

## v1.1.1

**The API designer, now driven from the sidebar.**

- **Your models, enums and routes live in the sidebar.** The three in-tab lists are gone — models (with their inheritance nesting), enums, and routes (groups and their routes) now sit directly in the sidebar tree. Right-click any of them to rename, add a sub-model or sub-group, clone a route, generate CRUD, or delete; drag to reorder or re-parent — never out of the design. Each page now shows just the selected item's details.
- **A bird's-eye view of your models, enums and routes.** Each section's root now lists everything under it — and Models add a **Graph** tab: a class diagram of your models with their inheritance and references drawn out. Enums show their values right beside the name.
- **One place to rename anything.** A model, enum or route is renamed from its large title (the pencil), and an empty name reads **"<unnamed>"** so the pencil is always within reach — the name is no longer shown twice on the page.
- **Validation errors point at the item.** When something is wrong — a model and an enum sharing a name, a reference to something that no longer exists — a note at the top of that model, enum or route now explains it.
- **A complete breadcrumb.** The trail mirrors the full sidebar hierarchy — folders › design › section › group › item — and every segment is clickable.
- **Select many, delete once.** Select several models, enums or routes and delete them in one go, after a confirmation.
- **Copy or open a code template's source in one click.** On the "</> Code" page, hovering a template reveals a button to copy its URL or path, and one to open it — the repository in your browser, or the folder on disk for a local template.
- **New routes start with a name.** A route created from scratch now gets a default name, so you can rename it right away.
- **Preview tabs, like your editor.** A single click now opens an item in a reusable **preview** tab (its name shown in italics); clicking another item reuses the same tab instead of stacking a new one. Double-click it, edit anything, or run a request to keep it open for good. Turn it off in Settings › Behavior.
- **Pin the tabs you keep open.** Right-click a tab and pin it: pinned tabs stay first, survive "close others", and are remembered per project.
- **Environments get a proper detail view.** Open an environment to rename it from its title, set its icon and color, and add a sub-environment — and the right-click menu now duplicates an environment with all its variables and sub-environments.

Fixes:

- **Choosing a code template closes the library.** "Use" now returns you straight to the Code page.
- **Documentation generation no longer fails on optional fields.** Generating docs from a design whose model or parameter left "required" unset no longer stops with a template error.
- **Deleting an enum asks first.** Enums now get the same confirmation prompt as models and routes.
- **The sidebar reveals what you select.** With "sync the sidebar with the active tab" turned on, selecting or creating a model, enum or route expands its parents so it stays visible in the tree.
- **The environment button stays readable on any color.** Its label now switches to dark or light text to stay legible against the environment's color, like the run button.
- **Middle-click closes an open file.** Middle-clicking an entry in the sidebar's "Opened" list closes its tab — and a new Behavior setting lets you hide that panel entirely.
- **Clearer wording when starting from documentation.** In an imported API's documentation, the button now reads "Create a new request from this documentation."
- **Signing in works on the Microsoft Store build.** The custom-protocol callback the browser hands back after you log in is now declared in the Store package, so the sign-in completes instead of timing out.

## v1.1.0

🎉 **Restorm is now an API designer, too.** Design your API, serve it as a live mock across five protocols at once, and generate its clients — all without leaving the app, all on your own disk.

- **A visual API designer.** Model your API by hand — models, enums (named or inline), routes, parameters, named examples, constraints, tags and deprecations — without writing a line of spec.
- **Serve it as a mock, in one click, across 5 protocols at once.** The design becomes a server that answers in HTTP, GraphQL, SOAP, OData and gRPC simultaneously. Responses come from your named examples (or realistic data generated from your models), with constraint validation, simulated latency and a stateful mode.
- **Ready-to-run clients, generated automatically.** While the mock runs, the Clients section creates real, runnable requests for every enabled protocol, pointed at the mock's endpoints. One click opens a request and hits the server — no more re-importing your API elsewhere to test it.
- **Generate code** from your design using the provided templates and your own custom ones, rendered in a sandbox and written to disk only after you confirm. **Export the descriptor** too (OpenAPI and more).
- **On import, request bodies pre-fill**: GraphQL selects the return type's scalar fields, gRPC expands nested messages — the request runs as-is.

## v1.0.6

Fixes:

- **A very large project now fails to save with a clear message instead of freezing.** If a project grows too big to write to disk in one piece — which can happen after importing an unusually large API schema — Restorm now tells you plainly that it is too large to save, rather than crashing or failing silently.
- **Clearer error reporting behind the scenes.** Cancelling a "Save as" dialog is no longer recorded as an error, and a failed import now reports its real cause — so the genuine problems are easier to spot and fix.

## v1.0.5

**The Cookie jar — one jar of cookies per environment.**

- **Every environment keeps its own cookies.** Sign in against your dev API and your prod API from two environments and their sessions never cross — a cookie captured in one is only ever sent back in that one. Expiry, `Path`, `Domain` and sub-domains, `Secure`, `HttpOnly` and `SameSite` are honoured now, not discarded.
- **Meet the Cookie jar.** A new workbench tab — **View ▸ Cookie jar** — lists every environment's cookies grouped by domain in collapsible panes: edit a value, delete one, clear a domain or the whole jar, or add a cookie by hand. It refreshes live as your requests set cookies.
- **See what each request sent and received.** Every request now has a **Cookies** tab beside Response and Info, showing the cookies sent with the call and the cookies received back — including cookies set on a redirect that never reach the final response. It's there on past responses in your history too.
- **Cookie logins just work.** A request that returns `Set-Cookie` is captured and replayed automatically on the protected calls that follow — including across a scenario run, where every step shares the environment's jar.
- **Cookies persist like a browser's.** Cookies with an expiry are saved per project and reloaded when you reopen it; session cookies are dropped when you restart — exactly as a browser would.
- **Beyond REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC and SSE all send and store cookies now, and WebSocket carries them on the connection handshake.
- **Cookies can use your variables.** Type `{{token}}` in a cookie you add by hand and it resolves against the active environment when the request goes out.

Fixes:

- **Autosave now covers environments inside folders.** Adding or renaming a sub-environment is saved right away in autosave mode — no more "save before closing?" prompt for a change that was already meant to be on disk.

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
