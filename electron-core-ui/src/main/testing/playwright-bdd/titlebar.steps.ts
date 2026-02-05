import {
  titlebarCenterSelector,
  titlebarIconSelector,
  titlebarLeftSelector,
  titlebarRightSelector,
  titlebarRootSelector,
  titlebarTitleSelector
} from '../titlebarSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  count: () => Promise<number>
  getAttribute: (name: string) => Promise<string | null>
  innerText: () => Promise<string>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

export function defineTitlebarBddSteps({ Then }: BddFnsWithPage): void {
  Then('titlebar {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid titlebar id')
    await asPage(page).locator(titlebarRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('titlebar {string} left zone should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid titlebar id')
    await asPage(page).locator(titlebarLeftSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('titlebar {string} center zone should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid titlebar id')
    await asPage(page).locator(titlebarCenterSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('titlebar {string} right zone should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid titlebar id')
    await asPage(page).locator(titlebarRightSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('titlebar {string} showSearchBar should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid titlebar parameters')
    const expectedValue = expected === 'true' ? 'true' : 'false'
    const locator = asPage(page).locator(titlebarRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const actual = await locator.getAttribute('data-show-searchbar')
    if ((actual ?? '') !== expectedValue) {
      throw new Error(`Expected titlebar "${testId}" data-show-searchbar="${expectedValue}", got "${actual ?? ''}"`)
    }
  })

  Then('titlebar {string} icon should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid titlebar id')
    await asPage(page).locator(titlebarIconSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('titlebar {string} icon should be hidden', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid titlebar id')
    const n = await asPage(page).locator(titlebarIconSelector(testId)).count()
    if (n !== 0) throw new Error(`Expected titlebar "${testId}" icon to be hidden`)
  })

  Then('titlebar {string} title should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid titlebar parameters')
    const locator = asPage(page).locator(titlebarTitleSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const text = (await locator.innerText()).trim()
    if (text !== expected) throw new Error(`Expected titlebar "${testId}" title="${expected}", got "${text}"`)
  })
}
