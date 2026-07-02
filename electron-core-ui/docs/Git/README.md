# Git integration

Generic git plumbing for ECUI-based Electron apps: repo detection, status,
stage/commit/push/pull, a merge-free "semi-pull" (fetch + compare) for
newer-remote-version detection, conflict-blob retrieval, and a debounced
`.git` folder watch. Built on [`simple-git`](https://github.com/steveukx/git-js).

## What is this?

- **`GitService`** (main process) — a single "active folder" tracker (mirrors
  `FileService`'s single active file) wrapping `simple-git`: `isGitRepo`,
  `getStatus`, `stage`, `commit`, `push`, `pull`, `fetchAndCompare` (the
  semi-pull), `getConflictVersions` (`:1`/`:2`/`:3` index stages),
  `getFileAtHead` (the last-committed content of a path, `null` if it didn't
  exist at `HEAD` — for diffing the working copy against the last commit
  without touching the index), `writeResolvedConflict`, `abortMerge`.
- **IPC bridge** — `git:*` channels registered on the main process and
  exposed via `window.api.git` in the renderer preload (no host-specific
  wiring needed — every primitive takes its folder path as an argument).
- **`useGitState()`** — React hook mirroring the live `GitState` snapshot,
  pushed on every `git:state-changed` event.
- **`useGitCliMissingToast()`** — surfaces the one-time "git isn't
  installed" notice as an `app`-toaster toast.
- **Folder watch** — a debounced watch on `.git/HEAD`, `.git/index`, and
  `.git/refs/**` (NOT the whole `.git` tree, which would also churn on
  `objects/**`) triggers a status refresh + a semi-pull check.

## Generalisation contract

`GitService` only knows about a folder path and raw git plumbing — it has
no notion of a "project file", an entity (request / scenario / folder /
environment-folder), or how to render one. Those concerns are host-injected
at a **higher layer**, not on the service itself:

| concern | who owns it | where |
|---|---|---|
| Which folder is "active" (the repo to track + watch) | host app | calls `setActiveFolder(folder)` — restorm maps "the open project file" → `dirname(filePath)` |
| Parsing the single-file YAML project into entities | host app | the conflict-resolution UI (per-entity 4-panel view) |
| Semantic diff / commit-message generation | host app + a generic ECUI templating engine | the commit-message engine |
| Per-entity conflict rendering (request / scenario / folder tab-views) | host app | the conflict-resolution UI |
| Toast wording | ECUI, self-contained | `git.cliMissing.*` i18n keys in ECUI's own `locales/` |

`GitServiceConfig.watchDebounceMs` is the one generic tuning knob (default
500ms) — everything else about *what* changed and *how to show it* is
decided above this layer.

## Quick start

```ts
// main process — no init call needed beyond IPC registration, which
// happens automatically via IPCManager's setupIPC(). Host apps only need
// to wire the active-folder lifecycle:
import { getGitService, getFileService } from 'electron-core-ui/main'
import { dirname } from 'path'

const gitService = getGitService()
getFileService().onStateChanged((state) => {
  void gitService.setActiveFolder(state.currentFile.path ? dirname(state.currentFile.path) : null)
})
```

```tsx
// renderer
import { useGitState, useGitCliMissingToast } from 'electron-core-ui/renderer'

function GitStatusPill(): JSX.Element | null {
  const { isRepo, status, remoteHasNewerVersion } = useGitState()
  if (!isRepo) return null
  const pushPending = (status?.files.length ?? 0) > 0
  return <span>{pushPending && '●'} {remoteHasNewerVersion && '●'}</span>
}

function AppRoot(): JSX.Element {
  useGitCliMissingToast() // mount once near the app root
  return <GitStatusPill />
}
```

## File map

```
src/types/git.ts                                — GitState, GitStatus, GitFileEntry, result types
src/main/services/GitService.ts                  — the service (simple-git wrapper + watch + broadcast)
src/main/managers/ipc/gitHandlers.ts             — `git:*` IPC channel registration
src/main/ipc/schemas.ts                          — zod arg schemas (git* entries)
src/preload/api.ts                               — `window.api.git` exposure
src/types/api.ts, src/renderer/types/global.d.ts — CoreUiGitApi / WindowApiGit contracts
src/renderer/hooks/useGitState.ts                — React hook: live GitState
src/renderer/hooks/useGitCliMissingToast.ts       — one-time "git not installed" toast
src/renderer/locales/*/translation.json          — `git.cliMissing.{title,body}` (all 27 locales)
```
