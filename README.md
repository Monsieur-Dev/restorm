# Restorm

**The local-first, secure, scriptable API testing environment.**

Restorm is a desktop application to **design, test and simulate APIs**, client
and server side. It imports any spec, chains your requests into visual
scenarios, runs them headless in CI, and keeps everything on your disk: your
tokens never leave your machine.

- Website: **https://restorm.app**
- Download (Linux, Windows, macOS, or the CLI via npm): https://restorm.app/download
- Documentation: https://restorm.app/docs
- Pricing: https://restorm.app/pricing — the client is free for individuals
  and teams under 10 people

## What it does

- **Multi-protocol.** HTTP/REST, GraphQL, gRPC and gRPC-Web, SOAP, OData,
  WebSocket, Socket.IO, Server-Sent Events, JSON-RPC, tRPC, Kafka, MQTT, AMQP,
  STOMP, Redis.
- **Import everything.** OpenAPI/Swagger, Postman, Bruno, Insomnia, HAR,
  HTTPie, REST Client, Thunder Client, Paw, RAML, WADL, API Blueprint, Smithy,
  Thrift, TypeSpec, OData metadata… and Restorm keeps the imported spec in sync.
- **Visual scenarios.** Chain requests in a dataflow graph, with step
  debugging, assertions and run logs.
- **Environments, variables, secrets.** Secrets resolve from environment
  variables, `.env` files or vaults, and never land in the project file.
- **Built-in outbound firewall.** Every request goes through an allow-list you
  control.
- **API designer and code generation.** Model an API, generate the client or
  server code from official or local templates.
- **Mock server and recording sessions.** Serve mocks for REST, GraphQL, SOAP
  and OData; capture the calls a web page makes from the built-in mini browser
  and turn them into replayable requests.
- **Automation.** Headless execution through the `restorm-cli` npm package and
  the [`restorm-action`](https://github.com/Monsieur-Dev/restorm-action) GitHub
  Action; an MCP server (`restorm-mcp`) so AI agents can drive the app.
- **Team work.** Projects are plain files meant to live in Git, with a
  built-in Git client.

## Licence

Restorm is **source-available, not open source**. The code is published so
that anyone can read it, audit its security and privacy properties, and
contribute. Production use, redistribution, forks and any circumvention of the
licensing mechanisms are prohibited. See [LICENSE](LICENSE) for the exact
terms, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## Repository layout

| Path | What it is |
|---|---|
| [`restorm/`](restorm/) | The application: Electron main process, React renderer, protocol executors, importers, scenario engine, MCP server. |
| [`electron-core-ui/`](electron-core-ui/) | The generic Electron + React foundation library Restorm is built on (components, theming, i18n, settings). |
| [`demo/`](demo/) | A minimal app used to exercise that library in isolation. |
| [`npm-cli/`](npm-cli/), [`npm-mcp/`](npm-mcp/) | The `restorm-cli` and `restorm-mcp` packages published on npm. |
| [`.github/workflows/`](.github/workflows/) | CI, release builds, store publishing, secret scanning. |

## Building and running from source

### Prerequisites

- **Node.js 20 or newer** (the repository pins the version in `.nvmrc`).
- **pnpm 10** — the exact version is in the `packageManager` field of
  `package.json`; `corepack enable` picks it up.
- **Docker** for the integration and end-to-end test suites (they run against
  local mock services).
- On Linux, `xvfb` for the end-to-end suite.

### Install and run

```bash
pnpm install                  # installs every workspace package
pnpm run dev:restorm          # Electron + Vite dev server with hot reload
```

To open a sample project straight away:

```bash
pnpm --filter restorm run dev:petstore
```

If Electron reports `Electron uninstall` on a fresh checkout, its binary was
not extracted; run `node install.js` inside
`node_modules/.pnpm/electron@<version>/node_modules/electron`.

### Build and package

```bash
pnpm run build                            # builds the library, the demo and the app
pnpm --filter restorm run package         # unpacked build in restorm/dist-electron/
pnpm --filter restorm run dist            # installers for the current platform
```

Packaging uses electron-builder; the per-platform targets are in the `build`
section of `restorm/package.json`. Signed and notarized builds are produced by
the release workflow, unsigned local builds work without any secret.

### Tests and checks

```bash
pnpm run lint                             # eslint, zero warnings
pnpm run typecheck                        # tsc --noEmit across the workspace
pnpm run test                             # unit tests (vitest)
pnpm run restorm:docker:up                # starts the mock services
pnpm --filter restorm run test:integration
pnpm --filter restorm run test:e2e        # Playwright, wrapped in xvfb on Linux
pnpm run restorm:docker:down
```

The git hooks in [`.husky/`](.husky/) run the fast checks and a gitleaks
secret scan on every commit, and the full end-to-end suite before every push.

## Documentation for contributors

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to work in this repository.
- [`restorm/docs/contributing/`](restorm/docs/contributing/) — playbooks:
  adding a protocol, an import format, a scenario node, a value source, a
  code template.
- [`restorm/docs/`](restorm/docs/) — protocol notes, import formats, the
  firewall, the mock server, the MCP server, the Git integration.

Contributions are welcome under the terms of the licence (section 4). Open a
pull request against `main`; CI runs lint, typecheck, unit and integration
tests on every pull request.

## Contact

contact@restorm.app
