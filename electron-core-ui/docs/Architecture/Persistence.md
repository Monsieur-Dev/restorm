# Persistence

Flexible serialization supporting single file or folder-based storage,
with an in-memory save-unit model and crash-recovery drafts.

## Formats

| Format | Extension | Use Case |
|--------|-----------|----------|
| JSON | `.json` | Standard, readable |
| YAML | `.yaml` | Human-friendly |
| JSON5 | `.json5` | Comments, trailing commas |

## Single File Mode

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
the user's data, and an outright error on a read-only file where a clean
refusal belongs. The same ordering applies to any future step that writes
during open. Only the first-ever open of a UUID-less file re-reads the file
(the stamp changed the bytes, and `diskDigest` must match what is on disk
or the external-change guard misfires).

The library deliberately renders no message of its own. It broadcasts
`file:open-rejected` with `{ path, code, detail }` and leaves the wording to
the host: the main process typically ships far fewer locales than the
renderer, so a user-facing explanation composed in main would reach many
users in the wrong language.

A validator that throws is treated as a refusal, not as approval — a
document whose acceptability is unknown is exactly what the gate exists to
keep out.

## Folder Mode

Hierarchical structure based on decorators.

### On-disk layout

```
collection/
├── .ecu.conf              # Format configuration
├── index.yaml             # Root metadata (see @separateFolders owner)
├── 01 - Users/
│   ├── index.yaml
│   ├── 01 - List.yaml
│   └── 02 - Create.yaml
└── 02 - Products/
    └── index.yaml
```

- Index files are named `index.<ext>` (no underscore prefix).
- Sub-folder directory names follow `{counter} - {name}`.
- Request (or other file-type) file names follow `{counter} - {name}.{ext}` — no type prefix (e.g. no `GET`, `SOAP`).
- Extension is uniform across the project, driven by `PersistenceConfig.format`.
- Counters are stable: they only move on an explicit reorder. Duplicate names within a folder are legal — the counter differentiates them.

### Decorator-driven structure

```typescript
class Collection {
  name: string

  @separateFolders()
  @fileNaming({ pattern: '{index} - {name}' })
  folders: Folder[]

  @separateFiles()
  @fileNaming({ pattern: '{index} - {name}', idProperty: 'id' })
  environments: Environment[]
}
```

### Config file

`.ecu.conf` at folder root stores format:

```yaml
format: yaml
```

### Atomic writes

Every disk write — single-file save, index file, each unit file, and
each re-indexed sibling — goes through `atomicWriteFile()`: serialize
to `<target>.<uuid>.tmp` adjacent to the target, then `fs.rename` into
place. A crash mid-write leaves the previous target intact.

### Files rewritten outside the app

`FileService` keeps a SHA-1 digest of the bytes it last read from — or
wrote to — the open file (`diskDigest`, refreshed by `open()`,
`save()` and `saveAs()`). `hasExternalChange()` re-reads the file and
compares; anything else on disk means a third party rewrote it.

The case that matters is a `git checkout` / `git pull` run from a
terminal while the project is open. The in-memory tree still holds the
pre-checkout content and autosave fires about a second later, so
without a guard the checkout is silently undone on disk.

`save()` therefore refuses to write when `hasExternalChange()` is true,
returns `false`, and broadcasts **`file:externally-changed`** exactly
once per divergence (a per-second autosave must not re-prompt every
tick). The app resolves it either way:

| Resolution | Call | Effect |
| --- | --- | --- |
| Use the version on disk | re-open the path | the normal file-open path re-hydrates and re-baselines the digest |
| Keep the in-memory version | `acceptExternalChange()` then save | re-baselines on the new bytes so the ordinary save overwrites them |
| — | `save(content, { force: true })` | same overwrite in one call, for callers that own the save themselves |

Both paths re-arm the guard, so a *second* external rewrite prompts
again. Folder mode leaves `diskDigest` null (no single file to digest),
which makes the guard inert there.

Renderer surface: `useFileExternallyChanged(cb)` subscribes to the
broadcast; `useFileService()` exposes `showExternalChangeDialog()` (a
native message box — the decision is about whose work survives, so it
must be impossible to click past) and `acceptExternalChange()`.

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

| Operation | In-memory effect | On save |
| --- | --- | --- |
| **Create** | New unit, no `reference`, only `draft`. | Write new file. |
| **Modify** | Update `draft`. | Atomic overwrite of reference file. |
| **Delete** | `draft = Tombstone(snapshot)`. | Delete reference file. |
| **Rename** | `draft.name` updated. | `fs.rename()` on file or folder. |
| **Move** | Same `runtimeId`, new parent. | `fs.rename()` across folders. |
| **Reorder** | Counters flip, siblings become dirty. | Cascade — every affected sibling saved together. |

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
