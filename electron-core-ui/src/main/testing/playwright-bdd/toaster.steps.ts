import {
  toastByTitleSelector,
  toastCloseByTitleSelector,
  toasterClearButtonSelector,
  toasterDndButtonSelector,
  toasterHideButtonSelector,
  toasterRootSelector,
  toastSelector
} from '../toasterSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  hover: () => Promise<void>
  count: () => Promise<number>
  getAttribute: (name: string) => Promise<string | null>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface MouseLike {
  move: (x: number, y: number) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  mouse: MouseLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

async function waitForAttribute(
  locator: LocatorLike,
  name: string,
  expected: string,
  timeoutMs = 2500
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const actual = await locator.getAttribute(name)
    if ((actual ?? '') === expected) return
    await sleep(50)
  }
  const final = await locator.getAttribute(name)
  throw new Error(`Expected ${name}="${expected}", but got "${final ?? ''}"`)
}

async function waitForCount(
  p: PageLike,
  selector: string,
  expected: number,
  timeoutMs = 2500
): Promise<void> {
  const start = Date.now()
  let actual = 0
  while (Date.now() - start <= timeoutMs) {
    actual = await p.locator(selector).count()
    if (actual === expected) return
    await sleep(50)
  }
  throw new Error(`Expected ${expected} elements matching "${selector}", got ${actual}`)
}

export function defineToasterBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('toaster {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toaster id')
    await asPage(page)
      .locator(toasterRootSelector(testId))
      .waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('toaster {string} should have {int} toasts', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid toaster parameters')
    await waitForCount(asPage(page), toastSelector(testId), expected, 5000)
  })

  Then('toaster {string} should contain toast {string}', async ({ page }, testId: unknown, title: unknown) => {
    if (typeof testId !== 'string' || typeof title !== 'string') throw new Error('Invalid toaster parameters')
    await asPage(page)
      .locator(toastByTitleSelector(testId, title))
      .waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('toaster {string} should not contain toast {string}', async ({ page }, testId: unknown, title: unknown) => {
    if (typeof testId !== 'string' || typeof title !== 'string') throw new Error('Invalid toaster parameters')
    const start = Date.now()
    const p = asPage(page)
    const sel = toastByTitleSelector(testId, title)
    while (Date.now() - start <= 5000) {
      const count = await p.locator(sel).count()
      if (count === 0) return
      await sleep(50)
    }
    throw new Error(`Toaster "${testId}" still contains toast "${title}"`)
  })

  Then('toaster {string} should show the frame', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toaster id')
    await waitForAttribute(asPage(page).locator(toasterRootSelector(testId)), 'data-showframe', 'true', 5000)
  })

  Then('toaster {string} should hide the frame', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toaster id')
    const p = asPage(page)
    const root = p.locator(toasterRootSelector(testId))
    // When frame is hidden AND there are no toasts, the Toaster unmounts.
    // We accept either: attribute "false", or the node not being present.
    const start = Date.now()
    while (Date.now() - start <= 5000) {
      const count = await root.count()
      if (count === 0) return
      const actual = await root.getAttribute('data-showframe')
      if (actual === 'false') return
      await sleep(50)
    }
    const actual = await root.getAttribute('data-showframe')
    throw new Error(`Expected toaster "${testId}" frame hidden, but data-showframe="${actual ?? ''}"`)
  })

  Then('toaster {string} should be in do-not-disturb mode', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toaster id')
    await waitForAttribute(asPage(page).locator(toasterRootSelector(testId)), 'data-donotdisturb', 'true', 5000)
  })

  Then('toaster {string} should not be in do-not-disturb mode', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toaster id')
    await waitForAttribute(asPage(page).locator(toasterRootSelector(testId)), 'data-donotdisturb', 'false', 5000)
  })

  When('I click clear-all button of toaster {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toaster id')
    await asPage(page).locator(toasterClearButtonSelector(testId)).click({ force: true })
  })

  When('I click do-not-disturb button of toaster {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toaster id')
    await asPage(page).locator(toasterDndButtonSelector(testId)).click({ force: true })
  })

  When('I click hide button of toaster {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toaster id')
    await asPage(page).locator(toasterHideButtonSelector(testId)).click({ force: true })
  })

  When('I dismiss toast {string} of toaster {string}', async ({ page }, title: unknown, testId: unknown) => {
    if (typeof testId !== 'string' || typeof title !== 'string') throw new Error('Invalid toaster parameters')
    await asPage(page).locator(toastCloseByTitleSelector(testId, title)).click({ force: true })
  })

  When('I hover toaster {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toaster id')
    await asPage(page).locator(toasterRootSelector(testId)).hover()
  })

  When('I move mouse away from toaster {string}', async ({ page }, _testId: unknown) => {
    await asPage(page).mouse.move(1, 1)
  })
}
