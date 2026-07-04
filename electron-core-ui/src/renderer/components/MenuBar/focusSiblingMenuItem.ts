/**
 * Direct `<a role="menuitem">` children of an open dropdown's `<ul
 * role="menu">`, in DOM order, disabled entries excluded. Scoped with `:scope
 * > li >` so a nested submenu's own list (deeper in the same `<li>`) never
 * leaks into the parent level's sibling set.
 *
 * Extracted from `MenuBar` (alongside `computeMenuBarLayout.ts`) purely so
 * the DOM-traversal rules are unit-testable against a hand-built fragment,
 * without needing a full component render.
 */
export function listMenuItems(list: Element | null): HTMLAnchorElement[] {
  if (!list) return []
  return Array.from(list.querySelectorAll<HTMLAnchorElement>(':scope > li > a[role="menuitem"]'))
    .filter((el) => el.getAttribute('aria-disabled') !== 'true')
}

/**
 * Move DOM focus to the previous/next sibling entry within the open dropdown
 * that owns `current`, wrapping at either end — the "up/down navigate the
 * open menu" half of the ARIA menubar keyboard pattern.
 */
export function focusSiblingMenuItem(current: HTMLAnchorElement, direction: 1 | -1): void {
  const items = listMenuItems(current.closest('ul.actions-container[role="menu"]'))
  if (items.length === 0) return
  const index = items.indexOf(current)
  const nextIndex = index === -1 ? 0 : (index + direction + items.length) % items.length
  items[nextIndex]?.focus()
}
