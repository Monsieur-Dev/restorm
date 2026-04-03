import {
  tabsRootSelector,
  tabsTabSelector
} from '../tabsSelectors'

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

type EvaluateFn = (fn: (selector: string) => unknown, arg: string) => Promise<unknown>

interface PageLike {
  locator: (selector: string) => LocatorLike
  evaluate: EvaluateFn
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

export function defineTabsBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('the tabs {string} should have {int} tabs', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid tabs id')
    if (typeof expected !== 'number') throw new Error('Invalid expected count')
    const selector = tabsRootSelector(testId)
    const count = await asPage(page).evaluate((sel: string) => {
      const root = document.querySelector(sel)
      if (!root) return 0
      return root.querySelectorAll('[role="tab"]').length
    }, selector)
    if (count !== expected) {
      throw new Error(`Expected tabs "${testId}" to have ${String(expected)} tabs, but found ${String(count)}`)
    }
  })

  When('I click on tab {string} in {string}', async ({ page }, tabId: unknown, testId: unknown) => {
    if (typeof tabId !== 'string' || typeof testId !== 'string') throw new Error('Invalid tab parameters')
    await asPage(page).locator(tabsTabSelector(testId, tabId)).click()
  })

  Then('the active tab in {string} should be {string}', async ({ page }, testId: unknown, expectedTabId: unknown) => {
    if (typeof testId !== 'string' || typeof expectedTabId !== 'string') throw new Error('Invalid tab parameters')
    const attr = await asPage(page).locator(tabsRootSelector(testId)).getAttribute('data-active-tab-id')
    if (attr !== expectedTabId) {
      throw new Error(`Expected active tab in "${testId}" to be "${expectedTabId}", but got "${String(attr)}"`)
    }
  })
}
