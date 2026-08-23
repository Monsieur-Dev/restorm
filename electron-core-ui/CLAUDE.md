# electron-core-ui — Library Isolation Rules

`electron-core-ui` is a **generic, reusable library**. It must remain completely independent from any specific project.

## Forbidden

- **NEVER** import from the host app or sibling consumer projects (e.g. `demo`)
- **NEVER** reference project-specific types, interfaces, or models
- **NEVER** hardcode project-specific values (URLs, IDs, names)
- **NEVER** add features that are not generalizable
- **NEVER** add dependencies only needed by a specific project

## What belongs here

- Generic UI components (Button, Modal, ListView, etc.)
- Generic hooks (useEventBus, useDirtyState, etc.)
- Generic services (PersistenceService, LoggerService, etc.)
- Generic decorators (@trackable, @searchable, etc.)
- Generic utilities and helpers

## Litmus test

> "Would this code be useful in ANY Electron application, or only in this specific project?"

If the answer is "only this project", it belongs in that project, not here.

## Component documentation (mandatory)

Every component, hook, service, or utility exposed from `electron-core-ui` has a doc under `electron-core-ui/docs/<Name>/README.md` (or for cross-cutting concerns, `electron-core-ui/docs/Architecture/*.md`). When you add, rename, or change the public surface of one of these, update the matching doc **in the same commit**:

- New prop / option on a component → add to its Props / API table and show it in at least one example
- New hook or function → new section in the component's doc (or a new `<Name>/README.md`)
- Rename / remove / deprecate → update every code sample that copy-pastes the old name, and any narrative prose that names it
- New storage key, IPC channel, on-disk layout, or persistence invariant → update `docs/Architecture/Persistence.md` (or the equivalent architecture doc) to match

If there's no existing doc for a new piece of surface, **create it** — the library's contract with consumers lives in `docs/`, and undocumented surface is not considered shipped. Grep for the old name across `docs/` before committing a rename; stale code samples break consumers who paste them.
