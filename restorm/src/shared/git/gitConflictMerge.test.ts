import { describe, it, expect } from 'vitest'
import { buildMergedProjectTree } from './gitConflictMerge'
import type { FolderItem, Folder } from '../types/folderTypes'
import type { Request } from '../types/requests'

function makeRequest(id: string, name: string, extra: Record<string, unknown> = {}): Request {
  return { id, name, type: 'http', tags: [], ...extra } as unknown as Request
}

function makeFolder(id: string, name: string, items: FolderItem[] = []): Folder {
  return { id, name, tags: [], configuration: {}, items } as unknown as Folder
}

function makeEnvFolder(id: string, name: string, version: string, extra: Record<string, unknown> = {}): FolderItem {
  return {
    id,
    name,
    tags: [],
    configuration: {},
    folderType: 'environment',
    items: [],
    apiDocumentation: { sourceType: 'openapi', api: { title: 'Petstore', version }, models: {}, groups: {}, operations: [] },
    ...extra
  } as unknown as FolderItem
}

describe('buildMergedProjectTree', () => {
  it('substitutes a resolved pick for its conflicting entity, keyed by id', () => {
    const ours: FolderItem[] = [makeRequest('r1', 'Ours name')]
    const theirs: FolderItem[] = [makeRequest('r1', 'Theirs name')]
    const resolvedById = { r1: makeRequest('r1', 'Resolved name') }
    const merged = buildMergedProjectTree(ours, theirs, resolvedById)
    expect(merged).toEqual([makeRequest('r1', 'Resolved name')])
  })

  it('keeps a non-conflicting entity from ours untouched', () => {
    const ours: FolderItem[] = [makeRequest('r1', 'Untouched')]
    const theirs: FolderItem[] = [makeRequest('r1', 'Untouched')]
    const merged = buildMergedProjectTree(ours, theirs, {})
    expect(merged).toEqual(ours)
  })

  it('folds in a top-level entity added on theirs only', () => {
    const ours: FolderItem[] = [makeRequest('r1', 'Existing')]
    const theirs: FolderItem[] = [makeRequest('r1', 'Existing'), makeRequest('r2', 'New on theirs')]
    const merged = buildMergedProjectTree(ours, theirs, {})
    expect(merged.map((i) => i.id)).toEqual(['r1', 'r2'])
  })

  it('folds a theirs-only child into a folder that exists on both sides', () => {
    const ours: FolderItem[] = [makeFolder('f1', 'Shared folder', [makeRequest('r1', 'A')])]
    const theirs: FolderItem[] = [makeFolder('f1', 'Shared folder', [makeRequest('r1', 'A'), makeRequest('r2', 'New nested')])]
    const merged = buildMergedProjectTree(ours, theirs, {})
    const folder = merged[0] as Folder
    expect(folder.items.map((i) => i.id)).toEqual(['r1', 'r2'])
  })

  it('does NOT recover an entity added inside a folder that does not exist on our side at all (documented limitation)', () => {
    const ours: FolderItem[] = [makeRequest('r1', 'Existing')]
    const theirs: FolderItem[] = [makeRequest('r1', 'Existing'), makeFolder('f-new', 'New folder', [makeRequest('r2', 'Nested new')])]
    const merged = buildMergedProjectTree(ours, theirs, {})
    // The new folder itself IS a top-level theirs-only addition, so it IS
    // folded in (top-level entities are handled) — its own nested content
    // came straight from theirs, so this case is actually fine; the real
    // limitation is a folder that exists on BOTH sides under DIFFERENT ids
    // per side, which this differ has no way to detect. Assert what
    // actually happens: the new folder + its nested request both appear.
    expect(merged.map((i) => i.id)).toEqual(['r1', 'f-new'])
    expect((merged[1] as Folder).items.map((i) => i.id)).toEqual(['r2'])
  })

  it('quick configs: merges in a theirs-only config even though the resolved pick came from ours', () => {
    const oursConfig = { id: 'q1', name: 'Staging', requestId: 'r1', storageTarget: 'project' as const, fields: {}, createdAt: '', updatedAt: '' }
    const theirsConfig = { id: 'q2', name: 'Prod', requestId: 'r1', storageTarget: 'project' as const, fields: {}, createdAt: '', updatedAt: '' }
    const ours: FolderItem[] = [makeRequest('r1', 'Untouched', { quickConfigs: [oursConfig] })]
    const theirs: FolderItem[] = [makeRequest('r1', 'Untouched', { quickConfigs: [theirsConfig] })]
    // No resolution needed — the request itself isn't otherwise conflicting,
    // so resolvedById is empty and `base` falls back to the `ours` item.
    const merged = buildMergedProjectTree(ours, theirs, {})
    const request = merged[0] as unknown as { quickConfigs: { name: string }[] }
    expect(request.quickConfigs.map((c) => c.name).sort()).toEqual(['Prod', 'Staging'])
  })

  it('quick configs: does not duplicate or touch a same-named config already present on both sides', () => {
    const config = { id: 'q1', name: 'Staging', requestId: 'r1', storageTarget: 'project' as const, fields: { url: 'a' }, createdAt: '', updatedAt: '' }
    const ours: FolderItem[] = [makeRequest('r1', 'Untouched', { quickConfigs: [config] })]
    const theirs: FolderItem[] = [makeRequest('r1', 'Untouched', { quickConfigs: [{ ...config, id: 'q2' }] })]
    const merged = buildMergedProjectTree(ours, theirs, {})
    const request = merged[0] as unknown as { quickConfigs: { id: string, name: string }[] }
    expect(request.quickConfigs).toEqual([config])
  })

  it('quick configs: a same-name conflict keeps the resolved pick\'s config untouched (no silent overwrite)', () => {
    const oursConfig = { id: 'q1', name: 'Staging', requestId: 'r1', storageTarget: 'project' as const, fields: { url: 'a' }, createdAt: '', updatedAt: '' }
    const theirsConfig = { id: 'q2', name: 'Staging', requestId: 'r1', storageTarget: 'project' as const, fields: { url: 'b' }, createdAt: '', updatedAt: '' }
    const ours: FolderItem[] = [makeRequest('r1', 'Ours name', { quickConfigs: [oursConfig] })]
    const theirs: FolderItem[] = [makeRequest('r1', 'Theirs name', { quickConfigs: [theirsConfig] })]
    // The request conflicts (name differs) — user resolves toward ours,
    // still holding ours's version of the "Staging" config.
    const resolvedById = { r1: makeRequest('r1', 'Ours name', { quickConfigs: [oursConfig] }) }
    const merged = buildMergedProjectTree(ours, theirs, resolvedById)
    const request = merged[0] as unknown as { quickConfigs: { id: string, name: string }[] }
    expect(request.quickConfigs).toEqual([oursConfig])
  })

  it('AC#6: auto-resolves apiDocumentation to the higher version, even with no manual resolution at all', () => {
    const ours: FolderItem[] = [makeEnvFolder('e1', 'My API', '1.0.0')]
    const theirs: FolderItem[] = [makeEnvFolder('e1', 'My API', '2.0.0')]
    const merged = buildMergedProjectTree(ours, theirs, {})
    const envFolder = merged[0] as unknown as { apiDocumentation: { api: { version: string } } }
    expect(envFolder.apiDocumentation.api.version).toBe('2.0.0')
  })

  it('AC#6: falls back to the newer commit timestamp when versions are equal', () => {
    const ours: FolderItem[] = [makeEnvFolder('e1', 'My API', '1.0.0')]
    const theirs: FolderItem[] = [makeEnvFolder('e1', 'My API', '1.0.0', {
      apiDocumentation: { sourceType: 'openapi', api: { title: 'Petstore v2', version: '1.0.0' }, models: {}, groups: {}, operations: [] }
    })]
    const merged = buildMergedProjectTree(ours, theirs, {}, { ours: 100, theirs: 200 })
    const envFolder = merged[0] as unknown as { apiDocumentation: { api: { title: string } } }
    expect(envFolder.apiDocumentation.api.title).toBe('Petstore v2')
  })

  it('AC#6: applies the winning apiDocumentation regardless of the manual pick for the entity\'s other fields', () => {
    const ours: FolderItem[] = [makeEnvFolder('e1', 'Ours name', '1.0.0', { notes: 'ours notes' })]
    const theirs: FolderItem[] = [makeEnvFolder('e1', 'Theirs name', '2.0.0', { notes: 'theirs notes' })]
    // The environmentFolder conflicts on `notes` (apiDocumentation is
    // excluded from that decision — see gitConflictModel.ts) — user
    // resolves toward ours, which currently holds version 1.0.0.
    const resolvedById = { e1: makeEnvFolder('e1', 'Ours name', '1.0.0', { notes: 'ours notes' }) }
    const merged = buildMergedProjectTree(ours, theirs, resolvedById)
    const envFolder = merged[0] as unknown as { name: string, apiDocumentation: { api: { version: string } } }
    expect(envFolder.name).toBe('Ours name')
    // Documentation still auto-resolves to the higher version, even though
    // the user's manual pick (for `notes`) came from `ours`.
    expect(envFolder.apiDocumentation.api.version).toBe('2.0.0')
  })

  it('does not drop an ours-only child when the user picks theirs for the folder\'s own fields (no data loss)', () => {
    // Regression test: `mergeItem` used to derive the child SET from `base`
    // (the resolved pick for the folder's own fields, e.g. `notes`), not
    // from `item` (the ours-side node actually being walked). Picking
    // "theirs" for the folder therefore silently swapped in theirs' child
    // list too — an ours-only child (never itself part of the conflict)
    // vanished instead of auto-merging in like any other one-side addition.
    const ours: FolderItem[] = [makeFolder('f1', 'Ours folder name', [makeRequest('r1', 'Shared'), makeRequest('b1', 'Ours-only child')])]
    const theirs: FolderItem[] = [makeFolder('f1', 'Theirs folder name', [makeRequest('r1', 'Shared')])]
    // The folder ITSELF conflicts (name differs) — user picks "theirs".
    const resolvedById = { f1: makeFolder('f1', 'Theirs folder name', [makeRequest('r1', 'Shared')]) }
    const merged = buildMergedProjectTree(ours, theirs, resolvedById)
    const folder = merged[0] as Folder
    expect(folder.name).toBe('Theirs folder name')
    expect(folder.items.map((i) => i.id)).toEqual(['r1', 'b1'])
  })

  it('recurses into a resolved folder\'s children independently of the resolved snapshot\'s own stale items', () => {
    const ours: FolderItem[] = [makeFolder('f1', 'Ours folder name', [makeRequest('r1', 'Child A')])]
    const theirs: FolderItem[] = [makeFolder('f1', 'Theirs folder name', [makeRequest('r1', 'Child A'), makeRequest('r2', 'Child B on theirs')])]
    // The folder ITSELF conflicts (name differs) — user picks "theirs" for
    // the folder's own fields, but the resolved snapshot's `items` was
    // cloned from `theirs` at pick-time; child merging must still be
    // computed independently (not just trust the resolved clone's items).
    const resolvedById = { f1: makeFolder('f1', 'Theirs folder name', [makeRequest('r1', 'Child A'), makeRequest('r2', 'Child B on theirs')]) }
    const merged = buildMergedProjectTree(ours, theirs, resolvedById)
    const folder = merged[0] as Folder
    expect(folder.name).toBe('Theirs folder name')
    expect(folder.items.map((i) => i.id)).toEqual(['r1', 'r2'])
  })
})

describe('buildMergedProjectTree — one-sided changes resolve without asking', () => {
  it('adopts their edit on an entity we never touched', () => {
    // The colleague renamed r1; we left it alone. Nobody contested it, so
    // it is not a conflict and carries no resolution pick — the merge must
    // still bring their rename in rather than silently keep the ancestor.
    const base: FolderItem[] = [makeRequest('r1', 'Original')]
    const ours: FolderItem[] = [makeRequest('r1', 'Original')]
    const theirs: FolderItem[] = [makeRequest('r1', 'Renamed by colleague')]

    const merged = buildMergedProjectTree(ours, theirs, {}, undefined, base)

    expect(merged[0]).toMatchObject({ id: 'r1', name: 'Renamed by colleague' })
  })

  it('keeps our edit on an entity they never touched', () => {
    const base: FolderItem[] = [makeRequest('r1', 'Original')]
    const ours: FolderItem[] = [makeRequest('r1', 'Renamed by me')]
    const theirs: FolderItem[] = [makeRequest('r1', 'Original')]

    const merged = buildMergedProjectTree(ours, theirs, {}, undefined, base)

    expect(merged[0]).toMatchObject({ id: 'r1', name: 'Renamed by me' })
  })

  it('keeps each side its own edit when the two touched different entities', () => {
    const base: FolderItem[] = [makeRequest('r1', 'One'), makeRequest('r2', 'Two')]
    const ours: FolderItem[] = [makeRequest('r1', 'One edited by me'), makeRequest('r2', 'Two')]
    const theirs: FolderItem[] = [makeRequest('r1', 'One'), makeRequest('r2', 'Two edited by them')]

    const merged = buildMergedProjectTree(ours, theirs, {}, undefined, base)

    expect(merged[0]).toMatchObject({ name: 'One edited by me' })
    expect(merged[1]).toMatchObject({ name: 'Two edited by them' })
  })

  it('leaves a contested entity to its resolution pick, never to the ancestor rule', () => {
    // Both sides moved: this IS a conflict, so the user's pick wins and
    // the one-sided shortcut must not fire.
    const base: FolderItem[] = [makeRequest('r1', 'Original')]
    const ours: FolderItem[] = [makeRequest('r1', 'Mine')]
    const theirs: FolderItem[] = [makeRequest('r1', 'Theirs')]
    const resolvedById = { r1: makeRequest('r1', 'Mine') as unknown as FolderItem }

    const merged = buildMergedProjectTree(ours, theirs, resolvedById, undefined, base)

    expect(merged[0]).toMatchObject({ name: 'Mine' })
  })

  it('without a supplied ancestor, behaves exactly as before (ours wins)', () => {
    const ours: FolderItem[] = [makeRequest('r1', 'Ours')]
    const theirs: FolderItem[] = [makeRequest('r1', 'Theirs')]

    const merged = buildMergedProjectTree(ours, theirs, {})

    expect(merged[0]).toMatchObject({ name: 'Ours' })
  })
})

describe('deletion semantics', () => {
  it('propagates a deletion the other side never contested', () => {
    // They removed the request, we never touched it: keeping it would
    // silently undo ordinary housekeeping, and the entity would come back
    // for them on their next pull.
    const base = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet'), makeRequest('r2', 'Add pet')])]
    const ours = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet'), makeRequest('r2', 'Add pet')])]
    const theirs = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet')])]

    const merged = buildMergedProjectTree(ours, theirs, {}, undefined, base)

    expect((merged[0] as Folder).items.map((i) => i.id)).toEqual(['r1'])
  })

  it('keeps an entity they deleted but we edited — the edit wins over the deletion', () => {
    // Work is never destroyed by someone else's delete: the edited entity
    // survives and reappears for whoever removed it.
    const base = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet'), makeRequest('r2', 'Add pet')])]
    const ours = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet'), makeRequest('r2', 'Add a pet, renamed')])]
    const theirs = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet')])]

    const merged = buildMergedProjectTree(ours, theirs, {}, undefined, base)

    expect((merged[0] as Folder).items.map((i) => i.name)).toEqual(['Find pet', 'Add a pet, renamed'])
  })

  it('honours OUR deletion when they left the entity alone', () => {
    const base = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet'), makeRequest('r2', 'Add pet')])]
    const ours = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet')])]
    const theirs = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet'), makeRequest('r2', 'Add pet')])]

    const merged = buildMergedProjectTree(ours, theirs, {}, undefined, base)

    expect((merged[0] as Folder).items.map((i) => i.id)).toEqual(['r1'])
  })

  it('brings back an entity we deleted but they edited', () => {
    const base = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet'), makeRequest('r2', 'Add pet')])]
    const ours = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet')])]
    const theirs = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet'), makeRequest('r2', 'Add pet, theirs')])]

    const merged = buildMergedProjectTree(ours, theirs, {}, undefined, base)

    expect((merged[0] as Folder).items.map((i) => i.name)).toEqual(['Find pet', 'Add pet, theirs'])
  })

  it('still adds an entity they created — a new entity is not a resurrection', () => {
    const base = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet')])]
    const ours = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet')])]
    const theirs = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet'), makeRequest('r9', 'Brand new')])]

    const merged = buildMergedProjectTree(ours, theirs, {}, undefined, base)

    expect((merged[0] as Folder).items.map((i) => i.id)).toEqual(['r1', 'r9'])
  })

  it('keeps every entity when no common ancestor is available', () => {
    // Without the ancestor there is no way to tell a deletion from an
    // addition, so the safe reading stands: nothing is dropped.
    const ours = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet')])]
    const theirs = [makeFolder('f1', 'Lab', [makeRequest('r1', 'Find pet'), makeRequest('r2', 'Add pet')])]

    const merged = buildMergedProjectTree(ours, theirs, {})

    expect((merged[0] as Folder).items.map((i) => i.id)).toEqual(['r1', 'r2'])
  })
})

describe("a request's documentation", () => {
  it('takes the newer commit when the two sides differ', () => {
    // Imported content the user never authored: asking them to arbitrate
    // it asks a question they cannot answer, so it resolves on its own.
    const ours = [makeRequest('r1', 'Find pet', { documentation: 'ours doc' })]
    const theirs = [makeRequest('r1', 'Find pet', { documentation: 'theirs doc' })]

    const merged = buildMergedProjectTree(ours, theirs, {}, { ours: 100, theirs: 200 })

    expect(merged[0]).toMatchObject({ documentation: 'theirs doc' })
  })

  it('keeps ours when our commit is the newer one', () => {
    const ours = [makeRequest('r1', 'Find pet', { documentation: 'ours doc' })]
    const theirs = [makeRequest('r1', 'Find pet', { documentation: 'theirs doc' })]

    const merged = buildMergedProjectTree(ours, theirs, {}, { ours: 300, theirs: 200 })

    expect(merged[0]).toMatchObject({ documentation: 'ours doc' })
  })

  it('keeps ours when there is no timestamp to compare', () => {
    const ours = [makeRequest('r1', 'Find pet', { documentation: 'ours doc' })]
    const theirs = [makeRequest('r1', 'Find pet', { documentation: 'theirs doc' })]

    const merged = buildMergedProjectTree(ours, theirs, {})

    expect(merged[0]).toMatchObject({ documentation: 'ours doc' })
  })
})

describe('deleting a folder the other side worked inside', () => {
  const baseTree = (): FolderItem[] => [
    makeFolder('f1', 'Dossier', [makeRequest('r1', 'Fiche animal', { url: 'https://example.com/1' })])
  ]

  it('keeps their edit when we deleted the folder around it', () => {
    // A folder's own fields are compared without its children, so a
    // deletion used to read as uncontested even when the colleague had
    // rewritten every request inside it — and their work vanished with
    // the folder, silently.
    const ours: FolderItem[] = []
    const theirs: FolderItem[] = [
      makeFolder('f1', 'Dossier', [makeRequest('r1', 'Fiche animal', { url: 'https://example.com/CHANGED' })])
    ]

    const merged = buildMergedProjectTree(ours, theirs, {}, undefined, baseTree())

    expect(merged).toHaveLength(1)
    const nested = (merged[0] as Folder).items
    expect((nested[0] as Request).url).toBe('https://example.com/CHANGED')
  })

  it('still honours the deletion when nobody touched anything inside', () => {
    const ours: FolderItem[] = []

    const merged = buildMergedProjectTree(ours, baseTree(), {}, undefined, baseTree())

    expect(merged).toEqual([])
  })

  it('keeps our edit when THEY deleted the folder around it', () => {
    const theirs: FolderItem[] = []
    const ours: FolderItem[] = [
      makeFolder('f1', 'Dossier', [makeRequest('r1', 'Fiche animal', { url: 'https://example.com/MINE' })])
    ]

    const merged = buildMergedProjectTree(ours, theirs, {}, undefined, baseTree())

    expect(merged).toHaveLength(1)
    const nested = (merged[0] as Folder).items
    expect((nested[0] as Request).url).toBe('https://example.com/MINE')
  })
})

describe('a project big enough to matter', () => {
  const LARGE = 500

  function bigTree(urlFor: (index: number) => string): FolderItem[] {
    return [makeFolder('big', 'Gros dossier', Array.from({ length: LARGE }, (_, index) =>
      makeRequest(`r${String(index)}`, `Requête ${String(index)}`, { url: urlFor(index) })
    ))]
  }

  it('merges a 500-request project with hundreds of conflicts in reasonable time', () => {
    // The deletion check walks whole subtrees, so an accidental quadratic
    // here would only show up on a real project — never on the handful of
    // entities the other tests use.
    const base = bigTree((i) => `https://example.com/${String(i)}`)
    const ours = bigTree((i) => (i % 2 === 0 ? `https://ours/${String(i)}` : `https://example.com/${String(i)}`))
    const theirs = bigTree((i) => (i % 2 === 0 ? `https://theirs/${String(i)}` : `https://example.com/${String(i)}`))

    const started = performance.now()
    const merged = buildMergedProjectTree(ours, theirs, {}, undefined, base)
    const elapsedMs = performance.now() - started

    expect((merged[0] as Folder).items).toHaveLength(LARGE)
    expect(elapsedMs).toBeLessThan(5000)
  })

  it('does not lose a single request when one side deletes the folder', () => {
    const base = bigTree((i) => `https://example.com/${String(i)}`)
    const theirs = bigTree((i) => `https://theirs/${String(i)}`)

    const merged = buildMergedProjectTree([], theirs, {}, undefined, base)

    expect((merged[0] as Folder).items).toHaveLength(LARGE)
  })
})

describe('successive round-trips with more than one other person', () => {
  const at = (url: string): FolderItem[] => [makeRequest('r1', 'Fiche animal', { url })]

  it('does not resurrect a version that was already arbitrated away', () => {
    // Round 1: Yoann and a colleague both edit; Yoann keeps the
    // colleague's value. The merge base then ADVANCES to that result —
    // reading it from HEAD instead would make round 2 compare against
    // the pre-resolution ancestor and offer the discarded value again.
    const round1 = buildMergedProjectTree(at('https://mine'), at('https://theirs'), {
      r1: makeRequest('r1', 'Fiche animal', { url: 'https://theirs' })
    }, undefined, at('https://origin'))
    expect((round1[0] as Request).url).toBe('https://theirs')

    // Round 2: a THIRD person edits the same request, starting from the
    // resolved state. Yoann has not touched it since.
    const round2 = buildMergedProjectTree(round1, at('https://third-person'), {}, undefined, round1)

    expect((round2[0] as Request).url).toBe('https://third-person')
  })

  it('keeps a third person\'s addition across a round-trip that resolved something else', () => {
    const base: FolderItem[] = [makeRequest('r1', 'Fiche animal', { url: 'https://origin' })]
    const ours: FolderItem[] = [makeRequest('r1', 'Fiche animal', { url: 'https://mine' })]
    const theirs: FolderItem[] = [
      makeRequest('r1', 'Fiche animal', { url: 'https://theirs' }),
      makeRequest('r2', 'Ajout du troisième', { url: 'https://added' })
    ]

    const merged = buildMergedProjectTree(ours, theirs, {
      r1: makeRequest('r1', 'Fiche animal', { url: 'https://mine' })
    }, undefined, base)

    // Arbitrating r1 in our favour must not take the unrelated addition
    // down with it.
    expect(merged).toHaveLength(2)
    expect((merged[1] as Request).name).toBe('Ajout du troisième')
  })
})
