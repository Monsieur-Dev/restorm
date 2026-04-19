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
<userData>/drafts/<projectUuid>/<runtimeId>.draft.<ext>
<userData>/drafts/<projectUuid>/.project-path        # marker for orphan sweep
```

- `<projectUuid>` is generated on first open and stored in the project's
  root `index.<ext>` so renames / moves of the project directory don't
  lose the link.
- One draft file per dirty unit.
- Tombstones serialize as `{ __tombstone: true, snapshot: … }`.

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
| Project reopened | Drafts auto-restored — each unit is marked dirty via `registry.mutate` (or `markDeleted` for tombstones); `file:drafts-restored { count }` broadcasts so the host app can push a toast via `<Toaster>`. |
| Project directory deleted on disk | At next app boot, `sweepOrphanedDrafts` removes drafts whose `.project-path` points nowhere. |
| Tab closed without saving | Drafts kept silently; next open re-restores them. |
| Explicit "Discard all changes" | Drafts deleted. |

### Wire-up

```typescript
// Main process, at project open
const restored = await getFileService().attachDraftStore({
  rootDir: join(app.getPath('userData'), 'drafts'),
  projectUuid,
  projectPath,
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

OYO-183 is a **breaking change** for on-disk layouts:

- `_index.json5` → `index.<ext>`.
- `{index} - {TYPE} - {name}.{ext}` → `{index} - {name}.{ext}`.
- Old projects must be re-created; no auto-migration is provided (the
  product was not yet distributed when this change landed).
