import {
  settingsTreeViewItemSelector,
  settingsTreeViewRootSelector
} from '../settingsTreeViewSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
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

export function defineSettingsTreeViewBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('settings tree view {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid settings tree view id')
    await asPage(page).locator(settingsTreeViewRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('settings tree view {string} category {string} should be visible', async ({ page }, testId: unknown, categoryId: unknown) => {
    if (typeof testId !== 'string' || typeof categoryId !== 'string') throw new Error('Invalid settings tree view parameters')
    await asPage(page).locator(settingsTreeViewItemSelector(testId, categoryId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('settings tree view {string} category {string} should be hidden', async ({ page }, testId: unknown, categoryId: unknown) => {
    if (typeof testId !== 'string' || typeof categoryId !== 'string') throw new Error('Invalid settings tree view parameters')
    const n = await asPage(page).locator(settingsTreeViewItemSelector(testId, categoryId)).count()
    if (n !== 0) throw new Error(`Expected settings tree view "${testId}" category "${categoryId}" to be hidden`)
  })

  When('I select settings tree view {string} category {string}', async ({ page }, testId: unknown, categoryId: unknown) => {
    if (typeof testId !== 'string' || typeof categoryId !== 'string') throw new Error('Invalid settings tree view parameters')
    const locator = asPage(page).locator(settingsTreeViewItemSelector(testId, categoryId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await locator.click({ force: true })
  })

  Then('settings tree view {string} selected category should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid settings tree view parameters')
    const root = asPage(page).locator(settingsTreeViewRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    const actual = await root.getAttribute('data-selected-category')
    if ((actual ?? '') !== expected) {
      throw new Error(`Expected settings tree view "${testId}" selected category="${expected}", got "${actual ?? ''}"`)
    }
  })

  Then(
    'settings tree view {string} category {string} expanded should be {string}',
    async ({ page }, testId: unknown, categoryId: unknown, expected: unknown) => {
      if (typeof testId !== 'string' || typeof categoryId !== 'string' || typeof expected !== 'string') {
        throw new Error('Invalid settings tree view parameters')
      }
      const normalizedExpected = expected === 'true' ? 'true' : 'false'
      const locator = asPage(page).locator(settingsTreeViewItemSelector(testId, categoryId))
      await locator.waitFor({ state: 'attached', timeout: 5000 })
      const actual = await locator.getAttribute('data-is-expanded')
      if ((actual ?? '') !== normalizedExpected) {
        throw new Error(
          `Expected settings tree view "${testId}" category "${categoryId}" data-is-expanded="${normalizedExpected}", got "${actual ?? ''}"`
        )
      }
    }
  )
}
