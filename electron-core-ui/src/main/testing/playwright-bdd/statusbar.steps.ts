import {
  statusbarElementSelector,
  statusbarElementTooltipSelector,
  statusbarRootSelector
} from '../statusbarSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  hover: () => Promise<void>
  focus: () => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
}

interface KeyboardLike {
  press: (key: string) => Promise<void>
}

interface MouseLike {
  move: (x: number, y: number) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  keyboard: KeyboardLike
  mouse: MouseLike
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

export function defineStatusbarBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('statusbar {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid statusbar id')
    await asPage(page).locator(statusbarRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('statusbar {string} should have {int} elements', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid statusbar parameters')
    const root = asPage(page).locator(statusbarRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(root, 'data-item-count', String(expected), 5000)
  })

  Then('statusbar element {string} should have warning {string}', async ({ page }, elementId: unknown, expected: unknown) => {
    if (typeof elementId !== 'string' || typeof expected !== 'string') throw new Error('Invalid statusbar element parameters')
    await waitForAttribute(asPage(page).locator(statusbarElementSelector(elementId)), 'data-warning', expected, 5000)
  })

  Then('statusbar element {string} should have error {string}', async ({ page }, elementId: unknown, expected: unknown) => {
    if (typeof elementId !== 'string' || typeof expected !== 'string') throw new Error('Invalid statusbar element parameters')
    await waitForAttribute(asPage(page).locator(statusbarElementSelector(elementId)), 'data-error', expected, 5000)
  })

  Then('statusbar element {string} should be clickable {string}', async ({ page }, elementId: unknown, expected: unknown) => {
    if (typeof elementId !== 'string' || typeof expected !== 'string') throw new Error('Invalid statusbar element parameters')
    await waitForAttribute(asPage(page).locator(statusbarElementSelector(elementId)), 'data-clickable', expected, 5000)
  })

  When('I hover statusbar element {string}', async ({ page }, elementId: unknown) => {
    if (typeof elementId !== 'string') throw new Error('Invalid statusbar element id')
    await asPage(page).locator(statusbarElementSelector(elementId)).hover()
  })

  When('I move mouse away from statusbar element {string}', async ({ page }, _elementId: unknown) => {
    const p = asPage(page)
    await p.mouse.move(1, 1)
  })

  Then('statusbar element {string} tooltip should be visible', async ({ page }, elementId: unknown) => {
    if (typeof elementId !== 'string') throw new Error('Invalid statusbar element id')
    const p = asPage(page)
    await waitForAttribute(p.locator(statusbarElementSelector(elementId)), 'data-tooltip-visible', 'true', 5000)
    await p.locator(statusbarElementTooltipSelector(elementId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('statusbar element {string} tooltip should be hidden', async ({ page }, elementId: unknown) => {
    if (typeof elementId !== 'string') throw new Error('Invalid statusbar element id')
    const p = asPage(page)
    await waitForAttribute(p.locator(statusbarElementSelector(elementId)), 'data-tooltip-visible', 'false', 5000)
    // Tooltip may remain in DOM during transitions; rely primarily on the stable attribute.
  })

  When('I click statusbar element {string}', async ({ page }, elementId: unknown) => {
    if (typeof elementId !== 'string') throw new Error('Invalid statusbar element id')
    await asPage(page).locator(statusbarElementSelector(elementId)).click({ force: true })
  })

  When('I press {string} on statusbar element {string}', async ({ page }, key: unknown, elementId: unknown) => {
    if (typeof key !== 'string' || typeof elementId !== 'string') throw new Error('Invalid statusbar element parameters')
    const p = asPage(page)
    const el = p.locator(statusbarElementSelector(elementId))
    await el.focus()
    await p.keyboard.press(key)
  })
}
