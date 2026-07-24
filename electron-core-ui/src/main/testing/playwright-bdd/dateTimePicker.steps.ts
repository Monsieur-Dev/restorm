import {
  dateTimePickerDaySelector,
  dateTimePickerIncludeTimeSelector,
  dateTimePickerHoursSelector,
  dateTimePickerInputSelector,
  dateTimePickerMinutesSelector,
  dateTimePickerNextMonthSelector,
  dateTimePickerOpenSelector,
  dateTimePickerOutputModeSelector,
  dateTimePickerPopoverSelector,
  dateTimePickerPrevMonthSelector,
  dateTimePickerRootSelector
} from '../dateTimePickerSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  selectOption?: (value: string) => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  count: () => Promise<number>
  inputValue: () => Promise<string>
}

interface KeyboardLike {
  press: (key: string) => Promise<void>
  type?: (text: string) => Promise<void>
}

interface MouseLike {
  click: (x: number, y: number) => Promise<void>
}

interface PageLike {
  locator: (selector: string) => LocatorLike
  keyboard: KeyboardLike
  mouse: MouseLike
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

function parseIsoDay(value: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) throw new Error(`Invalid ISO day "${value}". Expected YYYY-MM-DD.`)
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

async function replaceNumericInput(page: PageLike, selector: string, value: number): Promise<void> {
  const s = String(value)
  const input = page.locator(selector)
  await input.click({ force: true })
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  for (const ch of s) {
    if (typeof page.keyboard.type === 'function') {
      await page.keyboard.type(ch)
    } else {
      await page.keyboard.press(ch)
    }
  }
}

export function defineDateTimePickerBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('date time picker {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid date time picker id')
    await asPage(page).locator(dateTimePickerRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('date time picker {string} should be open', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid date time picker id')
    await waitForAttribute(asPage(page).locator(dateTimePickerRootSelector(testId)), 'data-is-open', 'true', 5000)
    await asPage(page).locator(dateTimePickerPopoverSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('date time picker {string} should be closed', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid date time picker id')
    await waitForAttribute(asPage(page).locator(dateTimePickerRootSelector(testId)), 'data-is-open', 'false', 5000)
    const n = await asPage(page).locator(dateTimePickerPopoverSelector(testId)).count()
    if (n !== 0) {
      throw new Error(`Expected date time picker "${testId}" popover to be hidden`)
    }
  })

  When('I open date time picker {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid date time picker id')
    const p = asPage(page)
    await p.locator(dateTimePickerOpenSelector(testId)).click({ force: true })
    await waitForAttribute(p.locator(dateTimePickerRootSelector(testId)), 'data-is-open', 'true', 5000)
  })

  When('I close date time picker {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid date time picker id')
    const p = asPage(page)
    await p.mouse.click(1, 1)
    await waitForAttribute(p.locator(dateTimePickerRootSelector(testId)), 'data-is-open', 'false', 5000)
  })

  When('I go to previous month in date time picker {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid date time picker id')
    await asPage(page).locator(dateTimePickerPrevMonthSelector(testId)).click({ force: true })
  })

  When('I go to next month in date time picker {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid date time picker id')
    await asPage(page).locator(dateTimePickerNextMonthSelector(testId)).click({ force: true })
  })

  When('I select day {string} in date time picker {string}', async ({ page }, isoDay: unknown, testId: unknown) => {
    if (typeof isoDay !== 'string' || typeof testId !== 'string') throw new Error('Invalid date selection parameters')
    parseIsoDay(isoDay)
    const p = asPage(page)
    await p.locator(dateTimePickerDaySelector(testId, isoDay)).click({ force: true })
  })

  Then('date time picker {string} day {string} should be selected', async ({ page }, testId: unknown, isoDay: unknown) => {
    if (typeof testId !== 'string' || typeof isoDay !== 'string') throw new Error('Invalid date selection parameters')
    parseIsoDay(isoDay)
    await waitForAttribute(asPage(page).locator(dateTimePickerDaySelector(testId, isoDay)), 'data-is-selected', 'true', 5000)
  })

  When('I set date time picker {string} include time to {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid date time picker parameters')
    if (expected !== 'true' && expected !== 'false') throw new Error('Expected include time to be \"true\" or \"false\"')
    const p = asPage(page)
    const root = p.locator(dateTimePickerRootSelector(testId))
    await root.waitFor({ state: 'attached', timeout: 5000 })
    const current = await root.getAttribute('data-include-time')
    const normalized = (current ?? '') === 'true' ? 'true' : 'false'
    if (normalized !== expected) {
      await p.locator(dateTimePickerIncludeTimeSelector(testId)).click({ force: true })
    }
    await waitForAttribute(root, 'data-include-time', expected, 5000)
  })

  When('I set date time picker {string} hours to {int}', async ({ page }, testId: unknown, hours: unknown) => {
    if (typeof testId !== 'string' || typeof hours !== 'number') throw new Error('Invalid date time picker parameters')
    const clamped = Math.min(23, Math.max(0, hours))
    const p = asPage(page)
    await replaceNumericInput(p, dateTimePickerHoursSelector(testId), clamped)
  })

  When('I set date time picker {string} minutes to {int}', async ({ page }, testId: unknown, minutes: unknown) => {
    if (typeof testId !== 'string' || typeof minutes !== 'number') throw new Error('Invalid date time picker parameters')
    const clamped = Math.min(59, Math.max(0, minutes))
    const p = asPage(page)
    await replaceNumericInput(p, dateTimePickerMinutesSelector(testId), clamped)
  })

  When('I set date time picker {string} output mode to {string}', async ({ page }, testId: unknown, mode: unknown) => {
    if (typeof testId !== 'string' || typeof mode !== 'string') throw new Error('Invalid date time picker parameters')
    if (mode !== 'pattern' && mode !== 'unix' && mode !== 'epoch' && mode !== 'iso') {
      throw new Error('Invalid output mode')
    }
    const p = asPage(page)
    const select = p.locator(dateTimePickerOutputModeSelector(testId))
    if (typeof select.selectOption === 'function') {
      await select.selectOption(mode)
    } else {
      // Fallback: open select and try to pick by typing + Enter.
      await select.click({ force: true })
      await p.keyboard.press(mode[0]?.toUpperCase() ?? 'P')
      await p.keyboard.press('Enter')
    }
    await waitForAttribute(p.locator(dateTimePickerRootSelector(testId)), 'data-output-mode', mode, 5000)
  })

  Then('date time picker {string} output mode should be {string}', async ({ page }, testId: unknown, mode: unknown) => {
    if (typeof testId !== 'string' || typeof mode !== 'string') throw new Error('Invalid date time picker parameters')
    await waitForAttribute(asPage(page).locator(dateTimePickerRootSelector(testId)), 'data-output-mode', mode, 5000)
  })

  // Asserts the text actually DISPLAYED in the input, not just that a toggle
  // fired mechanically. `pattern` is a regex source, e.g. "^\\d{4}-\\d{2}-\\d{2}$"
  // to lock the shape of a date-only render.
  //
  // `dateTimePickerInputSelector` targets the InputBox's hidden state marker
  // (`data-focused`/`data-has-message`, `display:none`), not the live <input> —
  // the real editable element carries an extra InputBox-internal `-input`
  // suffix. Passing the already-suffixed id back through the same helper reuses
  // its escaping and lands on the actual input.
  Then('date time picker {string} value should match {string}', async ({ page }, testId: unknown, pattern: unknown) => {
    if (typeof testId !== 'string' || typeof pattern !== 'string') throw new Error('Invalid date time picker parameters')
    const inputSelector = dateTimePickerInputSelector(`${testId}-input`)
    const value = await asPage(page).locator(inputSelector).inputValue()
    if (!new RegExp(pattern).test(value)) {
      throw new Error(`Expected date time picker "${testId}" value to match /${pattern}/, got "${value}"`)
    }
  })
}
