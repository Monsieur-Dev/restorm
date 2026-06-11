# Contributing

This monorepo ships **electron-core-ui** (a generic Electron + React
foundation library) and **restorm** (an HTTP / API client built on top
of it), plus the **demo** scaffolding used to exercise the library.
Different surfaces have different rules — start here, then jump to the
right playbook.

## Before you write any code

1. Read `CLAUDE.md` at the repo root. It encodes the non-negotiables
   (lint pass, no `eslint-disable`, no skipped tests, no `--no-verify`,
   self-review before push, branch up-to-date check).
2. If you're touching `electron-core-ui/`, also read
   [`electron-core-ui/CLAUDE.md`](./electron-core-ui/CLAUDE.md) — the
   library-isolation rules are strict.
3. Check the Backlog.md task (in `backlog/`). Most architectural decisions live there.

## Playbooks (start here for ticket-driven work)

### Adding a new execution protocol to Restorm

Read **[`restorm/docs/contributing/adding-a-protocol.md`](./restorm/docs/contributing/adding-a-protocol.md)**
end-to-end before writing the first line of code. It covers:

- Where files live (request types, models, execution service, tab view,
  import adapter, response history builder).
- The **three hard rules** that get PRs rejected if missed:
  1. UI built only from `electron-core-ui` components (no bespoke
     primitives).
  2. Every user input supports Handlebars `{{var}}` and goes through
     `ContextService.transformValue` at execution time.
  3. Every user input is debounced before triggering side effects.
- Docker mock conventions, CI integration, the full E2E scenario matrix
  (with copy-paste templates), the documentation checklist, and the PR
  review checklist.

The PR template at
[`.github/PULL_REQUEST_TEMPLATE/protocol.md`](./.github/PULL_REQUEST_TEMPLATE/protocol.md)
auto-populates the rules and checklist — append `?template=protocol.md`
to the GitHub PR creation URL to load it.

### Adding a new import format (without a new protocol)

Read **[`restorm/docs/contributing/adding-an-import.md`](./restorm/docs/contributing/adding-an-import.md)**.
Shorter than the protocol playbook — it covers the
`ImportAdapter.extractNormalizedSpec` contract, auto-detection
via content sniffing, idempotency, custom-vs-imported reconciliation,
and the import-only E2E scenario set.

### Adding a new scenario action to Restorm

Read **[`restorm/docs/contributing/adding-a-scenario-node.md`](./restorm/docs/contributing/adding-a-scenario-node.md)**
before writing any code. It covers the 13-step checklist for a new node kind:
kind union, port declarations, executor, registry, scheduler (scope nodes),
node box + component registration, catalogue, static preview, MCP wiring,
i18n (all 27 locales, including the inspector help line), unit tests, the lint
gate, and adding the new kind to the Bestiary scenario.

### Adding a new value/secret source to Restorm

Read **[`restorm/docs/contributing/adding-a-value-source.md`](./restorm/docs/contributing/adding-a-value-source.md)**
end-to-end before writing the first line of code. It covers:

- The shared descriptor (`ValueSourceDescriptor`) in `src/shared/secrets/sources/`.
- The main-process resolver (`ValueSourceResolver`) in
  `src/main/services/secrets/resolvers/`.
- Registration in both `mainSourceRegistry.ts` (descriptor + resolver) and
  `registerRendererSources.ts` (descriptor only) — and why the two bundles
  need separate registration.
- Why **no edits** to `KeyValue.fromPlain`, `valuePersistence.ts`, or
  `castValue.ts` are needed (the `SecretValue` type handles persistence
  automatically).
- The `paramSchema` (automatic ECUI config fields) vs. `configComponent`
  (custom React component) rendering paths, with masking invariants.
- i18n across all 27 locales, resolver unit tests, component render tests,
  and extending the growable e2e demo fixture with masking assertions.

### Adding a generic component or hook to `electron-core-ui`

Read [`electron-core-ui/CLAUDE.md`](./electron-core-ui/CLAUDE.md) for
the library-isolation litmus test ("would this be useful in any
Electron app, or only in this project?"), then update the matching doc
under `electron-core-ui/docs/` in the same commit. Undocumented public
surface is not considered shipped.

## Daily workflow

```bash
pnpm install                 # workspace install (uses pnpm 10)
pnpm run dev:restorm         # restorm dev server (or dev:demo)
pnpm run lint:fix && pnpm run lint && pnpm run typecheck
pnpm -F restorm run test     # restorm unit tests
pnpm -F restorm run test:e2e # restorm Playwright + BDD e2e (needs Docker)
```

The pre-commit hook runs the full validation chain across every package
and refuses to commit if anything fails. **Don't `--no-verify`.** If a
hook fails, fix the underlying issue.

## Questions

- Architecture: check the relevant Backlog.md task (in `backlog/`).
- Library isolation: see `electron-core-ui/CLAUDE.md`.
- Anything missing from the playbooks above: file a doc bug — the
  playbooks are the source of truth, gaps in them are bugs.
