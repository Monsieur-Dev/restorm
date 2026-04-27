import {
  toggleActionSelector,
  toggleLabelSelector,
  toggleRootSelector
} from '../toggleSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  focus: () => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  press: (key: string) => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

export function defineToggleBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('toggle {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    await asPage(page).locator(toggleRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('toggle {string} should be checked', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    const attr = await asPage(page).locator(toggleActionSelector(testId)).getAttribute('aria-checked')
    if ((attr ?? '') !== 'true') throw new Error(`Expected toggle "${testId}" to be checked`)
  })

  Then('toggle {string} should be unchecked', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    const attr = await asPage(page).locator(toggleActionSelector(testId)).getAttribute('aria-checked')
    if ((attr ?? '') !== 'false') throw new Error(`Expected toggle "${testId}" to be unchecked`)
  })

  Then('toggle {string} should be indeterminate', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    const attr = await asPage(page).locator(toggleActionSelector(testId)).getAttribute('aria-checked')
    if ((attr ?? '') !== 'mixed') throw new Error(`Expected toggle "${testId}" to be indeterminate (aria-checked="mixed")`)
  })

  Then('toggle {string} should be disabled', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    const attr = await asPage(page).locator(toggleActionSelector(testId)).getAttribute('aria-disabled')
    if ((attr ?? '') !== 'true') throw new Error(`Expected toggle "${testId}" to be disabled`)
  })

  When('I click toggle {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    await asPage(page).locator(toggleActionSelector(testId)).click({ force: true })
  })

  When('I click toggle {string} label', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid toggle id')
    await asPage(page).locator(toggleLabelSelector(testId)).click({ force: true })
  })

  When('I press {string} on toggle {string}', async ({ page }, key: unknown, testId: unknown) => {
    if (typeof key !== 'string' || typeof testId !== 'string') throw new Error('Invalid toggle parameters')
    const action = asPage(page).locator(toggleActionSelector(testId))
    await action.focus()
    await action.press(key)
  })
}
