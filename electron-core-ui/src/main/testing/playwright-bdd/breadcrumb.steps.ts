import {
  breadcrumbEditInputSelector,
  breadcrumbLastLabelSelector,
  breadcrumbNonLastItemsSelector,
  breadcrumbRootSelector
} from '../breadcrumbSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: () => Promise<void>
  fill: (value: string) => Promise<void>
  blur: () => Promise<void>
  press: (key: string) => Promise<void>
  innerText: () => Promise<string>
  count: () => Promise<number>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  nth: (index: number) => LocatorLike
}

interface PageLike {
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

async function ensureEditingInputVisible(page: PageLike, breadcrumbTestId: string): Promise<LocatorLike> {
  const input = page.locator(breadcrumbEditInputSelector(breadcrumbTestId))
  await input.waitFor({ state: 'visible', timeout: 5000 })
  return input
}

export function defineBreadcrumbBddSteps({ When, Then }: BddFnsWithPage): void {
  When('I click breadcrumb {string} item index {int}', async ({ page }, breadcrumbTestId: unknown, index: unknown) => {
    if (typeof breadcrumbTestId !== 'string' || typeof index !== 'number') {
      throw new Error('Invalid parameters for clicking breadcrumb item')
    }

    const p = asPage(page)
    const items = p.locator(breadcrumbNonLastItemsSelector(breadcrumbTestId))
    await items.nth(index).click()
  })

  When('I start editing breadcrumb {string} last item', async ({ page }, breadcrumbTestId: unknown) => {
    if (typeof breadcrumbTestId !== 'string') {
      throw new Error('Invalid breadcrumb id')
    }

    const p = asPage(page)
    await p.locator(breadcrumbLastLabelSelector(breadcrumbTestId)).click()
    await ensureEditingInputVisible(p, breadcrumbTestId)
  })

  When('I set breadcrumb {string} last item to {string}', async ({ page }, breadcrumbTestId: unknown, value: unknown) => {
    if (typeof breadcrumbTestId !== 'string' || typeof value !== 'string') {
      throw new Error('Invalid parameters for setting breadcrumb last item')
    }

    const p = asPage(page)

    // If not already editing, start it.
    const editingCount = await p.locator(breadcrumbEditInputSelector(breadcrumbTestId)).count()
    if (editingCount === 0) {
      await p.locator(breadcrumbLastLabelSelector(breadcrumbTestId)).click()
    }

    const input = await ensureEditingInputVisible(p, breadcrumbTestId)
    await input.fill(value)
  })

  When('I submit breadcrumb {string} edition with Enter', async ({ page }, breadcrumbTestId: unknown) => {
    if (typeof breadcrumbTestId !== 'string') {
      throw new Error('Invalid breadcrumb id')
    }

    const p = asPage(page)
    const input = await ensureEditingInputVisible(p, breadcrumbTestId)
    await input.press('Enter')
    await p.locator(breadcrumbLastLabelSelector(breadcrumbTestId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  When('I submit breadcrumb {string} edition with blur', async ({ page }, breadcrumbTestId: unknown) => {
    if (typeof breadcrumbTestId !== 'string') {
      throw new Error('Invalid breadcrumb id')
    }

    const p = asPage(page)
    const input = await ensureEditingInputVisible(p, breadcrumbTestId)
    await input.blur()
    await p.locator(breadcrumbLastLabelSelector(breadcrumbTestId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  When('I cancel breadcrumb {string} edition with Escape', async ({ page }, breadcrumbTestId: unknown) => {
    if (typeof breadcrumbTestId !== 'string') {
      throw new Error('Invalid breadcrumb id')
    }

    const p = asPage(page)
    const input = await ensureEditingInputVisible(p, breadcrumbTestId)
    await input.press('Escape')
    await p.locator(breadcrumbLastLabelSelector(breadcrumbTestId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  Then('breadcrumb {string} should be in editing mode', async ({ page }, breadcrumbTestId: unknown) => {
    if (typeof breadcrumbTestId !== 'string') {
      throw new Error('Invalid breadcrumb id')
    }

    const p = asPage(page)
    await p.locator(breadcrumbEditInputSelector(breadcrumbTestId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  Then('breadcrumb {string} should not be in editing mode', async ({ page }, breadcrumbTestId: unknown) => {
    if (typeof breadcrumbTestId !== 'string') {
      throw new Error('Invalid breadcrumb id')
    }

    const p = asPage(page)
    const count = await p.locator(breadcrumbEditInputSelector(breadcrumbTestId)).count()
    if (count !== 0) {
      throw new Error(`Expected breadcrumb "${breadcrumbTestId}" not to be in editing mode, but input is present.`)
    }
  })

  Then('the last breadcrumb label in {string} should be {string}', async ({ page }, breadcrumbTestId: unknown, expected: unknown) => {
    if (typeof breadcrumbTestId !== 'string' || typeof expected !== 'string') {
      throw new Error('Invalid parameters for breadcrumb label assertion')
    }

    const p = asPage(page)
    const text = await p.locator(breadcrumbLastLabelSelector(breadcrumbTestId)).innerText()
    if (text.trim() !== expected) {
      throw new Error(`Expected last breadcrumb label="${expected}", but got "${text}"`)
    }
  })

  Then('breadcrumb {string} should have {int} items', async ({ page }, breadcrumbTestId: unknown, expectedCount: unknown) => {
    if (typeof breadcrumbTestId !== 'string' || typeof expectedCount !== 'number') {
      throw new Error('Invalid parameters for breadcrumb items count assertion')
    }

    const p = asPage(page)
    const count = await p.locator(`${breadcrumbRootSelector(breadcrumbTestId)} li.ecui-breadcrumb-item`).count()
    if (count !== expectedCount) {
      throw new Error(`Expected breadcrumb "${breadcrumbTestId}" to have ${expectedCount} items, but got ${count}.`)
    }
  })
}
