import { describe, it, expect } from 'vitest'
import type { FolderItem } from '../../../shared/types/collections'
import { collectSubtreeScenarioUsages } from './containerDeleteUsages'

// Minimal fixtures — only the fields the walkers read.
function httpNode(id: string, requestId: string): { id: string; kind: string; config: { requestId: string }; inputs: never[]; outputs: never[]; position: { x: number; y: number } } {
  return { id, kind: 'httpRequest', config: { requestId }, inputs: [], outputs: [], position: { x: 0, y: 0 } }
}
const req = (id: string, name: string): { type: string; id: string; name: string } => ({ type: 'http', id, name })
const scn = (id: string, nodes: unknown[], items: unknown[] = []): Record<string, unknown> =>
  ({ type: 'scenario', id, name: `Scenario ${id}`, tags: [], params: [], nodes, edges: [], items })
const folder = (id: string, items: unknown[]): Record<string, unknown> =>
  ({ id, name: `Folder ${id}`, configuration: {}, items })

describe('collectSubtreeScenarioUsages', () => {
  it('surfaces a nested request bound by a scenario OUTSIDE the deleted subtree, recursively', () => {
    const tree = [
      folder('f-del', [folder('f-inner', [req('r1', 'Deep request')])]),
      scn('s-out', [httpNode('n1', 'r1')])
    ] as unknown as FolderItem[]
    const affected = collectSubtreeScenarioUsages(tree, 'f-del')
    expect(affected).toHaveLength(1)
    expect(affected[0]?.requestId).toBe('r1')
    expect(affected[0]?.usages.map((u) => u.scenarioId)).toEqual(['s-out'])
  })

  it('needs no prompt when the binding scenario dies in the SAME subtree (caller + callee deleted together)', () => {
    const tree = [
      folder('f-del', [req('r1', 'Req'), scn('s-in', [httpNode('n1', 'r1')])])
    ] as unknown as FolderItem[]
    expect(collectSubtreeScenarioUsages(tree, 'f-del')).toHaveLength(0)
  })

  it('splits usages per scenario side: inside-subtree usages are dropped, outside ones kept', () => {
    const tree = [
      folder('f-del', [req('r1', 'Req'), scn('s-in', [httpNode('n1', 'r1')])]),
      scn('s-out', [httpNode('n2', 'r1')])
    ] as unknown as FolderItem[]
    const affected = collectSubtreeScenarioUsages(tree, 'f-del')
    expect(affected).toHaveLength(1)
    expect(affected[0]?.usages.map((u) => u.scenarioId)).toEqual(['s-out'])
  })

  it('walks requests filed under a scenario of the deleted subtree too', () => {
    const tree = [
      folder('f-del', [scn('s-holder', [], [req('r1', 'Filed in scenario')])]),
      scn('s-out', [httpNode('n1', 'r1')])
    ] as unknown as FolderItem[]
    const affected = collectSubtreeScenarioUsages(tree, 'f-del')
    expect(affected.map((a) => a.requestId)).toEqual(['r1'])
  })

  it('returns nothing for a direct request id (the request flow has its own dialog)', () => {
    const tree = [
      req('r1', 'Req'),
      scn('s-out', [httpNode('n1', 'r1')])
    ] as unknown as FolderItem[]
    expect(collectSubtreeScenarioUsages(tree, 'r1')).toHaveLength(0)
  })
})
