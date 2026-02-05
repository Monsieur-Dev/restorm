import {
  listViewDropdownButtonAnchorSelector,
  listViewDropdownListViewTestId,
  listViewDropdownPanelSelector,
  listViewDropdownRootSelector
} from '../listViewDropdownSelectors'
import { listViewRowSelectorByItemId } from '../listViewSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  count: () => Promise<number>
  getAttribute: (name: string) => Promise<string | null>
  innerText: () => Promise<string>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface KeyboardLike {
  press: (key: string) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  keyboard: KeyboardLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

export function defineListViewDropdownBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('list view dropdown {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view dropdown id')
    await asPage(page).locator(listViewDropdownRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('list view dropdown {string} should be open', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view dropdown id')
    const root = asPage(page).locator(listViewDropdownRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    const value = await root.getAttribute('data-is-open')
    if ((value ?? '') !== 'true') throw new Error(`Expected list view dropdown "${testId}" to be open`)
  })

  Then('list view dropdown {string} should be closed', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view dropdown id')
    const root = asPage(page).locator(listViewDropdownRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    const value = await root.getAttribute('data-is-open')
    if ((value ?? '') !== 'false') throw new Error(`Expected list view dropdown "${testId}" to be closed`)
  })

  When('I toggle list view dropdown {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view dropdown id')
    const p = asPage(page)
    const button = p.locator(listViewDropdownButtonAnchorSelector(testId))
    await button.waitFor({ state: 'attached', timeout: 5000 })
    await button.click({ force: true })
  })

  Then('list view dropdown {string} panel should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view dropdown id')
    await asPage(page).locator(listViewDropdownPanelSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When('I close list view dropdown {string} with Escape', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view dropdown id')
    const p = asPage(page)
    const root = p.locator(listViewDropdownRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    await p.keyboard.press('Escape')
  })

  When('I close list view dropdown {string} by clicking outside', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view dropdown id')
    const p = asPage(page)
    const root = p.locator(listViewDropdownRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    await p.locator('body').click({ force: true })
  })

  Then('list view dropdown {string} button text should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid list view dropdown parameters')
    const p = asPage(page)
    const button = p.locator(listViewDropdownButtonAnchorSelector(testId))
    await button.waitFor({ state: 'attached', timeout: 5000 })
    const text = (await button.innerText()).trim()
    if (text !== expected) throw new Error(`Expected list view dropdown "${testId}" button text="${expected}", got "${text}"`)
  })

  Then('list view dropdown {string} item {string} should be visible', async ({ page }, testId: unknown, itemId: unknown) => {
    if (typeof testId !== 'string' || typeof itemId !== 'string') throw new Error('Invalid list view dropdown parameters')
    const listViewTestId = listViewDropdownListViewTestId(testId)
    const selector = listViewRowSelectorByItemId(listViewTestId, itemId)
    await asPage(page).locator(selector).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('list view dropdown {string} selected ids should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid list view dropdown parameters')
    const root = asPage(page).locator(listViewDropdownRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    const value = await root.getAttribute('data-selected-ids')
    if ((value ?? '') !== expected) {
      throw new Error(`Expected list view dropdown "${testId}" data-selected-ids="${expected}", got "${value ?? ''}"`)
    }
  })
}
