import { describe, it, expect } from 'vitest'
import type { FolderItem, Scenario } from '../../../shared/types/collections'
import { deepCloneItem, cloneItemInTree, generateUniqueId, REASSIGNED_ID_CONTAINER_KEYS } from './treeManipulation'

describe('generateUniqueId', () => {
  it('produces a UUID, never colliding within a tight loop', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 10_000; i++) ids.add(generateUniqueId())
    // Date.now()+Math.random() collided within a millisecond; crypto.randomUUID never does.
    expect(ids.size).toBe(10_000)
    expect(generateUniqueId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

/**
 * Cloning a tree item (sidebar "Clone") must produce a FULLY independent copy:
 * a fresh id for the item AND every descendant, no shared arrays/objects (so
 * adding a child to the copy never touches the original), and references to the
 * cloned ids remapped onto the new ones. Scenarios + folders both apply.
 */
function makeScenario(): Scenario {
  return {
    type: 'scenario',
    id: 'scn-1',
    name: 'My Scenario',
    tags: [],
    params: [],
    nodes: [
      { id: 'node-1', kind: 'httpRequest', config: { requestId: 'req-child', note: 'see req-child docs' }, inputs: [], outputs: [], position: { x: 0, y: 0 } },
      { id: 'node-2', kind: 'log', config: {}, inputs: [], outputs: [], position: { x: 10, y: 10 } }
    ],
    edges: [
      { id: 'e-1', from: { nodeId: 'node-1', portId: 'out' }, to: { nodeId: 'node-2', portId: 'in' } }
    ],
    items: [
      { type: 'http', id: 'req-child', name: 'Child Req', method: 'GET', url: '' } as unknown as FolderItem
    ]
  } as unknown as Scenario
}

describe('deepCloneItem', () => {
  it('clones a scenario with a fresh id + fresh child ids, fully unshared', () => {
    const original = makeScenario()
    const clone = deepCloneItem(original as unknown as FolderItem) as unknown as Scenario

    // Fresh ids for the scenario and its child item.
    expect(clone.id).not.toBe(original.id)
    expect(clone.items?.[0]?.id).not.toBe('req-child')

    // Independent arrays/objects — mutating the clone must not touch the source.
    expect(clone.nodes).not.toBe(original.nodes)
    expect(clone.items).not.toBe(original.items)
    clone.items?.push({ type: 'http', id: 'added', name: 'Added' } as unknown as FolderItem)
    expect(original.items?.length).toBe(1)

    // Only the top-level clone is renamed; children keep their names.
    expect(clone.name).toBe('My Scenario (copy)')
    expect(clone.items?.[0]?.name).toBe('Child Req')
  })

  it('remaps references to cloned ids (a node bound to a child request follows the copy)', () => {
    const original = makeScenario()
    const clone = deepCloneItem(original as unknown as FolderItem) as unknown as Scenario
    const newChildId = clone.items?.[0]?.id
    const boundId = (clone.nodes[0]?.config as { requestId?: string }).requestId
    expect(boundId).toBe(newChildId)
    // Original is untouched.
    expect((original.nodes[0]?.config as { requestId?: string }).requestId).toBe('req-child')
  })

  it('does NOT rewrite a free-text field that merely contains a remapped id', () => {
    const original = makeScenario()
    const clone = deepCloneItem(original as unknown as FolderItem) as unknown as Scenario
    // `requestId` (a reference field) follows the clone, but `note` (free text)
    // must stay verbatim even though it contains the old child id.
    const cfg = clone.nodes[0]?.config as { requestId?: string; note?: string }
    expect(cfg.requestId).toBe(clone.items?.[0]?.id)
    expect(cfg.note).toBe('see req-child docs')
  })

  it('leaves scenario-scoped node/edge ids intact (edges still point at their nodes)', () => {
    const clone = deepCloneItem(makeScenario() as unknown as FolderItem) as unknown as Scenario
    expect(clone.nodes[0]?.id).toBe('node-1')
    expect(clone.edges[0]?.from.nodeId).toBe('node-1')
    expect(clone.edges[0]?.to.nodeId).toBe('node-2')
  })
})

/**
 * An environment folder exercising every container `reassignTreeIds` must
 * descend into: `enumDefinitions`, `environments` with a nested
 * `subEnvironments` chain, and a `customValueLists` entry with `entries`.
 */
function makeEnvironmentFolder(): FolderItem {
  return {
    id: 'root-env', name: 'Root', folderType: 'environment', configuration: {}, fileFormatVersion: 1,
    items: [],
    environments: [
      {
        id: 'env-1', name: 'Default', variables: [],
        subEnvironments: [
          { id: 'sub-1', name: 'Nested', variables: [],
            subEnvironments: [
              { id: 'sub-2', name: 'DeepNested', variables: [] }
            ] }
        ]
      }
    ],
    customValueLists: [
      { id: 'cvl-1', name: 'Colors', entries: [
        { id: 'entry-1', label: 'Red', value: 'FF0000' },
        { id: 'entry-2', label: 'Blue', value: '0000FF' }
      ] }
    ],
    enumDefinitions: [
      { id: 'enum-1', name: 'Status', values: ['open', 'closed'], matchingRules: [] },
      { id: 'enum-2', name: 'Kind', values: ['a', 'b'], matchingRules: [] }
    ]
  } as unknown as FolderItem
}

describe('deepCloneItem — the 3 containers this ticket adds', () => {
  it('gives every enumDefinitions[] a fresh id, none matching the source or each other', () => {
    const original = makeEnvironmentFolder()
    const clone = deepCloneItem(original) as unknown as { enumDefinitions: { id: string }[] }
    const sourceIds = (original as unknown as { enumDefinitions: { id: string }[] }).enumDefinitions.map((e) => e.id)
    const cloneIds = clone.enumDefinitions.map((e) => e.id)

    expect(cloneIds).toHaveLength(2)
    for (const id of cloneIds) expect(sourceIds).not.toContain(id)
    expect(new Set(cloneIds).size).toBe(cloneIds.length)
  })

  it('gives every level of Environment.subEnvironments[] a fresh id, top-level AND nested', () => {
    const original = makeEnvironmentFolder()
    const clone = deepCloneItem(original) as unknown as {
      environments: { id: string, subEnvironments: { id: string, subEnvironments: { id: string }[] }[] }[]
    }
    const env = clone.environments[0]
    const sub = env?.subEnvironments[0]
    const deepSub = sub?.subEnvironments[0]

    expect(env?.id).not.toBe('env-1')
    expect(sub?.id).not.toBe('sub-1')
    expect(deepSub?.id).not.toBe('sub-2')
    // All fresh ids are distinct from one another too.
    const ids = [env?.id, sub?.id, deepSub?.id]
    expect(new Set(ids).size).toBe(3)
  })

  it('gives every CustomValueList.entries[] a fresh id', () => {
    const original = makeEnvironmentFolder()
    const clone = deepCloneItem(original) as unknown as { customValueLists: { entries: { id: string }[] }[] }
    const sourceEntryIds = (original as unknown as { customValueLists: { entries: { id: string }[] }[] })
      .customValueLists[0]?.entries.map((e) => e.id) ?? []
    const cloneEntryIds = clone.customValueLists[0]?.entries.map((e) => e.id) ?? []

    expect(cloneEntryIds).toHaveLength(2)
    for (const id of cloneEntryIds) expect(sourceEntryIds).not.toContain(id)
    expect(new Set(cloneEntryIds).size).toBe(cloneEntryIds.length)
  })
})

/**
 * `REASSIGNED_ID_CONTAINER_KEYS` is a flat allowlist applied to every visited
 * node — exactly the construct that silently drifted out of date once
 * already (this ticket's own bug). A test that only asserts today's entries
 * are present would pass again the next time a new id-bearing container is
 * added to the type system without a matching entry here — the SAME failure
 * mode, reproduced. So instead of asserting the list's contents, this test
 * asserts the BEHAVIOUR the list exists to guarantee, using an id-collector
 * that walks generically (by structure, not by key name) and is therefore
 * blind to `REASSIGNED_ID_CONTAINER_KEYS` itself: it cannot pass "by
 * agreeing" with the production code, because it shares no code with it.
 */
describe('deepCloneItem — exhaustive id coverage (container-key-agnostic)', () => {
  /** Every id anywhere in a value, found generically (any key, any depth) —
   * deliberately independent of `REASSIGNED_ID_CONTAINER_KEYS` so a
   * container silently missing from the reassignment loop shows up here as
   * a leftover shared id, not as an assertion that mirrors the production
   * list back at itself. */
  function allIds(node: unknown, out: string[] = []): string[] {
    if (Array.isArray(node)) { for (const child of node) allIds(child, out); return out }
    if (node === null || typeof node !== 'object') return out
    const rec = node as Record<string, unknown>
    if (typeof rec['id'] === 'string') out.push(rec['id'])
    for (const value of Object.values(rec)) allIds(value, out)
    return out
  }

  // Named up front so the test can assert the fixture itself reaches every
  // one of them (guards against the fixture silently losing a branch, which
  // would otherwise make this test pass for the wrong reason). This only
  // catches the fixture LOSING a branch, not GAINING one: a future
  // id-bearing container type this fixture doesn't yet exercise passes
  // vacuously here, so extend `makeEnvironmentFolder` (and this list) when
  // one is added.
  const SOURCE_IDS = ['root-env', 'env-1', 'sub-1', 'sub-2', 'cvl-1', 'entry-1', 'entry-2', 'enum-1', 'enum-2']

  it('reassigns a fresh id to EVERY id-bearing descendant, however deeply nested, with no overlap with the source', () => {
    const original = makeEnvironmentFolder()
    const sourceIds = allIds(original)
    // The fixture itself must reach every container this ticket touches —
    // otherwise a missing container would silently pass below.
    expect(sourceIds.sort()).toEqual([...SOURCE_IDS].sort())

    const clone = deepCloneItem(original)
    const cloneIds = allIds(clone)

    expect(cloneIds).toHaveLength(sourceIds.length)
    expect(new Set(cloneIds).size).toBe(cloneIds.length)
    for (const id of cloneIds) expect(sourceIds).not.toContain(id)
  })
})

describe('REASSIGNED_ID_CONTAINER_KEYS', () => {
  it('lists every container key this ticket adds, alongside the pre-existing ones', () => {
    // A minimal, deliberately-flat assertion — the real coverage guard is the
    // container-key-agnostic test above, which fails on a regression here
    // without needing to be kept in sync with this list by hand.
    expect(REASSIGNED_ID_CONTAINER_KEYS).toEqual([
      'items', 'environments', 'customValueLists',
      'enumDefinitions', 'subEnvironments', 'entries'
    ])
  })
})

describe('cloneItemInTree', () => {
  it('clones a ROOT-level item back into the root list (no parent)', () => {
    const root: FolderItem[] = [
      { id: 'env-1', name: 'Env', items: [], environments: [{ id: 'e1', name: 'local' }], configuration: {} } as unknown as FolderItem
    ]
    const clone = cloneItemInTree(root, 'env-1')
    expect(clone).not.toBeNull()
    expect(root).toHaveLength(2)
    expect(root[1]?.id).not.toBe('env-1')
    expect(root[1]?.id).toBe(clone?.id)
    // Environment child got a fresh id too.
    const clonedEnvs = (root[1] as unknown as { environments: { id: string }[] }).environments
    expect(clonedEnvs[0]?.id).not.toBe('e1')
  })
})
