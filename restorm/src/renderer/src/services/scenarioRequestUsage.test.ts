import { describe, it, expect } from 'vitest'
import type { FolderItem } from '../../../shared/types/collections'
import {
  findScenariosUsingRequest,
  findScenariosUsingScenario,
  isRequestInScenarioSubtree,
  collectRequestScenarioRelations
} from './scenarioRequestUsage'

// Minimal fixtures — only the fields the walkers read. An env-folder (which
// `isAnyFolder` excludes) contains the scenario, so the walk must descend it via
// the `'items' in item` idiom, not `isAnyFolder`.
const boundReq = { type: 'http', id: 'req-bound', name: 'Bound elsewhere' }
const childReq = { type: 'http', id: 'req-child', name: 'Lives in scenario' }

function httpNode(id: string, requestId: string): { id: string; kind: string; config: { requestId: string }; inputs: never[]; outputs: never[]; position: { x: number; y: number } } {
  return { id, kind: 'httpRequest', config: { requestId }, inputs: [], outputs: [], position: { x: 0, y: 0 } }
}

const scenario = {
  type: 'scenario',
  id: 'scn',
  name: 'My scenario',
  tags: [],
  params: [],
  // Two boxes bind the external request; the child request is bound by none.
  nodes: [httpNode('n1', 'req-bound'), httpNode('n2', 'req-bound')],
  edges: [],
  items: [childReq]
}

const innerFolder = { id: 'f1', name: 'Folder', configuration: {}, items: [boundReq] }
const envFolder = {
  folderType: 'environment',
  id: 'env',
  name: 'Env folder',
  configuration: {},
  environments: [],
  items: [scenario, innerFolder]
}
const rootItems = [envFolder] as unknown as FolderItem[]
const scn = scenario as unknown as Parameters<typeof isRequestInScenarioSubtree>[0]

describe('findScenariosUsingRequest', () => {
  it('descends an env-folder to find the scenario binding the request', () => {
    const usages = findScenariosUsingRequest(rootItems, 'req-bound')
    expect(usages).toHaveLength(1)
    expect(usages[0]?.scenario.id).toBe('scn')
  })

  it('aggregates every node id that binds the request in one scenario', () => {
    expect(findScenariosUsingRequest(rootItems, 'req-bound')[0]?.nodeIds).toEqual(['n1', 'n2'])
  })

  it('returns nothing for a request no box binds (even if it lives in the subtree)', () => {
    expect(findScenariosUsingRequest(rootItems, 'req-child')).toHaveLength(0)
  })
})

describe('streaming connect nodes bind a request too (Socket.IO / WebSocket)', () => {
  // A streaming connect node ties its bound request to the scenario exactly like
  // an httpRequest node — so the reverse-nav link + delete/move flow must see it.
  const streamNode = (id: string, kind: string, requestId: string): { id: string; kind: string; config: { requestId: string }; inputs: never[]; outputs: never[]; position: { x: number; y: number } } =>
    ({ id, kind, config: { requestId }, inputs: [], outputs: [], position: { x: 0, y: 0 } })
  const wsReq = { type: 'websocket', id: 'req-ws', name: 'WS Echo' }
  const streamScenario = {
    type: 'scenario', id: 'scn-stream', name: 'Streaming', tags: [], params: [],
    nodes: [streamNode('w1', 'websocketConnect', 'req-ws'), streamNode('s1', 'socketioConnect', 'req-ws')],
    edges: [], items: []
  }
  const env = { folderType: 'environment', id: 'env', name: 'Env', configuration: {}, environments: [], items: [streamScenario, wsReq] }
  const root = [env] as unknown as FolderItem[]

  it('findScenariosUsingRequest finds a request bound by websocketConnect + socketioConnect nodes', () => {
    const usages = findScenariosUsingRequest(root, 'req-ws')
    expect(usages).toHaveLength(1)
    expect(usages[0]?.nodeIds.sort()).toEqual(['s1', 'w1'])
  })

  it('collectRequestScenarioRelations reports streaming-bound requests for the delete/move flow', () => {
    const rel = collectRequestScenarioRelations(root, 'req-ws')
    expect(rel).toHaveLength(1)
    expect(rel[0]?.nodeIds.sort()).toEqual(['s1', 'w1'])
  })
})

describe('isRequestInScenarioSubtree', () => {
  it('is true for a request authored as a scenario child', () => {
    expect(isRequestInScenarioSubtree(scn, 'req-child')).toBe(true)
  })

  it('is false for a request referenced from outside the subtree', () => {
    expect(isRequestInScenarioSubtree(scn, 'req-bound')).toBe(false)
  })

  it('does not cross into a NESTED scenario — a request authored in a sub-scenario belongs to that sub-scenario, not its parent', () => {
    const deepReq = { type: 'grpc', id: 'req-deep', name: 'Lives in the sub-scenario' }
    const subScenario = { type: 'scenario', id: 'sub', name: 'Sub', tags: [], params: [], nodes: [], edges: [], items: [deepReq] }
    const parentScenario = { type: 'scenario', id: 'parent', name: 'Parent', tags: [], params: [], nodes: [], edges: [], items: [subScenario] } as unknown as Parameters<typeof isRequestInScenarioSubtree>[0]
    const sub = subScenario as unknown as Parameters<typeof isRequestInScenarioSubtree>[0]
    // The nearest scenario owns it…
    expect(isRequestInScenarioSubtree(sub, 'req-deep')).toBe(true)
    // …the ancestor scenario does NOT (no transitive over-reporting).
    expect(isRequestInScenarioSubtree(parentScenario, 'req-deep')).toBe(false)
  })

  it('still descends plain folders inside a scenario (folders are not scenario boundaries)', () => {
    const fReq = { type: 'http', id: 'req-in-folder', name: 'In a folder' }
    const folder = { id: 'fold', name: 'Folder', configuration: {}, items: [fReq] }
    const scnWithFolder = { type: 'scenario', id: 'swf', name: 'With folder', tags: [], params: [], nodes: [], edges: [], items: [folder] } as unknown as Parameters<typeof isRequestInScenarioSubtree>[0]
    expect(isRequestInScenarioSubtree(scnWithFolder, 'req-in-folder')).toBe(true)
  })
})

describe('findScenariosUsingScenario', () => {
  // A separate tree where two scenarios reference a third one via runScenario
  // boxes, plus a self-reference that must be excluded.
  function runNode(id: string, scenarioId: string): { id: string; kind: string; config: { scenarioId: string }; inputs: never[]; outputs: never[]; position: { x: number; y: number } } {
    return { id, kind: 'runScenario', config: { scenarioId }, inputs: [], outputs: [], position: { x: 0, y: 0 } }
  }
  const target = { type: 'scenario', id: 'target', name: 'Target', tags: [], params: [], nodes: [], edges: [] }
  // Caller A runs the target twice — both node ids must surface in `nodeIds`.
  const callerA = { type: 'scenario', id: 'a', name: 'Caller A', tags: [], params: [], nodes: [runNode('a1', 'target'), runNode('a2', 'target')], edges: [] }
  const callerB = { type: 'scenario', id: 'b', name: 'Caller B', tags: [], params: [], nodes: [runNode('b1', 'target')], edges: [] }
  // A scenario that runs ITSELF — the self-call must be excluded so the user
  // doesn't see "this scenario calls itself" when they open the callers menu.
  const selfCaller = { type: 'scenario', id: 'target', name: 'Self-caller', tags: [], params: [], nodes: [runNode('self1', 'target')], edges: [] }
  // A scenario that doesn't reference the target at all.
  const unrelated = { type: 'scenario', id: 'unrelated', name: 'Unrelated', tags: [], params: [], nodes: [runNode('u1', 'other')], edges: [] }

  it('lists every scenario whose runScenario boxes reference the target id', () => {
    const env = { folderType: 'environment', id: 'env', name: 'Env', configuration: {}, environments: [], items: [target, callerA, callerB, unrelated] }
    const usages = findScenariosUsingScenario([env] as unknown as FolderItem[], 'target')
    expect(usages).toHaveLength(2)
    expect(usages.map((u) => u.scenario.id).sort()).toEqual(['a', 'b'])
  })

  it('aggregates every matching node id when one caller runs the target several times', () => {
    const env = { folderType: 'environment', id: 'env', name: 'Env', configuration: {}, environments: [], items: [callerA] }
    const usages = findScenariosUsingScenario([env] as unknown as FolderItem[], 'target')
    expect(usages).toHaveLength(1)
    expect(usages[0]?.nodeIds).toEqual(['a1', 'a2'])
  })

  it('excludes self-calls so the target scenario is never listed as its own caller', () => {
    // `selfCaller` shares its id with `target` — `findScenariosUsingScenario`
    // must skip it, otherwise the callers menu would show "this scenario
    // calls itself" the moment the user adds a `runScenario` pointing at the
    // current scenario.
    const env = { folderType: 'environment', id: 'env', name: 'Env', configuration: {}, environments: [], items: [selfCaller] }
    expect(findScenariosUsingScenario([env] as unknown as FolderItem[], 'target')).toHaveLength(0)
  })

  it('returns nothing when no scenario references the target', () => {
    const env = { folderType: 'environment', id: 'env', name: 'Env', configuration: {}, environments: [], items: [unrelated] }
    expect(findScenariosUsingScenario([env] as unknown as FolderItem[], 'target')).toHaveLength(0)
  })
})

describe('collectRequestScenarioRelations', () => {
  it('reports an external bound request as inSubtree:false with its node ids', () => {
    const rel = collectRequestScenarioRelations(rootItems, 'req-bound')
    expect(rel).toHaveLength(1)
    expect(rel[0]).toMatchObject({ inSubtree: false })
    expect(rel[0]?.nodeIds).toEqual(['n1', 'n2'])
  })

  it('reports a subtree-only child request (no binding box) as inSubtree:true with no node ids', () => {
    const rel = collectRequestScenarioRelations(rootItems, 'req-child')
    expect(rel).toHaveLength(1)
    expect(rel[0]).toMatchObject({ inSubtree: true, nodeIds: [] })
  })

  it('returns nothing for a request unrelated to any scenario', () => {
    expect(collectRequestScenarioRelations(rootItems, 'req-absent')).toHaveLength(0)
  })
})
