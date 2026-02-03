import {
  selectBoxDetailsSelector,
  selectBoxDropdownSelector,
  selectBoxOptionSelector,
  selectBoxOptionLabelSelector,
  selectBoxRootSelector,
  selectBoxTriggerSelector
} from '../selectBoxSelectors'

export interface BddFnsWithPage {
  Given: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  When: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
  Then: (pattern: string, fn: (fixtures: { page: unknown }, ...args: unknown[]) => unknown) => void
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
  getAttribute: (name: string) => Promise<string | null>
  count: () => Promise<number>
  innerText?: () => Promise<string>
}

interface KeyboardLike {
  press: (key: string) => Promise<void>
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

async function readNumericAttribute(locator: LocatorLike, name: string): Promise<number> {
  const raw = await locator.getAttribute(name)
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name} value "${raw ?? ''}"`)
  return n
}

async function findSelectBoxOptionIndexByLabel(p: PageLike, testId: string, label: string): Promise<number> {
  for (let i = 0; i < 200; i += 1) {
    const locator = p.locator(selectBoxOptionLabelSelector(testId, i))
    const n = await locator.count()
    if (n === 0) break
    if (typeof locator.innerText !== 'function') throw new Error('Locator.innerText() is not available')
    const text = (await locator.innerText()).trim()
    if (text === label) return i
  }
  throw new Error(`Option label "${label}" was not found in select box "${testId}"`)
}

export function defineSelectBoxBddSteps({ When, Then }: BddFnsWithPage): void {
  Then('select box {string} should be visible', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid select box id')
    await asPage(page).locator(selectBoxRootSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('select box {string} should be open', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid select box id')
    const p = asPage(page)
    await waitForAttribute(p.locator(selectBoxRootSelector(testId)), 'data-is-open', 'true', 5000)
    await p.locator(selectBoxDropdownSelector(testId)).waitFor({ state: 'attached', timeout: 5000 })
  })

  Then('select box {string} should be closed', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid select box id')
    const p = asPage(page)
    await waitForAttribute(p.locator(selectBoxRootSelector(testId)), 'data-is-open', 'false', 5000)
    const n = await p.locator(selectBoxDropdownSelector(testId)).count()
    if (n !== 0) throw new Error(`Expected select box "${testId}" to be closed`)
  })

  Then('select box {string} selected index should be {int}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid select box parameters')
    const actual = await readNumericAttribute(asPage(page).locator(selectBoxRootSelector(testId)), 'data-selected-index')
    if (actual !== expected) throw new Error(`Expected selected index ${expected}, got ${actual}`)
  })

  Then('select box {string} selected label should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid select box parameters')
    const p = asPage(page)
    const locator = p.locator(selectBoxTriggerSelector(testId))
    if (typeof locator.innerText !== 'function') throw new Error('Locator.innerText() is not available')
    const text = (await locator.innerText()).trim()
    if (text !== expected) throw new Error(`Expected selected label "${expected}", got "${text}"`)
  })

  Then('select box {string} focused index should be {int}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'number') throw new Error('Invalid select box parameters')
    const actual = await readNumericAttribute(asPage(page).locator(selectBoxRootSelector(testId)), 'data-focused-index')
    if (actual !== expected) throw new Error(`Expected focused index ${expected}, got ${actual}`)
  })

  Then('select box {string} focused label should be {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid select box parameters')
    const p = asPage(page)
    const focusedIndex = await readNumericAttribute(p.locator(selectBoxRootSelector(testId)), 'data-focused-index')
    const locator = p.locator(selectBoxOptionLabelSelector(testId, focusedIndex))
    if (typeof locator.innerText !== 'function') throw new Error('Locator.innerText() is not available')
    const text = (await locator.innerText()).trim()
    if (text !== expected) throw new Error(`Expected focused label "${expected}", got "${text}"`)
  })

  Then('select box {string} option {int} should be disabled', async ({ page }, testId: unknown, index: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid select box parameters')
    await waitForAttribute(asPage(page).locator(selectBoxOptionSelector(testId, index)), 'data-is-disabled', 'true', 5000)
  })

  Then('select box {string} option with label {string} should be disabled', async ({ page }, testId: unknown, label: unknown) => {
    if (typeof testId !== 'string' || typeof label !== 'string') throw new Error('Invalid select box parameters')
    const p = asPage(page)
    const index = await findSelectBoxOptionIndexByLabel(p, testId, label)
    await waitForAttribute(p.locator(selectBoxOptionSelector(testId, index)), 'data-is-disabled', 'true', 5000)
  })

  Then('select box {string} details should contain {string}', async ({ page }, testId: unknown, expected: unknown) => {
    if (typeof testId !== 'string' || typeof expected !== 'string') throw new Error('Invalid select box parameters')
    const p = asPage(page)
    const locator = p.locator(selectBoxDetailsSelector(testId))
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    if (typeof locator.innerText !== 'function') throw new Error('Locator.innerText() is not available')
    const text = await locator.innerText()
    if (!text.includes(expected)) throw new Error(`Expected details to contain "${expected}", got "${text}"`)
  })

  When('I open select box {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid select box id')
    const p = asPage(page)
    await p.locator(selectBoxTriggerSelector(testId)).click({ force: true })
    await waitForAttribute(p.locator(selectBoxRootSelector(testId)), 'data-is-open', 'true', 5000)
  })

  When('I close select box {string}', async ({ page }, testId: unknown) => {
    if (typeof testId !== 'string') throw new Error('Invalid select box id')
    const p = asPage(page)
    await p.mouse.click(1, 1)
    await waitForAttribute(p.locator(selectBoxRootSelector(testId)), 'data-is-open', 'false', 5000)
  })

  When('I select option {int} in select box {string}', async ({ page }, index: unknown, testId: unknown) => {
    if (typeof testId !== 'string' || typeof index !== 'number') throw new Error('Invalid select box parameters')
    const p = asPage(page)
    await p.locator(selectBoxOptionSelector(testId, index)).click({ force: true })
  })

  When('I select option with label {string} in select box {string}', async ({ page }, label: unknown, testId: unknown) => {
    if (typeof testId !== 'string' || typeof label !== 'string') throw new Error('Invalid select box parameters')
    const p = asPage(page)
    const index = await findSelectBoxOptionIndexByLabel(p, testId, label)
    await p.locator(selectBoxOptionSelector(testId, index)).click({ force: true })
  })

  When('I press {string} in select box {string}', async ({ page }, key: unknown, testId: unknown) => {
    if (typeof testId !== 'string' || typeof key !== 'string') throw new Error('Invalid select box parameters')
    const p = asPage(page)
    const isOpen = (await p.locator(selectBoxRootSelector(testId)).getAttribute('data-is-open')) === 'true'
    if (isOpen) {
      // Focus the listbox by clicking inside the dropdown.
      await p.locator(selectBoxDropdownSelector(testId)).click({ force: true })
    } else {
      await p.locator(selectBoxTriggerSelector(testId)).click({ force: true })
    }
    await p.keyboard.press(key)
  })
}
