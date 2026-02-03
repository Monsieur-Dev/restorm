import {
  listViewRenameInputSelector,
  listViewRowExpanderSelectorByItemId,
  listViewRowSelectorByItemId,
  listViewRootSelector,
  listViewScrollableContentSelector
} from '../listViewSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

interface LocatorLike {
  click: (options?: { force?: boolean; noWaitAfter?: boolean; button?: 'left' | 'right' }) => Promise<void>
  press?: (key: string) => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  count: () => Promise<number>
  boundingBox?: () => Promise<BoundingBox | null>
}

interface KeyboardLike {
  press: (key: string) => Promise<void>
  type?: (text: string) => Promise<void>
}

interface MouseLike {
  down: () => Promise<void>
  move: (x: number, y: number) => Promise<void>
  up: () => Promise<void>
  click: (x: number, y: number, options?: { button?: 'left' | 'right' }) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  keyboard: KeyboardLike
  mouse: MouseLike
  dragAndDrop?: (
    source: string,
    target: string,
    options?: { targetPosition?: { x: number; y: number } }
  ) => Promise<void>
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

async function waitForStyleContaining(locator: LocatorLike, fragment: string, timeoutMs = 2500): Promise<string> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const style = await locator.getAttribute('style')
    if ((style ?? '').includes(fragment)) return style ?? ''
    await sleep(50)
  }
  const final = await locator.getAttribute('style')
  throw new Error(`Expected style to contain "${fragment}", but got "${final ?? ''}"`)
}

function extractPxFromStyle(style: string, propName: string): number {
  const re = new RegExp(`${propName}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`, 'i')
  const m = style.match(re)
  const raw = m?.[1]
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    throw new Error(`Missing numeric "${propName}: <n>px" in style. style="${style}"`)
  }
  return n
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

async function typeTextLetterByLetter(page: PageLike, text: string): Promise<void> {
  for (const ch of text) {
    if (typeof page.keyboard.type === 'function') {
      await page.keyboard.type(ch)
    } else {
      await page.keyboard.press(ch)
    }
  }
}

async function getBoundingBoxOrThrow(locator: LocatorLike, label: string): Promise<BoundingBox> {
  if (typeof locator.boundingBox !== 'function') {
    throw new Error(`Locator.boundingBox() is not available for "${label}"`)
  }
  const box = await locator.boundingBox()
  if (!box) throw new Error(`Missing bounding box for "${label}"`)
  return box
}

async function dragItemToTarget(
  page: PageLike,
  sourceSelector: string,
  targetSelector: string,
  targetYRatio: number
): Promise<void> {
  const source = page.locator(sourceSelector)
  const target = page.locator(targetSelector)
  const sourceBox = await getBoundingBoxOrThrow(source, 'source')
  const targetBox = await getBoundingBoxOrThrow(target, 'target')

  const startX = sourceBox.x + sourceBox.width / 2
  const startY = sourceBox.y + sourceBox.height / 2
  const endX = targetBox.x + targetBox.width / 2
  const endY = targetBox.y + targetBox.height * targetYRatio

  // Prefer Playwright's dragAndDrop when available (reliable HTML5 DnD).
  if (typeof page.dragAndDrop === 'function') {
    const targetPosition = {
      x: Math.max(1, Math.round(endX - targetBox.x)),
      y: Math.max(1, Math.round(endY - targetBox.y))
    }
    await page.dragAndDrop(sourceSelector, targetSelector, { targetPosition })
    return
  }

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(endX, endY)
  await page.mouse.up()
}

export function defineListViewBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('list view {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view id')
    await asPage(page).locator(listViewRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When('I focus list view {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view id')
    await asPage(page).locator(listViewScrollableContentSelector(testId)).click({ force: true })
  })

  When('I press {string} in list view {string}', async ({ page }, key: unknown, testId: unknown) => {
    if (typeof key !== 'string' || typeof testId !== 'string') throw new Error('Invalid list view key parameters')
    const p = asPage(page)
    const content = p.locator(listViewScrollableContentSelector(testId))
    await content.waitFor({ state: 'attached', timeout: 5000 })
    if (typeof content.press === 'function') {
      await content.press(key)
      return
    }
    // Fallback: ensure focus (may affect selection depending on click position).
    await content.click({ force: true })
    await p.keyboard.press(key)
  })

  When('I click list view {string} item {string}', async ({ page }, testId: unknown, itemId: unknown) => {
    if (typeof testId !== 'string' || typeof itemId !== 'string') throw new Error('Invalid list view item parameters')
    await asPage(page).locator(listViewRowSelectorByItemId(testId, itemId)).click({ force: true })
  })

  When('I double click list view {string} item {string}', async ({ page }, testId: unknown, itemId: unknown) => {
    if (typeof testId !== 'string' || typeof itemId !== 'string') throw new Error('Invalid list view item parameters')
    const row = asPage(page).locator(listViewRowSelectorByItemId(testId, itemId))
    await row.click({ force: true })
    await row.click({ force: true })
  })

  Then('list view {string} item {string} should be selected', async ({ page }, testId: unknown, itemId: unknown) => {
    if (typeof testId !== 'string' || typeof itemId !== 'string') throw new Error('Invalid list view item parameters')
    await waitForAttribute(asPage(page).locator(listViewRowSelectorByItemId(testId, itemId)), 'aria-selected', 'true', 5000)
  })

  Then('list view {string} item {string} should not be selected', async ({ page }, testId: unknown, itemId: unknown) => {
    if (typeof testId !== 'string' || typeof itemId !== 'string') throw new Error('Invalid list view item parameters')
    const value = await asPage(page).locator(listViewRowSelectorByItemId(testId, itemId)).getAttribute('aria-selected')
    if ((value ?? '') === 'true') {
      throw new Error(`Expected list view "${testId}" item "${itemId}" to not be selected`)
    }
  })

  Then('list view {string} item {string} aria-expanded should be {string}', async ({ page }, testId: unknown, itemId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof itemId !== 'string' || typeof expected !== 'string') {
      throw new Error('Invalid list view aria-expanded parameters')
    }
    const value = await asPage(page).locator(listViewRowSelectorByItemId(testId, itemId)).getAttribute('aria-expanded')
    if ((value ?? '') !== expected) {
      throw new Error(`Expected list view "${testId}" item "${itemId}" aria-expanded="${expected}", but got "${value ?? ''}"`)
    }
  })

  Then('list view {string} item {string} should have position sticky', async ({ page }, testId: unknown, itemId: unknown) => {
    if (typeof testId !== 'string' || typeof itemId !== 'string') throw new Error('Invalid list view sticky parameters')
    const row = asPage(page).locator(listViewRowSelectorByItemId(testId, itemId))
    await row.waitFor({ state: 'attached', timeout: 5000 })
    await waitForStyleContaining(row, 'position: sticky', 5000)
  })

  Then('list view {string} item {string} top should be >= {int}', async ({ page }, testId: unknown, itemId: unknown, minValue: unknown) => {
    if (typeof testId !== 'string' || typeof itemId !== 'string' || typeof minValue !== 'number') throw new Error('Invalid list view sticky parameters')
    const row = asPage(page).locator(listViewRowSelectorByItemId(testId, itemId))
    await row.waitFor({ state: 'attached', timeout: 5000 })
    const style = await waitForStyleContaining(row, 'top:', 5000)
    const topPx = extractPxFromStyle(style, 'top')
    if (topPx < minValue) {
      throw new Error(`Expected list view "${testId}" item "${itemId}" top >= ${minValue}px, but got ${topPx}px`)
    }
  })

  Then('list view {string} item {string} top should be > item {string} top', async ({ page }, testId: unknown, itemA: unknown, itemB: unknown) => {
    if (typeof testId !== 'string' || typeof itemA !== 'string' || typeof itemB !== 'string') throw new Error('Invalid list view sticky parameters')
    const p = asPage(page)
    const a = p.locator(listViewRowSelectorByItemId(testId, itemA))
    const b = p.locator(listViewRowSelectorByItemId(testId, itemB))
    await a.waitFor({ state: 'attached', timeout: 5000 })
    await b.waitFor({ state: 'attached', timeout: 5000 })
    const styleA = await waitForStyleContaining(a, 'top:', 5000)
    const styleB = await waitForStyleContaining(b, 'top:', 5000)
    const topA = extractPxFromStyle(styleA, 'top')
    const topB = extractPxFromStyle(styleB, 'top')
    if (!(topA > topB)) {
      throw new Error(`Expected item "${itemA}" top (${topA}px) > "${itemB}" top (${topB}px)`)
    }
  })

  When('I click list view {string} item {string} expander', async ({ page }, testId: unknown, itemId: unknown) => {
    if (typeof testId !== 'string' || typeof itemId !== 'string') throw new Error('Invalid list view expander parameters')
    await asPage(page).locator(listViewRowExpanderSelectorByItemId(testId, itemId)).click({ force: true })
  })

  When('I start renaming list view {string} item {string}', async ({ page }, testId: unknown, itemId: unknown) => {
    if (typeof testId !== 'string' || typeof itemId !== 'string') throw new Error('Invalid list view rename parameters')
    const p = asPage(page)
    await p.locator(listViewRowSelectorByItemId(testId, itemId)).click({ force: true })
    await p.locator(listViewScrollableContentSelector(testId)).click({ force: true })
    await p.keyboard.press('F2')
    await p.locator(listViewRenameInputSelector(testId, itemId)).waitFor({ state: 'visible', timeout: 5000 })
  })

  When('I type {string} in list view {string} rename input letter by letter', async ({ page }, text: unknown, testId: unknown) => {
    if (typeof testId !== 'string' || typeof text !== 'string') throw new Error('Invalid list view rename typing parameters')
    const p = asPage(page)
    const input = p.locator(listViewRenameInputSelector(testId))
    await input.waitFor({ state: 'visible', timeout: 5000 })
    await input.click({ force: true })
    await p.keyboard.press('Control+A')
    await p.keyboard.press('Backspace')
    await typeTextLetterByLetter(p, text)
  })

  When('I submit list view {string} rename with Enter', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view id')
    const p = asPage(page)
    const input = p.locator(listViewRenameInputSelector(testId))
    await input.waitFor({ state: 'visible', timeout: 5000 })
    await p.keyboard.press('Enter')
    const count = await input.count()
    if (count !== 0) {
      throw new Error(`Expected list view "${testId}" rename input to be gone after Enter`)
    }
  })

  When('I cancel list view {string} rename with Escape', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view id')
    const p = asPage(page)
    const input = p.locator(listViewRenameInputSelector(testId))
    await input.waitFor({ state: 'visible', timeout: 5000 })
    await p.keyboard.press('Escape')
    const count = await input.count()
    if (count !== 0) {
      throw new Error(`Expected list view "${testId}" rename input to be gone after Escape`)
    }
  })

  When('I request delete in list view {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid list view id')
    const p = asPage(page)
    const content = p.locator(listViewScrollableContentSelector(testId))
    await content.waitFor({ state: 'attached', timeout: 5000 })
    if (typeof content.press === 'function') {
      await content.press('Delete')
      return
    }
    await content.click({ force: true })
    await p.keyboard.press('Delete')
  })

  When('I open list view {string} context menu on item {string}', async ({ page }, testId: unknown, itemId: unknown) => {
    if (typeof testId !== 'string' || typeof itemId !== 'string') throw new Error('Invalid list view context menu parameters')
    const p = asPage(page)
    const row = p.locator(listViewRowSelectorByItemId(testId, itemId))
    await row.click({ force: true, button: 'right', noWaitAfter: true })
  })

  When('I drag list view {string} item {string} before item {string}', async ({ page }, testId: unknown, sourceId: unknown, targetId: unknown) => {
    if (typeof testId !== 'string' || typeof sourceId !== 'string' || typeof targetId !== 'string') throw new Error('Invalid list view drag parameters')
    const p = asPage(page)
    await dragItemToTarget(p, listViewRowSelectorByItemId(testId, sourceId), listViewRowSelectorByItemId(testId, targetId), 0.1)
  })

  When('I drag list view {string} item {string} into item {string}', async ({ page }, testId: unknown, sourceId: unknown, targetId: unknown) => {
    if (typeof testId !== 'string' || typeof sourceId !== 'string' || typeof targetId !== 'string') throw new Error('Invalid list view drag parameters')
    const p = asPage(page)
    await dragItemToTarget(p, listViewRowSelectorByItemId(testId, sourceId), listViewRowSelectorByItemId(testId, targetId), 0.5)
  })

  When('I drag list view {string} item {string} after item {string}', async ({ page }, testId: unknown, sourceId: unknown, targetId: unknown) => {
    if (typeof testId !== 'string' || typeof sourceId !== 'string' || typeof targetId !== 'string') throw new Error('Invalid list view drag parameters')
    const p = asPage(page)
    await dragItemToTarget(p, listViewRowSelectorByItemId(testId, sourceId), listViewRowSelectorByItemId(testId, targetId), 0.9)
  })
}
