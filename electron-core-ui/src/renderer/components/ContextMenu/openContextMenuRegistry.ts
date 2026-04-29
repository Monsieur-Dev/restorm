/**
 * Single-instance coordinator for in-page `ContextMenu`s. Each visible
 * menu registers its own `close` callback; opening another menu invokes
 * every registered callback first so only one menu is ever on screen.
 *
 * The registry exists because `ContextMenu`'s outside-click dismissal
 * (a document `mousedown` listener) doesn't fire in a few sequences:
 *
 * - The new menu opens in response to a `contextmenu` event that
 *   bubbled up *through* an already-open menu's overlay — the
 *   `mousedown` underneath landed inside the open menu's `containerRef`
 *   and was treated as "click inside, stay open".
 * - The new menu opens from a keyboard shortcut or a programmatic
 *   trigger that never went through `mousedown` at all.
 *
 * In both cases the registry guarantees the older menu disappears
 * before the new one paints.
 */

const openMenus = new Set<() => void>()

/**
 * Closes every menu currently in the registry except the one identified
 * by `selfClose`, then records `selfClose` as the new sole occupant.
 * Returns a deregistration function callers should invoke from their
 * unmount / hide cleanup.
 *
 * Calling this with a `selfClose` already in the registry is idempotent
 * — the function isn't re-added and isn't asked to close itself.
 */
export function registerOpenContextMenu(selfClose: () => void): () => void {
  // Snapshot before invoking so a synchronous `closeOther()` that
  // triggers the closed menu's effect cleanup (which calls our
  // returned deregister fn and mutates `openMenus`) cannot disturb
  // the iteration.
  const others = Array.from(openMenus)
  for (const closeOther of others) {
    if (closeOther !== selfClose) closeOther()
  }
  openMenus.add(selfClose)
  return () => {
    openMenus.delete(selfClose)
  }
}

/**
 * Test-only: lets unit tests seed two close fns into the registry to
 * verify "iterate-all-and-close" semantics without going through
 * `registerOpenContextMenu` (which would close the first as soon as
 * the second arrived).
 */
export function __seedOpenContextMenuRegistryForTesting(closeFn: () => void): void {
  openMenus.add(closeFn)
}

/**
 * Test-only: lets unit tests reset state between cases without exposing
 * `openMenus` directly. Production code never needs this.
 */
export function __resetOpenContextMenuRegistryForTesting(): void {
  openMenus.clear()
}
