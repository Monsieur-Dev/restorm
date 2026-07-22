import { describe, it, expect } from 'vitest'
import { diffProjectEntities, parseProjectYaml } from './gitCommitDiff'
import type { FolderItem, Folder, EnvironmentFolder } from '../types/folderTypes'
import type { Scenario } from '../types/scenario'
import type { Request } from '../types/requests'

function makeRequest(id: string, name: string, extra: Record<string, unknown> = {}): Request {
  return { id, name, type: 'http', tags: [], ...extra } as unknown as Request
}

function makeFolder(id: string, name: string, items: FolderItem[] = [], extra: Record<string, unknown> = {}): Folder {
  return { id, name, tags: [], configuration: {}, items, ...extra } as unknown as Folder
}

function makeEnvironmentFolder(id: string, name: string, items: FolderItem[] = []): EnvironmentFolder {
  return {
    id, name, tags: [], configuration: {}, folderType: 'environment', environments: [], fileFormatVersion: 1, items
  } as unknown as EnvironmentFolder
}

function makeScenario(id: string, name: string, items: FolderItem[] = []): Scenario {
  return { id, name, type: 'scenario', tags: [], params: [], nodes: [], edges: [], items } as unknown as Scenario
}

describe('diffProjectEntities', () => {
  it('reports an added entity present only on the "after" side', () => {
    const before: FolderItem[] = []
    const after: FolderItem[] = [makeRequest('r1', 'Find pet by ID')]
    expect(diffProjectEntities(before, after)).toEqual([
      { kind: 'request', name: 'Find pet by ID', action: 'added' }
    ])
  })

  it('reports a deleted entity present only on the "before" side', () => {
    const before: FolderItem[] = [makeRequest('r1', 'Find pet by ID')]
    const after: FolderItem[] = []
    expect(diffProjectEntities(before, after)).toEqual([
      { kind: 'request', name: 'Find pet by ID', action: 'deleted' }
    ])
  })

  it('reports a modified entity whose own fields changed, matched by id (not array position)', () => {
    const before: FolderItem[] = [makeRequest('r1', 'Find pet by ID', { notes: 'old' })]
    const after: FolderItem[] = [makeRequest('r1', 'Find pet by ID', { notes: 'new' })]
    expect(diffProjectEntities(before, after)).toEqual([
      { kind: 'request', name: 'Find pet by ID', action: 'modified' }
    ])
  })

  it('reports NO change for an unchanged entity, even after a reorder', () => {
    const a = makeRequest('r1', 'A')
    const b = makeRequest('r2', 'B')
    const before: FolderItem[] = [a, b]
    const after: FolderItem[] = [b, a] // reordered, otherwise identical
    expect(diffProjectEntities(before, after)).toEqual([])
  })

  it('classifies folders, environment folders, and scenarios distinctly', () => {
    const before: FolderItem[] = []
    const after: FolderItem[] = [
      makeFolder('f1', 'My Folder'),
      makeEnvironmentFolder('e1', 'My Project'),
      makeScenario('s1', 'Checkout flow')
    ]
    const changes = diffProjectEntities(before, after)
    expect(changes).toContainEqual({ kind: 'folder', name: 'My Folder', action: 'added' })
    expect(changes).toContainEqual({ kind: 'environmentFolder', name: 'My Project', action: 'added' })
    expect(changes).toContainEqual({ kind: 'scenario', name: 'Checkout flow', action: 'added' })
  })

  it('diffs nested items independently — a child change does NOT flag the parent folder as modified', () => {
    const childBefore = makeRequest('r1', 'Child', { notes: 'old' })
    const childAfter = makeRequest('r1', 'Child', { notes: 'new' })
    const before: FolderItem[] = [makeFolder('f1', 'Parent', [childBefore])]
    const after: FolderItem[] = [makeFolder('f1', 'Parent', [childAfter])]
    expect(diffProjectEntities(before, after)).toEqual([
      { kind: 'request', name: 'Child', action: 'modified' }
    ])
  })

  it('a scenario\'s own request-container items are walked the same as a folder\'s', () => {
    const before: FolderItem[] = [makeScenario('s1', 'Flow', [])]
    const after: FolderItem[] = [makeScenario('s1', 'Flow', [makeRequest('r1', 'New step')])]
    expect(diffProjectEntities(before, after)).toEqual([
      { kind: 'request', name: 'New step', action: 'added' }
    ])
  })

  it('produces a deterministic order (folders/env-folders, then requests, then scenarios; each group alphabetical) independent of insertion order', () => {
    const before: FolderItem[] = []
    const after: FolderItem[] = [
      makeScenario('s1', 'Zeta scenario'),
      makeRequest('r2', 'Beta request'),
      makeFolder('f1', 'Zulu folder'),
      makeRequest('r1', 'Alpha request'),
      makeEnvironmentFolder('e1', 'Env folder')
    ]
    const changes = diffProjectEntities(before, after)
    expect(changes.map((c) => c.name)).toEqual([
      'Zulu folder', 'Env folder', 'Alpha request', 'Beta request', 'Zeta scenario'
    ])
  })
})

describe('parseProjectYaml', () => {
  it('returns an empty array for a null blob (file did not exist at that commit)', () => {
    expect(parseProjectYaml(null)).toEqual([])
  })

  it('returns an empty array when the YAML has no collections field', () => {
    expect(parseProjectYaml('someOtherKey: 1\n')).toEqual([])
  })

  it('parses a real single-file project YAML into FolderItem[] with ids preserved, with no rehydration by default', () => {
    const yaml = [
      'collections:',
      '  - id: r1',
      '    name: Find pet by ID',
      '    type: http',
      '    tags: []'
    ].join('\n')
    const items = parseProjectYaml(yaml)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'r1', name: 'Find pet by ID' })
  })

  it('does NOT backfill a missing id when no rehydrate callback is given (main-process / MCP callers only need JSON-safe data)', () => {
    const yaml = [
      'collections:',
      '  - name: Find pet by ID',
      '    type: http',
      '    tags: []'
    ].join('\n')
    const items = parseProjectYaml(yaml)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBeUndefined()
  })

  it('applies a given rehydrate callback to the parsed collections — the seam the renderer plugs `processAfterDeserialization` into', () => {
    const yaml = [
      'collections:',
      '  - id: r1',
      '    name: Find pet by ID',
      '    type: http',
      '    tags: []'
    ].join('\n')
    const rehydrate = (items: FolderItem[]): FolderItem[] => items.map((item) => ({ ...item, name: `rehydrated:${item.name}` }))
    const items = parseProjectYaml(yaml, rehydrate)
    expect(items[0]?.name).toBe('rehydrated:Find pet by ID')
  })
})

describe('reorganising the tree', () => {
  it('reports a moved entity, so a reorganisation can be published', () => {
    // Nothing about the request itself changes when it is dragged into
    // another folder. Without this the publish flow saw an unchanged
    // project, opened with an empty message and a disabled button — the
    // user could not commit work that was already on disk.
    const before = [
      { id: 'f1', name: 'Folder A', tags: [], configuration: {}, items: [{ id: 'r1', name: 'Find pet', type: 'http', tags: [] }] },
      { id: 'f2', name: 'Folder B', tags: [], configuration: {}, items: [] }
    ] as unknown as FolderItem[]
    const after = [
      { id: 'f1', name: 'Folder A', tags: [], configuration: {}, items: [] },
      { id: 'f2', name: 'Folder B', tags: [], configuration: {}, items: [{ id: 'r1', name: 'Find pet', type: 'http', tags: [] }] }
    ] as unknown as FolderItem[]

    const changes = diffProjectEntities(before, after)

    expect(changes).toEqual([{ kind: 'request', name: 'Find pet', action: 'moved' }])
  })

  it('still reports a plain reorder as no change at all', () => {
    // Same parent, different position: the file's byte order changes, the
    // project does not.
    const before = [
      { id: 'f1', name: 'Folder A', tags: [], configuration: {}, items: [
        { id: 'r1', name: 'Find pet', type: 'http', tags: [] },
        { id: 'r2', name: 'Add pet', type: 'http', tags: [] }
      ] }
    ] as unknown as FolderItem[]
    const after = [
      { id: 'f1', name: 'Folder A', tags: [], configuration: {}, items: [
        { id: 'r2', name: 'Add pet', type: 'http', tags: [] },
        { id: 'r1', name: 'Find pet', type: 'http', tags: [] }
      ] }
    ] as unknown as FolderItem[]

    expect(diffProjectEntities(before, after)).toEqual([])
  })

  it('reports a move as moved, not as modified, when the content is untouched', () => {
    const before = [
      { id: 'f1', name: 'A', tags: [], configuration: {}, items: [{ id: 'r1', name: 'Find pet', type: 'http', tags: [], url: 'https://a' }] },
      { id: 'f2', name: 'B', tags: [], configuration: {}, items: [] }
    ] as unknown as FolderItem[]
    const after = [
      { id: 'f1', name: 'A', tags: [], configuration: {}, items: [] },
      { id: 'f2', name: 'B', tags: [], configuration: {}, items: [{ id: 'r1', name: 'Find pet', type: 'http', tags: [], url: 'https://CHANGED' }] }
    ] as unknown as FolderItem[]

    // Content changed too: "modified" wins — it is the more informative of
    // the two, and the move is implied by the new location.
    expect(diffProjectEntities(before, after)).toEqual([{ kind: 'request', name: 'Find pet', action: 'modified' }])
  })
})
