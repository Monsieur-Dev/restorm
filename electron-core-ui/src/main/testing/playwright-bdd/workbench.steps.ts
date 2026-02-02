import {
  editorWorkbenchGroupSelector,
  editorWorkbenchGroupTabsContainerSelector,
  editorWorkbenchGroupContentSelector,
  editorWorkbenchRootSelector,
  editorWorkbenchTabCloseSelector,
  editorWorkbenchTabLabelSelector,
  editorWorkbenchTabSelector
} from '../workbenchSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface BoundingBoxLike {
  x: number
  y: number
  width: number
  height: number
}

interface LocatorLike {
  click: (options?: { button?: 'left' | 'right' | 'middle'; force?: boolean; noWaitAfter?: boolean }) => Promise<void>
  dragTo: (target: LocatorLike, options?: { targetPosition?: { x: number; y: number } }) => Promise<void>
  nth: (index: number) => LocatorLike
  count: () => Promise<number>
  boundingBox: () => Promise<BoundingBoxLike | null>
  getAttribute: (name: string) => Promise<string | null>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
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

async function readNumericAttribute(locator: LocatorLike, name: string): Promise<number> {
  const raw = await locator.getAttribute(name)
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    throw new Error(`Expected numeric ${name}, got "${raw ?? ''}"`)
  }
  return n
}

function positionToRatios(position: string): { xRatio: number; yRatio: number } {
  switch (position) {
    case 'left': return { xRatio: 0.05, yRatio: 0.50 }
    case 'right': return { xRatio: 0.95, yRatio: 0.50 }
    case 'top': return { xRatio: 0.50, yRatio: 0.05 }
    case 'bottom': return { xRatio: 0.50, yRatio: 0.95 }
    case 'center': return { xRatio: 0.50, yRatio: 0.50 }
    default:
      throw new Error(`Invalid drop position "${position}". Expected left|right|top|bottom|center.`)
  }
}

export function defineWorkbenchBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('editor workbench {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid workbench id')
    await asPage(page).locator(editorWorkbenchRootSelector(testId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  Then('workbench {string} should have {int} groups', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid workbench group count parameters')
    const locator = asPage(page).locator(editorWorkbenchRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const actual = await readNumericAttribute(locator, 'data-root-group-count')
    if (actual !== expected) {
      throw new Error(`Expected workbench "${testId}" to have ${expected} groups, got ${actual}`)
    }
  })

  Then('workbench {string} group {string} should have {int} tabs', async ({ page }, testId: unknown, groupId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof groupId !== 'string' || typeof expected !== 'number') {
      throw new Error('Invalid workbench group tab count parameters')
    }
    const locator = asPage(page).locator(editorWorkbenchGroupSelector(testId, groupId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const actual = await readNumericAttribute(locator, 'data-tab-count')
    if (actual !== expected) {
      throw new Error(`Expected workbench "${testId}" group "${groupId}" to have ${expected} tabs, got ${actual}`)
    }
  })

  Then('active tab in workbench {string} group {string} should be {string}', async ({ page }, testId: unknown, groupId: unknown, expectedTabId: unknown) => {
    if (typeof testId !== 'string' || typeof groupId !== 'string' || typeof expectedTabId !== 'string') {
      throw new Error('Invalid parameters for active tab assertion')
    }
    const group = asPage(page).locator(editorWorkbenchGroupSelector(testId, groupId))
    await group.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(group, 'data-active-tab-id', expectedTabId)
  })

  When('I activate workbench {string} group {string} tab {string}', async ({ page }, testId: unknown, groupId: unknown, tabId: unknown) => {
    if (typeof testId !== 'string' || typeof groupId !== 'string' || typeof tabId !== 'string') {
      throw new Error('Invalid parameters for activating a tab')
    }
    const tab = asPage(page).locator(editorWorkbenchTabLabelSelector(testId, groupId, tabId))
    await tab.waitFor({ state: 'visible', timeout: 5000 })
    await tab.click()
  })

  When('I close workbench {string} group {string} tab {string}', async ({ page }, testId: unknown, groupId: unknown, tabId: unknown) => {
    if (typeof testId !== 'string' || typeof groupId !== 'string' || typeof tabId !== 'string') {
      throw new Error('Invalid parameters for closing a tab')
    }
    const close = asPage(page).locator(editorWorkbenchTabCloseSelector(testId, groupId, tabId))
    await close.waitFor({ state: 'visible', timeout: 5000 })
    await close.click({ force: true, noWaitAfter: true })
  })

  When('I open workbench {string} group {string} tab {string} context menu', async ({ page }, testId: unknown, groupId: unknown, tabId: unknown) => {
    if (typeof testId !== 'string' || typeof groupId !== 'string' || typeof tabId !== 'string') {
      throw new Error('Invalid parameters for opening tab context menu')
    }
    const tab = asPage(page).locator(editorWorkbenchTabLabelSelector(testId, groupId, tabId))
    await tab.waitFor({ state: 'visible', timeout: 5000 })
    await tab.click({ button: 'right' })
  })

  When('I reorder workbench {string} group {string} tab {string} to index {int}', async ({ page }, testId: unknown, groupId: unknown, tabId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof groupId !== 'string' || typeof tabId !== 'string' || typeof index !== 'number') {
      throw new Error('Invalid parameters for reordering tab')
    }
    const p = asPage(page)
    const source = p.locator(editorWorkbenchTabSelector(testId, groupId, tabId))
    const container = p.locator(editorWorkbenchGroupTabsContainerSelector(testId, groupId))
    await source.waitFor({ state: 'visible', timeout: 5000 })
    await container.waitFor({ state: 'visible', timeout: 5000 })

    const targetTabSelector = `[data-testid^="${testId}-group-${groupId}-tabs-tab-"]`
    const list = p.locator(targetTabSelector)
    const count = await list.count()
    if (count <= 0) throw new Error('No tabs found in group')
    const clamped = Math.max(0, Math.min(count - 1, index))
    const targetTab = list.nth(clamped)

    const containerBox = await container.boundingBox()
    const targetBox = await targetTab.boundingBox()
    if (!containerBox || !targetBox) throw new Error('Unable to compute tab bounding boxes')

    const x = Math.max(1, Math.min(containerBox.width - 2, (targetBox.x - containerBox.x) + 2))
    const y = Math.max(1, Math.min(containerBox.height - 2, containerBox.height / 2))
    await source.dragTo(container, { targetPosition: { x, y } })
  })

  When(
    'I move workbench {string} tab {string} from group {string} to group {string} at index {int}',
    async ({ page }, testId: unknown, tabId: unknown, fromGroupId: unknown, toGroupId: unknown, index: unknown) => {
      if (
        typeof testId !== 'string' ||
        typeof tabId !== 'string' ||
        typeof fromGroupId !== 'string' ||
        typeof toGroupId !== 'string' ||
        typeof index !== 'number'
      ) {
        throw new Error('Invalid parameters for moving tab between groups via tabs container')
      }
      const p = asPage(page)
      const source = p.locator(editorWorkbenchTabSelector(testId, fromGroupId, tabId))
      const container = p.locator(editorWorkbenchGroupTabsContainerSelector(testId, toGroupId))
      await source.waitFor({ state: 'visible', timeout: 5000 })
      await container.waitFor({ state: 'visible', timeout: 5000 })

      const targetTabSelector = `[data-testid^="${testId}-group-${toGroupId}-tabs-tab-"]`
      const list = p.locator(targetTabSelector)
      const count = await list.count()
      const clamped = Math.max(0, Math.min(Math.max(0, count - 1), index))

      const containerBox = await container.boundingBox()
      if (!containerBox) throw new Error('Unable to compute target tabs container bounding box')

      // If there are no tabs, just drop near the start of the container
      if (count <= 0) {
        const x = Math.max(1, Math.min(containerBox.width - 2, 5))
        const y = Math.max(1, Math.min(containerBox.height - 2, containerBox.height / 2))
        await source.dragTo(container, { targetPosition: { x, y } })
        return
      }

      const targetTab = list.nth(clamped)
      const targetBox = await targetTab.boundingBox()
      if (!targetBox) throw new Error('Unable to compute target tab bounding box')

      const x = Math.max(1, Math.min(containerBox.width - 2, (targetBox.x - containerBox.x) + 2))
      const y = Math.max(1, Math.min(containerBox.height - 2, containerBox.height / 2))
      await source.dragTo(container, { targetPosition: { x, y } })
    }
  )

  When(
    'I drag workbench {string} group {string} tab {string} and drop on group {string} position {string}',
    async ({ page }, testId: unknown, fromGroupId: unknown, tabId: unknown, targetGroupId: unknown, position: unknown) => {
      if (
        typeof testId !== 'string' ||
        typeof fromGroupId !== 'string' ||
        typeof tabId !== 'string' ||
        typeof targetGroupId !== 'string' ||
        typeof position !== 'string'
      ) {
        throw new Error('Invalid parameters for moving tab between groups')
      }
      const p = asPage(page)
      const source = p.locator(editorWorkbenchTabSelector(testId, fromGroupId, tabId))
      const target = p.locator(editorWorkbenchGroupContentSelector(testId, targetGroupId))
      await source.waitFor({ state: 'visible', timeout: 5000 })
      await target.waitFor({ state: 'visible', timeout: 5000 })

      const targetBox = await target.boundingBox()
      if (!targetBox) throw new Error('Unable to compute target group bounding box')

      const { xRatio, yRatio } = positionToRatios(position)
      const x = Math.max(1, Math.min(targetBox.width - 2, targetBox.width * xRatio))
      const y = Math.max(1, Math.min(targetBox.height - 2, targetBox.height * yRatio))
      await source.dragTo(target, { targetPosition: { x, y } })
    }
  )
}
