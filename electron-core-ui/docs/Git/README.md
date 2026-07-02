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
  without touching the index), `writeResolvedConflict`, `abortMerge`,
  `getConflictCommitTimestamps` (`HEAD`/`MERGE_HEAD` commit times, Unix
  seconds, `null` when a ref can't be read — a generic tie-breaker a host's
  conflict UI can use when two conflicting versions carry no other
  ordering signal, e.g. two content versions with no version number of
  their own).
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
- **Semi-pull triggers** — `GitService.checkForRemoteUpdate()` is the ONE
  implementation shared by all three triggers the folder-watch/check-on-
  open/CRON design calls for: the folder watch above, an immediate
  check-on-open inside `setActiveFolder()` (so a just-opened file with a
  stale local copy surfaces the toast right away), and
  `GitSemiPullController`'s periodic schedule. It no-ops unless the active
  folder is a repo, so every caller can invoke it unconditionally. Fires
  `onPullAvailable()` (→ `git:pull-available`) only on the false→true edge
  of `remoteHasNewerVersion` — a repeat check that still finds the same
  undetected pull pending does not re-toast.
- **`GitSemiPullController`** (main process) — reads the `git:
  semiPullFrequency` setting (presets `15m`/`30m`/`1h`/`4h`/`12h`/`24h`/
  `off`, default `1h` — the setting itself is host-registered, e.g.
  restorm's `resources/settings.yaml`, same split as `AutoSaveController`'s
  `files:autoSave`) and calls `checkForRemoteUpdate()` on that schedule.
  Reschedules immediately on a setting change. Mirrors
  `AutoSaveController`'s shape (`start()`/`stop()`, a settings
  subscription, a singleton `initGitSemiPullController()`/
  `getGitSemiPullController()` pair).
- **`useGitPullAvailableToast(onPull)`** — surfaces every
  `git:pull-available` detection as an `app`-toaster toast with a "Pull
  now" action button. Unlike `useGitCliMissingToast`, this can fire more
  than once per session; a fixed toast id means a re-detection updates the
  existing toast rather than stacking a duplicate. `onPull` is the host's
  injection point — this hook only knows a newer version was detected,
  never how to actually pull (conflict handling belongs to the host's own
  pull flow, e.g. restorm's `useGitActions`/`useGitPullConflict`).
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
- **`ConflictResolutionView`** + **`fieldDiffStyle`** — the conflict-
  resolution 4-panel shell + diff-highlight framework. See "Conflict
  resolution" below. **WIP** — the shell + list/empty-state behavior are
  built and tested; the restorm-side entity→tab-view wiring (read-only
  panels, field-level diff computation, per-entity YAML isolation) is not
  yet implemented.

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
| Toast wording | ECUI, self-contained | `git.cliMissing.*` / `git.pullAvailable.*` i18n keys in ECUI's own `locales/` |
| Reacting to "Pull now" (plain pull vs. opening conflict resolution) | host app | `useGitPullAvailableToast(onPull)`'s `onPull` callback |
| The CRON frequency setting's visible YAML registration | host app | restorm's `resources/settings.yaml` `git` group (`GitSemiPullController` just reads the `git:semiPullFrequency` key, wherever it's registered) |

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
`resources/settings.yaml` under the `git` group): `commitMessageLanguage`
(the default, English) and `applyCommitMessageLanguageByDefault` (a
toggle — when on, picking a language in the Push modal also updates the
default for future pushes; when off, a pick only affects the commit being
edited right now). The SAME toggle is exposed in Settings→Git — both sides
compute their storage key via `buildSettingsStorageKey(['git'], settingId)`
(exported from `electron-core-ui/renderer`, the same function
`SettingsService.buildStorageKey` delegates to on the main-process side)
rather than hand-writing the `<group>:<id>` format, so they can never
silently drift onto two different storage entries.

## Conflict resolution (4-panel shell)

**Status: WIP.** The shell, the diff-highlight framework, and restorm's
entity dispatcher are built and tested. Field-level diff + tab preselect
(`conflictFieldDiff.ts`) are wired for folders/environment-folders (the
`notes` field), HTTP/auth requests (a bespoke, per-field breakdown: url/
method/notes/auth-config discrete; headers/params/pathParams/body/
producedHeaders/authErrorCodes coarse whole-section), and the other 5
request protocols — GraphQL/gRPC/SOAP/WebSocket/OData — via a coarser
generic breakdown (url/notes discrete, everything else one `requestConfig`
boolean). The saved-quick-config whole-config merge rule and API-
documentation auto-resolve (`apiDocumentationConflict.ts`) are both
implemented. Still open: an interactive per-quick-config picker (the
merge is correct/lossless today, just not interactively resolvable — the
live quick-config UI isn't mounted inside this view at all — deferred to
a follow-up ticket by design).

`ConflictResolutionView` lays out, left to right: an optional conflict
LIST (master-detail, shown only when there's more than one conflicting
entity — built on `SplitView`/`Pane` + `ListView`), then three fixed
panels — user/ours, server/theirs, resolved — each populated entirely by a
host-supplied render prop:

```tsx
import { ConflictResolutionView } from 'electron-core-ui/renderer'

<ConflictResolutionView
  conflicts={conflicts}                      // [{ id, label }] — one per conflicting entity
  selectedConflictId={selectedConflictId}     // null until the user picks one (only reachable when the list shows)
  onSelectConflict={setSelectedConflictId}
  renderUserPanel={(id) => <MyEntityPanel entity={usersVersionOf(id)} mode="readOnly" />}
  renderServerPanel={(id) => <MyEntityPanel entity={serversVersionOf(id)} mode="readOnly" />}
  renderResolvedPanel={(id) => <MyEntityPanel entity={resolvedVersionOf(id)} mode="editable" />}
  onUseUserVersion={() => copyIntoResolved('ours')}     // optional — omit to hide the button
  onUseServerVersion={() => copyIntoResolved('theirs')} // same
/>
```

The shell owns: which panels are visible, the list's selection, the
optional "use this version" header button on the user/server panels
(renders nothing if the corresponding `onUse*Version` prop is omitted),
and falling back to a "select a conflict" empty state in all three
content panels before a selection exists. It owns NOTHING about what an
"entity" is — rendering the right tab-view per entity type, read-only vs.
editable, tab highlighting/hiding, and what "use this version" actually
copies are entirely the host's job, per the same ECUI/restorm split as
the rest of this feature.

`fieldDiffStyle(differs: boolean)` is the companion diff-highlight
framework: a plain style-computation helper (not a wrapper component,
since every field component in the app already accepts a `style` prop the
same way `NumberInput.tsx`'s `outOfRange` check does) returning the SAME
`var(--inputValidation-errorBorder)` border color every other field-level
error state already uses — spread it onto a field's `style` whenever the
host's own diff computation says that field differs between the user and
server versions.

`ReadOnlyOverlay` is how restorm's `MyEntityPanel` above achieves "EXACTLY
the normal entity panel, read-only" without a bespoke `readOnly` prop
threaded through every protocol view: it renders the host's UNMODIFIED
panel wrapped in a CSS class that disables `pointer-events` on every
interactive descendant (input/textarea/select/button/…), leaving scrolling
and text selection untouched. restorm's actual dispatcher
(`restorm/src/renderer/src/components/GitConflict/ConflictEntityPanel.tsx`)
picks the right panel per entity kind — folder / environment-folder /
scenario / every request protocol (HTTP, auth, GraphQL, gRPC, SOAP,
WebSocket, OData) reuses its exact live tab-view component; only a
request-shaped entity with an unrecognized `type` (a defensive runtime
fallback, not a real code path) falls back to the Monaco 3-pane view.
`conflictEntityClone.ts` produces the editable resolved copy (reactive-
proxy-wrapped for folders/requests, plain-cloned for scenarios, which are
controlled via `onScenarioChange` instead). `gitConflictModel.ts`
identifies which entities actually conflict from `getConflictVersions`'s
3 git stages — an entity added on only one side merges in automatically,
never flagged.

Every request protocol's TabView also gets a `conflictMode` prop forced
`true` from `ConflictEntityPanel` (`conflictSafeLiveState.ts`'s blanket
safety rule): a conflict panel is a STATIC historical snapshot, never a
live session, so `conflictMode` forces every "is this request currently
listening/subscribing" read to `false` and skips every live event-stream
subscription (GraphQL subscriptions, gRPC/WebSocket streaming frames,
every protocol's server-mode listening beam) — regardless of whether the
SAME request id happens to be genuinely connected in a real workbench tab
at that moment. GraphQL additionally uses it to disable an auto
`setOperationName` effect that otherwise mutates the request + the global
collections store with no user click — the clone must never silently
diverge from the ours/theirs/resolved snapshot the user is looking at.

`conflictFieldDiff.ts` is restorm's field-diff computation half of AC#9:
`computeEntityFieldDiff(kind, ours, theirs)` returns `{ fields, preselectTabId }`
for kinds it knows how to diff, or `undefined` for scenarios (never, by
design). `GitConflictResolutionModal` computes it ONCE per conflict (ours
vs theirs) and passes the same result to all 3 panels via
`ConflictEntityPanel`'s `fieldDiff` prop: the `fields` red-border map only
applies in `readOnly` mode (user/server, per AC#4), while `preselectTabId`
applies to every panel regardless of mode (AC#5).
For folders/environment-folders this surfaces as `notesDiffers` +
`defaultActiveTabId` passthrough props on `FolderView`/
`EnvironmentFolderView` → `BaseFolderView`, which borders the notes editor
and defaults to the `notes` tab when it's the one that differs. The same
`defaultActiveTabId` pattern (plus `conflictFieldDiff`/`showCodeSnippets`)
extends to `HTTPRequestTabView` for HTTP/auth requests.

An environment-folder's `apiDocumentation` is a special case: it never
becomes a manual pick. `gitConflictModel.ts` excludes it from the
equality check that decides whether an environment-folder conflicts at
all (a diff on `apiDocumentation` ALONE is invisible to the conflict
list); `apiDocumentationConflict.ts`'s `resolveApiDocumentationConflict`
picks a winner by dotted-numeric `api.version` compare, falling back to
`GitService.getConflictCommitTimestamps`'s `HEAD`/`MERGE_HEAD` commit
times when versions are equal/absent, and `gitConflictMerge.ts` applies
that winner at write-back time for every environment-folder pair —
independently of whatever the user resolved for the entity's OTHER
fields (e.g. `notes`), since `apiDocumentation` isn't user-editable in
this panel in the first place.

## Pro gating

The whole feature is gated behind a `git.client` entitlement capability —
generic infrastructure, restorm-specific wiring, same split as everywhere
else in this doc:

- `GatedControl`'s `showSubscribeLink` prop (generic, ECUI) distinguishes
  two locked reasons: missing entitlement (the normal upsell, subscribe
  link shown) vs. entitled-but-context-doesn't-apply (e.g. Pro but the
  open folder isn't a git repo — an informational message, no subscribe
  link, since there's nothing to buy).
- Capability-gated Settings rows (generic, ECUI — see `docs/
  Architecture/Settings.md`'s "Capability-gated settings" section) grey
  out `resources/settings.yaml`'s `git` group in Community via the same
  `GatedControl`.
- restorm's `useGitGateState()` hook computes the 3-state model (Pro+git
  → enabled; Pro+no-git → informational lock; Community, regardless of
  the folder → the standard Pro upsell) that drives the status-bar entry,
  the title-bar Git menu, and the Settings→Git capability check alike —
  one source of truth so they can never disagree.

## Quick start

```ts
// main process — no init call needed beyond IPC registration, which
// happens automatically via IPCManager's setupIPC(). Host apps only need
// to wire the active-folder lifecycle, register a `git:semiPullFrequency`
// setting (in the host's own settings config — see "CRON semi-pull"
// below), and start the CRON controller once SettingsService is ready:
import { getGitService, getFileService, getSettingsService, initGitSemiPullController } from 'electron-core-ui/main'
import { dirname } from 'path'

const gitService = getGitService()
getFileService().onStateChanged((state) => {
  void gitService.setActiveFolder(state.currentFile.path ? dirname(state.currentFile.path) : null)
})

// After app.whenReady() (SettingsService is initialized inside setupIPC,
// scheduled asynchronously by initializeApp — same indirection
// AutoSaveController's own wiring needs):
initGitSemiPullController({ settings: getSettingsService(), gitService })
```

```tsx
// renderer
import { useGitState, useGitCliMissingToast, useGitPullAvailableToast } from 'electron-core-ui/renderer'

function GitStatusPill(): JSX.Element | null {
  const { isRepo, status, remoteHasNewerVersion } = useGitState()
  if (!isRepo) return null
  const pushPending = (status?.files.length ?? 0) > 0
  return <span>{pushPending && '●'} {remoteHasNewerVersion && '●'}</span>
}

function AppRoot(): JSX.Element {
  useGitCliMissingToast() // mount once near the app root
  useGitPullAvailableToast(() => { /* the host's own pull flow, e.g. useGitActions().onPull */ })
  return <GitStatusPill />
}
```

## File map

```
src/types/git.ts                                — GitState, GitStatus, GitFileEntry, result types
src/types/settings.ts                           — buildSettingsStorageKey (canonical <group>:<id> key builder, shared main+renderer)
src/main/services/GitService.ts                  — the service (simple-git wrapper + watch + broadcast)
src/main/managers/ipc/gitHandlers.ts             — `git:*` IPC channel registration
src/main/ipc/schemas.ts                          — zod arg schemas (git* entries)
src/preload/api.ts                               — `window.api.git` exposure
src/types/api.ts, src/renderer/types/global.d.ts — CoreUiGitApi / WindowApiGit contracts
src/renderer/hooks/useGitState.ts                — React hook: live GitState
src/renderer/hooks/useGitCliMissingToast.ts       — one-time "git not installed" toast
src/main/services/GitSemiPullController.ts        — CRON schedule reading `git:semiPullFrequency`, calls checkForRemoteUpdate()
src/renderer/hooks/useGitPullAvailableToast.tsx   — "a newer version exists" toast with a Pull-now action button
src/renderer/services/CommitMessageEngine.ts      — renderCommitMessage (generic Handlebars render, cached per template)
src/renderer/components/PushModal/PushModal.tsx   — the non-scoped commit + push UI (fully controlled)
src/renderer/components/Settings/languages.ts     — AVAILABLE_LANGUAGES (shared by the UI-language switcher + PushModal)
src/renderer/components/ConflictResolutionView/ConflictResolutionView.tsx — the 4-panel shell (list + user/server/resolved)
src/renderer/components/ConflictResolutionView/fieldDiffStyle.ts          — the diff-highlight style helper
src/renderer/locales/*/translation.json          — `git.cliMissing.*` + `git.pullAvailable.*` + `pushModal.*` + `conflictResolution.*` (all 27 locales)
```

restorm's side of the commit-message pipeline (host-injected, not part of
this library):

```
src/renderer/src/services/gitCommitDiff.ts          — diffProjectEntities / parseProjectYaml (the semantic differ)
src/renderer/src/services/commitMessageContext.ts   — buildCommitMessageContext (diff → { titleSummary, lines })
src/renderer/src/services/commitMessageTemplates.ts — RESTORM_COMMIT_MESSAGE_TEMPLATE (the Handlebars templates)
src/renderer/src/hooks/usePushModal.ts              — modal lifecycle + settings sync + stage/commit/push
resources/settings.yaml                             — the `git` settings group (applyCommitMessageLanguageByDefault, semiPullFrequency)
src/renderer/locales/*/translation.json             — `git.diff.*`, `git.commitTitle.*`, `git.push{Failed,Succeeded}*` (all 27 locales)
src/renderer/src/services/gitConflictModel.ts       — identifyConflictingEntities (which entities genuinely conflict)
src/renderer/src/services/conflictEntityClone.ts    — cloneEntityForResolution (the editable resolved copy)
src/renderer/src/components/GitConflict/ConflictEntityPanel.tsx — the entity→panel dispatcher
src/shared/auth/authState.ts                        — the `git.client` entry in restorm's Capability union
src/renderer/src/hooks/useGitGateState.ts           — the 3-state Pro-gate
src/renderer/src/components/GitCapabilityGateHost.tsx — reactive CapabilityGate builder, mounted in main.tsx
src/renderer/src/components/MainView/StatusbarGitIndicator.tsx      — GatedControl wrapping
src/renderer/src/components/MainView/Titlebar/RestormTitlebar.tsx   — Git menu disable + Pro badge
src/renderer/locales/*/translation.json             — `git.gate.initGitFolder` (all 27 locales)
```
