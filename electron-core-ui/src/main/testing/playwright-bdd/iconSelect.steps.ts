import {
  iconSelectButtonSelector,
  iconSelectClearSelector,
  iconSelectEmojiSelector,
  iconSelectIconSelector,
  iconSelectPickerSelector,
  iconSelectRootSelector,
  iconSelectSearchInputSelector,
  iconSelectTabSelector
} from '../iconSelectSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  count: () => Promise<number>
  first?: () => LocatorLike
  isVisible?: () => Promise<boolean>
  scrollIntoViewIfNeeded?: () => Promise<void>
}

interface KeyboardLike {
  press: (key: string) => Promise<void>
  type?: (text: string) => Promise<void>
}

interface MouseLike {
  click: (x: number, y: number) => Promise<void>
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

async function ensureInView(locator: LocatorLike): Promise<void> {
  if (typeof locator.scrollIntoViewIfNeeded === 'function') {
    await locator.scrollIntoViewIfNeeded()
  }
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

async function waitForNonEmptyAttribute(locator: LocatorLike, name: string, timeoutMs = 2500): Promise<string> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const actual = await locator.getAttribute(name)
    if ((actual ?? '').trim().length > 0) return actual ?? ''
    await sleep(50)
  }
  const final = await locator.getAttribute(name)
  throw new Error(`Expected ${name} to be non-empty, but got "${final ?? ''}"`)
}

export function defineIconSelectBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('icon select {string} should be open', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid icon select id')
    const root = asPage(page).locator(iconSelectRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(root, 'data-is-open', 'true', 5000)
    await asPage(page).locator(iconSelectPickerSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('icon select {string} should be closed', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid icon select id')
    const root = asPage(page).locator(iconSelectRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(root, 'data-is-open', 'false', 5000)
    const n = await asPage(page).locator(iconSelectPickerSelector(testId)).count()
    if (n !== 0) throw new Error(`Expected icon select "${testId}" picker to be hidden`)
  })

  Then('icon select {string} active tab should be {string}', async ({ page }, testId: unknown, tabId: unknown) => {
    if (typeof testId !== 'string' || typeof tabId !== 'string') throw new Error('Invalid icon select parameters')
    await waitForAttribute(asPage(page).locator(iconSelectRootSelector(testId)), 'data-active-tab', tabId, 5000)
  })

  Then('icon select {string} selected type should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid icon select parameters')
    await waitForAttribute(asPage(page).locator(iconSelectRootSelector(testId)), 'data-selected-type', expected, 5000)
  })

  Then('icon select {string} selected value should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid icon select parameters')
    await waitForAttribute(asPage(page).locator(iconSelectRootSelector(testId)), 'data-selected-value', expected, 5000)
  })

  Then('icon select {string} selected value should not be empty', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid icon select id')
    await waitForNonEmptyAttribute(asPage(page).locator(iconSelectRootSelector(testId)), 'data-selected-value', 5000)
  })

  Then('icon select {string} should be readonly', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid icon select id')
    const p = asPage(page)
    await p.locator(iconSelectRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
    const n = await p.locator(iconSelectButtonSelector(testId)).count()
    if (n !== 0) throw new Error(`Expected icon select "${testId}" to have no button in readonly mode`)
  })

  When('I open icon select {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid icon select id')
    const p = asPage(page)
    await p.locator(iconSelectButtonSelector(testId)).click()
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-is-open', 'true', 5000)
  })

  When('I close icon select {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid icon select id')
    const p = asPage(page)
    await p.mouse.click(1, 1)
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-is-open', 'false', 5000)
  })

  When('I select icon select {string} tab {string}', async ({ page }, testId: unknown, tabId: unknown) => {
    if (typeof testId !== 'string' || typeof tabId !== 'string') throw new Error('Invalid icon select parameters')
    const p = asPage(page)
    await p.locator(iconSelectTabSelector(testId, tabId)).click({ force: true })
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-active-tab', tabId, 5000)
  })

  When('I clear icon select {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid icon select id')
    const p = asPage(page)
    await p.locator(iconSelectClearSelector(testId)).click({ force: true })
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-selected-type', '', 5000)
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-selected-value', '', 5000)
  })

  When('I type in icon select {string} search for tab {string} {string}', async ({ page }, testId: unknown, tabId: unknown, text: unknown) => {
    if (typeof testId !== 'string' || typeof tabId !== 'string' || typeof text !== 'string') {
      throw new Error('Invalid icon select search parameters')
    }
    const p = asPage(page)
    const input = p.locator(iconSelectSearchInputSelector(testId, tabId))
    await ensureInView(input)
    await input.click({ force: true })
    await p.keyboard.press('Control+A')
    await p.keyboard.press('Backspace')
    await typeTextLetterByLetter(p, text)
  })

  When('I select emoji {string} in icon select {string}', async ({ page }, emoji: unknown, testId: unknown) => {
    if (typeof emoji !== 'string' || typeof testId !== 'string') throw new Error('Invalid icon select parameters')
    const p = asPage(page)
    const locator = p.locator(iconSelectEmojiSelector(testId, emoji))
    await ensureInView(locator)
    await locator.click({ force: true })
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-selected-type', 'emoji', 5000)
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-selected-value', emoji, 5000)
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-is-open', 'false', 5000)
  })

  When('I select first emoji in icon select {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid icon select id')
    const p = asPage(page)
    const all = p.locator(`${iconSelectPickerSelector(testId)} [data-emoji]`)
    if (typeof all.first !== 'function') throw new Error('Locator.first() is not available')
    const first = all.first()
    await ensureInView(first)
    await first.click({ force: true })
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-selected-type', 'emoji', 5000)
    await waitForNonEmptyAttribute(p.locator(iconSelectRootSelector(testId)), 'data-selected-value', 5000)
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-is-open', 'false', 5000)
  })

  When('I select icon {string} {string} in icon select {string}', async ({ page }, iconType: unknown, iconName: unknown, testId: unknown) => {
    if (typeof iconType !== 'string' || typeof iconName !== 'string' || typeof testId !== 'string') {
      throw new Error('Invalid icon select parameters')
    }
    const p = asPage(page)
    const locator = p.locator(iconSelectIconSelector(testId, iconType, iconName))
    await ensureInView(locator)
    await locator.click({ force: true })
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-selected-type', iconType, 5000)
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-selected-value', iconName, 5000)
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-is-open', 'false', 5000)
  })

  When('I select first icon of type {string} in icon select {string}', async ({ page }, iconType: unknown, testId: unknown) => {
    if (typeof iconType !== 'string' || typeof testId !== 'string') throw new Error('Invalid icon select parameters')
    const p = asPage(page)
    const all = p.locator(`${iconSelectPickerSelector(testId)} [data-icon-type="${iconType}"][data-icon-name]`)
    if (typeof all.first !== 'function') throw new Error('Locator.first() is not available')
    const first = all.first()
    await ensureInView(first)
    await first.click({ force: true })
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-selected-type', iconType, 5000)
    await waitForNonEmptyAttribute(p.locator(iconSelectRootSelector(testId)), 'data-selected-value', 5000)
    await waitForAttribute(p.locator(iconSelectRootSelector(testId)), 'data-is-open', 'false', 5000)
  })
}
