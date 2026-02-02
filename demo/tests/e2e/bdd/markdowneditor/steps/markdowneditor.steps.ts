import { createBdd } from 'playwright-bdd'
import { defineMarkdownEditorBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openMarkdownEditorTab } from '../fixtures/markdowneditor.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineMarkdownEditorBddSteps(bdd)

Given('I open the markdown editor tab', async ({ page }) => {
  await openMarkdownEditorTab(page)
})

Then('markdown editor last change should contain {string}', async ({ page }, expected: string) => {
  const start = Date.now()
  const timeoutMs = 5000
  for (;;) {
    const text = await page.getByTestId('markdowneditor-last-change').innerText()
    if (text.includes(expected)) return
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Expected last change to contain "${expected}", got "${text}"`)
    }
    await page.waitForTimeout(50)
  }
})

export {}
