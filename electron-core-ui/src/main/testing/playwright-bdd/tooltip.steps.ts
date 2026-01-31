import { tooltipRootSelector } from '../tooltipSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  count: () => Promise<number>
  getAttribute: (name: string) => Promise<string | null>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null>
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

async function waitForPositioned(locator: LocatorLike, timeoutMs = 2500): Promise<void> {
  const start = Date.now()
  // Poll because Tooltip positions asynchronously (RAF + timeouts).
  while (Date.now() - start <= timeoutMs) {
    const positioned = await locator.getAttribute('data-is-positioned')
    if (positioned === 'true') return
    await sleep(50)
  }
  const final = await locator.getAttribute('data-is-positioned')
  throw new Error(`Tooltip did not become positioned within ${timeoutMs}ms (data-is-positioned="${final ?? ''}")`)
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

async function getBoundingBoxOrThrow(locator: LocatorLike, label: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`Missing bounding box for "${label}"`)
  return box
}

async function waitForNumericAttribute(locator: LocatorLike, name: string, timeoutMs = 2500): Promise<number> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const positioned = await locator.getAttribute('data-is-positioned')
    const raw = await locator.getAttribute(name)
    const n = Number(raw)
    if (positioned === 'true' && Number.isFinite(n)) return n
    await sleep(50)
  }
  const raw = await locator.getAttribute(name)
  throw new Error(`Timed out waiting for ${name}. Last="${raw ?? ''}"`)
}

export function defineTooltipBddSteps({ Then }: BddFnsWithPage): void {
  Then('tooltip {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid tooltip id')
    const p = asPage(page)
    const locator = p.locator(tooltipRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForPositioned(locator)
  })

  Then('tooltip {string} should be hidden', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid tooltip id')
    const p = asPage(page)
    const locator = p.locator(tooltipRootSelector(testId))
    const n = await locator.count()
    if (n !== 0) {
      throw new Error(`Expected tooltip "${testId}" to be hidden (not rendered), but it is present`)
    }
  })

  Then('tooltip {string} data-placement should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid tooltip parameters')
    const p = asPage(page)
    const locator = p.locator(tooltipRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForPositioned(locator)
    await waitForAttribute(locator, 'data-placement', expected)
  })

  Then('tooltip {string} data-side should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid tooltip parameters')
    const p = asPage(page)
    const locator = p.locator(tooltipRootSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    await waitForPositioned(locator)
    await waitForAttribute(locator, 'data-side', expected)
  })

  Then('tooltip {string} should be right of {string}', async ({ page }, tooltipId: unknown, targetId: unknown) => {
    if (typeof tooltipId !== 'string' || typeof targetId !== 'string') throw new Error('Invalid tooltip parameters')
    const p = asPage(page)
    const tooltip = p.locator(tooltipRootSelector(tooltipId))
    const target = p.locator(tooltipRootSelector(targetId))
    await tooltip.waitFor({ state: 'attached', timeout: 5000 })
    await target.waitFor({ state: 'attached', timeout: 5000 })
    await waitForPositioned(tooltip)
    const tooltipBox = await getBoundingBoxOrThrow(tooltip, tooltipId)
    const targetBox = await getBoundingBoxOrThrow(target, targetId)
    if (tooltipBox.x <= targetBox.x + targetBox.width) {
      throw new Error(`Expected tooltip "${tooltipId}" to be right of "${targetId}"`)
    }
  })

  Then('tooltip {string} should be left of {string}', async ({ page }, tooltipId: unknown, targetId: unknown) => {
    if (typeof tooltipId !== 'string' || typeof targetId !== 'string') throw new Error('Invalid tooltip parameters')
    const p = asPage(page)
    const tooltip = p.locator(tooltipRootSelector(tooltipId))
    const target = p.locator(tooltipRootSelector(targetId))
    await tooltip.waitFor({ state: 'attached', timeout: 5000 })
    await target.waitFor({ state: 'attached', timeout: 5000 })
    await waitForPositioned(tooltip)
    const tooltipBox = await getBoundingBoxOrThrow(tooltip, tooltipId)
    const targetBox = await getBoundingBoxOrThrow(target, targetId)
    if (tooltipBox.x + tooltipBox.width >= targetBox.x) {
      throw new Error(`Expected tooltip "${tooltipId}" to be left of "${targetId}"`)
    }
  })

  Then('tooltip {string} should be above {string}', async ({ page }, tooltipId: unknown, targetId: unknown) => {
    if (typeof tooltipId !== 'string' || typeof targetId !== 'string') throw new Error('Invalid tooltip parameters')
    const p = asPage(page)
    const tooltip = p.locator(tooltipRootSelector(tooltipId))
    const target = p.locator(tooltipRootSelector(targetId))
    await tooltip.waitFor({ state: 'attached', timeout: 5000 })
    await target.waitFor({ state: 'attached', timeout: 5000 })
    await waitForPositioned(tooltip)
    const tooltipBox = await getBoundingBoxOrThrow(tooltip, tooltipId)
    const targetBox = await getBoundingBoxOrThrow(target, targetId)
    if (tooltipBox.y + tooltipBox.height >= targetBox.y - 1) {
      throw new Error(`Expected tooltip "${tooltipId}" to be above "${targetId}"`)
    }
  })

  Then('tooltip {string} should be below {string}', async ({ page }, tooltipId: unknown, targetId: unknown) => {
    if (typeof tooltipId !== 'string' || typeof targetId !== 'string') throw new Error('Invalid tooltip parameters')
    const p = asPage(page)
    const tooltip = p.locator(tooltipRootSelector(tooltipId))
    const target = p.locator(tooltipRootSelector(targetId))
    await tooltip.waitFor({ state: 'attached', timeout: 5000 })
    await target.waitFor({ state: 'attached', timeout: 5000 })
    await waitForPositioned(tooltip)
    const tooltipBox = await getBoundingBoxOrThrow(tooltip, tooltipId)
    const targetBox = await getBoundingBoxOrThrow(target, targetId)
    if (tooltipBox.y <= targetBox.y + targetBox.height + 1) {
      throw new Error(`Expected tooltip "${tooltipId}" to be below "${targetId}"`)
    }
  })

  Then('tooltip {string} beak left percent should be {int}', async ({ page }, tooltipId: unknown, expected: unknown) => {
    if (typeof tooltipId !== 'string' || typeof expected !== 'number') throw new Error('Invalid tooltip parameters')
    const p = asPage(page)
    const tooltip = p.locator(tooltipRootSelector(tooltipId))
    await tooltip.waitFor({ state: 'attached', timeout: 5000 })
    await waitForPositioned(tooltip)
    const actual = await waitForNumericAttribute(tooltip, 'data-beak-left-percent')
    const delta = Math.abs(actual - expected)
    if (delta > 2) {
      throw new Error(`Expected tooltip "${tooltipId}" data-beak-left-percent≈${expected}, got ${actual}`)
    }
  })

  Then('tooltip {string} beak should point to {string} vertically', async ({ page }, tooltipId: unknown, targetId: unknown) => {
    if (typeof tooltipId !== 'string' || typeof targetId !== 'string') throw new Error('Invalid tooltip parameters')
    const p = asPage(page)
    const tooltip = p.locator(tooltipRootSelector(tooltipId))
    const target = p.locator(tooltipRootSelector(targetId))
    await tooltip.waitFor({ state: 'attached', timeout: 5000 })
    await target.waitFor({ state: 'attached', timeout: 5000 })
    await waitForPositioned(tooltip)

    const tooltipBox = await getBoundingBoxOrThrow(tooltip, tooltipId)
    const targetBox = await getBoundingBoxOrThrow(target, targetId)

    const targetCenterY = targetBox.y + targetBox.height / 2
    const expectedPercentRaw = ((targetCenterY - tooltipBox.y) / tooltipBox.height) * 100
    const expectedPercent = clamp(expectedPercentRaw, 10, 90)

    const actual = await waitForNumericAttribute(tooltip, 'data-beak-top-percent')
    const delta = Math.abs(actual - expectedPercent)
    if (delta > 4) {
      throw new Error(`Expected tooltip "${tooltipId}" beak-top-percent≈${Math.round(expectedPercent)}, got ${actual}`)
    }
  })

  Then('tooltip {string} beak should point to {string} horizontally', async ({ page }, tooltipId: unknown, targetId: unknown) => {
    if (typeof tooltipId !== 'string' || typeof targetId !== 'string') throw new Error('Invalid tooltip parameters')
    const p = asPage(page)
    const tooltip = p.locator(tooltipRootSelector(tooltipId))
    const target = p.locator(tooltipRootSelector(targetId))
    await tooltip.waitFor({ state: 'attached', timeout: 5000 })
    await target.waitFor({ state: 'attached', timeout: 5000 })
    await waitForPositioned(tooltip)

    const tooltipBox = await getBoundingBoxOrThrow(tooltip, tooltipId)
    const targetBox = await getBoundingBoxOrThrow(target, targetId)

    const targetCenterX = targetBox.x + targetBox.width / 2
    const expectedPercent = ((targetCenterX - tooltipBox.x) / tooltipBox.width) * 100

    const actual = await waitForNumericAttribute(tooltip, 'data-beak-left-percent')
    const delta = Math.abs(actual - expectedPercent)
    if (delta > 6) {
      throw new Error(`Expected tooltip "${tooltipId}" beak-left-percent≈${Math.round(expectedPercent)}, got ${actual}`)
    }
  })

  Then('tooltip {string} data-top should be {int}', async ({ page }, tooltipId: unknown, expected: unknown) => {
    if (typeof tooltipId !== 'string' || typeof expected !== 'number') throw new Error('Invalid tooltip parameters')
    const p = asPage(page)
    const tooltip = p.locator(tooltipRootSelector(tooltipId))
    await tooltip.waitFor({ state: 'attached', timeout: 5000 })
    await waitForPositioned(tooltip)

    const actual = await waitForNumericAttribute(tooltip, 'data-top')
    if (actual === -9999) throw new Error(`Invalid data-top for tooltip "${tooltipId}"`)

    const delta = Math.abs(actual - expected)
    if (delta > 3) {
      throw new Error(`Expected tooltip "${tooltipId}" data-top≈${expected}, got ${actual}`)
    }
  })
}
