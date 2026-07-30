import { describe, it, expect } from 'vitest'
import {
  layoutScenarioGraph,
  scenarioGraphNeedsPlacement,
  type LayoutEdgeInput,
  type LayoutNodeInput
} from './scenarioGraphLayout'

const at = (x: number, y: number): { position: { x: number; y: number } } => ({ position: { x, y } })

describe('scenarioGraphNeedsPlacement', () => {
  it('returns false for an empty graph (nothing to place)', () => {
    expect(scenarioGraphNeedsPlacement([])).toBe(false)
  })

  it('returns false when every box already has a real position', () => {
    // A hand-arranged / previously-tidied scenario: never auto-layout on open.
    expect(scenarioGraphNeedsPlacement([at(120, 40), at(480, 200), at(900, 40)])).toBe(false)
  })

  it('returns true when at least one box sits at the origin sentinel (0,0)', () => {
    // MCP/agent (`create_scenario_node` defaults to 0,0) or import: needs the
    // one-time initial placement.
    expect(scenarioGraphNeedsPlacement([at(120, 40), at(0, 0), at(900, 40)])).toBe(true)
  })

  it('returns true when an agent stacked every box at the origin', () => {
    expect(scenarioGraphNeedsPlacement([at(0, 0), at(0, 0), at(0, 0)])).toBe(true)
  })

  it('does not treat a box merely on an axis (x=0 or y=0, not both) as un-placed', () => {
    // Only the exact origin is the sentinel; a deliberately-placed box that
    // happens to be at x=0 (or y=0) but not both is a real position.
    expect(scenarioGraphNeedsPlacement([at(0, 240), at(360, 0)])).toBe(false)
  })

  it("after a delete, the surviving placed boxes do NOT request a re-layout", () => {
    // Regression guard for the delete-reorg bug: removing a node from an
    // already-placed graph leaves every remaining box with a real position, so
    // nothing asks to auto-layout (deletion never reflows).
    const placed = [at(120, 40), at(480, 200), at(900, 40)]
    const afterDelete = placed.slice(1) // dropped the first box
    expect(scenarioGraphNeedsPlacement(afterDelete)).toBe(false)
  })
})

describe('layoutScenarioGraph', () => {
  // A mock-server box: three outputs rendered top-to-bottom (`connected`,
  // `served`, then the implicit `done` which draws at the bottom of the box),
  // each wired to its own downstream box. The three targets are DECLARED in the
  // reverse order on purpose — that declaration order is what a port-blind
  // layout falls back to, so it's the order that produced crossing links.
  const source = (outputs: string[]): LayoutNodeInput => ({
    id: 'server',
    width: 260,
    height: 180,
    outputs
  })
  const target = (id: string): LayoutNodeInput => ({ id, width: 200, height: 90, inputs: ['in'] })
  const wire = (fromPort: string, to: string): LayoutEdgeInput => ({
    id: `e-${fromPort}`,
    source: 'server',
    target: to,
    sourcePort: fromPort,
    targetPort: 'in'
  })

  it('orders the downstream boxes top-to-bottom by the source-port order', async () => {
    const nodes = [
      source(['connected', 'served', 'done']),
      target('logBox'), // wired to `done` — the LAST output
      target('closeBox'), // wired to `served`
      target('consumerBox') // wired to `connected` — the FIRST output
    ]
    const edges = [wire('done', 'logBox'), wire('served', 'closeBox'), wire('connected', 'consumerBox')]

    const positions = await layoutScenarioGraph(nodes, edges)

    const y = (id: string): number => positions.get(id)?.y ?? Number.NaN
    // Topmost output's box on top, lowest output's box at the bottom.
    expect(y('consumerBox')).toBeLessThan(y('closeBox'))
    expect(y('closeBox')).toBeLessThan(y('logBox'))
    // …and they still form one layer to the right of the source.
    const sourceX = positions.get('server')?.x ?? 0
    for (const id of ['consumerBox', 'closeBox', 'logBox']) {
      expect(positions.get(id)?.x ?? 0).toBeGreaterThan(sourceX)
    }
  })

  it('follows the port order even when the ports are declared in another order', async () => {
    // Same graph, source ports re-ordered: the box order must follow the PORTS,
    // not the edge list or the node list (both unchanged from the case above).
    const nodes = [
      source(['done', 'served', 'connected']),
      target('logBox'),
      target('closeBox'),
      target('consumerBox')
    ]
    const edges = [wire('done', 'logBox'), wire('served', 'closeBox'), wire('connected', 'consumerBox')]

    const positions = await layoutScenarioGraph(nodes, edges)

    const y = (id: string): number => positions.get(id)?.y ?? Number.NaN
    expect(y('logBox')).toBeLessThan(y('closeBox'))
    expect(y('closeBox')).toBeLessThan(y('consumerBox'))
  })

  it('lays out a graph with no port information at all', async () => {
    // Backward compatibility: a caller that only knows the source→target
    // relationship still gets a full left→right placement.
    const nodes: LayoutNodeInput[] = [
      { id: 'a', width: 200, height: 90 },
      { id: 'b', width: 200, height: 90 },
      { id: 'c', width: 200, height: 90 }
    ]
    const edges: LayoutEdgeInput[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' }
    ]

    const positions = await layoutScenarioGraph(nodes, edges)

    expect(positions.size).toBe(3)
    expect(positions.get('b')?.x ?? 0).toBeGreaterThan(positions.get('a')?.x ?? 0)
    expect(positions.get('c')?.x ?? 0).toBeGreaterThan(positions.get('b')?.x ?? 0)
  })

  it('places a link off an unknown port without throwing', async () => {
    // A port the caller could not enumerate (e.g. one stranded by a rename)
    // keeps a node-level endpoint, alongside the pinned ports of the same box.
    const nodes = [source(['connected', 'served']), target('known'), target('stranded')]
    const edges = [wire('connected', 'known'), wire('ghost', 'stranded')]

    const positions = await layoutScenarioGraph(nodes, edges)

    expect(positions.size).toBe(3)
    for (const id of ['server', 'known', 'stranded']) {
      expect(Number.isFinite(positions.get(id)?.x)).toBe(true)
      expect(Number.isFinite(positions.get(id)?.y)).toBe(true)
    }
    // The un-pinned link is still laid out as a successor — it lands in the
    // same layer as the pinned one, not collapsed onto the source.
    const sourceX = positions.get('server')?.x ?? 0
    expect(positions.get('stranded')?.x ?? 0).toBeGreaterThan(sourceX)
    expect(positions.get('stranded')?.x).toBe(positions.get('known')?.x)
  })

  it('ignores a dangling edge whose endpoint is not in the node set', async () => {
    const nodes = [source(['connected']), target('known')]
    const edges = [wire('connected', 'known'), wire('connected', 'deletedBox')]

    const positions = await layoutScenarioGraph(nodes, edges)

    expect(positions.size).toBe(2)
    expect(positions.get('known')?.x ?? 0).toBeGreaterThan(positions.get('server')?.x ?? 0)
  })

  it('returns nothing for an empty graph', async () => {
    expect((await layoutScenarioGraph([], [])).size).toBe(0)
  })
})
