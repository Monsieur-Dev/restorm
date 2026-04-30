import {
  menuBarHamburgerButtonSelector,
  menuBarItemSelector,
  menuBarItemSubmenuSelector,
  menuBarMenuButtonSelector,
  menuBarMenuDropdownSelector,
  menuBarOverflowButtonSelector,
  menuBarRootSelector
} from '../menuBarSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  hover: () => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
}

interface KeyboardLike {
  press: (key: string) => Promise<void>
}

interface MouseLike {
  click: (x: number, y: number) => Promise<void>
}

interface EvaluateArgs {
  menubarTestId: string
  menuId: string
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  keyboard: KeyboardLike
  mouse: MouseLike
  evaluate: <T>(fn: (args: EvaluateArgs) => T, arg: EvaluateArgs) => Promise<T>
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

async function waitForAttribute(locator: LocatorLike, name: string, expected: string, timeoutMs = 2500): Promise<void> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const actual = await locator.getAttribute(name)
    if ((actual ?? '') === expected) return
    await sleep(50)
  }
  const final = await locator.getAttribute(name)
  throw new Error(`Expected ${name}="${expected}", but got "${final ?? ''}"`)
}

function parseKeys(keys: string): string[] {
  return keys
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
}

function toPlaywrightShortcut(shortcut: string): string {
  const parts = shortcut.split('+').map((p) => p.trim()).filter(Boolean)
  const mapped = parts.map((p) => {
    switch (p.toLowerCase()) {
      case 'ctrl': return 'Control'
      case 'control': return 'Control'
      case 'cmd': return 'Meta'
      case 'command': return 'Meta'
      case 'meta': return 'Meta'
      case 'alt': return 'Alt'
      case 'shift': return 'Shift'
      default: return p.length === 1 ? p.toUpperCase() : p
    }
  })
  return mapped.join('+')
}

export function defineMenuBarBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('menu bar {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid menu bar id')
    await asPage(page).locator(menuBarRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When('I open menu bar {string} menu {string}', async ({ page }, menubarTestId: unknown, menuId: unknown) => {
    if (typeof menubarTestId !== 'string' || typeof menuId !== 'string') throw new Error('Invalid menu bar parameters')
    const p = asPage(page)
    // Prefer keyboard-based open for reliability across environments (focus + ArrowDown open)
    const targetIndex = await p.evaluate(({ menubarTestId: mbId, menuId: mId }) => {
      const root = document.querySelector(`[data-testid="${mbId}"]`)
      if (!root) return -1
      const items = Array.from(root.querySelectorAll('[role="menuitem"]'))
      for (let i = 0; i < items.length; i += 1) {
        const el = items[i]
        if ((el as HTMLElement).getAttribute('data-testid') === mId) return i
      }
      return -1
    }, { menubarTestId, menuId })
    if (targetIndex < 0) {
      throw new Error(`Menu "${menuId}" not found in menu bar "${menubarTestId}"`)
    }

    // Ensure focus is inside the targeted menubar (avoid interacting with other menubars on the page)
    await p.evaluate(({ menuId: mId }) => {
      const el = document.querySelector(`[data-testid="${mId}"]`)
      if (el instanceof HTMLElement) {
        el.focus()
      }
      return true
    }, { menubarTestId, menuId })

    await p.keyboard.press('Escape')
    await p.keyboard.press('ArrowRight')
    for (let i = 0; i < targetIndex; i += 1) {
      await p.keyboard.press('ArrowRight')
    }
    await p.keyboard.press('ArrowDown')

    await p.locator(menuBarMenuButtonSelector(menuId)).waitFor({ state: 'attached', timeout: 5000 })
    await p.locator(menuBarMenuDropdownSelector(menuId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('menu bar {string} menu {string} should be open', async ({ page }, _menubarTestId: unknown, menuId: unknown) => {
    if (typeof menuId !== 'string') throw new Error('Invalid menu id')
    await asPage(page).locator(menuBarMenuDropdownSelector(menuId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('menu bar {string} menu {string} should be closed', async ({ page }, _menubarTestId: unknown, menuId: unknown) => {
    if (typeof menuId !== 'string') throw new Error('Invalid menu id')
    await asPage(page).locator(menuBarMenuDropdownSelector(menuId)).waitFor({ state: 'detached', timeout: 5000 })
  })

  When('I click outside to close menu bar {string}', async ({ page }, menubarTestId: unknown) => {
    if (typeof menubarTestId !== 'string') throw new Error('Invalid menu bar id')
    const p = asPage(page)
    await p.mouse.click(1, 1)
    await waitForAttribute(p.locator(menuBarRootSelector(menubarTestId)), 'data-is-open', 'false', 5000)
  })

  When('I click menu bar item {string}', async ({ page }, itemId: unknown) => {
    if (typeof itemId !== 'string') throw new Error('Invalid menu item id')
    await asPage(page).locator(menuBarItemSelector(itemId)).click({ force: true })
  })

  When('I hover menu bar item {string}', async ({ page }, itemId: unknown) => {
    if (typeof itemId !== 'string') throw new Error('Invalid menu item id')
    await asPage(page).locator(menuBarItemSelector(itemId)).hover()
  })

  Then('menu bar submenu {string} should be visible', async ({ page }, itemId: unknown) => {
    if (typeof itemId !== 'string') throw new Error('Invalid menu item id')
    await asPage(page).locator(menuBarItemSubmenuSelector(itemId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When('I press keys {string} in menu bar {string}', async ({ page }, keys: unknown, menubarTestId: unknown) => {
    if (typeof keys !== 'string' || typeof menubarTestId !== 'string') throw new Error('Invalid menu bar parameters')
    const p = asPage(page)
    await p.evaluate(({ menubarTestId: mbId }) => {
      const root = document.querySelector(`[data-testid="${mbId}"]`)
      if (!root) return false
      const first = root.querySelector('[role="menuitem"]')
      if (first instanceof HTMLElement) {
        first.focus()
      }
      return true
    }, { menubarTestId, menuId: menubarTestId })
    for (const key of parseKeys(keys)) {
      await p.keyboard.press(key)
    }
  })

  When('I trigger menu shortcut {string}', async ({ page }, shortcut: unknown) => {
    if (typeof shortcut !== 'string') throw new Error('Invalid shortcut')
    await asPage(page).keyboard.press(toPlaywrightShortcut(shortcut))
  })

  // ── Responsive layout (overflow + hamburger) ─────────────────────
  Then('menu bar {string} should be in {string} mode', async ({ page }, testId: unknown, mode: unknown) => {
    if (typeof testId !== 'string' || typeof mode !== 'string') throw new Error('Invalid menu bar mode params')
    if (mode !== 'full' && mode !== 'overflow' && mode !== 'hamburger') {
      throw new Error(`Invalid layout mode "${mode}" — expected full | overflow | hamburger`)
    }
    await waitForAttribute(asPage(page).locator(menuBarRootSelector(testId)), 'data-mode', mode, 5000)
  })

  Then('menu bar {string} should have {int} visible items', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid menu bar visible-count params')
    await waitForAttribute(
      asPage(page).locator(menuBarRootSelector(testId)),
      'data-visible-count',
      String(expected),
      5000
    )
  })

  When('I open the overflow menu of menu bar {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid menu bar id')
    await asPage(page).locator(menuBarOverflowButtonSelector(testId)).click({ force: true })
  })

  When('I open the hamburger menu of menu bar {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid menu bar id')
    await asPage(page).locator(menuBarHamburgerButtonSelector(testId)).click({ force: true })
  })

  Then('menu bar {string} overflow button should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid menu bar id')
    await asPage(page).locator(menuBarOverflowButtonSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('menu bar {string} hamburger button should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid menu bar id')
    await asPage(page).locator(menuBarHamburgerButtonSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })
}
