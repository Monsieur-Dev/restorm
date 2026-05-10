/**
 * Pure helpers backing the rail's "track-click autoscroll" gesture.
 *
 * Native scrollbars (Chromium / macOS / Windows) treat the gutter
 * area of the rail — the bit above and below the thumb — as a
 * page-jump trigger: a click jumps one viewport in the direction
 * of the click, and holding the mouse repeats the jump every
 * ~50ms until either the thumb crosses the cursor's position or
 * the user lets go.
 *
 * `ScrollableElement.tsx` wires the DOM events; this module owns
 * the math so the termination + clamp logic can be exercised
 * without spinning up a DOM testing harness.
 */

/**
 * Compute the next scroll position after one page-jump.
 *
 *   - `currentScroll`: current `scrollTop` (or `scrollLeft`).
 *   - `viewport`: pixel size of the visible region (one page).
 *   - `contentSize`: total scrollable size (`scrollHeight` /
 *     `scrollWidth`).
 *   - `direction`: `-1` to scroll up/left, `+1` to scroll down/right.
 *
 * Result is clamped to `[0, contentSize - viewport]` so the
 * caller never overshoots either edge.
 */
export function nextPageScrollPosition(
	currentScroll: number,
	viewport: number,
	contentSize: number,
	direction: 1 | -1
): number {
	const max = Math.max(0, contentSize - viewport)
	const next = currentScroll + direction * viewport
	if (next < 0) return 0
	if (next > max) return max
	return next
}

/**
 * Decide whether the auto-scroll loop should stop on the next tick.
 * The loop stops as soon as the thumb has crossed the cursor's
 * recorded position — that's what makes "click halfway down the
 * rail" eventually park the thumb at the cursor instead of
 * scrolling past it.
 *
 *   - `thumbStart` / `thumbEnd`: pixel coordinates of the thumb's
 *     top/left and bottom/right edges along the rail axis (already
 *     including any leading-arrow offset).
 *   - `cursor`: cursor position along the same axis (recorded at
 *     mousedown — does not need to track mousemove for this
 *     gesture).
 *   - `direction`: same convention as `nextPageScrollPosition`.
 */
export function shouldStopTrackAutoScroll(
	thumbStart: number,
	thumbEnd: number,
	cursor: number,
	direction: 1 | -1
): boolean {
	if (direction === -1) return thumbStart <= cursor
	return thumbEnd >= cursor
}

/**
 * Resolve the click direction from a cursor position relative to
 * the thumb. Returns `null` when the cursor is on the thumb itself
 * (in which case the slider's own drag handler is the right thing
 * to fire — the rail handler should no-op).
 */
export function trackClickDirection(
	cursor: number,
	thumbStart: number,
	thumbEnd: number
): 1 | -1 | null {
	if (cursor >= thumbStart && cursor <= thumbEnd) return null
	return cursor < thumbStart ? -1 : 1
}
