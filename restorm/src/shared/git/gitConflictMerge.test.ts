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
