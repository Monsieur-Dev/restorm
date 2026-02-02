import { progressBarRootSelector } from '../progressBarSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
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
  throw new Error(`Timed out waiting for numeric ${name}. Last="${final ?? ''}"`)
}

export function defineProgressBarBddSteps({ Then }: BddFnsWithPage): void {
  Then('progress bar {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid progress bar id')
    await asPage(page).locator(progressBarRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('progress bar {string} data-mode should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid progress bar parameters')
    const locator = asPage(page).locator(progressBarRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-mode', expected)
  })

  Then('progress bar {string} should be active', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid progress bar id')
    const locator = asPage(page).locator(progressBarRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-is-active', 'true')
  })

  Then('progress bar {string} should be inactive', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid progress bar id')
    const locator = asPage(page).locator(progressBarRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-is-active', 'false', 5000)
  })

  Then('progress bar {string} width percent should be {int}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid progress bar parameters')
    const locator = asPage(page).locator(progressBarRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const actual = await waitForNumericAttribute(locator, 'data-width-percent')
    const delta = Math.abs(actual - expected)
    if (delta > 1) {
      throw new Error(`Expected progress bar "${testId}" width percent≈${expected}, got ${actual}`)
    }
  })

  Then('progress bar {string} aria-valuenow should be {int}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid progress bar parameters')
    const locator = asPage(page).locator(progressBarRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const attr = await locator.getAttribute('aria-valuenow')
    const n = Number(attr)
    if (!Number.isFinite(n) || n !== expected) {
      throw new Error(`Expected progress bar "${testId}" aria-valuenow=${expected}, got "${attr ?? ''}"`)
    }
  })

  Then('progress bar {string} should become long running', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid progress bar id')
    const locator = asPage(page).locator(progressBarRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-is-long-running', 'true', 12000)
  })
}
