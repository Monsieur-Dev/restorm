# Persistence

Flexible serialization for single-file storage,
with an in-memory save-unit model and crash-recovery drafts.

## Formats

| Format | Extension | Use Case |
|--------|-----------|----------|
| JSON | `.json` | Standard, readable |
| YAML | `.yaml` | Human-friendly |
| JSON5 | `.json5` | Comments, trailing commas |

## Single File Persistence

All data in one file.

```typescript
import { getPersistenceService } from 'electron-core-ui/main'

const service = getPersistenceService()

// Save (atomic — writes `<file>.<uuid>.tmp` then fs.rename)
await service.saveSingleFile('/path/to/file.json', data, { format: 'json' })

// Load
const data = await service.loadSingleFile('/path/to/file.json')
```

### Stamping the document identity does not rewrite the document

`ensureFileUuid` / `ensureFolderUuid` add the UUID by **inserting the key
into the file's text** (`setTopLevelKey`), never by reparsing and
re-serializing it. The round-trip they used to do —
`serialize({ ...deserialize(raw), [uuidKey]: fresh })` — is lossy in every
format this library persists:

- **YAML**: `js-yaml` has no comment round-trip, so every comment is
  discarded, and `noRefs: true` expands anchors and aliases into
  duplicated literal content, irreversibly flattening a document that
  used `&x`/`*x` to share configuration. Quoting, indentation and scalar
  style are renormalised.
- **JSON5**: comments are part of the format and `JSON5.stringify` drops
  them.
- **JSON**: no comments to lose, but key order and formatting churn.

What made this sharp rather than cosmetic: a document only *lacks* the
UUID when it was hand-authored, created outside the app, or predates the
key — which is precisely the population most likely to contain comments
and anchors. The damage concentrated exactly where it cost most, on an
operation the user experiences as read-only.

`setTopLevelKey` re-parses its own output and returns `null` unless the
result is exactly the previous value plus the one new key. When it cannot
prove that — a sequence or scalar root, a flow-style root, a
multi-document YAML stream, unparsable input — the **file is left
completely untouched** and the result carries `persisted: false`. There is
deliberately no fallback to the round-trip: the UUID is convenience, the
user's file is not.

The same primitive is the only supported way to add ANY document-level
key to a file the app is not otherwise rewriting — an identity, an
on-disk format version, whatever a host app keeps beside its content.
`value` may be a string or a **number**, and the distinction is load-
bearing rather than a convenience: the round-trip check compares the
re-parsed value with the one asked for, so a number written as a quoted
string parses back as a string and the insertion is refused. A key
already holding a real value is never overwritten — only an absent key,
or a blank slot (`key:` / `key: ''`), is filled — so a caller that needs
to CHANGE an existing value has to rewrite the document properly rather
than patch its text.

**`persisted: false` means: do not attach a draft store.** An
unpersisted UUID is regenerated on every call, and `attachDraftStore` is
routinely called more than once for a single open, so the attaches would
land on different namespaces — and a crash would file the drafts under an
id nothing can look up again. That is unsaved work which *looks*
recoverable and is not, which is strictly worse than no recovery at all.
Callers must therefore skip the attach and say so in the log; the
document itself opens, edits and saves exactly as usual, it simply has no
crash-recovery drafts. Anything else quietly recreates the failure that
persisting the UUID at open exists to prevent.

### Refusing a document on open (`validateOnOpen`)

A host app can install a gate that refuses a document the running build
cannot handle — an unsupported on-disk format version, a schema the build
predates, a required capability it lacks:

```typescript
initFileService({
  extension: '.myapp',
  uuidKey: '_projectUuid',
  validateOnOpen: (content, filePath) => {
    if (isFromTheFuture(content)) {
      return { ok: false, code: 'format-too-new', detail: { found: 7, current: 1 } }
    }
    return { ok: true }
  }
})
```

`FileService.open()` calls the validator on the freshly parsed content and,
on `ok: false`, aborts completely: the document is not loaded, the previous
file stays open, the path does not join recent files, `file:opened` is not
emitted, and — the point of the ordering — **nothing is written to the
file**. `open()` resolves to `{ success: false, rejected: true }` so the
caller can tell a refusal from a read error.

**Ordering invariant: read → parse → validate → stamp.** The UUID stamp
(`ensureFileUuid`) runs *after* the gate, never before. Stamping first
would mutate a file the app then declines to open — an unrequested write to
data the user is only reading. The same ordering applies to any future step
that writes during open. Only the first-ever open of a UUID-less file
re-reads the file (the stamp changed the bytes, and `diskDigest` must match
what is on disk or the external-change guard misfires).

A note on how this stayed hidden, because it shapes where to look for the
same bug elsewhere. The stamp inside `open()` is wrapped in a try/catch, so
a **read-only** file never announced itself — the write failed, a warning
was logged, and the document opened normally. The harm was confined to the
files where the write *succeeded*. Host apps that stamp **outside** a catch
get the opposite and louder failure: restorm's folder-mode loader called
`ensureFolderUuid` inside a `try` whose `catch` returns `null`, so a
read-only project directory made the entire open fail silently — no
document, no message. Both shapes are worth checking for whenever a read
path writes.

The library deliberately renders no message of its own. It broadcasts
`file:open-rejected` with `{ path, code, detail }` and leaves the wording to
the host: the main process typically ships far fewer locales than the
renderer, so a user-facing explanation composed in main would reach many
users in the wrong language.

A validator that throws is treated as a refusal, not as approval — a
document whose acceptability is unknown is exactly what the gate exists to
keep out.

## Atomic writes

Every disk write goes through `atomicWriteFile()`: serialize
to `<target>.<uuid>.tmp` adjacent to the target, then `fs.rename` into
place. A crash mid-write leaves the previous target intact.

Two things `rename` would otherwise get wrong, because it replaces the
*inode* rather than the bytes of the existing file — and because it
consults only the DIRECTORY's permissions:

- **A read-only target can be refused**, via the opt-in
  `atomicWriteFile(path, contents, { refuseReadOnlyTarget: true })`.
  Without it the read-only bit offers no resistance whatsoever: the file
  is replaced and the marking is gone. When asked, `atomicWriteFile`
  checks `fs.access(W_OK)` on an existing target first and throws
  `FileSystemError('FS_TARGET_READ_ONLY')`. This is a **detection, not
  the safety net** — `access` is advisory, it lies under ACLs and reports
  writable for root — so every case it waves through still fails at the
  write and is reported from the `catch`, through the same channel. A
  path with no file yet is not a refusal (`ENOENT` there means the
  directory governs the write).

  **It is opt-in on purpose.** The throw lands on the caller, and only a
  caller that reports failure to the user can act on it. The atomicity
  here is *per file*: a caller writing several files in one pass would
  be left mid-operation, some files written and some not. Writers that report
  failure **by value** (`'refused'`, `persisted: false`) or that merely
  log would turn the refusal into a silent no-op or an unexpected
  exception. So the default is the historical behaviour, and only the
  `FileService` save paths — the ones that own the `file:save-failed`
  notice — switch it on.
- **The target's permission mode is carried across.** Without it the file
  comes back with whatever mode the umask gave the temp file: a project
  kept at `600` — they can hold secrets — would silently return as `644`.

### When a write fails

A failed save used to be invisible: the `catch` logged and returned
`false`, and the only thing the user saw was the dirty markers staying
lit — which is exactly what "not saved yet" looks like. So they keep
working on a project they believe is on disk.

Every write path therefore reports its outcome to the renderer:

| Broadcast | Payload | Fired by |
| --- | --- | --- |
| **`file:save-failed`** | `{ path, reason, detail }` | `save()`, `saveAs()` |
| **`file:save-succeeded`** | `{ path }` | the same, on the way through |

`reason` is a `SaveFailureReason` — `'read-only-file'`,
`'read-only-location'`, `'permission-denied'`, `'disk-full'`,
`'quota-exceeded'`, `'path-missing'`, `'file-busy'`, `'unknown'` —
derived by `classifySaveFailure()`, which walks the error's `cause` chain
for an errno (or for the pre-flight's `FS_TARGET_READ_ONLY`). `detail`
carries the raw message, which is what the `'unknown'` message renders.
"The file is read-only" tells the user what to change; "save failed"
tells them nothing.

Two rules the reporting side keeps:

- **Every failed attempt is reported**, including each autosave retry.
  Main stays a plain reporter — only the renderer knows whether the user
  has already been told and dismissed the notice.
- **A batch reports one outcome**, its first failure or a success when
  every unit landed. A partially-written project is not a successful
  save, and letting the later successes speak would retract the notice
  for a failure nobody saw.

A save refused because the file changed outside the app broadcasts
nothing here — that path has its own prompt (above), and no write was
attempted.

Hosts that persist through their own IPC (exports) report
through `getFileService().notifySaveSucceeded(path)` /
`notifySaveFailed(path, error)`, so the notice covers those paths too.
Do NOT call them for a cancelled dialog or a refused precondition: those
are not failed writes.

Renderer surface: **`useSaveFailureToast()`** — mount once at the app
root, alongside an `app` toaster. See
[Renderer/Hooks-Services-Contexts.md](../Renderer/Hooks-Services-Contexts.md).

### Files rewritten outside the app

`FileService` keeps a SHA-1 digest of the bytes it last read from — or
wrote to — the open file (`diskDigest`, refreshed by `open()`,
`save()` and `saveAs()`). `hasExternalChange()` re-reads the file and
compares; anything else on disk means a third party rewrote it.

The case that matters is a `git checkout` / `git pull` run from a
terminal while the project is open. The in-memory tree still holds the
pre-checkout content and autosave fires about a second later, so
without a guard the checkout is silently undone on disk.

Detection is TWO-sided:

- **Proactive** — `open()`/`saveAs()` arm a chokidar watcher on the open
  file (torn down by `close()`, re-armed on every file switch). Fs events
  are debounced (`externalWatchDebounceMs`, default 250 ms — atomic
  writes rename, editors write in bursts), then the digest decides: bytes
  matching `diskDigest` are the app's own write echoing back, anything
  else broadcasts **`file:externally-changed`**. A positive probe is
  re-checked after a second debounce window so a save whose digest stamp
  is a microtask away never reads as a third-party rewrite.
- **Save-time backstop** — `save()` refuses to write when
  `hasExternalChange()` is true, returns `false`, and broadcasts the same
  event.

Both share a one-shot latch: the broadcast fires exactly once per
divergence (a per-second autosave must not re-prompt every tick). The
app resolves it either way:

| Resolution | Call | Effect |
| --- | --- | --- |
| Use the version on disk | re-open the path | the normal file-open path re-hydrates and re-baselines the digest |
| Keep the in-memory version | `acceptExternalChange()` then save | re-baselines on the new bytes so the ordinary save overwrites them |
| — | `save(content, { force: true })` | same overwrite in one call, for callers that own the save themselves |

Both paths re-arm the guard, so a *second* external rewrite prompts
again.

Renderer surface: `useFileExternallyChanged(cb)` subscribes to the
broadcast and `useFileService()` exposes `acceptExternalChange()`. The
host decides the prompt UX — restorm shows a non-blocking, indefinite
toast (reload / keep mine); the native `showExternalChangeDialog()`
message box remains available for hosts that prefer a blocking prompt.

### Reorder cascade

When siblings are reordered, every affected unit's counter flips — so
all reordered siblings become dirty and are saved together. The
existing `reindexFiles` routine stages every old file to a `__temp_*`
name first, then renames into the new slot, removing each temp entry
from the pending set as soon as it's consumed (prevents ENOENT on
later iterations).

## Save Unit Model (`SaveUnitRegistry`)

A **save unit** is the atomic persistence object in memory — a
request, a folder, the root environment. Each unit has:

- `reference` — the last state synchronized with disk.
- `draft` (optional) — a pending change (modify / rename / move /
  reorder) or a `Tombstone` (pending delete).
- `parentId` for tree positioning.
- `lastDirtyReason` — one of `'modify' | 'create' | 'delete' | 'rename' | 'move' | 'reorder'`.

Predicates: `isDirty(unit) ⇔ draft !== undefined`,
`isUnitPendingDelete(unit)` for tombstones, `isUnitNew(unit)` for
freshly created units.

Lifecycle:

| Operation | In-memory effect | On save (whole-file write + commit) |
| --- | --- | --- |
| **Create** | New unit, no `reference`, only `draft`. | Unit committed, draft dropped. |
| **Modify** | Update `draft`. | Unit committed, draft dropped. |
| **Delete** | `draft = Tombstone(snapshot)`. | Tombstone cleared. |
| **Rename** | `draft.name` updated. | Unit committed. |
| **Move** | Same `runtimeId`, new parent. | Unit committed. |
| **Reorder** | Counters flip, siblings become dirty. | Every affected sibling committed together. |

Undo-to-reference: if a mutation makes the draft structurally identical
to the reference, the draft is discarded automatically.

### Events

The registry exposes `onUnitChange((snapshot) => …)`. `FileService`
bridges this to an IPC broadcast `file:unit-dirty-changed` with
`{ runtimeId, isDirty, reason? }`. Global `file:state-changed` fires
alongside so consumers can refresh aggregate counts.

Renderer hooks:

```tsx
import { useUnitDirtyState } from 'electron-core-ui/renderer'

function TabTitle({ unitId }: { unitId: string }) {
  const { isDirty, reason } = useUnitDirtyState(unitId)
  return <span>{name}{isDirty && ' •'}</span>
}
```

## Drafts & Crash Recovery (`DraftStore`)

Each dirty save unit is persisted to one draft file so the user's
work survives a hard crash.

### Location

```
<userData>/drafts/<uuid>/<runtimeId>.draft.<ext>
<userData>/drafts/<uuid>/.last-opened         # epoch-ms marker for the age-based sweep
```

> **Test isolation.** `<userData>` resolves via Electron's
> `app.getPath('userData')` — `~/.config/<appName>/` on Linux,
> `~/Library/Application Support/<appName>/` on macOS,
> `%APPDATA%/<appName>/` on Windows. Restorm's main entrypoint reads
> the **`RESTORM_USER_DATA_OVERRIDE`** environment variable very early
> (before any storage consumer initialises) and, if non-blank, calls
> `app.setPath('userData', <override>)`. After that call every
> downstream consumer of `app.getPath('userData')` — `StorageService`,
> `DraftStore`, `FileService`, the CLI's `clearUserSettings`, etc. —
> follows automatically.
>
> The e2e launcher sets the override to a unique
> `tests/e2e/.tmp/userdata/<uuid>/` per app launch so parallel agents
> running `pnpm test:e2e` from different worktrees don't share drafts
> / config / recent files, and a failing teardown can't leak state
> into the developer's real account. Production / dev runs leave the
> var unset and the OS default applies. Other apps embedding
> `electron-core-ui` can opt into the same convention by reading their
> own `<APPNAME>_USER_DATA_OVERRIDE` and forwarding to `app.setPath`
> at the same boot location.

- `<uuid>` is generated on first open by `ensureFolderUuid` /
  `ensureFileUuid` and stored at the top level of the project's root
  file (under `FileServiceConfig.uuidKey`, default `_uuid`) so renames /
  moves of the project directory don't lose the link.
- One draft file per dirty unit.
- Tombstones serialize as `{ __tombstone: true, snapshot: … }`.
- `.last-opened` holds a numeric epoch-ms; `DraftStore.markOpened()` is
  called from `FileService.attachDraftStore()` on the first attach for a
  project (a de-duplicated repeat attach for the same one skips it, see
  below), so the marker stays fresh as long as the user keeps returning
  to the project. There is no on-disk `filePath` sidecar anywhere in
  the draft tree — the store is fully path-agnostic, which means the
  user can rename or move the project file outside the app and the
  drafts still resolve correctly on next open (the UUID in the project
  content is the only identity we need).

### Write cadence

- Debounced 300 ms after the last mutation on a unit (override via
  `DraftStoreOptions.debounceMs`).
- Atomic: `atomicWriteFile()` — temp + rename.

### Lifecycle

| Trigger | Action |
| --- | --- |
| Unit becomes dirty | Draft file created / updated (debounced). |
| Unit saved | Draft file deleted after the reference commit. |
| Unit un-dirtied via undo | Draft file deleted. |
| App crash | Draft files survive. |
| Project reopened | Drafts auto-restored — each unit is marked dirty via `registry.mutate` (or `markDeleted` for tombstones); `file:drafts-restored { count }` broadcasts once so the host app can push a toast via `<Toaster>`. |
| Project abandoned for >30 days | At next app boot, `sweepOrphanedDrafts` reaps any draft directory whose `.last-opened` stamp is older than `DEFAULT_DRAFT_MAX_AGE_DAYS` (30). Age-based reaping is path-agnostic — it won't nuke drafts for a project the user simply renamed or moved outside the app. |
| Tab closed without saving | Drafts kept silently; next open re-restores them. |
| Explicit "Discard all changes" | Drafts deleted. |

### `attachDraftStore` is idempotent per project

`FileService.attachDraftStore({ rootDir, uuid, ... })` is safe to call
more than once for the SAME `(rootDir, uuid)` pair without re-emitting
`file:drafts-restored` or re-reading drafts from disk — a repeat call
joins the first one and resolves to the same restored-count, whether
that first call has already settled or is still reading from disk.

This matters because host apps commonly reach it from more than one
code path for a single "open": e.g. a reactive `onStateChanged`
listener that fires as soon as the file's path is visible, AND the
explicit caller that awaited the open. Un-de-duplicated, both callers
read the on-disk drafts and broadcast `file:drafts-restored`
independently — restoring correctly (both agree on the count) but
firing the recovery toast twice for one open.

Two boundaries the de-duplication deliberately does NOT cross:

- a call for a genuinely different project (a different
  `(rootDir, uuid)`) still drops the old store and attaches the new
  one — callers must NOT `detachDraftStore()` first, since that would
  reset the identity and re-arm the duplicate broadcast;
- `detachDraftStore()` (which `close()` calls) clears the recorded
  identity, so closing a project and reopening the SAME one later in
  the session restores its drafts afresh.

The identity is the PROJECT only. `extension` / `serialize` /
`deserialize` describe how that one project's drafts are read and
written, so callers that reach `attachDraftStore` for the same project
must pass matching ones; disagreeing about them would not produce a
second attach, it would just mean whichever call arrived first decided
the on-disk draft format. An attach that is superseded mid-flight — a
project switch or a `close()` landing while it is still reading the
disk — abandons itself: it restores nothing and stays silent, leaving
the newer attach in charge.

### Wire-up

```typescript
// Main process, at project open
const restored = await getFileService().attachDraftStore({
  rootDir: join(app.getPath('userData'), 'drafts'),
  uuid,
  extension: persistenceConfig.extension,
  serialize: (v) => serialize(v, persistenceConfig.format),
  deserialize: (raw) => deserialize(raw, persistenceConfig.format)
})

// Renderer
import { useDraftsRestored } from 'electron-core-ui/renderer'

useDraftsRestored(({ count }) => {
  toasterService.push('app', {
    title: 'Drafts restored',
    body: `Recovered ${count} unsaved edit${count === 1 ? '' : 's'} from the last session.`,
    durationMs: 5000
  })
})

// App boot
await FileService.cleanupOrphanedDrafts(join(app.getPath('userData'), 'drafts'))
```

## Other files under `userData`

Beyond documents and drafts, a few services keep small state files of their own
directly under `app.getPath('userData')`. They are listed here so the on-disk
footprint is answerable from one page:

| Path | Owner | Contents |
|------|-------|----------|
| `firewall/state.json` | `permissionService` | the user's whitelist + blacklist, as two arrays of `FirewallOrigin`. The project-derived origins, the infra ports and the system allowlist are **not** persisted — they are re-supplied on every boot |
| `privacy/consent.json` | `ConsentService` | the consent audit trail: `{ version: 1, gates: { <id>: { granted, consentedAt, policyVersion } } }`. The user-editable boolean itself lives in the settings store — deleting this file loses the trail, never the choice. Both read and write are non-throwing: an unreadable file starts a fresh trail, a failed write is logged and swallowed. See [Privacy](./Privacy.md) |

## `@TreatEmptyAsUndefined`

Decorator that normalizes `null`, `undefined`, and `""` to `undefined`
for the marked property — before checksum calculation and before
serialization. Whitespace-only strings (`"   "`, `" "`) are **not**
normalized.

```typescript
class Note {
  @TreatEmptyAsUndefined() body: string | null | undefined
}
```

Rationale: rich-text editors (Milkdown and similar) leave `""` behind
when the user clears all content. Without this decorator, an empty
note would register as a change vs. a never-filled field and trip the
dirty flag falsely.

## Runtime ID Tracking

Every save unit carries a stable `runtimeId` string that survives
renames, moves, and reorders. Passed back through events and IPC so
renderer components can scope to a single unit (see
`useUnitDirtyState`).

`idProperty` on `@fileNaming` is still the classic affordance for
identifying a file across reorderings — the ID lives in the object
but isn't part of the filename.

```typescript
@fileNaming({
  pattern: '{index} - {name}',
  idProperty: 'id'  // runtime-only, not persisted in the filename
})
```

## Migration Note

The current on-disk layout is the result of one historical breaking
change applied before any production distribution:

- `_index.json5` → `index.<ext>`.
- `{index} - {TYPE} - {name}.{ext}` → `{index} - {name}.{ext}`.
- Old projects must be re-created; no auto-migration is provided (the
  product was not yet distributed when this change landed).
