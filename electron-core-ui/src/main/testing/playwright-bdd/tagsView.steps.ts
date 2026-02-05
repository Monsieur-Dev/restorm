import {
  tagsViewAddSelector,
  tagsViewContextMenuSelector,
  tagsViewRootSelector,
  tagsViewTagInputSelector,
  tagsViewTagLabelSelector,
  tagsViewTagSelector
} from '../tagsViewSelectors'

import { contextMenuItemSelectorByLabel } from '../contextMenuSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { button?: 'left' | 'right'; force?: boolean; noWaitAfter?: boolean }) => Promise<void>
  focus: () => Promise<void>
  hover: () => Promise<void>
  press: (key: string) => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  count: () => Promise<number>
}

interface KeyboardLike {
  type: (text: string) => Promise<void>
  press: (key: string) => Promise<void>
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

export function defineTagsViewBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('tags view {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid tags view id')
    await asPage(page).locator(tagsViewRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('tags view {string} should have {int} tags', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid tags view parameters')
    const root = asPage(page).locator(tagsViewRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(root, 'data-tag-count', String(expected), 5000)
  })

  When('I add a tag in tags view {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid tags view id')
    const p = asPage(page)
    await p.locator(tagsViewAddSelector(testId)).click({ force: true })
  })

  When('I start editing tag {int} in tags view {string}', async ({ page }, index: unknown, testId: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid tags view parameters')
    const p = asPage(page)
    await p.locator(tagsViewTagLabelSelector(testId, index)).click({ force: true })
    await p.locator(tagsViewTagInputSelector(testId, index)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When(
    'I type {string} into tags view {string} tag {int} input',
    async ({ page }, text: unknown, testId: unknown, index: unknown) => {
      if (typeof text !== 'string' || typeof testId !== 'string' || typeof index !== 'number') {
        throw new Error('Invalid tags view typing parameters')
      }
      const p = asPage(page)
      const input = p.locator(tagsViewTagInputSelector(testId, index))
      await input.waitFor({ state: 'attached', timeout: 5000 })
      await input.focus()
      // Clear existing value reliably (Ctrl+A then Backspace)
      await input.press('Control+A')
      await input.press('Backspace')
      for (const ch of text) {
        await p.keyboard.type(ch)
      }
    }
  )

  When(
    'I type {string} into tags view {string} tag {int} input letter by letter',
    async ({ page }, text: unknown, testId: unknown, index: unknown) => {
      if (typeof text !== 'string' || typeof testId !== 'string' || typeof index !== 'number') {
        throw new Error('Invalid tags view typing parameters')
      }
      const p = asPage(page)
      const input = p.locator(tagsViewTagInputSelector(testId, index))
      await input.waitFor({ state: 'attached', timeout: 5000 })
      await input.focus()
      // Clear existing value reliably (Ctrl+A then Backspace)
      await input.press('Control+A')
      await input.press('Backspace')
      for (const ch of text) {
        await p.keyboard.type(ch)
      }
    }
  )

  When('I commit tags view {string} tag {int} editing', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid tags view parameters')
    const p = asPage(page)
    const input = p.locator(tagsViewTagInputSelector(testId, index))
    await input.waitFor({ state: 'attached', timeout: 5000 })
    await input.press('Enter')
  })

  When('I blur tags view {string} tag {int} input', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid tags view parameters')
    const p = asPage(page)
    const input = p.locator(tagsViewTagInputSelector(testId, index))
    await input.waitFor({ state: 'attached', timeout: 5000 })
    // Blur via Tab (simple + consistent)
    await input.focus()
    await input.press('Tab')
  })

  When('I cancel tags view {string} tag {int} editing', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid tags view parameters')
    const p = asPage(page)
    const input = p.locator(tagsViewTagInputSelector(testId, index))
    await input.waitFor({ state: 'attached', timeout: 5000 })
    await input.press('Escape')
  })

  When('I open tags view {string} tag {int} context menu', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid tags view parameters')
    const p = asPage(page)
    await p.locator(tagsViewTagSelector(testId, index)).click({ button: 'right', force: true })
    await p.locator(tagsViewContextMenuSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When('I click tags view {string} remove tag menu item {string}', async ({ page }, testId: unknown, label: unknown) => {
    if (typeof testId !== 'string' || typeof label !== 'string') throw new Error('Invalid tags view parameters')
    const p = asPage(page)
    const menuId = `${testId}-contextmenu`
    const item = p.locator(contextMenuItemSelectorByLabel(menuId, label))
    await item.waitFor({ state: 'visible', timeout: 5000 })
    await item.click({ force: true, noWaitAfter: true })
  })
}
