# electron-core-ui — Library Isolation Rules

`electron-core-ui` is a **generic, reusable library**. It must remain completely independent from any specific project.

## Forbidden

- **NEVER** import from `restorm`, `gitable`, or `demo` projects
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
