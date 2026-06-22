# Playbook — Adding a New Execution Protocol to Restorm

> **Status:** authoritative reference for protocol work.
> Any ticket that adds a new execution protocol must follow this playbook
> to keep the protocol surface consistent. Do this *first*, not last — the doc
> exists so each author does not reinvent the same four artifacts (mock service,
> CI hook, E2E feature, user docs) with a slightly different shape.

This playbook covers a **new execution protocol**. For a new **import format**
without a new execution protocol (e.g. a new spec parser feeding existing
HTTP requests), follow [`adding-an-import.md`](./adding-an-import.md) — it
shares Sections 9–12 of this playbook but skips the execution-service work.

---

## TL;DR — checklist

Before you open the PR, all of these must be true:

- [ ] Architecture decided per [Section 1](#section-1--architectural-decision-tree).
- [ ] All UI uses `electron-core-ui` components only — [Section 2](#section-2--mandatory-ui-component-reuse-hard-rule) (hard rule).
- [ ] Every user input supports `{{handlebars}}` and goes through `ContextService.transformValue` — [Section 3](#section-3--mandatory-handlebars--env-variable-resolution-hard-rule) (hard rule).
- [ ] Every user input is debounced before triggering side effects — [Section 4](#section-4--mandatory-input-debouncing-hard-rule) (hard rule).
- [ ] Mock service added to `restorm/tests/docker/docker-compose.yml` — [Section 5](#section-5--docker-mock-service).
- [ ] CI integration confirmed — [Section 6](#section-6--ci-integration).
- [ ] E2E feature file covers every scenario in [Section 7](#section-7--e2e-scenario-template-the-full-matrix), including the debounce assertion.
- [ ] Response panel assertions per [Section 8](#section-8--ui-verifications-the-e2e-must-hit) covered.
- [ ] **Code-snippet examples are relevant** — the request panel's "code examples" tab renders a correct, env-/Handlebars-resolved snippet for the protocol in EVERY listed language (no empty output, no literal `{{var}}`, the right host/method/headers). Add a `CodeSnippetGenerator` template + wire its template variables, and verify each entry — [Section 8](#section-8--ui-verifications-the-e2e-must-hit).
- [ ] Response history builder added in `ResponseHistoryService`.
- [ ] **Scenario-graph integration complete** — action nodes, MCP, the request↔scenario links, demo scenario + goldens, palette/Bestiary — [Section 13](#section-13--scenario-graph-integration-streaming--bound-protocols) (the part most easily forgotten).
- [ ] **Server / long-running action = a DISTINCT scenario node (listen + close) + reference scenario + listening beam** — [Section 14](#section-14--server--long-running-actions-scenario-node-reference-scenario-listening-beam) (a server is its OWN node kind with `connected` / `served` / `done` ports and NO `response` — never a request-with-a-flag; it MUST appear in `scenarios-e2e-reference-tests.restorm` as a Main sub-scenario with both goldens regenerated, AND its running beam MUST orbit BOTH the sidebar badge AND the workbench-tab badge).
- [ ] User-facing + dev docs updated — [Section 10](#section-10--documentation-checklist).
- [ ] Protocol PR template ([Section 11](#section-11--pr-review-checklist)) populated and ticked.

The same checklist auto-populates for protocol PRs via
[`.github/PULL_REQUEST_TEMPLATE/protocol.md`](../../../.github/PULL_REQUEST_TEMPLATE/protocol.md).

---

## Section 1 — Architectural decision tree

Before writing any code, decide which of these paths the new work falls into.
The wrong path doubles the maintenance cost.

### 1.1 — New execution protocol vs. new mode on an existing one

| Question | If **yes** → | If **no** → |
| --- | --- | --- |
| Does the wire format reuse HTTP semantics (verbs, headers, status codes)? | New **mode** on `HTTPExecutionService` (precedent: REST, OData, JSON-RPC, tRPC). | Dedicated execution service. |
| Is the transport bidirectional / streaming (long-lived connections, frames)? | Dedicated service (precedent: `WebSocketExecutionService`, planned MQTT, Socket.IO). | HTTP-shaped service. |
| Does the call shape map 1:1 to a single request → single response? | HTTP-shaped service is fine. | Streaming / batch path needed; dedicated service. |
| Does the protocol need a binary codec / IDL (protobuf, Avro, Thrift)? | Dedicated service with codec registry. | HTTP-shaped service. |

**Heuristic:** if the tweak fits in one extra `switch` arm of `HTTPExecutionService`
and one extra renderer tab section, build it as a mode. If it forces a parallel
request model, response model, history builder, *and* tab view, build a dedicated
service.

### 1.2 — New import adapter vs. extend an existing one

* New importer if the source spec is a distinct format (different MIME, root
  schema, extension, or vendor lineage). Examples: AsyncAPI ≠ Swagger.
* Extend an existing importer if the spec is a *version* or *flavor* of an
  already-supported format (e.g. OpenAPI 3.1 alongside 3.0 inside
  `SwaggerImportService`).
* Always keep auto-detection in the source format's adapter (content sniffing
  on leading bytes, root field, extension), never in `ImportManager` — the
  manager dispatches, it does not classify.

### 1.3 — When to share code with `HTTPExecutionService`

Share when the protocol speaks plain HTTP under the hood:

* JSON-RPC, tRPC, OData → call into `HTTPExecutionService` and add a thin
  request-shaping layer.
* GraphQL → already a dedicated service because of subscriptions, but the
  query/mutation path leans on HTTP execution.

Do **not** share when:

* The transport is not HTTP (WebSocket, MQTT, gRPC over HTTP/2 with binary
  frames, Kafka, AMQP). These get their own service.
* Cancellation semantics differ materially (e.g. you need an `AbortController`
  per frame instead of per request).

### 1.4 — Where files live

```
restorm/
├── src/
│   ├── shared/
│   │   ├── types/requests/<Protocol>Request.ts          # request model (POJO)
│   │   └── models/requests/<Protocol>Request.ts         # decorated class
│   ├── main/services/
│   │   ├── <Protocol>ExecutionService.ts                # execution
│   │   ├── ResponseHistoryService.ts                    # add build<Protocol>Response
│   │   └── import/<Format>ImportService.ts              # import adapter
│   └── renderer/src/components/RequestTabViews/
│       └── <Protocol>RequestTabView.tsx                 # tab UI
├── tests/
│   ├── docker/docker-compose.yml                        # mock service
│   ├── docker/<protocol>-seed.sh                        # seed (optional)
│   ├── unit/fixtures/<format>/...                       # parser fixtures
│   └── e2e/bdd/<protocol>/
│       ├── features/<protocol>-execution.feature
│       └── steps/<protocol>-execution.steps.ts
└── docs/protocols/<protocol>.md                          # user-facing doc
```

For UI primitives that ought to be shared: `electron-core-ui/src/renderer/...`,
not under `restorm/`. If the new protocol surfaces a brand-new editor or input,
ship it in core-ui from day one (Section 2).

---

## Section 2 — Mandatory UI component reuse (hard rule)

> **Reviewers reject PRs that introduce bespoke buttons, modals, inputs, or
> layouts when an `electron-core-ui` (ecu) equivalent exists. No exceptions.**

All UI built for a new protocol must be composed of components from
`electron-core-ui`. Hand-rolled primitives are a bug, not a stylistic choice —
they break theming, keyboard accessibility, RTL, and selector-based testing.

### 2.1 — What's already shipped

Before writing a new primitive, grep:

```bash
ls electron-core-ui/src/renderer/components/
ls electron-core-ui/src/renderer/hooks/
```

Components available today (non-exhaustive):

| Domain | Component(s) |
| --- | --- |
| Layout | `ScrollableElement`, `SplitView`, `Pane`, `StaticPane`, `VerticalSashContainer`, `Sash` |
| Form controls | `Button`, `InputBox`, `TextArea`, `Toggle`, `SelectBox`, `KeyValueTable`, `IconSelect`, `ColorPicker`, `Radio`, `MultiSelectCombo` |
| Variable-aware input | `VariableInputBox` (single-line with Handlebars autocomplete — see Section 3) |
| Dialogs / overlays | `Modal`, `Tooltip`, `ContextMenu`, `TabSwitcherOverlay` |
| Navigation | `Breadcrumb`, `ListView`, `Tag`, `MenuBar`, `Tabs`, `BookmarkRibbon` |
| Code / text | `CodeEditor` (Monaco-backed, with Handlebars contribution), `MarkdownEditor`, `MarkdownViewer` |
| Feedback | `Callout`, toasts via `toasterService`, `ProgressBar`, `Statusbar` |
| Utilities | `getContrastColor`, `getColorFromString` |

The list is not exhaustive — always grep first.

### 2.2 — When no ecu component fits

If you genuinely need something new, the order is:

1. **Check core-ui first.** If similar primitives exist, extend them rather
   than fork — add a prop, do not copy-paste a 200-line file.
2. **Add to core-ui, not to restorm.** Anything reusable across packages
   ships in `electron-core-ui/src/renderer/components/` with proper exports
   in `electron-core-ui/src/renderer/components/index.ts`. The PR description
   must explain why no existing component fits.
3. **Last resort: protocol-local.** If the component is so protocol-specific
   that nothing else will ever consume it (e.g. a gRPC reflection picker),
   keep it under `restorm/src/renderer/src/components/RequestTabViews/<Protocol>/`.
   Even then, build it from ecu primitives.

### 2.3 — Common pitfalls

* **Bare `<div>` with `overflow: auto`.** Never. Use `ScrollableElement`. The
  default scrollbars don't match the theme and break on macOS / Windows
  high-contrast modes.
* **Plain `<button>`.** Use `Button`. Even tiny iconographic buttons.
* **Native `<select>`.** Use `SelectBox`. Native is unstyleable across platforms.
* **Custom modal backdrops.** Use `Modal`. The shared one already wires Esc,
  focus trap, and scroll lock.
* **Plain `<input>` for a value the user types.** See Section 3 — must be
  `VariableInputBox` for variable-aware inputs.

---

## Section 3 — Mandatory Handlebars / env-variable resolution (hard rule)

> **Reviewers reject PRs where a user-facing input uses a plain HTML input
> instead of `VariableInputBox`, or where a field's value reaches the
> execution service without going through `ContextService.transformValue`.**

Every request input that can carry user data must support the existing
Handlebars `{{var}}` template syntax, backed by `ContextService` env-variable
resolution. There is no "minor field" exception — URL, headers, query,
body, OData `$filter`, gRPC method args, MQTT topic names, WebSocket payload
strings, SOAP envelope namespaces, etc. all qualify.

### 3.1 — Input layer

| Input shape | Component to use |
| --- | --- |
| Single-line string field | `VariableInputBox` (autocompletes `{{var}}` against the active env, syntax-highlights resolved values). |
| Multi-line / structured body | `CodeEditor` (Monaco) — already includes the Handlebars language contribution. |
| Key/value pairs (headers, query) | `KeyValueTable` — its cells already wrap `VariableInputBox`. |

If you introduce a brand-new editor (e.g. a binary frame composer for MQTT),
register the same Handlebars language contribution from
`electron-core-ui/src/renderer/components/CodeEditor/handlebarsLanguage.ts`
on the new editor instance. Do **not** ship an editor that bypasses it.

### 3.2 — Execution layer

At execution time, every user-provided field passes through
`ContextService.transformValue(value)` before reaching the wire:

```ts
const resolvedUrl = contextService.transformValue(request.url, ctx)
const resolvedHeaders = Object.fromEntries(
  Object.entries(request.headers).map(([k, v]) => [
    contextService.transformValue(k, ctx),
    contextService.transformValue(v, ctx)
  ])
)
const resolvedBody = contextService.transformValue(request.body, ctx)
```

There is **no** path where raw user input bypasses resolution. Reviewers
trace each user-facing field from the tab view down to the execution service
and verify the transform is called. If the protocol has a structured payload
(protobuf message, GraphQL variables, OData query options), call
`transformValue` on every leaf string before the codec runs.

### 3.3 — Mandatory E2E coverage

The feature file must include the **"Env variable / Handlebars substitution"**
scenario from Section 7:

```gherkin
Scenario: Env variable / Handlebars substitution
  Given I have an env variable "host" with value "<mock-host>"
  When I use "{{host}}" in the request URL / body / headers
  And I run the request
  Then the mock service receives the substituted value
```

The mock service assertion is non-negotiable: a green substitution test that
only asserts the resolved value at the renderer is worthless — the bug class
this guards against is "substitution happens in the UI but the wire receives
the literal `{{host}}`".

---

## Section 4 — Mandatory input debouncing (hard rule)

> **Reviewers reject PRs where a user input drives state mutations on every
> keystroke. Debounce or document why a tighter delay is required.**

Every text input that drives state mutations — anything that fires events
into the event bus, the save-unit registry, IPC, GraphQL subscriptions, the
search index, autosave, `document:request:updated`, etc. on each keystroke —
must be **debounced** before it reaches the side-effect path.

Per-keystroke firing is the React default but not what we want. Flooding the
registry / IPC / persistence layer on every character produces real bugs:
autosave loops, `KeyValueTable` jitter, draft thrashing, dirty-state
misclassification, search-index recompute storms. The OData typing path
historically hit several of these and is the canonical motivating
example for the rule.

### 4.1 — Canonical hooks

Use the shared hooks from `electron-core-ui/src/renderer/hooks/`:

```ts
import { useDebouncedValue, useDebouncedCallback } from 'electron-core-ui/renderer'

// Mirror a controlled input value into a side-effecting consumer:
const debouncedUrl = useDebouncedValue(url, 250)
useEffect(() => {
  documentEvents.emit('request:updated', { id: requestId, url: debouncedUrl })
}, [debouncedUrl, requestId])

// Or wrap an effectful callback fired on every keystroke:
const onUrlChange = useDebouncedCallback((next: string) => {
  documentEvents.emit('request:updated', { id: requestId, url: next })
}, 250)
```

**Default delay: 250 ms.** Long enough to coalesce rapid typing, short
enough that the user perceives feedback as soon as they pause. Override
only with a justifying comment in the PR description and an inline comment
on the hook call site.

### 4.2 — What MUST be debounced

* URL field, request name, headers/query keys + values, body editor.
* Any new protocol-specific text field that mutates persisted state.
* Any field that fires `document:*:updated` events.
* Any field that triggers a search-index update or an IPC message.

What does **not** need debouncing:

* Pure controlled-input local state (no side effects beyond `setState`).
* Fields whose only consumer is a rendered preview (the React reconciler
  already coalesces).

### 4.3 — Mandatory E2E assertion

Per protocol, at least one feature scenario must assert that rapid typing
(10+ keystrokes within 100 ms) produces **at most a couple of state
mutations** at the consumer. Counting `document:request:updated` emissions
is the canonical proxy:

```gherkin
Scenario: Inputs are debounced
  When I type 10 characters into the URL field within 100 ms
  Then at most 2 document-update events are emitted for the request
```

The reusable scaffold in
[`restorm/tests/e2e/bdd/_scaffold/protocol-e2e-scaffold.ts`](../../tests/e2e/bdd/_scaffold/protocol-e2e-scaffold.ts)
already exposes the `Then at most N document-update events ...` step. Wire
your protocol's tab view into the assertion by giving the URL/keyword input
a stable `data-testid` of `<protocol>-request-url-input`.

---

## Section 5 — Docker mock service

Every new execution protocol needs a reproducible mock in
`restorm/tests/docker/docker-compose.yml`.

### 5.0 — Reuse an existing service FIRST (hard preference)

**Before adding any new container, check what's already in
`docker-compose.yml` and use it.** Several services already cover broad
surface and exist precisely for protocol testing — e.g. `moul/grpcbin`
(port 9000) provides unary **and** server/client/bidi **streaming** gRPC
echo, so a gRPC ticket should drive grpcbin directly and **not** add a new
mock. Only add a dedicated mock when an existing service genuinely cannot
exercise the behaviour you need, and say *why* in the PR. (raw WebSocket was
a legitimate case: a plain-WS client cannot echo against the Socket.IO
server's framing, so a tiny `ws-echo` server was added — but that was the
exception, justified in the ticket, not the default.)

### 5.1 — Image selection (only if 5.0 has no fit)

Prefer an official or widely-used image:

| Protocol | Suggested image |
| --- | --- |
| HTTP / OpenAPI | `swaggerapi/petstore` |
| GraphQL | custom Node 20 server (precedent: `restorm/tests/docker/graphql-server`) |
| WebSocket / Socket.IO | custom Node 20 server (precedent: `socketio-server`) |
| MQTT | `eclipse-mosquitto:2` |
| SOAP | `castlemock/castlemock` |
| gRPC | `moul/grpcbin` (echo) |
| Kafka | `confluentinc/cp-kafka` |
| Redis | `redis:7-alpine` |
| Git host | `gitea/gitea` |

Custom-built images only when no good official one exists. Pin a version
tag (`:7-alpine`, not `:latest`) so CI is reproducible.

### 5.2 — Compose conventions

* Container name prefixed with `restorm-` (`restorm-petstore`,
  `restorm-mqtt`, ...) so logs are unambiguous.
* Stable, distinct host port. Pick the next free one — grep the existing
  `docker-compose.yml` for `ports:` to confirm.
* Join the `restorm-tests` external network (already declared at the top
  of the compose file). No extra wiring required.
* Add a `healthcheck` when the image supports it. The integration suite's
  `pnpm docker:wait` polls for readiness; an explicit healthcheck cuts
  flake.
* Seed deterministic fixture data via a bootstrap script in
  `restorm/tests/docker/<protocol>-seed.sh` if the image needs setup
  beyond default config. Reference the script from compose with
  `command:` or `volumes:`.

### 5.3 — Documenting the mock

Add a one-paragraph block to your protocol's user-facing doc
(`restorm/docs/protocols/<protocol>.md`) explaining:

* Which image is used and why.
* Which port it binds to.
* What fixture data is seeded and how to refresh it.

This prevents future authors from second-guessing your choice when the
image goes EOL.

---

## Section 6 — CI integration

The test runner already spawns docker-compose in
`restorm/tests/e2e/global-setup.ts`. New services join automatically once
added to `docker-compose.yml` — no workflow change needed for the mock
itself.

### 6.1 — Workflow check

CI workflows in `.github/workflows/` (`build.yml`) have a `docker-compose
up` step indirectly via the restorm e2e job. Confirm:

* Your new service lands in the same `restorm/tests/docker/docker-compose.yml`,
  not a new file.
* The image pulls within CI's network policy (no private registry without
  credentials).
* The container starts in under ~30 s. If it doesn't, add a longer
  `start_period` on the healthcheck and budget for it in
  `pnpm docker:wait`.

### 6.2 — Optional opt-out flag

Provide an env var `SKIP_<PROTOCOL>_E2E=1` for machines that can't run the
container (precedent: the existing `SKIP_GITEA_E2E` flag). Wire it in
the relevant `before` hook of your feature file, and document the
flag in the protocol doc. This is a courtesy for contributors on
constrained environments — it does not change CI behavior, where the
flag is never set.

---

## Section 7 — E2E scenario template (the full matrix)

Every new protocol ships a feature file at
`restorm/tests/e2e/bdd/<protocol>/features/<protocol>-execution.feature`
that covers all of the checkpoints below. Adapt the wording to your
protocol's semantics — the scenarios are non-negotiable, the prose is yours.

A copy-paste starting point lives at
[`restorm/docs/contributing/templates/protocol-execution.feature.template`](./templates/protocol-execution.feature.template).
The reusable BDD steps are in
[`restorm/tests/e2e/bdd/_scaffold/protocol-e2e-scaffold.ts`](../../tests/e2e/bdd/_scaffold/protocol-e2e-scaffold.ts).

```gherkin
Feature: <Protocol> end-to-end

  Background:
    Given the <protocol> mock service is running

  Scenario: Import a spec / connect to a server
    When I import the <protocol> spec (or create a manual request)
    Then the sidebar tree shows the expected folders + requests

  Scenario: Navigate the imported tree
    When I click a folder and then a request
    Then the request tab opens with the expected shape

  Scenario: Run a request and see the response panel
    When I run the request
    Then the response panel shows status, headers (where applicable), body, duration
    And the response body is rendered in the default formatter
    And the JSONcrack visualization is available when the body is JSON

  Scenario: Run multiple requests and inspect history
    When I run the request three times
    Then the status bar history button surfaces 3 entries for this scope
    When I open the history panel
    Then the three entries are listed with timestamps + statuses
    When I click an entry
    Then the response panel shows that entry's response
    And I can see request-time metadata (headers, timing)

  Scenario: Env variable / Handlebars substitution (mandatory, see Section 3)
    Given I have an env variable "host" with value "<mock-host>"
    When I use "{{host}}" in the request URL / body / headers
    And I run the request
    Then the mock service receives the substituted value

  Scenario: Cancellation
    When I trigger a long-running call
    And I cancel it mid-flight
    Then the request is aborted cleanly
    And the response panel reflects the cancellation state

  Scenario: Inputs are debounced (mandatory, see Section 4)
    When I type 10 characters into the URL field within 100 ms
    Then at most 2 document-update events are emitted for the request

  # Protocol-specific scenarios (streaming, batch, subscriptions, ...)
  Scenario: <protocol-specific>
    ...
```

BDD step location:

* Generic, cross-protocol steps → `electron-core-ui/src/main/testing/playwright-bdd/`.
* Protocol-specific steps → `restorm/tests/e2e/bdd/<protocol>/steps/`.

---

## Section 8 — UI verifications the E2E must hit

For every run of a request, the feature file asserts these UI elements.
Use `data-testid` attributes (per CLAUDE.md), not text selectors — text
breaks under i18n, and the project ships in multiple languages.

| Element | Selector convention |
| --- | --- |
| Response panel root visible | `data-testid="response-panel"` |
| Status / statusText (HTTP-like) | `data-testid="response-status"` |
| Duration | `data-testid="response-duration"` |
| Headers section (when applicable) | `data-testid="response-headers"` |
| Body section visible | `data-testid="response-body"` |
| JSON renders in JSONcrack + Monaco formatter | `data-testid="response-jsoncrack"` / `response-monaco` |
| Streaming protocols: per-frame entries | `data-testid="response-stream-frame-<n>"` |
| Batch protocols: per-child results | `data-testid="response-batch-child-<n>"` |
| History entry count | `data-testid="statusbar-history-count"` |
| Clicking a history entry swaps the displayed response | (assert on `response-body` content change) |
| Navigation between history entries keeps the editor consistent | (assert request-editor inputs unchanged) |
| No hand-rolled UI primitives | grep the rendered tree for ecu component class names; PR review verifies |

When in doubt about the exact selector, grep the existing HTTP / OData /
GraphQL tab views — they are the reference implementations
([Section 12](#section-12--reference-implementations)).

### 8.1 — Code-snippet examples must be relevant (not just present)

The request panel's **"code examples"** tab renders, per protocol, a set of
ready-to-run snippets in several languages from a Handlebars template in
`CodeSnippetGenerator` (`src/main/resources/templates/code-snippets-<proto>.hbs`).
A new protocol must add its template AND wire its template variables in
`generateCodeSnippets`. **Verify every language entry actually renders a correct
snippet** — this is a recurring trap:

* **No empty output.** The template branches on the exact variables the generator
  passes. A name mismatch (generator passes `protocol`, template tests
  `isNativeWebSocket`) makes every branch silently evaluate false and the snippet
  renders blank. Open the tab for a real request and read each entry.
* **Values are resolved.** Every interpolated field (URL/host, method, message,
  headers/metadata, topic/event, …) must go through `transformValue` so the
  snippet shows the env-/Handlebars-resolved value, never a literal `{{var}}`.
* **Protocol-correct flags.** e.g. a gRPC `grpcurl` snippet needs `-plaintext`
  for an insecure server; a streaming call should read sensibly per call type.

Treat the snippet tab as a first-class output surface — a blank or `{{var}}`-leaking
snippet is a bug, exactly like a blank response panel.

---

## Section 9 — Import adapter specifics

For tickets that ship a new import format (with or without a new execution
protocol), the import side has its own contract. See
[`adding-an-import.md`](./adding-an-import.md) for the full version. Quick
reminder:

* Implement `ImportAdapter.extractNormalizedSpec`. If a
  `NormalizedSpec` shape isn't available in the codebase yet, fall
  back to the inline pattern used by `SwaggerImportService`.
* Auto-detection lives in the adapter, not in `ImportManager`. Sniff
  leading bytes, root field, extension — whatever is unambiguous for your
  format.
* Plug into the idempotent re-import pipeline so re-importing the same
  spec is a no-op, not a duplicate insert.
* If the format carries enums, wire into the custom-vs-imported
  reconciliation so user edits survive re-import.
* Commit a fixture under `restorm/tests/unit/fixtures/<format>/` and a
  unit test under `restorm/tests/unit/<Format>ImportService.test.ts`.

---

## Section 10 — Documentation checklist

Three doc surfaces, all mandatory:

1. **User-facing doc** under `restorm/docs/protocols/<protocol>.md`
   (or `restorm/docs/imports/<format>.md` for import-only tickets).
   Cover: what the protocol is, how to use it in Restorm, supported
   features, gotchas, and the docker-mock notes from Section 5.
2. **Dev note** in `electron-core-ui` *only if* you added a shared
   helper or hook there. Add it next to the implementation, not in a
   separate folder.
3. **Index update** in `restorm/docs/protocols/index.md` so the new
   protocol shows up in the rendered docs sidebar.

If a welcome-screen redesign is live when your ticket lands, add a
one-liner there too.

---

## Section 11 — PR review checklist

The protocol PR template at
[`.github/PULL_REQUEST_TEMPLATE/protocol.md`](../../../.github/PULL_REQUEST_TEMPLATE/protocol.md)
auto-populates this checklist on new PRs that opt into it (append
`?template=protocol.md` to the PR URL). Tick every box before requesting
review.

```
- [ ] Only `electron-core-ui` components used for UI (no bespoke primitives).
- [ ] Every user input supports `{{handlebars}}` via `VariableInputBox` / Monaco contribution.
- [ ] Every user input is resolved via `ContextService.transformValue` at execution time.
- [ ] Every user input is debounced (~250 ms default) before triggering side effects.
- [ ] Docker mock added to `docker-compose.yml`.
- [ ] E2E feature file covers all scenarios in Section 7, including the debounce assertion.
- [ ] Response panel assertions (status / headers / body / JSONcrack / history) covered.
- [ ] Response history builder added in `ResponseHistoryService`.
- [ ] User + dev docs updated.
```

---

## Section 12 — Reference implementations

When in doubt, follow the closest existing precedent. Read the
reference files alongside this playbook:

| Protocol | Reference files |
| --- | --- |
| REST / HTTP | `restorm/src/main/services/HTTPExecutionService.ts`, `restorm/src/renderer/src/components/RequestTabViews/HTTPRequestTabView.tsx` |
| GraphQL | `restorm/src/main/services/GraphQLExecutionService.ts`, `restorm/src/renderer/src/components/RequestTabViews/GraphQLRequestTabView.tsx`, `restorm/src/main/services/import/GraphQLImportService.ts` |
| raw WebSocket | `restorm/src/main/services/WebSocketExecutionService.ts` (`connectStreamingRaw`), `restorm/src/renderer/src/components/RequestTabViews/WebSocketRequestTabView.tsx`. Scenario slice (the [Section 13](#section-13--scenario-graph-integration-streaming--bound-protocols) reference): `nodes/WebsocketNodeBoxes.tsx`, `tests/e2e/bdd/websocket-execution/`, `tests/docker/ws-echo-server/`. |
| Socket.IO | `WebSocketExecutionService.ts` (`connectStreaming`, `socketio` protocol) + `WebSocketRequestTabView.tsx`; scenario nodes in `nodes/SocketioNodeBoxes.tsx`, `tests/e2e/bdd/socketio-execution/`. The canonical streaming reference for a NEW protocol's [Section 13](#section-13--scenario-graph-integration-streaming--bound-protocols) work. |
| MQTT | _planned_ — uses the `eclipse-mosquitto:2` mock in `restorm/tests/docker/docker-compose.yml`. |
| SOAP | `restorm/src/main/services/SOAPExecutionService.ts`, `restorm/src/main/services/import/SoapImportService.ts`, `restorm/src/renderer/src/components/RequestTabViews/SoapRequestTabView.tsx` |
| gRPC | `restorm/src/main/services/GRPCExecutionService.ts`, `restorm/src/main/services/import/GrpcImportService.ts`, `restorm/src/renderer/src/components/RequestTabViews/GrpcRequestTabView.tsx` |
| OData | `restorm/src/main/services/HTTPExecutionService.ts` (OData mode), `restorm/src/main/services/import/ODataImportService.ts`, `restorm/src/renderer/src/components/RequestTabViews/ODataRequestTabView.tsx`, `restorm/tests/docker/odata-petstore/` |

Pick the closest semantic match (HTTP-shaped → OData; streaming →
WebSocket; binary → gRPC) and use it as a structural guide, not a
copy-paste template. The shape evolves; the rules in Sections 2–4 do
not.

---

## Section 13 — Scenario-graph integration (streaming & bound protocols)

A protocol is not "done" when its request panel executes. It must also be a
first-class citizen of the **scenario graph** — the same vertical slice Socket.IO
(TASK-66.1) and raw WebSocket (TASK-66.6) shipped. This is the section most
easily forgotten; every item below was a real gap caught in review on those two.

See also the companion playbook
[`adding-a-scenario-node.md`](./adding-a-scenario-node.md) for the per-node
mechanics. **A request-bound protocol shows up in a scenario one of two ways:**

- **Unary / one-shot** (HTTP, GraphQL, SOAP, OData, gRPC-unary): binds like an
  `httpRequest` node — one box, `config.requestId`, a `response` output.
- **Streaming / long-lived** (Socket.IO, raw WebSocket, gRPC server/client/bidi,
  MQTT): a **connect** node opens a long-lived connection and re-emits each
  received frame on a `message` port; for **bidirectional** transports add a
  **send** node (push a payload, no channel) and a **close** node — the
  `connect / send / close` triplet, mirroring `websocketConnect/Send/Close`.

### 13.1 — Scenario action nodes + engine

- [ ] Add the kind(s) to the `ScenarioNodeKind` union (`shared/types/scenario.ts`)
      and their ports (`shared/scenarioNodePorts.ts`). A raw connect has a single
      `message` output (no named events); a multiplexed one (Socket.IO) derives
      `event:<name>` ports + an `others` catch-all.
- [ ] **Port ↔ data coherence (check this deliberately).** Every input/output
      port must match the data the action actually sends or receives — both its
      direction (`value` / `signal` / `both`) and the shape downstream/upstream
      nodes expect. A `send` node's `payload` input must accept the payload type;
      a connect node's received-frame output (`message` / `event:<name>`) must
      emit exactly the parsed frame a JSON-path picker will bind against; a
      signal-only completion is a `signal` port, not a data port. A mismatched or
      mislabelled port silently produces empty/garbled data in wired nodes and a
      misleading inspector preview — verify against a real run before freezing
      anything.
- [ ] Executors (`scenarioEngine/executors/`) + registry. A connect executor
      hands the scheduler a scope-action carrying a **transport/mode
      discriminator** (cf. `transport: 'socketio' | 'websocket'`); the scheduler
      routes received frames to the `message` port and the engine bridge picks
      the matching streaming service method (`connectStreaming` /
      `connectStreamingRaw` / …).
- [ ] **Stop / abort must cancel the live connection** (close the socket / cancel
      the RPC) — reuse the universal `done`/abort machinery; never leak a socket.
- [ ] Kind docs in `shared/scenarioKindDocs.ts` + the MCP `describe_scenario_kinds`
      catalogue (`SCENARIO_KINDS`), so `create_scenario_node` / `connect_scenario_nodes`
      can author the nodes.

### 13.2 — Inspector preview from history

- [ ] Register the connect kind in `previewResolvers` (`mcp/tools/scenarioRun.ts`)
      — reuse `resolveStreamConnectPreview`. It reads the **freshest SUCCESSFUL**
      entry from the bound request's history (`freshestSuccessfulEntry` — the
      first `success === true`, NOT just the latest) and surfaces the latest
      received frame, so an edge leaving the `message` port gets a JSON-path
      picker over real data. (Forgetting to register the kind = a blank preview;
      this was missed first on `websocketConnect`.)
- [ ] The executor must persist received frames to `ResponseHistoryService`
      (`storeExecutionResult`) — that history is what feeds the preview, the
      request panel's replay, AND the golden's data.

### 13.3 — Request ↔ scenario navigation (BOTH directions)

- [ ] **Node → request**: on the connect node box, an "Edit request" link
      (`Button externalLink`, `data-testid="scn-request-edit-link"`,
      `data.onOpenItem(requestId)`) as `RequestNodeBox` renders; and in the
      inspector, register the kind in the `openItemId` / title+badge branches of
      `ScenarioEditorView` so the inspector header links to the bound request.
- [ ] **Request → scenarios**: add the kind to `REQUEST_BINDING_KINDS` in
      `services/scenarioRequestUsage.ts`. That single set drives BOTH the request
      panel's "used in scenarios" reverse-nav button AND the generic
      delete → move-request-into-scenario flow (`collectRequestScenarioRelations`).
      The button + flow are already protocol-agnostic; only the node-kind scan
      needs the new kind. **A request bound only by a non-listed node kind has no
      back-link and silently won't trigger the move-on-delete dialog.**

### 13.4 — Palette, catalogue, drag-drop, i18n

- [ ] `onDrop` (`ScenarioEditorView`): dragging a request of this protocol maps
      to the right node kind (streaming → connect node; unary → request node).
- [ ] `scenarioNodeCatalogue.ts` + the node-component registry (`nodes/index.ts`).
- [ ] Add an **action** section to the scenario "Add" palette
      (`scenarioChildPalette.tsx`) — same badge as the sidebar, a `connect / send /
      close` badge triplet for bidirectional transports. Do **not** add a
      request-creation entry for a streaming protocol (it's redundant with the
      action nodes — the WebSocket one was removed for exactly this reason).
- [ ] **Palette coherence audit**: no duplicate entries, all expected entries
      present, badges consistent with the sidebar + board headers.
- [ ] i18n: `scenario.nodes.<kind>` + `scenario.help.<kind>` (test-enforced) +
      any new port labels, across **all 27 locales** — translate `fr`, English
      placeholder elsewhere (mirrors the existing streaming kinds).

### 13.5 — Demo scenario, Bestiary, goldens

- [ ] A **valid demo scenario** exercising the protocol — bidirectional →
      WebSocket/Socket.IO-style connect→send→receive→close; unary → an HTTP-style
      request. Serialize any async frames with `wait` nodes so the run-log is
      **deterministic** (otherwise the golden flakes).
- [ ] Chain the demo into the **Main** orchestrator scenario.
- [ ] Add the new action boxes to the **Bestiary** catalogue scenario.
- [ ] **Play the request(s) at least once to populate history, and confirm the
      data surfaces in the scenario editor's inspector preview BEFORE freezing**
      the golden (the whole point — a golden over empty data proves nothing).
- [ ] Add the demo to the run-log E2E feature list and regenerate **both**
      `…main-runlog.yaml` AND `…main-suggestions.json` (Main gains a node).
      Goldens via `UPDATE_RUNLOG_GOLDEN=1` / `UPDATE_SUGGESTIONS_GOLDEN=1`.

### 13.6 — Request-execution E2E + close-out

- [ ] A request-panel execution E2E (new Playwright project + a dedicated
      `<proto>-sample.restorm`), mirroring `tests/e2e/bdd/socketio-execution` /
      `websocket-execution`: connect/start, send + receive, server-push, cancel/
      disconnect, asserting button states + stream bubbles. Gitignore the
      runtime `*.responses.zip`.
- [ ] **Fix any gap found while writing the tests, here** (same clause as the
      execution matrix). The raw-WS Send button (rendered only for `socketio`)
      and the missing navigation links were both found exactly this way.
- [ ] `lint` + `typecheck` + an independent PR review over the whole diff.

> Reference files for this section: `services/scenarioRequestUsage.ts`,
> `components/Scenario/nodes/SocketioNodeBoxes.tsx` +
> `WebsocketNodeBoxes.tsx`, `mcp/tools/scenarioRun.ts` (preview resolvers),
> `tests/e2e/bdd/{socketio,websocket}-execution/`, `tests/docker/ws-echo-server/`.

---

## Section 14 — Server / long-running actions: scenario node, reference scenario, listening beam

A protocol that can **host a server** (an HTTP mock, a Socket.IO / raw-WS / MQTT
server) or otherwise **runs long-lived** carries three extra obligations beyond
Section 13. All were real gaps caught in validation — they are now mandatory.

### 14.1 — A server is a DISTINCT long-lived scenario node, never a request-with-a-flag

A server is **fundamentally different** from a one-shot request: a request is a
client that calls out once and returns a `response`; a server **listens
indefinitely** and the scenario must NOT complete until it is stopped (the action
stays in-progress, exactly like a WS server). So a server gets its **own scenario
node kind** with its **own executor and engine/scheduler path** — do NOT reuse
the one-shot request node's execution with a `server` flag, and do NOT share
request-execution code between them. (The only acceptable sharing is the GUI /
editor box, since the panels may look alike — and only if it genuinely helps.)

Concretely, mirror the HTTP mock's `httpListen` / `httpClose` pair (which itself
mirrors `websocketConnect` / `websocketClose`):

- A **listen** kind (e.g. `httpListen`) bound to the `server: true` request.
  Ports: **`connected`** (a PURE SIGNAL — fires once the server is listening),
  **`served`** (`flow: 'both'` — re-emits each served request's
  `{ request, response }` data, the analogue of a received frame), and the
  universal **`done`** (fires when the server STOPS). There is **NO `response`
  output** — a server serves, it does not call out.
- A **close** kind (e.g. `httpClose`) that stops the server named by
  `config.connectionNodeId`, firing that listen node's `done`.
- The listen executor hands the scheduler an `openSocketioConnect` scope action
  with the protocol's own `transport` discriminator, so the run stays alive
  (`pendingReentry`) until the close (or a Stop). Route the transport's
  `onMessage` to the right output port in the scheduler.
- Wire EVERY kind-enumeration site (the type-checker enforces most): the
  `ScenarioNodeKind` union, `scenarioNodePorts`, `scenarioKindDocs`, the
  node-box registry + a box component, `scenarioNodeCatalogue`, the scenario
  **palette** ("Serveur HTTP" / "Fermeture HTTP" — a server request entry that
  drops the bound listen node + a close action section), the executor registry,
  the engine connect-bridge dispatch, the MCP `SCENARIO_KINDS`, and the
  `scenario.nodes.*` + `scenario.help.*` strings across **all 27 locales**
  (`scenario.help.*` is test-enforced).

### 14.2 — Add it to the reference scenarios (`scenarios-e2e-reference-tests.restorm`)

The server MUST appear in
`restorm/tests/e2e/samples/scenarios-e2e-reference-tests.restorm` as a **Main
sub-scenario** that both **hosts in-scenario AND is consumed in the same run**.
The canonical shape (the HTTP Server sub-scenario):

- the **listen** node → a short `wait` wired on its **`connected`** output (so the
  consumer only fires once the server is up, keeping the run-log deterministic) →
  a **consumer** request node that fetches the server → a `log`;
- a **close** node wired on the listen node's **`served`** output (stop once a
  request has been served), and optionally a `log` on the listen node's `done`.
- A `runScenario` node in **Main** calling the sub-scenario, chained `done` → `in`
  after the previous server sub-scenario, plus a standalone Examples row in
  `tests/e2e/bdd/scenario-runlog/features/scenario-runlog.feature`.

Then regenerate **both** goldens and **verify each without the UPDATE flag**
(a golden is written from whatever the app emits — including a recorded failure —
so re-run clean + READ it):

- run-log: `UPDATE_RUNLOG_GOLDEN=1` (then re-run plain + read — confirm the listen
  node reports `connected`, the consumer receives the served response, the close
  stops it, and there is no `EADDRINUSE` and no `response` output on the server);
- suggestions: `UPDATE_SUGGESTIONS_GOLDEN=1`, regenerated **LAST** (it compares
  node IDs exactly — do not re-edit the `.restorm` after).

Pick a port distinct from the others (SIO `3001`, raw-WS `3002`, MQTT, the HTTP
mock's `8077`) so two server sub-scenarios never collide.

### 14.3 — The running beam orbits BOTH badges

The yellow→green "running" beam that signals an open server / connection MUST
spin around the protocol badge in **both** places it appears:

- the **sidebar tree** row (`FolderToListView`), and
- the **workbench tab** title (`RestormWorkbench`).

Drive both from the **same listening state**. The shared mechanism is
`ServerListeningBadge` (in `components/common/`), which wraps a badge in the
generic `BeamWrap` and lights it while the request is listening — it ORs every
protocol's listening store (`websocketListeningStore` / `grpcListeningStore` /
`httpListeningStore`, all fed by the per-protocol `*:request-progress` stream).
A new long-running protocol adds its listening store (mirror the existing ones)
to that OR, and reuses `ServerListeningBadge` in both render sites — never a
bespoke per-protocol badge. Shipping the beam on only the sidebar (the tab badge
left static) is a fault, not a nit.

---

## Trial-run acceptance

The doc is "done" when a reviewer who didn't write it can take a hello-
world protocol (e.g. a fictional `Echo` protocol over TCP), follow this
playbook end-to-end, and reach a green E2E run without asking the author
a single question. If they get stuck, the playbook is the bug — patch it
and re-run the trial.
