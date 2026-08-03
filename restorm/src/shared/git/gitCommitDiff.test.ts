import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { diffProjectEntities, flattenEntities, parseProjectYaml } from './gitCommitDiff'
// The renderer's rehydrate callback — the one the publish flow really
// passes (`usePushModal.ts`), and the only one that backfills ids.
import { processAfterDeserialization } from '../../renderer/src/utils/serialization'
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
    id, name, tags: [], configuration: {}, folderType: 'environment', environments: [], items
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

  it('reports a plain reorder at the container folder level', () => {
    // Same parent, different position: nothing about the requests changed,
    // but the folder was reorganised — the commit message should say so
    // (named once, on the container, not per shuffled item).
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

    expect(diffProjectEntities(before, after)).toEqual([{ kind: 'folder', name: 'Folder A', action: 'reordered' }])
  })

  it('does not report a reorder when membership changed (that churn is on the per-entity lines)', () => {
    const before = [
      { id: 'f1', name: 'A', tags: [], configuration: {}, items: [{ id: 'r1', name: 'One', type: 'http', tags: [] }] }
    ] as unknown as FolderItem[]
    const after = [
      { id: 'f1', name: 'A', tags: [], configuration: {}, items: [
        { id: 'r2', name: 'Two', type: 'http', tags: [] },
        { id: 'r1', name: 'One', type: 'http', tags: [] }
      ] }
    ] as unknown as FolderItem[]

    // r2 added; NO 'reordered' line (the set changed, not just the order).
    expect(diffProjectEntities(before, after)).toEqual([{ kind: 'request', name: 'Two', action: 'added' }])
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

/**
 * A project written before document ids were persisted carries no `id` at
 * all — the committed `Petstore.restorm` sample is exactly that file. The
 * publish flow parses the HEAD blob on one side and holds the live tree on
 * the other, then pairs entities BY id. When the loader minted those ids
 * randomly the two sides shared none, so an untouched project reported
 * every single entity as deleted AND added, and the generated commit
 * message was nonsense.
 */
describe('diffProjectEntities on a project whose ids are not persisted yet', () => {
  const legacySample = readFileSync(join(__dirname, '../../../tests/e2e/samples/Petstore.restorm'), 'utf-8')

  it('reports nothing at all when neither side changed', () => {
    // Two INDEPENDENT parses, as the publish flow really does it.
    const head = parseProjectYaml(legacySample, processAfterDeserialization)
    const live = parseProjectYaml(legacySample, processAfterDeserialization)

    expect(head.length).toBeGreaterThan(0)
    expect(diffProjectEntities(head, live)).toEqual([])
  })

  it('still reports the one entity that DID change', () => {
    // Guard against a vacuous pass: the diff must stay sensitive.
    const head = parseProjectYaml(legacySample, processAfterDeserialization)
    const live = parseProjectYaml(
      legacySample.replace('Returns a single pet', 'Returns exactly one pet'),
      processAfterDeserialization
    )

    expect(diffProjectEntities(head, live)).toEqual([
      { kind: 'request', name: 'Find pet by ID', action: 'modified' }
    ])
  })
})

/**
 * Both maps in this module are built with `out.set(item.id, …)`. An entity
 * whose `id` is missing keys its entry under the JS value `undefined` — and
 * every further id-less entity overwrites that same slot. The result is not
 * a harmless extra row: the two sides of a diff each end up holding a
 * DIFFERENT entity under the same phantom key, so the engine happily
 * compares one entity against another and reports the difference as a
 * change to whichever one happened to land there last.
 *
 * An entity with no id has nothing stable to pair on, so it takes no part in
 * the diff at all. Its children do: they carry their own ids, and dropping
 * them would turn a malformed parent into silent, unreported work loss.
 */
describe('id-less entities never collide in the id-keyed maps', () => {
  const idless = (name: string, items: FolderItem[] = []): Scenario =>
    ({ name, type: 'scenario', tags: [], params: [], nodes: [], edges: [], items }) as unknown as Scenario

  it('keeps every id-less entity out of flattenEntities, however many there are', () => {
    const flat = flattenEntities([idless('Alpha'), idless('Beta'), makeRequest('r1', 'Find pet')])

    expect(flat.has(undefined as unknown as string)).toBe(false)
    expect([...flat.keys()]).toEqual(['r1'])
  })

  it('still indexes the id-bearing children of an id-less parent', () => {
    const flat = flattenEntities([idless('Alpha', [makeRequest('r1', 'Find pet')])])

    expect(flat.has('r1')).toBe(true)
    // The breadcrumb still names the parent it really sits under.
    expect(flat.get('r1')?.path).toEqual(['Alpha'])
  })

  it('never reports a change to one id-less entity as a change to another', () => {
    // Two id-less siblings on the "before" side, three on the "after" side.
    // Keyed by `undefined`, each side keeps only its LAST one — so the
    // engine compares "Beta" against "Gamma" and calls it a modification of
    // a scenario that was in fact merely added, and never existed before.
    const before: FolderItem[] = [idless('Alpha'), idless('Beta')]
    const after: FolderItem[] = [idless('Alpha'), idless('Beta'), idless('Gamma')]

    expect(diffProjectEntities(before, after)).toEqual([])
  })

  it('stays sensitive to a real change sitting next to an id-less entity', () => {
    // Guard against a vacuous pass: skipping the id-less entity must not
    // blind the engine to everything around it.
    const before: FolderItem[] = [idless('Alpha'), makeRequest('r1', 'Find pet', { notes: 'old' })]
    const after: FolderItem[] = [idless('Alpha'), makeRequest('r1', 'Find pet', { notes: 'new' })]

    expect(diffProjectEntities(before, after)).toEqual([
      { kind: 'request', name: 'Find pet', action: 'modified' }
    ])
  })

  it('stays sensitive to a change nested INSIDE an id-less entity', () => {
    const before: FolderItem[] = [idless('Alpha', [makeRequest('r1', 'Find pet', { notes: 'old' })])]
    const after: FolderItem[] = [idless('Alpha', [makeRequest('r1', 'Find pet', { notes: 'new' })])]

    expect(diffProjectEntities(before, after)).toEqual([
      { kind: 'request', name: 'Find pet', action: 'modified' }
    ])
  })
})
