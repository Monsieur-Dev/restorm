import {
  modalCloseButtonSelector,
  modalHeaderSelector,
  modalOverlaySelector,
  modalRootSelector
} from '../modalSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { button?: 'left' | 'right' | 'middle'; force?: boolean }) => Promise<void>
  count: () => Promise<number>
  getAttribute: (name: string) => Promise<string | null>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface KeyboardLike {
  press: (key: string) => Promise<void>
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

async function waitForCount(locator: LocatorLike, expected: number, timeoutMs = 2500): Promise<void> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const n = await locator.count()
    if (n === expected) return
    await sleep(50)
  }
  const final = await locator.count()
  throw new Error(`Expected count ${expected}, got ${final}`)
}

export function defineModalBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('modal {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid modal id')
    await asPage(page).locator(modalRootSelector(testId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  Then('modal {string} should be hidden', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid modal id')
    await waitForCount(asPage(page).locator(modalRootSelector(testId)), 0, 5000)
  })

  Then('modal {string} state should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid modal parameters')
    if (expected !== 'open' && expected !== 'closing' && expected !== 'closed') {
      throw new Error('Invalid modal state. Expected open|closing|closed')
    }
    const p = asPage(page)
    if (expected === 'closed') {
      await waitForCount(p.locator(modalRootSelector(testId)), 0, 5000)
      return
    }
    const locator = p.locator(modalOverlaySelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-state', expected, 5000)
  })

  Then('modal {string} size should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid modal parameters')
    if (expected !== 'full' && expected !== 'dialog') throw new Error('Invalid modal size. Expected full|dialog')
    const locator = asPage(page).locator(modalRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-size', expected, 5000)
  })

  When('I close modal {string} with Escape', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid modal id')
    await asPage(page).locator(modalRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
    await asPage(page).keyboard.press('Escape')
  })

  When('I close modal {string} with close button', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid modal id')
    const p = asPage(page)
    const locator = p.locator(modalCloseButtonSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await locator.click({ force: true })
  })

  When('I close modal {string} with header middle click', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid modal id')
    const p = asPage(page)
    const locator = p.locator(modalHeaderSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await locator.click({ button: 'middle', force: true })
  })
}
