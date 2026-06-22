import { describe, it, expect } from 'vitest'
import { scenarioGraphNeedsPlacement } from './scenarioGraphLayout'

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
