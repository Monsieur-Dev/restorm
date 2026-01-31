import {
  customWcoCloseSelector,
  customWcoMaximizeIconSelector,
  customWcoMaximizeSelector,
  customWcoMinimizeSelector,
  customWcoRootSelector
} from '../customWcoSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: () => Promise<void>
  count: () => Promise<number>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

export function defineCustomWcoBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('custom wco {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid custom wco id')
    const p = asPage(page)
    await p.locator(customWcoRootSelector(testId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  Then('custom wco spacer {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid custom wco id')
    const p = asPage(page)
    await p.locator(customWcoRootSelector(testId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  Then('custom wco {string} should be hidden', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid custom wco id')
    const p = asPage(page)
    const count = await p.locator(customWcoRootSelector(testId)).count()
    if (count !== 0) {
      throw new Error(`Expected custom wco "${testId}" to be hidden, but it is still present.`)
    }
  })

  When('I click custom wco {string} minimize', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid custom wco id')
    const p = asPage(page)
    await p.locator(customWcoMinimizeSelector(testId)).click()
  })

  When('I click custom wco {string} maximize', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid custom wco id')
    const p = asPage(page)
    await p.locator(customWcoMaximizeSelector(testId)).click()
  })

  When('I click custom wco {string} close', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid custom wco id')
    const p = asPage(page)
    await p.locator(customWcoCloseSelector(testId)).click()
  })

  Then('custom wco {string} maximize icon should be {string}', async ({ page }, testId: unknown, icon: unknown) => {
    if (typeof testId !== 'string' || typeof icon !== 'string') {
      throw new Error('Invalid parameters for custom wco maximize icon assertion')
    }
    if (icon !== 'chrome-maximize' && icon !== 'chrome-restore') {
      throw new Error('Invalid icon name for custom wco maximize button')
    }
    const p = asPage(page)
    await p.locator(customWcoMaximizeIconSelector(testId, icon)).waitFor({ state: 'visible', timeout: 5000 })
  })
}
