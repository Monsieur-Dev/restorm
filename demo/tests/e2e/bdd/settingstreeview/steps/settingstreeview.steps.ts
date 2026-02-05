import { createBdd } from 'playwright-bdd'
import { defineSettingsTreeViewBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openSettingsTreeViewE2ETab } from '../fixtures/settingstreeview.fixture'

const bdd = createBdd()
const { Given, When, Then } = bdd

defineSettingsTreeViewBddSteps(bdd)

interface KeyboardLike {
  press: (key: string) => Promise<void>
  type?: (text: string) => Promise<void>
}

interface LocatorLike {
  click: (options?: { force?: boolean }) => Promise<void>
  innerText: () => Promise<string>
  waitFor: (options: { state: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>
}

interface PageLike {
  getByTestId: (testId: string) => LocatorLike
  keyboard: KeyboardLike
}

function asPage(value: unknown): PageLike {
  return value as PageLike
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

Given('I open the settings tree view e2e tab', async ({ page }) => {
  await openSettingsTreeViewE2ETab(page)
})

When('I type {string} in settings tree view search', async ({ page }, text: string) => {
  const p = asPage(page)
  const input = p.getByTestId('settingstreeview-e2e-search')
  await input.waitFor({ state: 'attached', timeout: 5000 })
  await input.click({ force: true })
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Backspace')
  await typeTextLetterByLetter(p, text)
})

Then('settings tree view harness selected category should be {string}', async ({ page }, expected: string) => {
  const p = asPage(page)
  const locator = p.getByTestId('settingstreeview-e2e-selected')
  await locator.waitFor({ state: 'attached', timeout: 5000 })
  const actual = await locator.innerText()
  if (actual.trim() !== expected) {
    throw new Error(`Expected selected category "${expected}", got "${actual.trim()}"`)
  }
})

export {}
