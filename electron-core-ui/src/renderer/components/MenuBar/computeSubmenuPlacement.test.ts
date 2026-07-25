import { describe, it, expect } from 'vitest'
import { computeSubmenuPlacement, type SubmenuPlacementInput } from './computeSubmenuPlacement'

// Reference viewport: 1000 x 800, the component's own constants for padding
// (8), overlap inset (8) and submenu width (300). The parent item sits at the
// top-left of a menu that starts just above it.
const base: SubmenuPlacementInput = {
  itemTop: 100,
  itemLeft: 20,
  itemRight: 320,
  parentMenuTop: 90,
  parentMenuLeft: 20,
  submenuWidth: 300,
  submenuHeight: 200,
  viewportWidth: 1000,
  viewportHeight: 800,
  padding: 8,
  overlapOffset: 8
}

const place = (overrides: Partial<SubmenuPlacementInput> = {}): ReturnType<typeof computeSubmenuPlacement> =>
  computeSubmenuPlacement({ ...base, ...overrides })

describe('computeSubmenuPlacement', () => {
  describe('vertical clamp', () => {
    it('leaves a submenu that already fits exactly where its parent item is', () => {
      expect(place({ itemTop: 100, submenuHeight: 200 })).toEqual({
        left: 320,
        top: 100,
        maxHeight: null
      })
    })

    it('slides a submenu up instead of clipping it when it overflows the bottom', () => {
      // 800 - 8 - 300 = 492
      const placement = place({ itemTop: 700, submenuHeight: 300 })
      expect(placement.top).toBe(492)
      expect(placement.maxHeight).toBeNull()
      expect(placement.top + 300).toBeLessThanOrEqual(800 - 8)
    })

    it('never slides a submenu DOWN — the clamp is purely upward', () => {
      // Plenty of room below: the clamp must be a no-op.
      expect(place({ itemTop: 12, submenuHeight: 100 }).top).toBe(12)
    })

    it('keeps the submenu attached: the parent item top stays inside its band', () => {
      const cases: readonly [number, number][] = [
        [700, 300],
        [750, 400],
        [790, 100],
        [600, 500],
        [400, 700],
        [100, 200]
      ]
      for (const [itemTop, submenuHeight] of cases) {
        const { top } = place({ itemTop, submenuHeight })
        expect(top).toBeLessThanOrEqual(itemTop)
        expect(itemTop).toBeLessThanOrEqual(top + submenuHeight)
      }
    })

    it('never covers the parent item: sliding up cannot occlude what opened it', () => {
      // Occlusion is governed by `left`, which the vertical clamp never
      // touches: the submenu sits entirely beside the item (flush right, or
      // flipped entirely to its left), so moving it up the other axis cannot
      // bring it over the item. Checked across the cases that DO move.
      const cases: readonly [number, number][] = [
        [700, 300],
        [750, 400],
        [790, 100],
        [400, 700]
      ]
      for (const [itemTop, submenuHeight] of cases) {
        for (const itemRight of [320, 750]) {
          const itemLeft = itemRight - 300
          const { left } = place({ itemTop, submenuHeight, itemLeft, itemRight })
          const coversItem = left < itemRight && left + 300 > itemLeft
          expect(coversItem).toBe(false)
        }
      }
    })

    it('applies the same rule at depth — a level-3 submenu is clamped too', () => {
      // Item of a level-2 menu opened far right: the submenu flips left AND
      // has to slide up. The function is stateless, so depth changes nothing.
      const placement = place({
        itemTop: 700,
        itemLeft: 620,
        itemRight: 920,
        parentMenuTop: 650,
        parentMenuLeft: 620,
        submenuHeight: 300
      })
      expect(placement.left).toBe(320)
      expect(placement.top).toBe(492)
      expect(placement.maxHeight).toBeNull()
    })

    it('leaves a menu-bar submenu opened near the top of the screen untouched', () => {
      // Just under a 30px title bar — the historically correct case.
      expect(place({ itemTop: 34, submenuHeight: 200 }).top).toBe(34)
      expect(place({ itemTop: 34, submenuHeight: 700 })).toEqual({
        left: 320,
        top: 34,
        maxHeight: null
      })
    })
  })

  describe('submenu taller than the viewport', () => {
    it('pins to the top padding and reports a clip height, never a negative top', () => {
      const placement = place({ itemTop: 700, submenuHeight: 900 })
      expect(placement.top).toBe(8)
      expect(placement.maxHeight).toBe(784) // 800 - 2 * 8
      expect(placement.top).toBeGreaterThanOrEqual(0)
    })

    it('still fits (no clip) at exactly the padded viewport height', () => {
      expect(place({ itemTop: 700, submenuHeight: 784 })).toEqual({
        left: 320,
        top: 8,
        maxHeight: null
      })
    })

    it('switches to clipping one pixel past the padded viewport height', () => {
      expect(place({ itemTop: 700, submenuHeight: 785 })).toEqual({
        left: 320,
        top: 8,
        maxHeight: 784
      })
    })
  })

  describe('horizontal flip / overlap', () => {
    it('sits flush to the right of the item when there is room', () => {
      expect(place().left).toBe(320)
    })

    it('flips to the left of the item when it would overflow the right edge', () => {
      // 750 + 300 + 8 = 1058 > 1000 → flip to 450 - 300 = 150
      expect(place({ itemLeft: 450, itemRight: 750 }).left).toBe(150)
    })

    it('overlaps the parent menu when neither side has room', () => {
      // Narrow viewport: right overflows and the flipped position would be
      // off-screen, so the submenu stacks over its parent menu.
      const placement = place({ viewportWidth: 400 })
      expect(placement.left).toBe(28) // parentMenuLeft + overlapOffset
      expect(placement.top).toBe(98) // parentMenuTop + overlapOffset
    })

    it('clamps the overlap position vertically as well', () => {
      const placement = place({
        viewportWidth: 400,
        parentMenuTop: 700,
        submenuHeight: 300
      })
      expect(placement.left).toBe(28)
      expect(placement.top).toBe(492) // 708 clamped to 800 - 8 - 300
    })

    it('pins against the right edge when no parent menu can be resolved', () => {
      const placement = place({
        viewportWidth: 400,
        parentMenuLeft: null,
        parentMenuTop: null
      })
      expect(placement.left).toBe(92) // 400 - 300 - 8
      expect(placement.top).toBe(100) // unchanged: no overlap, no overflow
    })

    it('keeps the right-edge pin inside the viewport on a very narrow window', () => {
      expect(
        place({ viewportWidth: 200, parentMenuLeft: null, parentMenuTop: null }).left
      ).toBe(8) // max(padding, 200 - 300 - 8)
    })
  })
})
