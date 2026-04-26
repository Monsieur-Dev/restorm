## Protocol / Import format

> Append `?template=protocol.md` to the PR URL to load this template.
> Required for any PR that adds an execution protocol or import format.
> Reference playbook: [`restorm/docs/contributing/adding-a-protocol.md`](../../restorm/docs/contributing/adding-a-protocol.md).

**Linear ticket:** OYO-…

## Summary

<!-- 1–3 bullets: what protocol / format, what it unlocks for users, how it
     plugs into the existing services. -->

## Hard rules (must be ticked)

- [ ] **UI reuse** — only `electron-core-ui` components used (no bespoke buttons,
      modals, inputs, layouts). Section 2 of the playbook.
- [ ] **Handlebars resolution** — every user input is a `VariableInputBox` (or
      Monaco with the Handlebars contribution) and goes through
      `ContextService.transformValue` at execution time. Section 3.
- [ ] **Debouncing** — every user input that drives state mutations is
      debounced (~250 ms default) via `useDebouncedValue` /
      `useDebouncedCallback`. Section 4.

## Implementation checklist

- [ ] Architecture decision documented (new service vs. mode on existing).
      Section 1.
- [ ] Files in the canonical locations (request types/models, execution
      service, tab view, import service if applicable, response history
      builder).
- [ ] Docker mock added to `restorm/tests/docker/docker-compose.yml`,
      stable port, joins `gitable-tests` network. Section 5.
- [ ] CI integration confirmed (mock starts via `global-setup.ts`, no
      workflow change needed). Section 6.
- [ ] Optional `SKIP_<PROTOCOL>_E2E=1` opt-out flag, if applicable.

## E2E coverage

- [ ] Feature file at `restorm/tests/e2e/bdd/<protocol>/features/<protocol>-execution.feature`
      covers every scenario in Section 7, including the **debounce assertion**
      and the **Handlebars substitution** scenario.
- [ ] Response panel assertions (status, headers, body, JSONcrack, history
      navigation) covered. Section 8 — `data-testid` driven, no text selectors.
- [ ] Streaming / batch protocols: per-frame / per-child entries asserted.

## Backend wiring

- [ ] `build<Protocol>Response` builder added in `ResponseHistoryService`.
- [ ] Cancellation path implemented (request can be aborted mid-flight).
- [ ] Auth, env-variable resolution, redaction (where applicable) plug into
      existing services — no parallel implementations.

## Imports (for import-only or import-plus-protocol PRs)

- [ ] `ImportAdapter.extractNormalizedSpec` implemented (OYO-168) and
      idempotent — re-import of the same spec is a no-op.
- [ ] Auto-detection via content-sniffing in the adapter, not in
      `ImportManager`.
- [ ] Enum reconciliation wired (OYO-184) when the format carries enums.
- [ ] Fixture under `restorm/tests/unit/fixtures/<format>/`.
- [ ] Sample under `restorm/Samples/` and added to the
      `full-workflow.feature` import sweep.

## Documentation

- [ ] User-facing doc at `restorm/docs/protocols/<protocol>.md`
      (or `restorm/docs/imports/<format>.md`).
- [ ] Index update in `restorm/docs/protocols/index.md` (or imports/).
- [ ] Dev note in `electron-core-ui` if a shared helper / hook was added.

## Self-review

- [ ] Independent code review run (per `CLAUDE.md`'s self-review rule);
      findings addressed or explicitly waived in the PR description.
- [ ] Branch up to date with `origin/main` (per `CLAUDE.md`'s up-to-date check).

## Out of scope (note explicitly)

<!-- Anything you deliberately deferred or chose not to do. -->
