// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { listMenuItems, focusSiblingMenuItem } from './focusSiblingMenuItem'

/** Build a `<ul role="menu">` matching MenuBarItem/MenuItem's real markup:
 * a `<li>` per entry, wrapping either a plain `<a role="menuitem">` or —
 * for the `withNestedSubmenu` case — one that itself contains a nested
 * `<ul role="menu">` (mirroring an open submenu) to prove the parent
 * level's sibling set never reaches into it. */
function buildMenu(labels: string[], options: { disabledIndex?: number; withNestedSubmenu?: boolean } = {}): HTMLUListElement {
  document.body.innerHTML = ''
  const ul = document.createElement('ul')
  ul.className = 'actions-container'
  ul.setAttribute('role', 'menu')
  labels.forEach((label, index) => {
    const li = document.createElement('li')
    const a = document.createElement('a')
    a.setAttribute('role', 'menuitem')
    // Matches MenuItem.tsx's real markup (`tabIndex={disabled ? -1 : 0}`):
    // without a `tabindex` (or an `href`), jsdom — like real browsers —
    // treats a bare `<a>` as non-focusable, so `.focus()` would silently
    // no-op and every assertion below would see `document.body` instead.
    a.tabIndex = index === options.disabledIndex ? -1 : 0
    a.textContent = label
    if (index === options.disabledIndex) a.setAttribute('aria-disabled', 'true')
    li.appendChild(a)
    if (options.withNestedSubmenu && index === labels.length - 1) {
      const nestedUl = document.createElement('ul')
      nestedUl.className = 'actions-container'
      nestedUl.setAttribute('role', 'menu')
      const nestedLi = document.createElement('li')
      const nestedA = document.createElement('a')
      nestedA.setAttribute('role', 'menuitem')
      nestedA.tabIndex = 0
      nestedA.textContent = 'nested'
      nestedLi.appendChild(nestedA)
      nestedUl.appendChild(nestedLi)
      li.appendChild(nestedUl)
    }
    ul.appendChild(li)
  })
  document.body.appendChild(ul)
  return ul
}

afterEach(() => { document.body.innerHTML = '' })

/** Non-null array access without `!` — the fixtures below always build
 * enough items, so a thrown error here means the test itself is wrong. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`expected an item at index ${index}, the fixture is too short`)
  return item
}

describe('listMenuItems', () => {
  it('returns the direct <a role="menuitem"> children in DOM order', () => {
    const ul = buildMenu(['New', 'Open', 'Save'])
    const items = listMenuItems(ul)
    expect(items.map((el) => el.textContent)).toEqual(['New', 'Open', 'Save'])
  })

  it('excludes items marked aria-disabled', () => {
    const ul = buildMenu(['New', 'Open', 'Revert'], { disabledIndex: 2 })
    const items = listMenuItems(ul)
    expect(items.map((el) => el.textContent)).toEqual(['New', 'Open'])
  })

  it('does not descend into a nested submenu\'s own list', () => {
    const ul = buildMenu(['New', 'Open Recent'], { withNestedSubmenu: true })
    const items = listMenuItems(ul)
    expect(items.map((el) => el.textContent)).toEqual(['New', 'Open Recent'])
  })

  it('returns an empty array for a null list', () => {
    expect(listMenuItems(null)).toEqual([])
  })
})

describe('focusSiblingMenuItem', () => {
  it('moves focus to the next sibling on direction 1', () => {
    const ul = buildMenu(['New', 'Open', 'Save'])
    const items = listMenuItems(ul)
    const first = nth(items, 0)
    first.focus()
    focusSiblingMenuItem(first, 1)
    expect(document.activeElement).toBe(nth(items, 1))
  })

  it('moves focus to the previous sibling on direction -1', () => {
    const ul = buildMenu(['New', 'Open', 'Save'])
    const items = listMenuItems(ul)
    const second = nth(items, 1)
    second.focus()
    focusSiblingMenuItem(second, -1)
    expect(document.activeElement).toBe(nth(items, 0))
  })

  it('wraps from the last item to the first on direction 1', () => {
    const ul = buildMenu(['New', 'Open', 'Save'])
    const items = listMenuItems(ul)
    const last = nth(items, 2)
    last.focus()
    focusSiblingMenuItem(last, 1)
    expect(document.activeElement).toBe(nth(items, 0))
  })

  it('wraps from the first item to the last on direction -1', () => {
    const ul = buildMenu(['New', 'Open', 'Save'])
    const items = listMenuItems(ul)
    const first = nth(items, 0)
    first.focus()
    focusSiblingMenuItem(first, -1)
    expect(document.activeElement).toBe(nth(items, 2))
  })

  it('skips disabled items', () => {
    const ul = buildMenu(['New', 'Open', 'Revert'], { disabledIndex: 1 })
    const items = listMenuItems(ul) // ['New', 'Revert'] — Open excluded
    const first = nth(items, 0)
    first.focus()
    focusSiblingMenuItem(first, 1)
    expect(document.activeElement).toBe(nth(items, 1))
    expect(document.activeElement?.textContent).toBe('Revert')
  })

  it('is a no-op when the item has no open dropdown ancestor', () => {
    document.body.innerHTML = '<a role="menuitem" id="lone" tabindex="0">Lone</a>'
    const lone = document.getElementById('lone') as HTMLAnchorElement
    lone.focus()
    focusSiblingMenuItem(lone, 1)
    expect(document.activeElement).toBe(lone)
  })
})
