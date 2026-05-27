import { describe, it, expect } from 'vitest'
import type { FolderItem } from '../../../shared/types/collections'
import {
  findScenariosUsingRequest,
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

describe('isRequestInScenarioSubtree', () => {
  it('is true for a request authored as a scenario child', () => {
    expect(isRequestInScenarioSubtree(scn, 'req-child')).toBe(true)
  })

  it('is false for a request referenced from outside the subtree', () => {
    expect(isRequestInScenarioSubtree(scn, 'req-bound')).toBe(false)
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
