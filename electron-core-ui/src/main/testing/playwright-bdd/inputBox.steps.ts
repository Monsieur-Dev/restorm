import {
  inputBoxInputSelector,
  inputBoxMessageSelector,
  inputBoxRootSelector
} from '../inputBoxSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  count: () => Promise<number>
  fill: (value: string) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  innerText: () => Promise<string>
  inputValue: () => Promise<string>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

export function defineInputBoxBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('input box {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid input box id')
    await asPage(page).locator(inputBoxRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('input box {string} should be disabled', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid input box id')
    const p = asPage(page)
    const disabled = await p.locator(inputBoxInputSelector(testId)).getAttribute('disabled')
    if (disabled === null) {
      throw new Error(`Expected input box "${testId}" to be disabled`)
    }
  })

  When('I focus input box {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid input box id')
    await asPage(page).locator(inputBoxInputSelector(testId)).click({ force: true })
  })

  When('I set input box {string} value to {string}', async ({ page }, testId: unknown, value: unknown) => {
    if (typeof testId !== 'string' || typeof value !== 'string') throw new Error('Invalid input box parameters')
    await asPage(page).locator(inputBoxInputSelector(testId)).fill(value)
  })

  Then('input box {string} value should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid input box parameters')
    const v = await asPage(page).locator(inputBoxInputSelector(testId)).inputValue()
    if (v !== expected) {
      throw new Error(`Expected input box "${testId}" value="${expected}", but got "${v}"`)
    }
  })

  Then('input box {string} should have aria-invalid {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid input box parameters')
    const attr = await asPage(page).locator(inputBoxInputSelector(testId)).getAttribute('aria-invalid')
    const normalized = attr ?? 'false'
    if (normalized !== expected) {
      throw new Error(`Expected input box "${testId}" aria-invalid="${expected}", but got "${normalized}"`)
    }
  })

  Then('input box {string} message should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid input box parameters')
    const text = await asPage(page).locator(inputBoxMessageSelector(testId)).innerText()
    if (text.trim() !== expected) {
      throw new Error(`Expected input box "${testId}" message="${expected}", but got "${text}"`)
    }
  })

  Then('input box {string} message type should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid input box parameters')
    const type = await asPage(page).locator(inputBoxMessageSelector(testId)).getAttribute('data-message-type')
    if ((type ?? '') !== expected) {
      throw new Error(`Expected input box "${testId}" message type="${expected}", but got "${type ?? ''}"`)
    }
  })

  Then('input box {string} placeholder should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid input box parameters')
    const placeholder = await asPage(page).locator(inputBoxInputSelector(testId)).getAttribute('placeholder')
    if ((placeholder ?? '') !== expected) {
      throw new Error(`Expected input box "${testId}" placeholder="${expected}", but got "${placeholder ?? ''}"`)
    }
  })
}
