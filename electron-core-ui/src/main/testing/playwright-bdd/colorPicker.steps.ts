import {
  colorPickerHexInputSelector,
  colorPickerHueSelector,
  colorPickerSaturationSelector
} from '../colorPickerSelectors'

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
  click: (options?: { position?: { x: number; y: number } }) => Promise<void>
  fill: (value: string) => Promise<void>
  press: (key: string) => Promise<void>
  inputValue: () => Promise<string>
  boundingBox: () => Promise<BoundingBox | null>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  nth: (index: number) => LocatorLike
}

interface MouseLike {
  move: (x: number, y: number) => Promise<void>
  down: () => Promise<void>
  up: () => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  mouse: MouseLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
}

function normalizeHexForCompare(value: string): string {
  return value.trim().replace(/^#/, '').toLowerCase()
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function positionFromPercent(box: BoundingBox, xPercent: number, yPercent: number): { x: number; y: number } {
  const x = clamp((box.width * xPercent) / 100, 1, Math.max(1, box.width - 1))
  const y = clamp((box.height * yPercent) / 100, 1, Math.max(1, box.height - 1))
  return { x, y }
}

async function ensureVisible(locator: LocatorLike): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: 5000 })
}

export function defineColorPickerBddSteps({ When, Then }: BddFnsWithPage): void {
  When('I set color picker {string} hex to {string}', async ({ page }, testId: unknown, value: unknown) => {
    if (typeof testId !== 'string' || typeof value !== 'string') {
      throw new Error('Invalid parameters for setting color picker hex')
    }

    const p = asPage(page)
    const input = p.locator(colorPickerHexInputSelector(testId)).nth(0)
    await ensureVisible(input)
    // The HEX input UI usually displays without '#'.
    await input.click()
    await input.fill(value.replace(/^#/, ''))
    await input.press('Enter')
    // Some implementations only apply the change on blur.
    await input.press('Tab')
  })

  Then('color picker {string} hex input value should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') {
      throw new Error('Invalid parameters for color picker hex value assertion')
    }

    const p = asPage(page)
    const input = p.locator(colorPickerHexInputSelector(testId)).nth(0)
    await ensureVisible(input)
    const current = await input.inputValue()
    if (normalizeHexForCompare(current) !== normalizeHexForCompare(expected)) {
      throw new Error(`Expected color picker "${testId}" hex input value="${expected}", but got "${current}"`)
    }
  })

  Then('color picker {string} hex input value should not be {string}', async ({ page }, testId: unknown, notExpected: unknown) => {
    if (typeof testId !== 'string' || typeof notExpected !== 'string') {
      throw new Error('Invalid parameters for color picker hex negative assertion')
    }

    const p = asPage(page)
    const input = p.locator(colorPickerHexInputSelector(testId)).nth(0)
    await ensureVisible(input)
    const current = await input.inputValue()
    if (normalizeHexForCompare(current) === normalizeHexForCompare(notExpected)) {
      throw new Error(`Expected color picker "${testId}" hex input value to differ from "${notExpected}", but it was the same.`)
    }
  })

  When('I click color picker {string} saturation at {int}% {int}%', async ({ page }, testId: unknown, xPercent: unknown, yPercent: unknown) => {
    if (typeof testId !== 'string' || typeof xPercent !== 'number' || typeof yPercent !== 'number') {
      throw new Error('Invalid parameters for color picker saturation click')
    }

    const p = asPage(page)
    const sat = p.locator(colorPickerSaturationSelector(testId))
    await ensureVisible(sat)
    const box = await sat.boundingBox()
    if (!box) throw new Error(`Unable to get saturation bounding box for color picker "${testId}"`)

    const pos = positionFromPercent(box, xPercent, yPercent)
    await sat.click({ position: pos })
  })

  When('I drag color picker {string} hue to {int}%', async ({ page }, testId: unknown, percent: unknown) => {
    if (typeof testId !== 'string' || typeof percent !== 'number') {
      throw new Error('Invalid parameters for color picker hue drag')
    }

    const p = asPage(page)
    const hue = p.locator(colorPickerHueSelector(testId))
    await ensureVisible(hue)
    const box = await hue.boundingBox()
    if (!box) throw new Error(`Unable to get hue bounding box for color picker "${testId}"`)

    const isHorizontal = box.width >= box.height
    const start = isHorizontal
      ? { x: box.x + (box.width * 0.5), y: box.y + (box.height * 0.5) }
      : { x: box.x + (box.width * 0.5), y: box.y + (box.height * 0.5) }

    const target = isHorizontal
      ? { x: box.x + clamp((box.width * percent) / 100, 1, Math.max(1, box.width - 1)), y: box.y + (box.height * 0.5) }
      : { x: box.x + (box.width * 0.5), y: box.y + clamp((box.height * percent) / 100, 1, Math.max(1, box.height - 1)) }

    await p.mouse.move(start.x, start.y)
    await p.mouse.down()
    await p.mouse.move(target.x, target.y)
    await p.mouse.up()
  })
}
