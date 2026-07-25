/**
 * Clamp a menu's position on one axis so it stays inside the viewport with a
 * uniform gap from the edge.
 *
 * The menu opens at `cursor` (a right-click point). When it fits, that exact
 * position is honoured. When it would overflow the far edge it is pulled back
 * to leave `gap` pixels — the same gap a repositioned submenu keeps (see
 * `computeSubmenuPlacement`), so a first-level menu clamped at the bottom is not
 * flush against the edge while its own submenu floats a few pixels above it.
 * A menu larger than the viewport minus two gaps pins at `gap` from the near
 * edge rather than going negative.
 *
 * Only the far (overflow) edge is padded: a menu that fits still opens exactly
 * at the cursor, so the near-edge `gap` floor only bites for oversized menus.
 */
export function clampMenuAxis(
  cursor: number,
  size: number,
  viewport: number,
  gap: number
): number {
  const max = Math.max(gap, viewport - size - gap)
  return Math.min(cursor, max)
}
