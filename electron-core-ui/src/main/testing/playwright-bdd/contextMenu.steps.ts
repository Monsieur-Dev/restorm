import {
  contextMenuItemIconSelector,
  contextMenuItemSelectorByLabel,
  contextMenuMenuSelector,
  contextMenuOpenSubmenuContainerSelector,
  contextMenuOpenSubmenuItemByLabelSelector,
  contextMenuOpenSubmenuItemSelector,
  contextMenuRootSelector,
  contextMenuSeparatorSelector
} from '../contextMenuSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean; noWaitAfter?: boolean }) => Promise<void>
  hover: () => Promise<void>
  focus: () => Promise<void>
  press: (key: string) => Promise<void>
  count: () => Promise<number>
  getAttribute: (name: string) => Promise<string | null>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

async function ensureVisible(locator: LocatorLike): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: 5000 })
}

export function defineContextMenuBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('context menu {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid context menu id')
    const p = asPage(page)
    await p.locator(contextMenuMenuSelector(testId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  Then('context menu {string} should be hidden', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid context menu id')
    const p = asPage(page)
    const count = await p.locator(contextMenuRootSelector(testId)).count()
    if (count !== 0) {
      throw new Error(`Expected context menu "${testId}" to be hidden, but it is still present.`)
    }
  })

  Then('context menu {string} should have a separator', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid context menu id')
    const p = asPage(page)
    const count = await p.locator(contextMenuSeparatorSelector(testId)).count()
    if (count <= 0) {
      throw new Error(`Expected context menu "${testId}" to contain a separator, but none was found.`)
    }
  })

  When('I click context menu {string} item {string}', async ({ page }, testId: unknown, label: unknown) => {
    if (typeof testId !== 'string' || typeof label !== 'string') {
      throw new Error('Invalid parameters for clicking context menu item')
    }
    const p = asPage(page)
    const item = p.locator(contextMenuItemSelectorByLabel(testId, label))
    await ensureVisible(item)
    await item.click({ force: true, noWaitAfter: true })
  })

  Then('context menu {string} item {string} should be disabled', async ({ page }, testId: unknown, label: unknown) => {
    if (typeof testId !== 'string' || typeof label !== 'string') {
      throw new Error('Invalid parameters for context menu disabled assertion')
    }
    const p = asPage(page)
    const value = await p.locator(contextMenuItemSelectorByLabel(testId, label)).getAttribute('aria-disabled')
    if (value !== 'true') {
      throw new Error(`Expected context menu item "${label}" to be aria-disabled=true, but got ${String(value)}`)
    }
  })

  Then('context menu {string} item {string} should be enabled', async ({ page }, testId: unknown, label: unknown) => {
    if (typeof testId !== 'string' || typeof label !== 'string') {
      throw new Error('Invalid parameters for context menu enabled assertion')
    }
    const p = asPage(page)
    const value = await p.locator(contextMenuItemSelectorByLabel(testId, label)).getAttribute('aria-disabled')
    if (value === 'true') {
      throw new Error(`Expected context menu item "${label}" to be enabled, but aria-disabled=true`)
    }
  })

  Then('context menu {string} item {string} should be checked', async ({ page }, testId: unknown, label: unknown) => {
    if (typeof testId !== 'string' || typeof label !== 'string') {
      throw new Error('Invalid parameters for context menu checked assertion')
    }
    const p = asPage(page)
    const value = await p.locator(contextMenuItemSelectorByLabel(testId, label)).getAttribute('aria-checked')
    if (value !== 'true') {
      throw new Error(`Expected context menu item "${label}" to be aria-checked=true, but got ${String(value)}`)
    }
  })

  Then('context menu {string} item {string} should have icon {string}', async ({ page }, testId: unknown, label: unknown, icon: unknown) => {
    if (typeof testId !== 'string' || typeof label !== 'string' || typeof icon !== 'string') {
      throw new Error('Invalid parameters for context menu icon assertion')
    }
    const p = asPage(page)
    const count = await p.locator(contextMenuItemIconSelector(testId, label, icon)).count()
    if (count <= 0) {
      throw new Error(`Expected context menu item "${label}" to contain codicon "${icon}", but none was found.`)
    }
  })

  When('I open context menu {string} submenu {string} with keyboard', async ({ page }, testId: unknown, label: unknown) => {
    if (typeof testId !== 'string' || typeof label !== 'string') {
      throw new Error('Invalid parameters for opening context menu submenu with keyboard')
    }
    const p = asPage(page)
    const item = p.locator(contextMenuItemSelectorByLabel(testId, label))
    await ensureVisible(item)
    await item.focus()
    await item.press('ArrowRight')
    await p.locator(contextMenuOpenSubmenuItemSelector(testId, label)).waitFor({ state: 'visible', timeout: 5000 })
  })

  When('I open context menu {string} submenu {string} with hover', async ({ page }, testId: unknown, label: unknown) => {
    if (typeof testId !== 'string' || typeof label !== 'string') {
      throw new Error('Invalid parameters for opening context menu submenu with hover')
    }
    const p = asPage(page)
    const item = p.locator(contextMenuItemSelectorByLabel(testId, label))
    await ensureVisible(item)
    await item.hover()
    await p.locator(contextMenuOpenSubmenuItemSelector(testId, label)).waitFor({ state: 'visible', timeout: 5000 })
  })

  Then('context menu {string} submenu {string} should be open', async ({ page }, testId: unknown, label: unknown) => {
    if (typeof testId !== 'string' || typeof label !== 'string') {
      throw new Error('Invalid parameters for submenu open assertion')
    }
    const p = asPage(page)
    await p.locator(contextMenuOpenSubmenuContainerSelector(testId, label)).waitFor({ state: 'visible', timeout: 5000 })
  })

  When('I click context menu {string} submenu item {string} -> {string}', async ({ page }, testId: unknown, parent: unknown, child: unknown) => {
    if (typeof testId !== 'string' || typeof parent !== 'string' || typeof child !== 'string') {
      throw new Error('Invalid parameters for clicking context menu submenu item')
    }
    const p = asPage(page)
    const item = p.locator(contextMenuOpenSubmenuItemByLabelSelector(testId, parent, child))
    await ensureVisible(item)
    await item.click()
  })
}
