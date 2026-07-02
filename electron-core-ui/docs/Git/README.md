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
- **`renderCommitMessage`** (`CommitMessageEngine`) — a thin Handlebars
  wrapper (`Handlebars.compile`, cached per template string) that renders a
  `{ title, body }` commit-message pair from a restorm-provided
  `CommitMessageTemplates` pair + an arbitrary context object. Knows nothing
  about requests/scenarios/diffs — see "Commit-message generation" below.
- **`PushModal`** — the non-scoped (not tab-bound) commit + push UI: a
  language dropdown that regenerates both the title and body on change, an
  "apply this language by default" toggle, a commit-title field with a soft
  72-character counter (visual only, never blocks), a multiline body field,
  and Cancel/Push buttons. Fully controlled — the host owns every value and
  the actual git calls; see "Commit-message generation" below for how
  restorm drives it.

## Generalisation contract

`GitService` only knows about a folder path and raw git plumbing — it has
no notion of a "project file", an entity (request / scenario / folder /
environment-folder), or how to render one. Those concerns are host-injected
at a **higher layer**, not on the service itself:

| concern | who owns it | where |
|---|---|---|
| Which folder is "active" (the repo to track + watch) | host app | calls `setActiveFolder(folder)` — restorm maps "the open project file" → `dirname(filePath)` |
| Parsing the single-file YAML project into entities | host app | the conflict-resolution UI (per-entity 4-panel view) |
| Semantic diff / commit-message generation | host app + a generic ECUI templating engine | `renderCommitMessage` (generic) + restorm's differ/context builder (host) |
| Per-entity conflict rendering (request / scenario / folder tab-views) | host app | the conflict-resolution UI |
| Toast wording | ECUI, self-contained | `git.cliMissing.*` i18n keys in ECUI's own `locales/` |

`GitServiceConfig.watchDebounceMs` is the one generic tuning knob (default
500ms) — everything else about *what* changed and *how to show it* is
decided above this layer.

## Commit-message generation + the Push modal

The Push modal's title/body are produced by a three-layer pipeline, split
exactly along the ECUI/host line above:

1. **The differ** (host-owned, restorm: `services/gitCommitDiff.ts`) —
   `diffProjectEntities(beforeItems, afterItems)` does a deterministic
   structural diff of the Restorm project tree, grouped ONE change per
   entity (request / scenario / folder / environment folder) — never per
   field, never per scenario-node reposition. Diffs by the entity's
   persisted `id`, not array position, so a reorder alone is never a
   change. `parseProjectYaml(rawYaml)` turns `window.api.git.getFileAtHead`'s
   raw blob into the same `FolderItem[]` shape the live editor holds — the
   "before" side of the diff; the live `rootItems` is the "after" side.
2. **The context builder** (host-owned, restorm: `services/
   commitMessageContext.ts`) — `buildCommitMessageContext(changes, t)`
   turns the structural diff into `{ titleSummary, lines }`: a single
   changed entity gets a natural sentence ("Update to the request «X»"); several
   get an aggregate count per kind ("Update to 3 requests, 1 scenario").
   `t` must be an i18next translator **fixed to the target commit-message
   language** (`i18n.getFixedT(lang)`) — deliberately independent of the
   app's own active UI language, so a French-UI user can still generate an
   English commit message (or vice versa) without switching the whole app.
3. **The render engine** (ECUI-generic: `renderCommitMessage` +
   `CommitMessageEngine`) — compiles restorm's Handlebars templates
   (`services/commitMessageTemplates.ts`, one structural shape reused for
   every language — the localization already happened in step 2) against
   that context, producing the final `{ title, body }` pair.

`usePushModal(filePath, rootItems)` (restorm) glues all three together +
owns the modal's open/closed state, the "apply this language by default"
setting sync, and the actual stage → commit → push sequence:

```tsx
// renderer (restorm) — App.tsx
import { PushModal, AVAILABLE_LANGUAGES } from 'electron-core-ui/renderer'
import { usePushModal } from './hooks/usePushModal'

const pushModal = usePushModal(filePath, rootItems)

<PushModal
  isOpen={pushModal.isOpen}
  onClose={pushModal.closePushModal}
  languages={AVAILABLE_LANGUAGES}
  language={pushModal.language}
  onLanguageChange={pushModal.setLanguage}
  applyLanguageByDefault={pushModal.applyLanguageByDefault}
  onApplyLanguageByDefaultChange={pushModal.setApplyLanguageByDefault}
  title={pushModal.title}
  onTitleChange={pushModal.setTitle}
  body={pushModal.body}
  onBodyChange={pushModal.setBody}
  onPush={pushModal.push}
/>
```

Two settings persist the language preference (`useSetting`, restorm's
`resources/settings.yaml` under the `git` group): `git.commitMessageLanguage`
(the default, English) and `git.applyCommitMessageLanguageByDefault` (a
toggle — when on, picking a language in the Push modal also updates the
default for future pushes; when off, a pick only affects the commit being
edited right now). The SAME toggle is exposed in Settings→Git — both read
and write the identical setting key, so they can never drift out of sync.

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
src/renderer/services/CommitMessageEngine.ts      — renderCommitMessage (generic Handlebars render, cached per template)
src/renderer/components/PushModal/PushModal.tsx   — the non-scoped commit + push UI (fully controlled)
src/renderer/components/Settings/languages.ts     — AVAILABLE_LANGUAGES (shared by the UI-language switcher + PushModal)
src/renderer/locales/*/translation.json          — `git.cliMissing.*` + `pushModal.*` (all 27 locales)
```

restorm's side of the commit-message pipeline (host-injected, not part of
this library):

```
src/renderer/src/services/gitCommitDiff.ts          — diffProjectEntities / parseProjectYaml (the semantic differ)
src/renderer/src/services/commitMessageContext.ts   — buildCommitMessageContext (diff → { titleSummary, lines })
src/renderer/src/services/commitMessageTemplates.ts — RESTORM_COMMIT_MESSAGE_TEMPLATE (the Handlebars templates)
src/renderer/src/hooks/usePushModal.ts              — modal lifecycle + settings sync + stage/commit/push
resources/settings.yaml                             — the `git` settings group (applyCommitMessageLanguageByDefault)
src/renderer/locales/*/translation.json             — `git.diff.*`, `git.commitTitle.*`, `git.push{Failed,Succeeded}*` (all 27 locales)
```
