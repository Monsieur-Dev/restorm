import {
  buttonAnchorSelector,
  buttonDropdownActionByIndexSelector,
  buttonDropdownMenuSelector,
  buttonDropdownPrimarySelector,
  buttonDropdownToggleSelector,
  buttonTestIdSelector
} from '../buttonSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  press: (key: string) => Promise<void>
  focus: () => Promise<void>
  count: () => Promise<number>
  getAttribute: (name: string) => Promise<string | null>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

function normalizeKey(value: string): string {
  // Keep Playwright key names (e.g. "Enter", "Space", "Escape").
  // We also accept a literal space for convenience.
  if (value === ' ') return 'Space'
  return value
}

export function defineButtonBddSteps({ When, Then }: BddFnsWithPage): void {
  When('I click button {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid button id')
    const p = asPage(page)
    await p.locator(buttonAnchorSelector(testId)).click()
  })

  When('I try to click button {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid button id')
    const p = asPage(page)
    await p.locator(buttonAnchorSelector(testId)).click({ force: true })
  })

  When('I press {string} on button {string}', async ({ page }, key: unknown, testId: unknown) => {
    if (typeof key !== 'string' || typeof testId !== 'string') {
      throw new Error('Invalid parameters for button key press')
    }
    const p = asPage(page)
    const locator = p.locator(buttonAnchorSelector(testId))
    await locator.focus()
    await locator.press(normalizeKey(key))
  })

  Then('button {string} should be disabled', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid button id')
    const p = asPage(page)
    const value = await p.locator(buttonAnchorSelector(testId)).getAttribute('aria-disabled')
    if (value !== 'true') {
      throw new Error(`Expected button "${testId}" to be aria-disabled=true, but got ${String(value)}`)
    }
  })

  Then('button {string} should not be disabled', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid button id')
    const p = asPage(page)
    const value = await p.locator(buttonAnchorSelector(testId)).getAttribute('aria-disabled')
    if (value === 'true') {
      throw new Error(`Expected button "${testId}" to be enabled, but aria-disabled=true`)
    }
  })

  Then('button {string} should contain codicon {string}', async ({ page }, testId: unknown, icon: unknown) => {
    if (typeof testId !== 'string' || typeof icon !== 'string') {
      throw new Error('Invalid parameters for codicon assertion')
    }
    const p = asPage(page)
    const root = buttonTestIdSelector(testId)
    const count = await p.locator(`${root} .codicon-${icon}, ${root}.codicon-${icon}`).count()
    if (count <= 0) {
      throw new Error(`Expected button "${testId}" to contain codicon "${icon}", but none was found.`)
    }
  })

  When('I open dropdown {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid dropdown id')
    const p = asPage(page)
    await p.locator(buttonDropdownToggleSelector(testId)).click()
  })

  When('I click dropdown {string} primary action', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid dropdown id')
    const p = asPage(page)
    await p.locator(buttonDropdownPrimarySelector(testId)).click()
  })

  When('I click dropdown {string} action index {int}', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') {
      throw new Error('Invalid parameters for dropdown action click')
    }
    const p = asPage(page)
    await p.locator(buttonDropdownActionByIndexSelector(testId, index)).click()
  })

  Then('dropdown {string} should be open', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid dropdown id')
    const p = asPage(page)
    await p.locator(buttonDropdownMenuSelector(testId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  Then('dropdown {string} should be closed', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid dropdown id')
    const p = asPage(page)
    const count = await p.locator(buttonDropdownMenuSelector(testId)).count()
    if (count !== 0) {
      throw new Error(`Expected dropdown "${testId}" to be closed, but menu is still present.`)
    }
  })
}
