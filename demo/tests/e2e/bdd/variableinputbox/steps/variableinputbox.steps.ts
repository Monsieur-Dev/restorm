import { createBdd } from 'playwright-bdd'
import { defineVariableInputBoxBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openVariableInputBoxTab } from '../fixtures/variableinputbox.fixture'

const bdd = createBdd()

defineVariableInputBoxBddSteps(bdd)

async function waitForContains(
  getText: () => Promise<string>,
  expected: string,
  timeoutMs = 5000
): Promise<void> {
  const start = Date.now()
  for (;;) {
    const current = await getText()
    if (current.includes(expected)) return
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Expected text to contain "${expected}", got "${current}"`)
    }
    await new Promise((r) => { setTimeout(r, 50) })
  }
}

bdd.Given('I open the variable input box tab', async ({ page }) => {
  await openVariableInputBoxTab(page)
})

bdd.Then('variable input box last change should contain {string}', async ({ page }, expected: string) => {
  const locator = page.getByTestId('variableinputbox-last-change')
  await waitForContains(async () => (await locator.textContent()) ?? '', expected)
})

bdd.Then('variable input box last context action should contain {string}', async ({ page }, expected: string) => {
  const locator = page.getByTestId('variableinputbox-last-context-action')
  await waitForContains(async () => (await locator.textContent()) ?? '', expected)
})

bdd.When('I click variable input box context menu item {string}', async ({ page }, label: string) => {
  // ContextMenu is rendered in a portal; selecting by role is the most stable here.
  await page.getByRole('menuitem', { name: label }).click()
})
