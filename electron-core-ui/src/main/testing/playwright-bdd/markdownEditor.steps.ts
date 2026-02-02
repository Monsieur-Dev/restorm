import {
  markdownEditorContentEditableSelector,
  markdownEditorRootSelector
} from '../markdownEditorSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  focus: () => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  innerText: () => Promise<string>
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

export function defineMarkdownEditorBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('markdown editor {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid markdown editor id')
    await asPage(page).locator(markdownEditorRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('markdown editor {string} should be dark', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid markdown editor id')
    const root = asPage(page).locator(markdownEditorRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(root, 'data-is-dark', 'true')
  })

  When('I focus markdown editor {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid markdown editor id')
    const editor = asPage(page).locator(markdownEditorContentEditableSelector(testId))
    await editor.waitFor({ state: 'attached', timeout: 10000 })
    await editor.click({ force: true })
    await editor.focus()
  })

  When('I type in markdown editor {string} {string}', async ({ page }, testId: unknown, text: unknown) => {
    if (typeof testId !== 'string' || typeof text !== 'string') throw new Error('Invalid markdown editor parameters')
    const p = asPage(page)
    const editor = p.locator(markdownEditorContentEditableSelector(testId))
    await editor.waitFor({ state: 'attached', timeout: 10000 })
    await editor.click({ force: true })
    await editor.focus()
    for (const ch of text) {
      await p.keyboard.type(ch)
    }
  })

  Then('markdown editor {string} should contain text {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid markdown editor parameters')
    const editor = asPage(page).locator(markdownEditorContentEditableSelector(testId))
    await editor.waitFor({ state: 'attached', timeout: 10000 })
    const text = await editor.innerText()
    if (!text.includes(expected)) {
      throw new Error(`Expected markdown editor \"${testId}\" to contain \"${expected}\"`)
    }
  })
}
