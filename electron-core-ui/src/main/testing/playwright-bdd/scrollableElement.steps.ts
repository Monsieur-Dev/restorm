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

function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function testIdSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
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

function extractNumberFromStyle(style: string, propName: string): number {
  const re = new RegExp(`${propName}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\s*;?`, 'i')
  const m = style.match(re)
  const raw = m?.[1]
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    throw new Error(`Missing numeric "${propName}: <n>" in style. style="${style}"`)
  }
  return n
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

  Then(
    'scrollable element {string} sticky element {string} should have position sticky',
    async ({ page }, _scrollableTestId: unknown, stickyTestId: unknown) => {
      if (typeof stickyTestId !== 'string') throw new Error('Invalid sticky element id')
      const p = asPage(page)
      const el = p.locator(testIdSelector(stickyTestId))
      await el.waitFor({ state: 'attached', timeout: 5000 })
      await waitForStyleContaining(el, 'position: sticky', 5000)
    }
  )

  Then(
    'scrollable element {string} sticky element {string} top should be >= {int}',
    async ({ page }, _scrollableTestId: unknown, stickyTestId: unknown, minValue: unknown) => {
      if (typeof stickyTestId !== 'string' || typeof minValue !== 'number') throw new Error('Invalid sticky element parameters')
      const p = asPage(page)
      const el = p.locator(testIdSelector(stickyTestId))
      await el.waitFor({ state: 'attached', timeout: 5000 })
      const style = await waitForStyleContaining(el, 'top:', 5000)
      const topPx = extractPxFromStyle(style, 'top')
      if (topPx < minValue) {
        throw new Error(`Expected sticky element "${stickyTestId}" top >= ${minValue}px, but got ${topPx}px`)
      }
    }
  )

  Then(
    'scrollable element {string} sticky element {string} z-index should be >= {int}',
    async ({ page }, _scrollableTestId: unknown, stickyTestId: unknown, minValue: unknown) => {
      if (typeof stickyTestId !== 'string' || typeof minValue !== 'number') throw new Error('Invalid sticky element parameters')
      const p = asPage(page)
      const el = p.locator(testIdSelector(stickyTestId))
      await el.waitFor({ state: 'attached', timeout: 5000 })
      const style = await waitForStyleContaining(el, 'z-index:', 5000)
      const zIndex = extractNumberFromStyle(style, 'z-index')
      if (zIndex < minValue) {
        throw new Error(`Expected sticky element "${stickyTestId}" z-index >= ${minValue}, but got ${zIndex}`)
      }
    }
  )

  Then(
    'scrollable element {string} sticky element {string} top should be > sticky element {string} top',
    async ({ page }, _scrollableTestId: unknown, stickyA: unknown, stickyB: unknown) => {
      if (typeof stickyA !== 'string' || typeof stickyB !== 'string') throw new Error('Invalid sticky element parameters')
      const p = asPage(page)
      const a = p.locator(testIdSelector(stickyA))
      const b = p.locator(testIdSelector(stickyB))
      await a.waitFor({ state: 'attached', timeout: 5000 })
      await b.waitFor({ state: 'attached', timeout: 5000 })
      const styleA = await waitForStyleContaining(a, 'top:', 5000)
      const styleB = await waitForStyleContaining(b, 'top:', 5000)
      const topA = extractPxFromStyle(styleA, 'top')
      const topB = extractPxFromStyle(styleB, 'top')
      if (!(topA > topB)) {
        throw new Error(`Expected sticky "${stickyA}" top (${topA}px) > "${stickyB}" top (${topB}px)`)
      }
    }
  )
}
