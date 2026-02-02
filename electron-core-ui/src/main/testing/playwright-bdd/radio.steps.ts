import { radioGroupItemSelector, radioGroupRootSelector } from '../radioSelectors'

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

export function defineRadioBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('radio group {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid radio group id')
    await asPage(page).locator(radioGroupRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When('I click radio group {string} item {int}', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid radio group parameters')
    await asPage(page).locator(radioGroupItemSelector(testId, index)).click({ force: true })
  })

  Then('radio group {string} item {int} should be checked', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid radio group parameters')
    const attr = await asPage(page).locator(radioGroupItemSelector(testId, index)).getAttribute('aria-checked')
    if ((attr ?? '') !== 'true') throw new Error(`Expected radio group "${testId}" item ${index} to be checked`)
  })

  Then('radio group {string} item {int} should be unchecked', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid radio group parameters')
    const attr = await asPage(page).locator(radioGroupItemSelector(testId, index)).getAttribute('aria-checked')
    if ((attr ?? '') !== 'false') throw new Error(`Expected radio group "${testId}" item ${index} to be unchecked`)
  })

  Then('radio group {string} item {int} should be disabled', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid radio group parameters')
    const disabled = await asPage(page).locator(radioGroupItemSelector(testId, index)).getAttribute('disabled')
    if (disabled === null) throw new Error(`Expected radio group "${testId}" item ${index} to be disabled`)
  })

  Then('radio group {string} item {int} title should be {string}', async ({ page }, testId: unknown, index: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number' || typeof expected !== 'string') throw new Error('Invalid radio group parameters')
    const title = await asPage(page).locator(radioGroupItemSelector(testId, index)).getAttribute('title')
    if ((title ?? '') !== expected) {
      throw new Error(`Expected radio group "${testId}" item ${index} title="${expected}", got "${title ?? ''}"`)
    }
  })
}
