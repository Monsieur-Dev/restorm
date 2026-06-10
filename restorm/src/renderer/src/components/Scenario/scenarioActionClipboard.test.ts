import { describe, it, expect } from 'vitest'
import {
  setScenarioClipboard,
  getScenarioClipboard,
  hasScenarioClipboard,
  nextPasteDelta
} from './scenarioActionClipboard'
import type { ScenarioNode } from '../../../../shared/types/collections'

function node(id: string, x: number, y: number): ScenarioNode {
  return { id, kind: 'log', config: {}, inputs: [], outputs: [], position: { x, y } } as unknown as ScenarioNode
}

const PAN = { x: 100, y: 100, zoom: 1 }
const CENTER = { x: 500, y: 500 }

describe('scenarioActionClipboard', () => {
  it('deep-copies on set and get (no shared refs with the source)', () => {
    const source = node('a', 0, 0)
    setScenarioClipboard([source], [], CENTER, PAN)
    expect(hasScenarioClipboard()).toBe(true)
    const got = getScenarioClipboard()
    source.position.x = 999
    expect(got?.nodes[0]?.position.x).toBe(0)
  })

  it('stacks diagonally (+40 each) while the viewport is unchanged', () => {
    setScenarioClipboard([node('a', 0, 0)], [], CENTER, PAN)
    // First paste onto the copy anchor: centre stays on the copied group, +40.
    expect(nextPasteDelta(PAN, { x: 0, y: 0 })).toEqual({ x: 40, y: 40 })
    expect(nextPasteDelta(PAN, { x: 0, y: 0 })).toEqual({ x: 80, y: 80 })
    expect(nextPasteDelta(PAN, { x: 0, y: 0 })).toEqual({ x: 120, y: 120 })
  })

  it('re-centres on the current view (and resets the counter) after a pan', () => {
    setScenarioClipboard([node('a', 0, 0)], [], CENTER, PAN)
    nextPasteDelta(PAN, { x: 0, y: 0 }) // C=1 → (40,40)
    // A different viewport → recentre the group on the view centre, C back to 0.
    const view = { x: 700, y: 700 }
    expect(nextPasteDelta({ x: 0, y: 0, zoom: 1 }, view)).toEqual({ x: view.x - CENTER.x, y: view.y - CENTER.y })
    // Subsequent paste at the SAME new pan stacks +40 from that recentre.
    expect(nextPasteDelta({ x: 0, y: 0, zoom: 1 }, view)).toEqual({ x: view.x - CENTER.x + 40, y: view.y - CENTER.y + 40 })
  })

  it('treats a zoom change as a moved viewport', () => {
    setScenarioClipboard([node('a', 0, 0)], [], CENTER, PAN)
    nextPasteDelta(PAN, { x: 0, y: 0 }) // C=1
    const view = { x: 200, y: 200 }
    // same x/y but different zoom → not the same pan → recentre, C reset.
    expect(nextPasteDelta({ ...PAN, zoom: 2 }, view)).toEqual({ x: view.x - CENTER.x, y: view.y - CENTER.y })
  })
})
