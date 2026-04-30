import type { MenuBarLayoutMode } from './types'

export interface ComputeLayoutInput {
  /** Width of the visible MenuBar root, in CSS pixels. `null` when measurement hasn't arrived yet. */
  containerWidth: number | null
  /** Natural widths of each top-level item, in render order. Empty until the hidden mirror has been measured. */
  itemWidths: readonly number[]
  /** Below this container width the bar collapses fully into a hamburger. */
  hamburgerBelowPx: number
  /** Estimated/measured width of the overflow / hamburger button. */
  overflowButtonWidth: number
}

export interface ComputeLayoutOutput {
  mode: MenuBarLayoutMode
  /** How many original items render inline in `overflow` mode. Zero in `hamburger`, all in `full`. */
  visibleCount: number
}

/**
 * Pure decision function for the responsive `MenuBar` layout mode.
 * Extracted from the component so the rules are unit-testable without
 * spinning up a JSDOM render — the React side just feeds in measured
 * widths from `ResizeObserver` callbacks.
 *
 * Rules:
 *
 * - No measurements yet (`containerWidth === null` or no item widths)
 *   → `full` mode with every item visible. This avoids first-paint
 *   flicker before the observer fires.
 * - `containerWidth < hamburgerBelowPx` → `hamburger`, all items
 *   inside the dropdown.
 * - Sum of item widths ≤ container width → `full`, no overflow needed.
 * - Otherwise → `overflow`, with as many leading items as fit in
 *   `containerWidth - overflowButtonWidth`.
 */
export function computeMenuBarLayout(input: ComputeLayoutInput): ComputeLayoutOutput {
  const { containerWidth, itemWidths, hamburgerBelowPx, overflowButtonWidth } = input

  if (containerWidth === null || itemWidths.length === 0) {
    return { mode: 'full', visibleCount: itemWidths.length }
  }
  if (containerWidth < hamburgerBelowPx) {
    return { mode: 'hamburger', visibleCount: 0 }
  }
  const total = itemWidths.reduce((sum, w) => sum + w, 0)
  if (total <= containerWidth) {
    return { mode: 'full', visibleCount: itemWidths.length }
  }
  const budget = Math.max(0, containerWidth - overflowButtonWidth)
  let used = 0
  let n = 0
  for (const w of itemWidths) {
    const next = used + w
    if (next > budget) break
    used = next
    n++
  }
  return { mode: 'overflow', visibleCount: n }
}
