import { describe, it, expect, vi, beforeEach } from 'vitest'

const findById = vi.fn()
vi.mock('../services/CollectionStore', () => ({
  collectionStore: { findById: (id: string): unknown => findById(id) as unknown }
}))

import { collectReferencedScenarios } from './collectReferencedScenarios'

function scn(id: string, name: string, refs: string[]): unknown {
  return {
    type: 'scenario',
    id,
    name,
    nodes: refs.map((r, i) => ({ id: `n${i}`, kind: 'runScenario', config: { scenarioId: r } })),
    edges: []
  }
}

describe('collectReferencedScenarios', () => {
  beforeEach(() => { findById.mockReset() })

  it('collects the main scenario + ALL transitively-referenced ones, deduped and cycle-guarded', () => {
    const map: Record<string, unknown> = {
      A: scn('A', 'Main', ['B', 'C']),
      B: scn('B', 'Sub B', ['C', 'D']), // C already referenced by A
      C: scn('C', 'Sub C', ['A']), // cycle back to A
      D: scn('D', 'Sub D', [])
    }
    findById.mockImplementation((id: string) => map[id] ?? null)

    const out = collectReferencedScenarios('A')
    expect(out.map((s) => s.id).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(out.find((s) => s.id === 'A')?.name).toBe('Main')
    // Each scenario appears exactly once despite the diamond + cycle.
    expect(out).toHaveLength(4)
  })

  it('collects referenced scenarios even when they are not executed (static walk)', () => {
    // B is referenced by A but D is referenced only by B — all are captured
    // regardless of any runtime branch.
    const map: Record<string, unknown> = {
      A: scn('A', 'Main', ['B']),
      B: scn('B', 'Sub B', ['D']),
      D: scn('D', 'Sub D', [])
    }
    findById.mockImplementation((id: string) => map[id] ?? null)
    expect(collectReferencedScenarios('A').map((s) => s.id).sort()).toEqual(['A', 'B', 'D'])
  })

  it('skips param:-prefixed (runtime-resolved) sub-scenario targets', () => {
    const map: Record<string, unknown> = { A: scn('A', 'Main', ['param:dynamic']) }
    findById.mockImplementation((id: string) => map[id] ?? null)
    expect(collectReferencedScenarios('A').map((s) => s.id)).toEqual(['A'])
  })
})
