import {
  codeEditorResolvedThemeAttrSelector,
  codeEditorRootSelector,
  codeEditorTextareaSelector
} from '../codeEditorSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  count: () => Promise<number>
  fill: (value: string) => Promise<void>
  innerText: () => Promise<string>
  press: (key: string) => Promise<void>
  type: (text: string) => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

export function defineCodeEditorBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('code editor {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid code editor id')
    await asPage(page).locator(codeEditorRootSelector(testId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  When('I focus code editor {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid code editor id')
    const p = asPage(page)
    await p.locator(codeEditorTextareaSelector(testId)).click({ force: true })
  })

  When('I type in code editor {string} {string}', async ({ page }, testId: unknown, text: unknown) => {
    if (typeof testId !== 'string' || typeof text !== 'string') throw new Error('Invalid code editor typing parameters')
    const p = asPage(page)
    const textarea = p.locator(codeEditorTextareaSelector(testId))
    await textarea.click({ force: true })
    for (const ch of text) {
      await textarea.type(ch)
    }
  })

  When('I press {string} in code editor {string}', async ({ page }, key: unknown, testId: unknown) => {
    if (typeof testId !== 'string' || typeof key !== 'string') throw new Error('Invalid key press parameters')
    const p = asPage(page)
    const textarea = p.locator(codeEditorTextareaSelector(testId))
    await textarea.click({ force: true })
    await textarea.press(key)
  })

  Then('code editor {string} resolved theme should be {string}', async ({ page }, testId: unknown, expectedTheme: unknown) => {
    if (typeof testId !== 'string' || typeof expectedTheme !== 'string') {
      throw new Error('Invalid code editor theme assertion parameters')
    }
    const p = asPage(page)
    const attr = await p.locator(codeEditorResolvedThemeAttrSelector(testId)).getAttribute('data-resolved-theme')
    if (attr !== expectedTheme) {
      throw new Error(`Expected code editor "${testId}" resolved theme="${expectedTheme}", but got "${attr ?? ''}"`)
    }
  })

  Then('code editor {string} value should contain {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') {
      throw new Error('Invalid code editor value assertion parameters')
    }
    const p = asPage(page)
    const rootText = await p.locator(codeEditorRootSelector(testId)).innerText()
    if (!rootText.includes(expected)) {
      throw new Error(`Expected code editor "${testId}" text to contain "${expected}", but it did not.`)
    }
  })

  Then('code editor {string} should be hidden', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid code editor id')
    const p = asPage(page)
    const count = await p.locator(codeEditorRootSelector(testId)).count()
    if (count !== 0) {
      throw new Error(`Expected code editor "${testId}" to be hidden, but it is still present.`)
    }
  })
}
