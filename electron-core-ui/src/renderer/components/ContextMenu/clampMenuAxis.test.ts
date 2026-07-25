import { describe, it, expect } from 'vitest'
import { clampMenuAxis } from './clampMenuAxis'

const GAP = 8

describe('clampMenuAxis', () => {
  it('honours the cursor position when the menu fits', () => {
    // Menu of 98px opened at 100 in a 1076 viewport fits comfortably.
    expect(clampMenuAxis(100, 98, 1076, GAP)).toBe(100)
  })

  it('pulls the menu back to leave the gap when it would overflow the far edge', () => {
    // Opened at 990, a 98px menu would reach 1088 (past 1076). It is pulled to
    // 1076 - 98 - 8 = 970 so its far edge sits 8px above the viewport edge —
    // matching the submenu, not flush against the edge (which was the bug).
    expect(clampMenuAxis(990, 98, 1076, GAP)).toBe(970)
  })

  it('leaves exactly the gap, never zero, at the clamped edge', () => {
    const top = clampMenuAxis(2000, 98, 1076, GAP)
    expect(1076 - (top + 98)).toBe(GAP)
  })

  it('pins at the gap from the near edge for a menu taller than the viewport', () => {
    // A 2000px menu in a 1076 viewport can't fit; it pins at the gap rather
    // than going negative (which would clip the first entries off-screen).
    expect(clampMenuAxis(500, 2000, 1076, GAP)).toBe(GAP)
  })

  it('opens at the cursor even near the near edge (no forced near-edge gap when it fits)', () => {
    // A right-click 2px from the top opens the menu there; only the overflow
    // edge is padded, so a small cursor value is preserved.
    expect(clampMenuAxis(2, 98, 1076, GAP)).toBe(2)
  })
})
