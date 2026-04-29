# Monorepo

Three packages live here:

1. **[electron-core-ui](./electron-core-ui/)** — generic Electron + React
   foundation library: UI components, theming, logging, window state, i18n.
   Project-agnostic; no app-specific code allowed (see
   [`electron-core-ui/CLAUDE.md`](./electron-core-ui/CLAUDE.md)).
2. **[restorm](./restorm/)** — HTTP / API client built on top of
   `electron-core-ui`. Multi-protocol (REST, GraphQL, gRPC, SOAP, OData,
   WebSocket, …) with a Postman-style workspace UX.
3. **[demo](./demo/)** — minimal app that exercises every
   `electron-core-ui` primitive in isolation. Used to validate library
   changes without dragging restorm-specific surface in.

## Quick start

```bash
pnpm install                 # workspace install (pnpm 10)
pnpm run dev:restorm         # restorm dev server
pnpm run dev:demo            # demo dev server
```

The first command installs every workspace package. `dev:restorm` and
`dev:demo` start an Electron + Vite dev server with hot reload — edits to
`electron-core-ui/` are picked up live.

## Build, lint, test

```bash
pnpm run build               # build all packages
pnpm run lint                # eslint across all packages
pnpm run typecheck           # tsc --noEmit across all packages
pnpm run test                # electron-core-ui + restorm test suites
```

The pre-commit and pre-push hooks (`.husky/`) run the full validation
chain. **Don't `--no-verify`** — fix the underlying issue. See
[`.husky/README.md`](./.husky/README.md) for the rules.

## Contributing

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the playbooks (adding a
new protocol, adding an import format, adding a generic component to
`electron-core-ui`) and **[CLAUDE.md](./CLAUDE.md)** for the
non-negotiable repo rules.

## License

MIT
