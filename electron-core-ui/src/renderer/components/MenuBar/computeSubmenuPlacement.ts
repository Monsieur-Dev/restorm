export interface SubmenuPlacementInput {
  /** Viewport-relative top edge of the parent menu item. */
  itemTop: number
  /** Viewport-relative left edge of the parent menu item. */
  itemLeft: number
  /** Viewport-relative right edge of the parent menu item — the submenu's preferred left. */
  itemRight: number
  /** Top of the enclosing `.menu-container`, or `null` when it can't be resolved. */
  parentMenuTop: number | null
  /** Left of the enclosing `.menu-container`, or `null` when it can't be resolved. */
  parentMenuLeft: number | null
  /** Fixed submenu width, in CSS pixels. */
  submenuWidth: number
  /**
   * NATURAL (unclipped) outer height of the submenu holder, chrome included.
   * Measuring a holder that still carries a previous opening's clip would
   * under-estimate this and defeat the vertical clamp.
   */
  submenuHeight: number
  viewportWidth: number
  viewportHeight: number
  /** Minimum gap kept between the submenu and every viewport edge. */
  padding: number
  /** Inset used when the submenu has to be stacked over its parent menu. */
  overlapOffset: number
}

export interface SubmenuPlacement {
  left: number
  top: number
  /**
   * `null` when the submenu fits and must render at its natural height.
   * Otherwise the OUTER holder height to clip it to — callers that apply the
   * value to an inner scroll viewport must subtract the holder's own chrome.
   */
  maxHeight: number | null
}

/**
 * Pure placement decision for a menu submenu, at any depth.
 * Extracted from the component so the rules are unit-testable without a
 * JSDOM render — the React side only feeds in measured rects.
 *
 * Horizontal rules (unchanged behaviour):
 *
 * - Preferred position is flush to the right of the parent item (`itemRight`).
 * - When that would overflow the right edge, flip to the left of the item.
 * - When the flipped position would overflow the left edge, stack the submenu
 *   over its parent menu, inset by `overlapOffset` on both axes.
 * - With no parent menu to stack onto, pin against the right edge instead.
 *
 * Vertical rules:
 *
 * - The submenu is slid UP whenever it would overflow the bottom edge, so it
 *   stays fully readable instead of being clipped into a scrolling strip.
 *   The clamp is purely downward — a submenu that already fits never moves.
 * - Because it only ever moves up to the point where its bottom sits at
 *   `viewportHeight - padding`, the parent item's top edge stays inside the
 *   submenu's vertical band (`top <= itemTop <= top + submenuHeight`) for any
 *   item whose own top is inside the padded viewport. The submenu therefore
 *   always overlaps its (highlighted) parent item and stays visually attached.
 *   This does not apply on the overlap branch, which deliberately covers the
 *   parent menu.
 * - A submenu TALLER than the padded viewport cannot be made to fit: it is
 *   pinned at `padding` and reported with a `maxHeight`, falling back to
 *   clipping + scroll. `top` is never negative and the submenu never escapes
 *   through the top edge.
 */
export function computeSubmenuPlacement(input: SubmenuPlacementInput): SubmenuPlacement {
  const {
    itemTop,
    itemLeft,
    itemRight,
    parentMenuTop,
    parentMenuLeft,
    submenuWidth,
    submenuHeight,
    viewportWidth,
    viewportHeight,
    padding,
    overlapOffset
  } = input

  let left = itemRight
  let top = itemTop

  const overflowsRight = left + submenuWidth + padding > viewportWidth

  if (overflowsRight) {
    const flippedLeft = itemLeft - submenuWidth
    if (flippedLeft >= padding) {
      left = flippedLeft
    } else if (parentMenuLeft !== null && parentMenuTop !== null) {
      left = parentMenuLeft + overlapOffset
      top = parentMenuTop + overlapOffset
    } else {
      left = Math.max(padding, viewportWidth - submenuWidth - padding)
    }
  }

  const available = viewportHeight - 2 * padding

  if (submenuHeight > available) {
    return { left, top: padding, maxHeight: available }
  }

  const maxTop = viewportHeight - padding - submenuHeight
  return { left, top: Math.max(padding, Math.min(top, maxTop)), maxHeight: null }
}
