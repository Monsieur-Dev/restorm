import { describe, it, expect } from 'vitest'
import type { FolderItem, Scenario } from '../../../shared/types/collections'
import { deepCloneItem, cloneItemInTree, generateUniqueId, ID_REFERENCE_KEYS, REASSIGNED_ID_CONTAINER_KEYS } from './treeManipulation'

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
    // A top-level param declaration (distinct from a node's own config.params
    // below) — same key name as a Request's query `params`, scoped to
    // type==='scenario' in reassignTreeIds (see its JSDoc).
    params: [
      { id: 'param-1', name: 'Input', dataType: 'string', required: true }
    ],
    nodes: [
      // Ports named to match the edge below — proves the exclusion (they
      // must stay 'out'/'in' on the clone, not become fresh ids).
      { id: 'node-1', kind: 'httpRequest', config: { requestId: 'req-child', note: 'see req-child docs' },
        inputs: [], outputs: [{ id: 'out', name: 'out' }], position: { x: 0, y: 0 } },
      { id: 'node-2', kind: 'log', config: {},
        inputs: [{ id: 'in', name: 'in' }], outputs: [], position: { x: 10, y: 10 } },
      // An `input` node: its config.params (InputParam[]) is a narrow,
      // separately-handled exception — distinct from both the ports above
      // and the top-level `params` above.
      { id: 'node-3', kind: 'input', config: { params: [{ id: 'ip-1', name: 'x', valueType: { type: 'string', value: '' } }] },
        inputs: [], outputs: [{ id: 'value', name: 'value' }], position: { x: 20, y: 20 } }
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

  /**
   * REVERSED BY DESIGN DECISION — not a fix chasing green. This test used to
   * assert the exact opposite:
   *
   *   it('leaves scenario-scoped node/edge ids intact (edges still point at their nodes)', () => {
   *     const clone = deepCloneItem(makeScenario() as unknown as FolderItem) as unknown as Scenario
   *     expect(clone.nodes[0]?.id).toBe('node-1')
   *     expect(clone.edges[0]?.from.nodeId).toBe('node-1')
   *     expect(clone.edges[0]?.to.nodeId).toBe('node-2')
   *   })
   *
   * That encoded a deliberate, independently-verified design decision: node
   * ids are scenario-scoped (no cross-scenario global lookup exists), so
   * leaving them untouched on Clone was provably safe. The product rule
   * cloning follows is now broader — every id-bearing object in a cloned
   * subtree gets a fresh id, recursively, with no exception for "provably
   * safe today": the invariant "ids are never duplicated" doesn't decay when
   * a future refactor adds a global lookup, "scenario-scoped today" can. So
   * nodes and edges are no longer exempt — only ports are, and for a
   * completely different reason (see the JSDoc on `reassignTreeIds`: a port
   * id is a structural label copied from a static kind template, not
   * instance identity, so reassigning it would be an outright regression,
   * not a stricter application of the rule).
   */
  it('gives every node and edge a fresh id, with the edge remapped to follow the cloned nodes', () => {
    const original = makeScenario()
    const clone = deepCloneItem(original as unknown as FolderItem) as unknown as Scenario

    // Every node's own id is fresh...
    expect(clone.nodes[0]?.id).not.toBe('node-1')
    expect(clone.nodes[1]?.id).not.toBe('node-2')
    expect(clone.nodes[2]?.id).not.toBe('node-3')
    // ...and so is the edge's own id.
    expect(clone.edges[0]?.id).not.toBe('e-1')

    // The edge still connects the SAME two nodes — just their NEW ids...
    expect(clone.edges[0]?.from.nodeId).toBe(clone.nodes[0]?.id)
    expect(clone.edges[0]?.to.nodeId).toBe(clone.nodes[1]?.id)
    // ...never the original's (a dangling reference would be silent — this
    // is the assertion that catches it).
    expect(clone.edges[0]?.from.nodeId).not.toBe('node-1')
    expect(clone.edges[0]?.to.nodeId).not.toBe('node-2')
  })

  it('leaves every port id exactly as it was — a port is a structural label, not an instance id', () => {
    const clone = deepCloneItem(makeScenario() as unknown as FolderItem) as unknown as Scenario
    expect(clone.nodes[0]?.outputs[0]?.id).toBe('out')
    expect(clone.nodes[1]?.inputs[0]?.id).toBe('in')
    expect(clone.nodes[2]?.outputs[0]?.id).toBe('value')
  })

  it('gives every Scenario.params[] entry (top-level param declarations) a fresh id', () => {
    const clone = deepCloneItem(makeScenario() as unknown as FolderItem) as unknown as Scenario
    expect(clone.params[0]?.id).not.toBe('param-1')
  })

  it("does NOT touch a REQUEST's own params[] (query KeyValues) — the key-name collision with Scenario.params is scoped to type==='scenario' only", () => {
    const request = {
      id: 'req-1', name: 'Req', type: 'http',
      params: [{ id: 'qp-1', key: 'foo', value: { type: 'string', value: 'bar' } }]
    } as unknown as FolderItem
    const clone = deepCloneItem(request) as unknown as { params: { id: string }[] }
    expect(clone.params[0]?.id).toBe('qp-1')
  })

  it("gives an input node's config.params[] (InputParam) a fresh id — cheap to include, though nothing resolves it by id", () => {
    const clone = deepCloneItem(makeScenario() as unknown as FolderItem) as unknown as Scenario
    const cfg = clone.nodes[2]?.config as { params: { id: string }[] }
    expect(cfg.params[0]?.id).not.toBe('ip-1')
  })
})

/** A minimal connect/close node pair — the fixture for the
 * `config.connectionNodeId` remap, kept separate from `makeScenario()` so
 * the concern under test (a cross-node reference used by 23 scenario node
 * kinds, e.g. a `socketioClose` node referencing its `socketioConnect`
 * node) reads on its own. */
function makeScenarioWithConnectionPair(): Scenario {
  return {
    type: 'scenario', id: 'scn-conn', name: 'Socket Scenario', tags: [], params: [],
    nodes: [
      { id: 'connect-1', kind: 'socketioConnect', config: {},
        inputs: [], outputs: [{ id: 'connected', name: 'connected' }, { id: 'others', name: 'others' }], position: { x: 0, y: 0 } },
      { id: 'close-1', kind: 'socketioClose', config: { connectionNodeId: 'connect-1' },
        inputs: [{ id: 'on', name: 'on' }], outputs: [], position: { x: 10, y: 0 } }
    ],
    edges: [],
    items: []
  } as unknown as Scenario
}

describe('deepCloneItem — config.connectionNodeId remap (23 scenario node kinds share this key)', () => {
  it("remaps a close node's connectionNodeId to follow its cloned connect node, never the original", () => {
    const original = makeScenarioWithConnectionPair()
    const clone = deepCloneItem(original as unknown as FolderItem) as unknown as Scenario
    const newConnectId = clone.nodes[0]?.id
    const closeCfg = clone.nodes[1]?.config as { connectionNodeId?: string }

    expect(closeCfg.connectionNodeId).toBe(newConnectId)
    expect(closeCfg.connectionNodeId).not.toBe('connect-1')
    // Original is untouched.
    const originalCloseCfg = original.nodes[1]?.config as { connectionNodeId?: string }
    expect(originalCloseCfg.connectionNodeId).toBe('connect-1')
  })
})

describe("deepCloneItem — a request's project-target quickConfigs[]", () => {
  it("gives every quickConfigs[] entry a fresh id, and remaps its own requestId onto the clone", () => {
    // `quickConfigs` is an ad-hoc field every request model declares (not
    // part of the formal FolderItem union), so `deepCloneItem`'s JSON
    // round-trip carries it verbatim unless explicitly reassigned — found
    // live, mid-e2e-run, by the sidebar-clone suite: a cloned request kept
    // its quick config's original id AND (before this fix) its stale
    // requestId, since nothing walked into `quickConfigs` at all.
    const request = {
      id: 'req-1', name: 'Req', type: 'http',
      quickConfigs: [{ id: 'qc_1', name: 'Prod', requestId: 'req-1', storageTarget: 'project', fields: { url: 'https://example.com' } }]
    } as unknown as FolderItem
    const clone = deepCloneItem(request) as unknown as { id: string, quickConfigs: { id: string, requestId: string }[] }

    expect(clone.quickConfigs[0]?.id).not.toBe('qc_1')
    // Self-referential: the config lives ON the request it names, so its
    // own requestId must follow the SAME clone's new id — never the
    // original's, and never left stale.
    expect(clone.quickConfigs[0]?.requestId).toBe(clone.id)
    expect(clone.quickConfigs[0]?.requestId).not.toBe('req-1')
  })
})

describe('deepCloneItem — config.scenarioId remap (already correct — this locks it down)', () => {
  it("remaps a runScenario node's config.scenarioId to follow the OTHER scenario cloned in the same subtree", () => {
    // A folder holding two sibling scenarios, one with a `runScenario` node
    // pointing at the other — both get cloned together, so both land fresh
    // ids in the same idMap pass, and the cross-scenario reference should
    // follow. This already worked before this ticket (`scenarioId` was
    // already in ID_REFERENCE_KEYS) — nothing here changes behavior, it
    // just names and locks it down the way the existing test already does
    // for `requestId`.
    const folder = {
      id: 'folder-1', name: 'Folder', configuration: {}, items: [
        { type: 'scenario', id: 'scn-target', name: 'Target', tags: [], params: [], nodes: [], edges: [] },
        { type: 'scenario', id: 'scn-caller', name: 'Caller', tags: [], params: [], nodes: [
          { id: 'run-1', kind: 'runScenario', config: { scenarioId: 'scn-target' }, inputs: [], outputs: [], position: { x: 0, y: 0 } }
        ], edges: [] }
      ]
    } as unknown as FolderItem

    const clone = deepCloneItem(folder) as unknown as { items: Scenario[] }
    const [target, caller] = clone.items
    const runCfg = caller?.nodes[0]?.config as { scenarioId?: string }

    expect(runCfg.scenarioId).toBe(target?.id)
    expect(runCfg.scenarioId).not.toBe('scn-target')
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

/**
 * A scenario exercising every id-bearing container `reassignTreeIds` now
 * recurses into for scenarios — top-level `params`, `nodes`, `edges`, and an
 * `input` node's `config.params` — PLUS the one container it deliberately
 * does NOT: `inputs`/`outputs` (ports). An edge pair (`node-a`→`node-b`) AND
 * a connect/close pair (`node-d`/`node-e`, `config.connectionNodeId`) so
 * BOTH reference kinds have something real to resolve. Kept separate from
 * `makeScenario()` / `makeEnvironmentFolder()` so this fixture's
 * completeness is self-evident rather than coupled to what other unit tests
 * happen to exercise.
 */
function makeScenarioWithEverything(): FolderItem {
  return {
    type: 'scenario', id: 'scn-full', name: 'Full', tags: [],
    params: [{ id: 'param-1', name: 'Input', dataType: 'string', required: true }],
    nodes: [
      { id: 'node-a', kind: 'httpRequest', config: {},
        inputs: [{ id: 'env', name: 'env' }], outputs: [{ id: 'response', name: 'response' }], position: { x: 0, y: 0 } },
      { id: 'node-b', kind: 'log', config: {},
        inputs: [{ id: 'on', name: 'on' }], outputs: [], position: { x: 10, y: 0 } },
      { id: 'node-c', kind: 'input', config: { params: [{ id: 'ip-1', name: 'x' }] },
        inputs: [], outputs: [{ id: 'value', name: 'value' }], position: { x: 20, y: 0 } },
      { id: 'node-d', kind: 'socketioConnect', config: {},
        inputs: [], outputs: [{ id: 'connected', name: 'connected' }], position: { x: 30, y: 0 } },
      { id: 'node-e', kind: 'socketioClose', config: { connectionNodeId: 'node-d' },
        inputs: [{ id: 'on', name: 'on' }], outputs: [], position: { x: 40, y: 0 } }
    ],
    edges: [
      { id: 'edge-1', from: { nodeId: 'node-a', portId: 'response' }, to: { nodeId: 'node-b', portId: 'on' } }
    ],
    items: []
  } as unknown as FolderItem
}

/**
 * The primary guarantee this ticket makes for a scenario is NOT "ids look
 * different" — a clone whose ids are all fresh but whose edges/config still
 * point at the ORIGINAL's nodes would pass a bare freshness check and be
 * silently broken (an edge either can't resolve, or worse, resolves into
 * the source graph). So the FIRST assertion below is resolution: every
 * node-id reference in the clone (`edges[].from/to.nodeId`,
 * `config.connectionNodeId`) must name a node that exists IN THE CLONE, and
 * the clone's own node ids must be disjoint from the source's — together
 * those two facts are what rule out both "nothing was reassigned" and
 * "reassigned but not remapped". Freshness (no id anywhere overlaps the
 * source, ports excepted) is asserted after, as a consequence to also lock
 * down — not the thing being guaranteed.
 *
 * A scenario cannot honestly claim "zero id overlap ANYWHERE in the clone"
 * for the freshness check either — ports are deliberately unchanged, by
 * design. Asserting a blind zero-overlap walk would either false-fail on
 * the ports or need a silent carve-out baked into the walker (reintroducing
 * the hand-maintained exclusion list this ticket family exists to kill), so
 * that check is split into two explicit assertions instead: everything
 * except ports fresh and non-overlapping, every port id unchanged.
 *
 * `REASSIGNED_ID_CONTAINER_KEYS` is deliberately NOT a general "add any
 * id-bearing container here" list — a hand-maintained list is fine as a
 * pure inclusion mechanism (folders/environments/lists, nothing
 * deliberately left out), but that reasoning does not carry over once the
 * rule is "everything, recursively": at that scope the list is an explicit
 * CONTRACT over `FolderItem`'s own container surface, with two documented,
 * reasoned exclusions WITHIN that surface (ports: a structural label, not
 * identity; `config`: opaque per-kind data, with one narrow named exception
 * for `config.params`). It is NOT a claim that every id-bearing array in the
 * whole persisted format is covered — per-protocol request models
 * (`src/shared/types/requests/*.ts`) can and do declare id-bearing arrays
 * outside the `FolderItem` union (`quickConfigs`, `headers`, STOMP
 * `subscriptions`, OData `batchSubRequests`), which this fixture-bounded
 * test structurally cannot see. See the fuller account of what is and isn't
 * covered in `REASSIGNED_ID_CONTAINER_KEYS`'s own JSDoc in
 * `treeManipulation.ts`.
 */
describe('deepCloneItem — exhaustive id coverage for scenarios (container-key-agnostic)', () => {
  /** Every node id declared anywhere in a value (`ScenarioNode.id`,
   * identified structurally by having both `kind` and `id`, not by calling
   * into production code). */
  function declaredNodeIds(node: unknown, out = new Set<string>()): Set<string> {
    if (Array.isArray(node)) { for (const child of node) declaredNodeIds(child, out); return out }
    if (node === null || typeof node !== 'object') return out
    const rec = node as Record<string, unknown>
    if (typeof rec['kind'] === 'string' && typeof rec['id'] === 'string') out.add(rec['id'])
    for (const value of Object.values(rec)) declaredNodeIds(value, out)
    return out
  }

  /** Every node-id REFERENCE anywhere in a value: an edge endpoint
   * (`from.nodeId`/`to.nodeId`) or `config.connectionNodeId`. */
  function referencedNodeIds(node: unknown, out: string[] = []): string[] {
    if (Array.isArray(node)) { for (const child of node) referencedNodeIds(child, out); return out }
    if (node === null || typeof node !== 'object') return out
    const rec = node as Record<string, unknown>
    for (const key of ['nodeId', 'connectionNodeId']) {
      const v = rec[key]
      if (typeof v === 'string') out.push(v)
    }
    for (const value of Object.values(rec)) referencedNodeIds(value, out)
    return out
  }

  it("every node-id reference in the clone resolves to a node THAT EXISTS IN THE CLONE, and the clone's node ids never overlap the source's", () => {
    const original = makeScenarioWithEverything()
    const clone = deepCloneItem(original)

    const sourceNodeIds = declaredNodeIds(original)
    const cloneNodeIds = declaredNodeIds(clone)
    const cloneReferences = referencedNodeIds(clone)

    // The fixture must actually exercise both reference kinds, or this test
    // would pass vacuously.
    expect(sourceNodeIds.size).toBe(5)
    expect(cloneReferences.length).toBeGreaterThanOrEqual(3) // edge.from + edge.to + connectionNodeId

    // The clone's own node ids are fresh — disjoint from the source. (Catches
    // "nothing was reassigned": if it weren't, this would fail on its own.)
    expect(cloneNodeIds.size).toBe(sourceNodeIds.size)
    for (const id of cloneNodeIds) expect(sourceNodeIds.has(id)).toBe(false)

    // Every reference in the clone resolves to one of the clone's OWN node
    // ids. (Catches "reassigned but not remapped": ids would be fresh above,
    // but a stale reference here would name something outside `cloneNodeIds`
    // — either a source id or nothing at all.)
    for (const ref of cloneReferences) expect(cloneNodeIds.has(ref)).toBe(true)
  })

  /** Every id anywhere in a value EXCEPT inside `inputs`/`outputs` (ports) —
   * deliberately independent of `REASSIGNED_ID_CONTAINER_KEYS`, walking by
   * key name rather than calling into the production code, so it can't pass
   * "by agreeing" with it. */
  function allIdsExceptPorts(node: unknown, out: string[] = []): string[] {
    if (Array.isArray(node)) { for (const child of node) allIdsExceptPorts(child, out); return out }
    if (node === null || typeof node !== 'object') return out
    const rec = node as Record<string, unknown>
    if (typeof rec['id'] === 'string') out.push(rec['id'])
    for (const [key, value] of Object.entries(rec)) {
      if (key === 'inputs' || key === 'outputs') continue
      allIdsExceptPorts(value, out)
    }
    return out
  }

  /** Every port id (`inputs[].id` + `outputs[].id`) on every node, anywhere
   * in a value. */
  function allPortIds(node: unknown, out: string[] = []): string[] {
    if (Array.isArray(node)) { for (const child of node) allPortIds(child, out); return out }
    if (node === null || typeof node !== 'object') return out
    const rec = node as Record<string, unknown>
    for (const key of ['inputs', 'outputs']) {
      const arr = rec[key]
      if (Array.isArray(arr)) {
        for (const p of arr) {
          const pid = (p as { id?: unknown } | undefined)?.id
          if (typeof pid === 'string') out.push(pid)
        }
      }
    }
    for (const value of Object.values(rec)) allPortIds(value, out)
    return out
  }

  // Named up front, same self-check discipline as the environment-folder
  // guard: catches the FIXTURE losing a branch, not a future container type
  // it doesn't yet exercise — extend `makeScenarioWithEverything` (and these
  // two lists) when one is added.
  const SOURCE_NON_PORT_IDS = ['scn-full', 'param-1', 'node-a', 'node-b', 'node-c', 'node-d', 'node-e', 'ip-1', 'edge-1']
  const SOURCE_PORT_IDS = ['env', 'response', 'on', 'value', 'connected', 'on']

  it('reassigns every non-port id, and leaves every port id exactly as it was', () => {
    const original = makeScenarioWithEverything()
    const sourceIds = allIdsExceptPorts(original)
    expect(sourceIds.sort()).toEqual([...SOURCE_NON_PORT_IDS].sort())
    const sourcePortIds = allPortIds(original)
    expect(sourcePortIds.sort()).toEqual([...SOURCE_PORT_IDS].sort())

    const clone = deepCloneItem(original)
    const cloneIds = allIdsExceptPorts(clone)
    const clonePortIds = allPortIds(clone)

    // Everything except ports: fresh, no overlap with the source.
    expect(cloneIds).toHaveLength(sourceIds.length)
    expect(new Set(cloneIds).size).toBe(cloneIds.length)
    for (const id of cloneIds) expect(sourceIds).not.toContain(id)

    // Ports: untouched — by design, not an oversight.
    expect(clonePortIds.sort()).toEqual([...sourcePortIds].sort())
  })
})

describe('REASSIGNED_ID_CONTAINER_KEYS', () => {
  it('lists every container key this ticket adds, alongside the pre-existing ones', () => {
    // A minimal, deliberately-flat assertion — the real coverage guards are
    // the container-key-agnostic tests above, which fail on a regression
    // here without needing to be kept in sync with this list by hand.
    expect(REASSIGNED_ID_CONTAINER_KEYS).toEqual([
      'items', 'environments', 'customValueLists',
      'enumDefinitions', 'subEnvironments', 'entries',
      'nodes', 'edges', 'quickConfigs'
    ])
  })
})

/**
 * An environment folder wiring up every id REFERENCE a clone must follow but
 * that nothing walked before: a request's `authenticationRequestId`, an
 * `apiUpdate` config's `authenticationRequestId`, an enum-typed variable's
 * `enumDefinitionId`, and a scenario action's `quickConfigId`. All four
 * targets live INSIDE this subtree, so cloning the folder must rebind every
 * one of them onto the copy.
 */
function makeReferenceRichFolder(): FolderItem {
  return {
    id: 'root-env', name: 'API', folderType: 'environment', configuration: {}, fileFormatVersion: 1,
    apiUpdate: { sourceUrl: 'https://example.com/spec.json', authenticationRequestId: 'auth-1' },
    enumDefinitions: [
      { id: 'enum-1', name: 'Status', values: ['open', 'closed'], matchingRules: [] }
    ],
    environments: [
      {
        id: 'env-1', name: 'Default',
        variables: [
          { id: 'kv-1', key: 'status', value: { type: 'enum', value: 'open', enumDefinitionId: 'enum-1' } },
          { id: 'kv-2', key: 'statuses', value: { type: 'enumList', value: ['open'], enumDefinitionId: 'enum-1' } }
        ]
      }
    ],
    items: [
      { type: 'auth', id: 'auth-1', name: 'Login' },
      {
        type: 'http', id: 'req-1', name: 'List pets', method: 'GET', url: '',
        authenticationRequestId: 'auth-1',
        quickConfigs: [{ id: 'qc-1', name: 'Staging', requestId: 'req-1', storageTarget: 'project', fields: {} }]
      },
      {
        type: 'scenario', id: 'scn-1', name: 'Smoke', tags: [], params: [], edges: [],
        nodes: [
          { id: 'node-1', kind: 'httpRequest', config: { requestId: 'req-1', quickConfigId: 'qc-1' },
            inputs: [], outputs: [], position: { x: 0, y: 0 } }
        ]
      }
    ]
  } as unknown as FolderItem
}

describe('deepCloneItem — id references the remap walk did not follow', () => {
  it("rebinds a request's authenticationRequestId onto the CLONED auth request", () => {
    const clone = deepCloneItem(makeReferenceRichFolder()) as unknown as { items: { id: string, authenticationRequestId?: string }[] }
    const clonedAuthId = clone.items[0]?.id
    const clonedRequest = clone.items[1]

    expect(clonedAuthId).not.toBe('auth-1')
    expect(clonedRequest?.authenticationRequestId).toBe(clonedAuthId)
    expect(clonedRequest?.authenticationRequestId).not.toBe('auth-1')
  })

  it("rebinds an apiUpdate config's authenticationRequestId onto the CLONED auth request", () => {
    // The same key name on a different carrier — a folder's spec-refresh
    // config rather than a request. One Set entry covers both, because the
    // remap walk matches by key name wherever it appears.
    const clone = deepCloneItem(makeReferenceRichFolder()) as unknown as {
      items: { id: string }[], apiUpdate: { authenticationRequestId?: string }
    }
    expect(clone.apiUpdate.authenticationRequestId).toBe(clone.items[0]?.id)
    expect(clone.apiUpdate.authenticationRequestId).not.toBe('auth-1')
  })

  it('rebinds an enum-typed variable onto the CLONED EnumDefinition, single and list alike', () => {
    // EnumDefinition ids ARE reassigned on clone, so an unfollowed
    // `enumDefinitionId` does not merely go stale — it resolves against the
    // ORIGINAL folder's definition, since several call sites look an
    // EnumDefinition up by a global id sweep over the whole tree.
    const clone = deepCloneItem(makeReferenceRichFolder()) as unknown as {
      enumDefinitions: { id: string }[],
      environments: { variables: { value: { enumDefinitionId?: string } }[] }[]
    }
    const clonedEnumId = clone.enumDefinitions[0]?.id
    const vars = clone.environments[0]?.variables ?? []

    expect(clonedEnumId).not.toBe('enum-1')
    expect(vars[0]?.value.enumDefinitionId).toBe(clonedEnumId)
    expect(vars[1]?.value.enumDefinitionId).toBe(clonedEnumId)
  })

  it("rebinds a scenario action's quickConfigId onto the CLONED request's quick config", () => {
    // A quick config is resolved by id scoped to the request that owns it
    // (`resolveProjectConfigFields`, shared/scenarioActionOverride.ts), so a
    // clone whose node still names the ORIGINAL config's id finds nothing on
    // its own request and silently degrades to "config missing" — the action
    // loses its base configuration. Live since quickConfigs[] entries started
    // getting fresh ids on clone.
    const clone = deepCloneItem(makeReferenceRichFolder()) as unknown as {
      items: ({ quickConfigs?: { id: string }[], nodes?: { config: { quickConfigId?: string } }[] })[]
    }
    const clonedQuickConfigId = clone.items[1]?.quickConfigs?.[0]?.id
    const nodeConfig = clone.items[2]?.nodes?.[0]?.config

    expect(clonedQuickConfigId).not.toBe('qc-1')
    expect(nodeConfig?.quickConfigId).toBe(clonedQuickConfigId)
  })

  it('leaves a reference whose target sits OUTSIDE the cloned subtree pointing at the original', () => {
    // Cloning just the request: the auth request it names is a sibling, not a
    // descendant, so it is not part of this clone and no new id exists for
    // it. The reference must stay on the original — rewriting it would be
    // worse than leaving it, and dropping it would break the binding.
    const folder = makeReferenceRichFolder() as unknown as { items: [FolderItem, FolderItem, FolderItem] }
    const request = folder.items[1]
    const clone = deepCloneItem(request) as unknown as { authenticationRequestId?: string }

    expect(clone.authenticationRequestId).toBe('auth-1')
  })
})

/**
 * `ID_REFERENCE_KEYS` cannot be derived from the type system: half the live
 * references live in `ScenarioNode.config`, an untyped `Record<string,
 * unknown>` whose key names exist only as strings. So the list is hand-held,
 * and the guard against it drifting again is this table — every reference
 * field known to be live, with where it is declared, asserted individually.
 * A key silently dropped fails here loudly; a key ADDED without being
 * audited fails the exact-membership assertion at the bottom, which is the
 * prompt to decide whether it belongs.
 */
describe('ID_REFERENCE_KEYS', () => {
  const liveReferenceFields: readonly { key: string, declaredIn: string, target: string }[] = [
    { key: 'listId', declaredIn: 'shared/types/valueTypes/CustomListValue.ts + CustomListMultiValue.ts', target: 'CustomValueList.id' },
    { key: 'requestId', declaredIn: "ScenarioNode.config (request-binding kinds) + QuickConfig.requestId", target: 'a request' },
    { key: 'scenarioId', declaredIn: "ScenarioNode.config of the 'runScenario' kind", target: 'Scenario.id' },
    { key: 'nodeId', declaredIn: 'shared/types/scenario.ts — ScenarioEdge.from/to.nodeId', target: 'ScenarioNode.id' },
    { key: 'connectionNodeId', declaredIn: "ScenarioNode.config of the connect/close kinds", target: 'the connecting ScenarioNode.id' },
    { key: 'quickConfigId', declaredIn: 'shared/scenarioActionOverride.ts — QUICK_CONFIG_ID_KEY, read off ScenarioNode.config', target: 'QuickConfig.id on the bound request' },
    { key: 'authenticationRequestId', declaredIn: 'shared/types/requests/BaseRequest.ts + shared/types/baseTypes.ts (ApiUpdateConfig)', target: "a request of type 'auth'" },
    { key: 'enumDefinitionId', declaredIn: 'shared/types/valueTypes/EnumValue.ts + EnumListValue.ts', target: 'EnumDefinition.id' }
  ]

  for (const { key, declaredIn, target } of liveReferenceFields) {
    it(`follows ${key} (${declaredIn} → ${target})`, () => {
      expect(ID_REFERENCE_KEYS.has(key)).toBe(true)
    })
  }

  it('carries nothing beyond the audited list — an unlisted key is either dead weight or an unreviewed addition', () => {
    expect([...ID_REFERENCE_KEYS].sort()).toEqual(liveReferenceFields.map((f) => f.key).sort())
  })

  it('never follows portId — a port id is a structural label, never reassigned, and rewriting it would break the clone against its own edges', () => {
    expect(ID_REFERENCE_KEYS.has('portId')).toBe(false)
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
