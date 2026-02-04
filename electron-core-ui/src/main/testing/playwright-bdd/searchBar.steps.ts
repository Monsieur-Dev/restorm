import {
  searchBarClosedSelector,
  searchBarCategorySelector,
  searchBarInputSelector,
  searchBarOpenSelector,
  searchBarResultSelector,
  searchBarRootSelector,
  searchBarResultsSelector,
  searchBarTooltipSelector
} from '../searchBarSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  count: () => Promise<number>
  getAttribute: (name: string) => Promise<string | null>
  hover: () => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface KeyboardLike {
  press: (key: string) => Promise<void>
  type?: (text: string) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  keyboard: KeyboardLike
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

async function waitForNumericAttribute(locator: LocatorLike, name: string, timeoutMs = 2500): Promise<number> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const raw = await locator.getAttribute(name)
    const n = Number(raw)
    if (Number.isFinite(n)) return n
    await sleep(50)
  }
  const raw = await locator.getAttribute(name)
  throw new Error(`Timed out waiting for numeric attribute ${name}. Last="${raw ?? ''}"`)
}

async function typeTextLetterByLetter(page: PageLike, text: string): Promise<void> {
  for (const ch of text) {
    if (typeof page.keyboard.type === 'function') {
      await page.keyboard.type(ch)
    } else {
      await page.keyboard.press(ch)
    }
  }
}

export function defineSearchBarBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('search bar {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid search bar id')
    await asPage(page).locator(searchBarRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('search bar {string} should be open', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid search bar id')
    const root = asPage(page).locator(searchBarRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(root, 'data-is-open', 'true', 5000)
  })

  Then('search bar {string} should be closed', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid search bar id')
    const root = asPage(page).locator(searchBarRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(root, 'data-is-open', 'false', 5000)
  })

  When('I open search bar {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid search bar id')
    const p = asPage(page)
    const closed = p.locator(searchBarClosedSelector(testId))
    await closed.waitFor({ state: 'attached', timeout: 5000 })
    await closed.click({ force: true })
    await p.locator(searchBarOpenSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When('I close search bar {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid search bar id')
    const p = asPage(page)
    const input = p.locator(searchBarInputSelector(testId))
    await input.waitFor({ state: 'attached', timeout: 5000 })
    await input.click({ force: true })
    await p.keyboard.press('Escape')
  })

  When('I type in search bar {string} query letter by letter {string}', async ({ page }, testId: unknown, text: unknown) => {
    if (typeof testId !== 'string' || typeof text !== 'string') throw new Error('Invalid search bar typing parameters')
    const p = asPage(page)
    const input = p.locator(searchBarInputSelector(testId))
    await input.waitFor({ state: 'attached', timeout: 5000 })
    await input.click({ force: true })
    await typeTextLetterByLetter(p, text)
  })

  When('I clear search bar {string} query', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid search bar id')
    const p = asPage(page)
    const input = p.locator(searchBarInputSelector(testId))
    await input.waitFor({ state: 'attached', timeout: 5000 })
    await input.click({ force: true })
    await p.keyboard.press('Control+A')
    await p.keyboard.press('Backspace')
  })

  Then('search bar {string} results count should be {int}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid search bar parameters')
    const root = asPage(page).locator(searchBarRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    const actual = await waitForNumericAttribute(root, 'data-results-count', 5000)
    if (actual !== expected) throw new Error(`Expected search bar "${testId}" results count ${expected}, got ${actual}`)
  })

  Then('search bar {string} results should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid search bar id')
    await asPage(page).locator(searchBarResultsSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When('I toggle search bar {string} category {string}', async ({ page }, testId: unknown, categoryKey: unknown) => {
    if (typeof testId !== 'string' || typeof categoryKey !== 'string') throw new Error('Invalid search bar parameters')
    const p = asPage(page)
    const locator = p.locator(searchBarCategorySelector(testId, categoryKey))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await locator.click({ force: true })
  })

  When('I click search bar {string} result {string}', async ({ page }, testId: unknown, resultKey: unknown) => {
    if (typeof testId !== 'string' || typeof resultKey !== 'string') throw new Error('Invalid search bar parameters')
    const p = asPage(page)
    const locator = p.locator(searchBarResultSelector(testId, resultKey))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await locator.click({ force: true })
  })

  Then('search bar {string} tooltip should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid search bar id')
    const p = asPage(page)
    const locator = p.locator(searchBarTooltipSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('search bar {string} tooltip should be hidden', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid search bar id')
    const p = asPage(page)
    const locator = p.locator(searchBarTooltipSelector(testId))
    const n = await locator.count()
    if (n !== 0) throw new Error(`Expected search bar "${testId}" tooltip to be hidden`)
  })

  When('I hover search bar {string} result {string}', async ({ page }, testId: unknown, resultKey: unknown) => {
    if (typeof testId !== 'string' || typeof resultKey !== 'string') throw new Error('Invalid search bar parameters')
    const p = asPage(page)
    const locator = p.locator(searchBarResultSelector(testId, resultKey))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await locator.hover()
  })
}

// EOF
