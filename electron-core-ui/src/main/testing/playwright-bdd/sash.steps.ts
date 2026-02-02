import {
  horizontalSashContainerRootSelector,
  horizontalSashContainerSashSelector,
  sashRootSelector,
  verticalSashContainerRootSelector,
  verticalSashContainerSashSelector
} from '../sashSelectors'

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
  boundingBox: () => Promise<BoundingBox | null>
  click: (options?: { force?: boolean; clickCount?: number }) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  scrollIntoViewIfNeeded: () => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface MouseLike {
  down: () => Promise<void>
  move: (x: number, y: number) => Promise<void>
  up: () => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  mouse: MouseLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

async function getBoundingBoxOrThrow(locator: LocatorLike, label: string): Promise<BoundingBox> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`Missing bounding box for "${label}"`)
  return box
}

async function dragLocatorBy(page: PageLike, locator: LocatorLike, deltaX: number, deltaY: number): Promise<void> {
  await locator.scrollIntoViewIfNeeded()
  const box = await getBoundingBoxOrThrow(locator, 'drag target')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + deltaX, startY + deltaY)
  await page.mouse.up()
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

async function waitForNumericAttribute(locator: LocatorLike, name: string, timeoutMs = 2500): Promise<number> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const raw = await locator.getAttribute(name)
    const n = Number(raw)
    if (Number.isFinite(n)) return n
    await sleep(50)
  }
  const final = await locator.getAttribute(name)
  throw new Error(`Timed out waiting for numeric attribute ${name}. Last="${final ?? ''}"`)
}

export function defineSashBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('sash {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid sash id')
    await asPage(page).locator(sashRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('sash {string} data-orientation should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid sash parameters')
    const locator = asPage(page).locator(sashRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-orientation', expected)
  })

  Then('sash {string} data-state should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid sash parameters')
    const locator = asPage(page).locator(sashRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-state', expected)
  })

  When('I drag sash {string} by x {int} y {int}', async ({ page }, testId: unknown, dx: unknown, dy: unknown) => {
    if (typeof testId !== 'string' || typeof dx !== 'number' || typeof dy !== 'number') throw new Error('Invalid drag parameters')
    const p = asPage(page)
    const locator = p.locator(sashRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await dragLocatorBy(p, locator, dx, dy)
  })

  When('I double click sash {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid sash id')
    const locator = asPage(page).locator(sashRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await locator.scrollIntoViewIfNeeded()
    await locator.click({ force: true, clickCount: 2 })
  })

  Then('vertical sash container {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid vertical sash container id')
    await asPage(page).locator(verticalSashContainerRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('vertical sash container {string} left width should be {int}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid vertical sash container parameters')
    const locator = asPage(page).locator(verticalSashContainerRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const actual = await waitForNumericAttribute(locator, 'data-left-width')
    const delta = Math.abs(actual - expected)
    if (delta > 1) throw new Error(`Expected "${testId}" left width≈${expected}, got ${actual}`)
  })

  Then('vertical sash container {string} sash state should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid vertical sash container parameters')
    const locator = asPage(page).locator(verticalSashContainerRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-sash-state', expected)
  })

  When('I drag vertical sash container {string} by {int}', async ({ page }, testId: unknown, delta: unknown) => {
    if (typeof testId !== 'string' || typeof delta !== 'number') throw new Error('Invalid vertical sash container drag parameters')
    const p = asPage(page)
    const locator = p.locator(verticalSashContainerSashSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await dragLocatorBy(p, locator, delta, 0)
  })

  Then('horizontal sash container {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid horizontal sash container id')
    await asPage(page).locator(horizontalSashContainerRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('horizontal sash container {string} top height should be {int}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid horizontal sash container parameters')
    const locator = asPage(page).locator(horizontalSashContainerRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    const actual = await waitForNumericAttribute(locator, 'data-top-height')
    const delta = Math.abs(actual - expected)
    if (delta > 1) throw new Error(`Expected "${testId}" top height≈${expected}, got ${actual}`)
  })

  Then('horizontal sash container {string} sash state should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid horizontal sash container parameters')
    const locator = asPage(page).locator(horizontalSashContainerRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForAttribute(locator, 'data-sash-state', expected)
  })

  When('I drag horizontal sash container {string} by {int}', async ({ page }, testId: unknown, delta: unknown) => {
    if (typeof testId !== 'string' || typeof delta !== 'number') throw new Error('Invalid horizontal sash container drag parameters')
    const p = asPage(page)
    const locator = p.locator(horizontalSashContainerSashSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await dragLocatorBy(p, locator, 0, delta)
  })
}
