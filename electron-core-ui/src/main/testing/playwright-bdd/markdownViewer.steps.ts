import {
  markdownViewerCodeBlockCopySelector,
  markdownViewerLinkSelector,
  markdownViewerMermaidSelector,
  markdownViewerRootSelector
} from '../markdownViewerSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  textContent: () => Promise<string | null>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PopupPageLike {
  url: () => string
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  waitForEvent: (event: 'popup') => Promise<PopupPageLike>
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

export function defineMarkdownViewerBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('markdown viewer {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid markdown viewer id')
    await asPage(page).locator(markdownViewerRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('markdown viewer {string} should be dark', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid markdown viewer id')
    const locator = asPage(page).locator(markdownViewerRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-is-dark', 'true')
  })

  Then('markdown viewer {string} allow mermaid should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid markdown viewer parameters')
    const expectedValue = expected === 'true' ? 'true' : 'false'
    const locator = asPage(page).locator(markdownViewerRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-allow-mermaid', expectedValue)
  })

  Then('markdown viewer {string} should contain text {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid markdown viewer parameters')
    const locator = asPage(page).locator(markdownViewerRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const text = await locator.textContent()
    if (!(text ?? '').includes(expected)) {
      throw new Error(`Expected markdown viewer "${testId}" to contain "${expected}"`)
    }
  })

  When('I click markdown viewer {string} code block {int} copy', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid markdown viewer parameters')
    await asPage(page).locator(markdownViewerCodeBlockCopySelector(testId, index)).click({ force: true })
  })

  Then('markdown viewer {string} code block {int} copy should be copied', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid markdown viewer parameters')
    const locator = asPage(page).locator(markdownViewerCodeBlockCopySelector(testId, index))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-is-copied', 'true', 3000)
  })

  Then('markdown viewer {string} mermaid block {int} should be rendered', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid markdown viewer parameters')
    const locator = asPage(page).locator(markdownViewerMermaidSelector(testId, index))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-is-rendered', 'true', 5000)
  })

  When('I click markdown viewer {string} link {int}', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid markdown viewer parameters')
    await asPage(page).locator(markdownViewerLinkSelector(testId, index)).click({ force: true })
  })

  Then('a popup should open with url {string}', async ({ page }, expectedUrl: unknown) => {
    if (typeof expectedUrl !== 'string') throw new Error('Invalid expected url')
    const popup = await asPage(page).waitForEvent('popup')
    const actual = popup.url()
    if (actual !== expectedUrl) {
      throw new Error(`Expected popup url "${expectedUrl}", got "${actual}"`)
    }
  })
}
