import {
  scrollableElementContentSelector,
  scrollableElementHorizontalArrowLeftSelector,
  scrollableElementHorizontalArrowRightSelector,
  scrollableElementHorizontalScrollbarSelector,
  scrollableElementHorizontalSliderSelector,
  scrollableElementLeftShadowSelector,
  scrollableElementRootSelector,
  scrollableElementVerticalArrowDownSelector,
  scrollableElementVerticalArrowUpSelector,
  scrollableElementVerticalScrollbarSelector,
  scrollableElementVerticalSliderSelector
} from '../scrollableElementSelectors'

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
  click: (options?: { force?: boolean }) => Promise<void>
  count: () => Promise<number>
  getAttribute: (name: string) => Promise<string | null>
  hover: () => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface MouseLike {
  down: () => Promise<void>
  move: (x: number, y: number) => Promise<void>
  up: () => Promise<void>
  wheel: (deltaX: number, deltaY: number) => Promise<void>
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

async function waitForNumericAttributeAtLeast(locator: LocatorLike, name: string, minValue: number, timeoutMs = 2500): Promise<number> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const n = await waitForNumericAttribute(locator, name, 250)
    if (n >= minValue) return n
    await sleep(50)
  }
  const final = await locator.getAttribute(name)
  throw new Error(`Expected ${name} to be >= ${minValue}, but got "${final ?? ''}"`)
}

async function getBoundingBoxOrThrow(locator: LocatorLike, label: string): Promise<BoundingBox> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`Missing bounding box for "${label}"`)
  return box
}

async function dragSliderBy(page: PageLike, slider: LocatorLike, deltaX: number, deltaY: number): Promise<void> {
  const box = await getBoundingBoxOrThrow(slider, 'slider')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + deltaX, startY + deltaY)
  await page.mouse.up()
}

export function defineScrollableElementBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('scrollable element {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid scrollable element id')
    await asPage(page).locator(scrollableElementRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  When('I wheel scroll scrollable element {string} vertically by {int}', async ({ page }, testId: unknown, deltaY: unknown) => {
    if (typeof testId !== 'string' || typeof deltaY !== 'number') throw new Error('Invalid scrollable element parameters')
    const p = asPage(page)
    await p.locator(scrollableElementContentSelector(testId)).hover()
    await p.mouse.wheel(0, deltaY)
  })

  When('I wheel scroll scrollable element {string} horizontally by {int}', async ({ page }, testId: unknown, deltaX: unknown) => {
    if (typeof testId !== 'string' || typeof deltaX !== 'number') throw new Error('Invalid scrollable element parameters')
    const p = asPage(page)
    await p.locator(scrollableElementContentSelector(testId)).hover()
    await p.mouse.wheel(deltaX, 0)
  })

  When('I click scrollable element {string} vertical arrow up', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid scrollable element id')
    const p = asPage(page)
    await p.locator(scrollableElementRootSelector(testId)).hover()
    await p.locator(scrollableElementVerticalArrowUpSelector(testId)).click({ force: true })
  })

  When('I click scrollable element {string} vertical arrow down', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid scrollable element id')
    const p = asPage(page)
    await p.locator(scrollableElementRootSelector(testId)).hover()
    await p.locator(scrollableElementVerticalArrowDownSelector(testId)).click({ force: true })
  })

  When('I click scrollable element {string} horizontal arrow left', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid scrollable element id')
    const p = asPage(page)
    await p.locator(scrollableElementRootSelector(testId)).hover()
    await p.locator(scrollableElementHorizontalArrowLeftSelector(testId)).click({ force: true })
  })

  When('I click scrollable element {string} horizontal arrow right', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid scrollable element id')
    const p = asPage(page)
    await p.locator(scrollableElementRootSelector(testId)).hover()
    await p.locator(scrollableElementHorizontalArrowRightSelector(testId)).click({ force: true })
  })

  When('I drag scrollable element {string} vertical slider by {int}', async ({ page }, testId: unknown, deltaY: unknown) => {
    if (typeof testId !== 'string' || typeof deltaY !== 'number') throw new Error('Invalid scrollable element parameters')
    const p = asPage(page)
    await p.locator(scrollableElementRootSelector(testId)).hover()
    await dragSliderBy(p, p.locator(scrollableElementVerticalSliderSelector(testId)), 0, deltaY)
  })

  When('I drag scrollable element {string} horizontal slider by {int}', async ({ page }, testId: unknown, deltaX: unknown) => {
    if (typeof testId !== 'string' || typeof deltaX !== 'number') throw new Error('Invalid scrollable element parameters')
    const p = asPage(page)
    await p.locator(scrollableElementRootSelector(testId)).hover()
    await dragSliderBy(p, p.locator(scrollableElementHorizontalSliderSelector(testId)), deltaX, 0)
  })

  Then('scrollable element {string} scroll top should be >= {int}', async ({ page }, testId: unknown, minValue: unknown) => {
    if (typeof testId !== 'string' || typeof minValue !== 'number') throw new Error('Invalid scrollable element parameters')
    const p = asPage(page)
    const content = p.locator(scrollableElementContentSelector(testId))
    await content.waitFor({ state: 'attached', timeout: 5000 })
    await waitForNumericAttributeAtLeast(content, 'data-scroll-top', minValue)
  })

  Then('scrollable element {string} scroll left should be >= {int}', async ({ page }, testId: unknown, minValue: unknown) => {
    if (typeof testId !== 'string' || typeof minValue !== 'number') throw new Error('Invalid scrollable element parameters')
    const p = asPage(page)
    const content = p.locator(scrollableElementContentSelector(testId))
    await content.waitFor({ state: 'attached', timeout: 5000 })
    await waitForNumericAttributeAtLeast(content, 'data-scroll-left', minValue)
  })

  Then('scrollable element {string} vertical scrollbar should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid scrollable element id')
    const p = asPage(page)
    const sb = p.locator(scrollableElementVerticalScrollbarSelector(testId))
    await sb.waitFor({ state: 'attached', timeout: 5000 })
    const visible = await sb.getAttribute('data-is-visible')
    if ((visible ?? '') !== 'true') {
      throw new Error(`Expected scrollable element "${testId}" vertical scrollbar to be visible`)
    }
  })

  Then('scrollable element {string} vertical scrollbar should be hidden', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid scrollable element id')
    const p = asPage(page)
    const sb = p.locator(scrollableElementVerticalScrollbarSelector(testId))
    const count = await sb.count()
    if (count < 1) return
    const visible = await sb.getAttribute('data-is-visible')
    if ((visible ?? '') !== 'false') throw new Error(`Expected scrollable element "${testId}" vertical scrollbar to be hidden`)
  })

  Then('scrollable element {string} horizontal scrollbar should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid scrollable element id')
    const p = asPage(page)
    const sb = p.locator(scrollableElementHorizontalScrollbarSelector(testId))
    await sb.waitFor({ state: 'attached', timeout: 5000 })
    const visible = await sb.getAttribute('data-is-visible')
    if ((visible ?? '') !== 'true') {
      throw new Error(`Expected scrollable element "${testId}" horizontal scrollbar to be visible`)
    }
  })

  Then('scrollable element {string} horizontal scrollbar should be hidden', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid scrollable element id')
    const p = asPage(page)
    const sb = p.locator(scrollableElementHorizontalScrollbarSelector(testId))
    const count = await sb.count()
    if (count < 1) return
    const visible = await sb.getAttribute('data-is-visible')
    if ((visible ?? '') !== 'false') throw new Error(`Expected scrollable element "${testId}" horizontal scrollbar to be hidden`)
  })

  Then('scrollable element {string} left shadow should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid scrollable element id')
    const p = asPage(page)
    const shadow = p.locator(scrollableElementLeftShadowSelector(testId))
    await shadow.waitFor({ state: 'attached', timeout: 2500 })
    const count = await shadow.count()
    if (count < 1) throw new Error(`Expected scrollable element "${testId}" left shadow to be visible`)
  })
}
