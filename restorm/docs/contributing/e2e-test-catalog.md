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
| http-execution | 27 | HTTP/REST execution end-to-end (methods, redirects, history, errors, file body) | 🏠 |
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
| odata-petstore | 4 | OData import + send + filter (petstore) | — |
| scenario-code-deps | 2 | Code-node external deps (offline chained golden) | — |
| scenario-runlog | 56 | Scenario run-log golden matrix (all node kinds + every protocol sub-scenario + Main) | 🏠 |
| scenario-quick-config-selector | 1 | Request-action config selector stays live | — |
| scenario-setvariable-override | 1 | setVariable overrides an env-folder var downstream | — |
| scenario-suggestions | 1 | Scenario inspector data suggestions | — |
| secrets-sources | 1 | Secret-source scenarios → stable run-log | — |

## UI / workbench / lifecycle

| Suite | Scen | Covers | Deps |
|---|--:|---|---|
| full-workflow | 7 | Full workflow (bounds, new-file, imports, MRU tabs) | — |
| exhaustive-doc-viewer | 6 | Exhaustive documentation-viewer behaviour | — |
| settings-tab | 6 | Settings surface follows the workbench | — |
| dirty-state | 5 | Dirty-state propagation across nested units | — |
| documentation-viewer | 4 | Documentation viewer interactions | — |
| quick-settings | 8 | Quick-config save/load round-trip every protocol field | — |
| sidebar-split-drop | 3 | Sidebar → workbench drag opens a split view | — |
| auth-login | 2 | Authentication routes end-to-end | 🏠 |
| open-folder | 2 | Open Folder | — |
| body-type-migration | 1 | Legacy body-type canonicalisation on load | — |
| fully-documented-petstore | 1 | Fully-documented Petstore fixture builder | — |

## MCP surface

| Suite | Scen | Covers | Deps |
|---|--:|---|---|
| mcp-server | 1 | MCP server end-to-end (JSON-RPC tools) | 🔌 |
| mcp-logs | 1 | MCP logs menu entry gated on the MCP server | 🔌 |

## Git (version control)

| Suite | Scen | Covers | Deps |
|---|--:|---|---|
| git-status | 1 | Detect repo → GIT status-bar push button enabled | 🐳 git-server |
| git-push-pull | 2 | Push lands on remote; collaborator pull with no conflict appears | 🐳 git-server |
| git-conflict | 6 | Provoked conflict → 4-panel resolve (all entity kinds + field-diffs), abort-merge keeps local work, pull-available toast, commit-message generation, live-action controls disabled in the conflict panel | 🐳 git-server |
| git-mcp | 3 | git_commit_push→confirm, git_pull→resolve_conflicts (agent-driven), and an MCP write right after open_project still reaches disk | 🐳 git-server 🔌 |

## Non-BDD e2e specs

| Spec | Covers |
|---|---|
| scenario-cli/scenario-cli.spec.ts | Headless CLI scenario runner (run-log goldens, exit codes, --param/--out) |
| stage-gating/headless-gating.spec.ts | Capability gating in headless mode |
| stage-gating/gating-lifecycle.spec.ts | Capability gating lifecycle |
