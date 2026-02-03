import {
  splitViewPaneHeaderSelector,
  splitViewRootSelector
} from '../splitViewSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
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
  const final = await locator.getAttribute(name)
  throw new Error(`Timed out waiting for numeric attribute ${name}. Last="${final ?? ''}"`)
}

export function defineSplitViewBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('split view {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid split view id')
    await asPage(page).locator(splitViewRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('split view {string} pane count should be {int}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid split view parameters')
    const locator = asPage(page).locator(splitViewRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const actual = await waitForNumericAttribute(locator, 'data-pane-count', 5000)
    if (actual !== expected) throw new Error(`Expected split view "${testId}" pane count ${expected}, got ${actual}`)
  })

  Then('split view {string} collapsed state should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid split view parameters')
    const locator = asPage(page).locator(splitViewRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-collapsed', expected, 5000)
  })

  Then('split view {string} sizes should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid split view parameters')
    const locator = asPage(page).locator(splitViewRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-sizes', expected, 5000)
  })

  Then('split view {string} sizes should sum to {int}', async ({ page }, testId: unknown, expectedSum: unknown) => {
    if (typeof testId !== 'string' || typeof expectedSum !== 'number') throw new Error('Invalid split view parameters')
    const locator = asPage(page).locator(splitViewRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const raw = await locator.getAttribute('data-sizes')
    const parts = (raw ?? '').split('|').map((p) => Number(p))
    if (!parts.length || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`Invalid data-sizes for split view "${testId}": "${raw ?? ''}"`)
    }
    const sum = parts.reduce((a, b) => a + b, 0)
    if (sum !== expectedSum) throw new Error(`Expected split view "${testId}" sizes sum ${expectedSum}, got ${sum}`)
  })

  When('I toggle split view {string} pane {string}', async ({ page }, testId: unknown, paneIdOrIndex: unknown) => {
    if (typeof testId !== 'string' || typeof paneIdOrIndex !== 'string') throw new Error('Invalid split view toggle parameters')
    const locator = asPage(page).locator(splitViewPaneHeaderSelector(testId, paneIdOrIndex))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await locator.click({ force: true })
  })
}
