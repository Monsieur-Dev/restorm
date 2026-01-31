import {
  variableInputBoxRootSelector,
  variableInputBoxTextareaSelector
} from '../variableInputBoxSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { button?: 'left' | 'right'; force?: boolean }) => Promise<void>
  count: () => Promise<number>
  press: (key: string) => Promise<void>
  type: (text: string) => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface KeyboardLike {
  type: (text: string) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  keyboard: KeyboardLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

export function defineVariableInputBoxBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('variable input box {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid variable input box id')
    await asPage(page).locator(variableInputBoxRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When('I focus variable input box {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid variable input box id')
    const p = asPage(page)
    await p.locator(variableInputBoxTextareaSelector(testId)).click({ force: true })
  })

  When('I type in variable input box {string} {string}', async ({ page }, testId: unknown, text: unknown) => {
    if (typeof testId !== 'string' || typeof text !== 'string') throw new Error('Invalid variable input box typing parameters')
    const p = asPage(page)
    const textarea = p.locator(variableInputBoxTextareaSelector(testId))
    await textarea.click({ force: true })
    for (const ch of text) {
      await p.keyboard.type(ch)
    }
  })

  When('I press {string} in variable input box {string}', async ({ page }, key: unknown, testId: unknown) => {
    if (typeof testId !== 'string' || typeof key !== 'string') throw new Error('Invalid variable input box key press parameters')
    const p = asPage(page)
    const textarea = p.locator(variableInputBoxTextareaSelector(testId))
    await textarea.click({ force: true })
    await textarea.press(key)
  })

  When('I right click variable input box {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid variable input box id')
    const p = asPage(page)
    await p.locator(variableInputBoxRootSelector(testId)).click({ button: 'right', force: true })
  })
}
