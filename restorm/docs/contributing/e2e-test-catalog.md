# E2E test catalog

Authoritative index of every Playwright end-to-end suite: what it covers and
what it depends on. **This file is part of the contract:**

- **Devs** — when you ADD or materially change an e2e suite, you MUST update the
  matching row here (add the suite, adjust its coverage/deps). A test without a
  catalog entry is an incomplete change.
- **Reviewers** — before GO, confirm the dev added/updated the catalog entry for
  any e2e they touched, and use this catalog to tell the dev **which existing
  suites their change may affect** (recorded in the ticket at refinement).
- **Devs, before "done"** — run the suites the reviewer flagged as affected +
  your new/changed suites (xvfb on the headless host), NOT the whole suite. The
  milestone-branch push then only CONFIRMS.

Suites live under `restorm/tests/e2e/bdd/<suite>/features/*.feature` (+ steps).
Each is a Playwright project registered in `playwright.config.ts` (guarded by the
`e2eBddSuiteRegistration` unit test). Run one with
`xvfb-run -a pnpm exec playwright test --project=<suite>`.

Legend for **Deps**: 🐳 = Docker mock required (tests/docker/docker-compose.yml);
🏠 = self-hosted in-process mock (no Docker); 🔌 = drives the app via the MCP
server; — = pure UI/in-process.

## Execution protocols (send a request, assert the response/history)

| Suite | Scen | Covers | Deps |
|---|--:|---|---|
| http-execution | 33 | HTTP/REST execution end-to-end (methods, redirects, history, errors, file body, activity beam stops) | 🏠 |
| graphql-execution | 15 | GraphQL execution end-to-end | 🏠 |
| graphql-operation-name | 3 | operationName / multi-operation selection | 🏠 |
| grpc-execution | 11 | gRPC unary + streaming execution | 🐳 grpcbin |
| soap-execution | 9 | SOAP execution end-to-end | 🏠 |
| trpc-execution | 10 | tRPC over HTTP execution (+ env-var suggestions) | 🏠 |
| odata-execution | 8 | OData query options, CRUD, batch, v2 envelope | 🏠 |
| kafka-execution | 7 | Kafka produce/consume/offset, live-consume stays alive + delivers | 🐳 kafka 🔌 |
| sse-execution | 5 | Server-Sent Events execution | 🏠 |
| redis-execution | 2 | Redis pub/sub + commands | 🐳 redis |
| amqp-execution | 1 | AMQP / RabbitMQ publish/consume | 🐳 rabbitmq |
| stomp-execution | 1 | STOMP over WebSocket | 🐳 activemq |
| mqtt-execution | 1 | MQTT execution | 🏠 broker |
| socketio-execution | 1 | Socket.IO execution | 🏠 |
| websocket-execution | 1 | Raw WebSocket execution | 🏠 |
| jsonrpc-execution | 1 | OpenRPC import → run a JSON-RPC request | 🏠 |

## Import formats (import a spec/collection → assert the request tree)

| Suite | Scen | Covers | Deps |
|---|--:|---|---|
| odata-import | 4 | OData multi-version metadata + JSON-CSDL | — |
| raml-import | 4 | RAML import | — |
| har-import | 3 | HAR (HTTP Archive) auto-detect + tree | — |
| restorm-import | 3 | .restorm project merge — wrapper folder, self-import duplication, save+reopen | — |
| paw-import | 3 | Paw JSON export import | 🏠 live API |
| wadl-import | 3 | WADL import | — |
| thrift-import | 3 | Thrift IDL (documentation-only) | — |
| api-blueprint-import | 3 | API Blueprint resource groups/requests | — |
| smithy-import | 3 | Smithy JSON AST + .smithy IDL auto-detect | — |
| openapi-import | 2 | OpenAPI 3.x import | — |
| httpie-import | 2 | HTTPie Desktop collections + CLI sessions | — |
| thunder-client-import | 2 | Thunder Client import | — |
| typespec-import | 2 | TypeSpec → compile via tsp → OpenAPI importer | — |
| swagger-import | 1 | Swagger import with enum support | — |
| postman-import | 1 | Postman workflow → scenario execution | — |
| rest-client-import | 1 | REST Client (.http) import | — |

## Self-hosted mock servers (restorm hosts the server the test hits)

| Suite | Scen | Covers | Deps |
|---|--:|---|---|
| graphql-server | 1 | GraphQL mock server end-to-end | 🏠 |
| grpc-server | 1 | gRPC mock server end-to-end | 🏠 |
| http-server | 1 | HTTP mock server end-to-end | 🏠 |
| odata-server | 1 | OData mock server end-to-end | 🏠 |
| soap-server | 1 | SOAP mock server end-to-end | 🏠 |

## Scenarios (dataflow-graph orchestration + run-log goldens)

| Suite | Scen | Covers | Deps |
|---|--:|---|---|
| odata-petstore | 5 | OData import + send + filter (petstore) | — |
| scenario-code-deps | 2 | Code-node external deps (offline chained golden) | — |
| scenario-runlog | 57 | Scenario run-log golden matrix (all node kinds + every protocol sub-scenario + Main + the value+done join, where a consumer is wired to both an upstream node's data output AND its `done` signal) | 🏠 |
| scenario-quick-config-selector | 1 | Request-action config selector stays live | — |
| scenario-setvariable-override | 1 | setVariable overrides an env-folder var downstream | — |
| scenario-input-prompt | 4 | Run-parameters modal: the answer wins over the input default AND the request's own path param (string / number / enum / custom-list) | 🐳 petstore |
| scenario-suggestions | 1 | Scenario inspector data suggestions | — |
| secrets-sources | 1 | Secret-source scenarios → stable run-log | — |

## UI / workbench / lifecycle

| Suite | Scen | Covers | Deps |
|---|--:|---|---|
| full-workflow | 9 | Full workflow (bounds, new-file, imports, MRU tabs, sidebar Add submenu) | — |
| exhaustive-doc-viewer | 6 | Exhaustive documentation-viewer behaviour | — |
| settings-tab | 7 | Settings surface follows the workbench (+ Toggle keyboard focus ring) | — |
| firewall-exemptions | 5 | The app's own phone-home destinations: the panel exposes only the whitelist/blacklist, and consent OFF ⇒ endpoint declared but not exempted / ON ⇒ exempted | — |
| dirty-state | 6 | Dirty-state propagation across nested units | — |
| design-shell | 6 | Design tab shell: single tab per design refocused on the sidebar group entry's section, icon-rail section switching with filterable lists, virtual sub-entry drag refusal (file untouched), smartbar favourite + reopen from the pane, settings editable on EVERY plan (the plan gates serve/codegen, not editing), context-menu open-in-split-panel | — |
| design-dirty-state | 3 | API-design edits ride the standard dirty/autosave pipeline: dirty round-trip (edit → `*` → save → clean → reopen intact), every top-level design section marks dirty (no silent surface), autosave persists a design edit with no manual save | — |
| design-models | 7 | Models & enums editor: full model+property creation persisted to file (round-trip), reference-typed relation with delete rule + "Used by" jump navigation, inheritance (read-only parent rows, jump to parent, cycle-free candidate list), row+sidebar validation errors that clear on fix, parent-model deletion with impact modal, enum created in the Enums section typing a property, named examples (seeded auto values, constraint-violating value refused with message) | — |
| design-creation | 3 | Design creation entry points: blank design from the EmptyBench button (file-asserted), pre-filled design derived from a documented env folder's context menu (models/enums/routes checked, nested INSIDE the folder in the saved file), and {{variable}} resolution of the design's base URL per the picked environment | — |
| design-docviewer | 3 | Design documentation viewer: the Documentation section renders through the SHARED DocumentationHost (same testids as an imported API's doc — route blocks by operation slug, model-graph nodes), reflects design edits live (model renamed in the Models section → re-projected on return), and carries edit links jumping from the readable doc to the editable cards (model node → Models card, route header → Routes card) | — |
| design-export | 3 | Descriptor export: the Settings combo + download button emit an OpenAPI 3.1 document that the real validator accepts (spec-spelled paths, all components, servers carrying the base path, zero x-restorm/intents, save-path status); the import→design→export chain preserves the Petstore's path surface and component names; and the loop closes over the network — the spec SERVED by the design server re-imports through the import modal as a plain API | — |
| design-codegen | 3 | Sandboxed code generation from the Code section: a LOCAL Copier-format fixture template renders in the Pyodide sandbox (cold boot budgeted — 7 min project timeout), the preview lists the tree, confirmation writes it under the folder picked through the (mocked) system open-folder dialog, and the rendered files carry the design's data; an invalid design (duplicate route) disables Generate with the explanation; Community sees the DESIGN_RUN gate on the generate control | — |
| design-mcp | 5 | Design MCP exposure (agent loop): a design built entirely over MCP (model + identifier + searchable property + enum + named example + generated CRUD, zero validation issues) is served and called back through an MCP-created Restorm request (200 + example value, live counters, clean stop) with post-write search coherence (created entities findable, deleted ones swept); the served design projects into GraphQL/SOAP/OData on the same port (protocol-typed Restorm requests get the example back, $metadata + WSDL served, UI protocol pills toggle the projections); Community edits freely but serve_design refuses payment_required; an unsaved UI title edit survives an MCP enum write (the existing writes' coherence contract); MCP serve/stop reflect on the UI spin button state | — |
| design-search | 4 | Global search over designs: models/enums/routes surface as typed results under the design category (symbol-color icon), a description-only term finds its route, selecting a model result re-opens the Design tab positioned on that card (single-tab intent), and a rename reindexes so the new name matches | — |
| design-server | 6 | Design server (full product loop — REAL Restorm requests against the served API): spin from Settings opens the tab-scoped run panel (routes + zeroed counters) with the serving beam on the sidebar badge and a clean stop; served responses (paginated example list, single named example, 400 with constraint detail on an invalid body, 401 without the group's bearer) with per-route call counters; hot steering (force 404 from the panel, back to the design response) without restart; self-describing /swagger.json; an invalid design disables the spin (blank model name, then restored); a busy port surfaces a clean error | — |
| design-routes | 7 | Routes editor: group+route by hand with `{{param}}` rows auto-created from the pattern and the fully-resolved path line, model-linked parameter inheriting type/format (auto description badge) and surviving a property rename by stable id (file-asserted), responses-by-code accordion with standard errors minting the shared Error model, body combo emptied by model deletion, CRUD generator (group + 5 linked routes), searchable properties generating linked query params on the list route, route settings persisted (cache/deprecated) + inherited-block jump to the group | — |
| file-format-gate | 6 | `fileFormatVersion` gate: current version opens, future version refused (file untouched byte-for-byte), missing/legacy-position version refused, lazy 1→1.1 bump (design-less project saves at 1; a project carrying a design opens, saves at 1.1 and reopens intact) | — |
| status-bar-context-menu | 6 | Status bar file-path popover actions: reveal in OS file explorer, copy file name, copy full path, popover closes after each action, no-file-open state, reveal-channel path containment | — |
| documentation-viewer | 4 | Documentation viewer interactions | — |
| quick-settings | 13 | Quick-config save/load round-trip every protocol field + app-wide popover exclusivity | — |
| sidebar-split-drop | 3 | Sidebar → workbench drag opens a split view | — |
| sidebar-dnd | 10 | Sidebar multi-selection + drag & drop — multi-drop on container, root move (rows + empty area), incoherent refusal (own subtree, env-folder nesting), hover-expand with disarm, requests→scenario canvas, no overlay on multi, tab-activation moves the sidebar selection (sync-with-active-tab) | — |
| sidebar-clone | 3 | Sidebar "Clone" recursive id independence: request / quick-configs / env-folder (nested request, custom value list, enum definition, cross-scenario runScenario, connectionNodeId) — clone-then-rename-the-original leaves the clone unaffected, both stay distinctly searchable | 🔌 |
| menubar-context | 3 | Contextual menu-bar menus (Requête / Serveur / Scénario) exist exactly while the matching tab is active; deleting a folder walks each subtree request bound by an OUTSIDE scenario through the used-by-scenarios dialog before deleting (box stripped on delete-anyway), and asks nothing when the binding scenario dies in the same subtree | 🔌 |
| file-external-change | 4 | Open-file watch: an external rewrite raises the timerless reload/keep-mine toast (reload reflects disk, keep-mine actually overwrites even when not dirty), the app's own autosave never prompts, and an external secrets-sidecar write is re-applied silently | 🔌 |
| auth-login | 2 | Authentication routes end-to-end | 🏠 |
| fully-documented-petstore | 1 | Fully-documented Petstore fixture builder | — |
| theme-carousel-a11y | 1 | Theme preview cards keep Tab on the card only, never the abstract preview | — |
| monaco-suggest-dismiss | 1 | A `{{...}}` suggest popup opened in one request is gone after switching tabs, and still opens in the now-active field | 🔌 |
| monaco-handlebars-body | 2 | Handlebars in a request body produces no Monaco error marker (double / triple brace, single-line block, XML), while a genuinely broken payload still does; a construct nested in a quoted string is coloured as template syntax | 🔌 |

## MCP surface

| Suite | Scen | Covers | Deps |
|---|--:|---|---|
| mcp-server | 1 | MCP server end-to-end (JSON-RPC tools) | 🔌 |
| mcp-logs | 1 | MCP logs menu entry gated on the MCP server | 🔌 |

## Git (version control)

| Suite | Scen | Covers | Deps |
|---|--:|---|---|
| git-collab | 10 | Two live instances collaborating through one remote: dirty-state reactivity, behind-server handling, reset-to-server, per-field arbitration (quick settings, renames, deletions, tags, moves), terminal-checkout protection via the reload/keep-mine toast | 🐳 git-server |
| git-status | 1 | Detect repo → GIT status-bar push button enabled | 🐳 git-server |
| git-push-pull | 2 | Push lands on remote; collaborator pull with no conflict appears | 🐳 git-server |
| git-conflict | 6 | Provoked conflict → 4-panel resolve (all entity kinds + field-diffs), abort-merge keeps local work, pull-available toast, commit-message generation, live-action controls disabled in the conflict panel | 🐳 git-server |
| git-mcp | 3 | git_commit_push→confirm, git_pull→resolve_conflicts (agent-driven), and an MCP write right after open_project still reaches disk | 🐳 git-server 🔌 |

## Non-BDD e2e specs

Every spec here that spawns the app for a headless `--run` isolates its userData
directory per invocation (`RESTORM_USER_DATA_OVERRIDE` → a fresh `mkdtemp`). This
is mandatory, not optional: the single-instance lock is keyed on that directory,
so a run sharing it with any already-open Restorm window (a human validation
instance) loses the lock. The app now refuses such a run with a clear message and
a non-zero exit — but the isolation is what lets these suites pass regardless of
what else is open. No suite in this catalog requires the absence of a concurrent
instance.

| Spec | Covers |
|---|---|
| scenario-cli/scenario-cli.spec.ts | Headless CLI scenario runner (run-log goldens, exit codes, --param/--out, loud failure under a held single-instance lock) |
| auth-propagation/auth-propagation.spec.ts | Cross-instance live auth propagation: two real instances sharing one userData follow a login/logout written to the shared auth cache, live, no restart (watch → reload → broadcast). Backend-free — the session token is fabricated (decode-only client checks), so it proves the plumbing, not the JWT trust model (unit-tested separately) |
| stage-gating/headless-gating.spec.ts | Capability gating in headless mode |
| stage-gating/gating-lifecycle.spec.ts | Capability gating lifecycle |
