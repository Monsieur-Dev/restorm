import { createBdd } from 'playwright-bdd'
import { defineInputBoxBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openInputBoxTab } from '../fixtures/inputbox.fixture'
import { setCodeEditorValueInput, setDocumentThemeFromHarness } from '../../codeeditor/steps/codeeditor.steps'

const bdd = createBdd()
const { Given, When, Then } = bdd

defineInputBoxBddSteps(bdd)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

async function waitForContains(getText: () => Promise<string>, expected: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const value = await getText()
    if (value.includes(expected)) return
    await sleep(50)
  }
  const finalValue = await getText()
  throw new Error(`Timed out waiting for text to contain "${expected}". Last value="${finalValue}"`)
}

Given('I open the input box tab', async ({ page }) => {
  await openInputBoxTab(page)
})

// Wrapper: requested reuse of CodeEditor steps/controls.
When('I set input box value input to {string}', async ({ page }, value: string) => {
  await setCodeEditorValueInput(page, value)
})

// Wrapper (optional): reuse same document theme behavior.
When('I set document theme to {string}', async ({ page }, theme: string) => {
  await setDocumentThemeFromHarness(page, theme)
})

When('I apply input box value to {string}', async ({ page }, target: string) => {
  if (target === 'basic') {
    await page.getByTestId('inputbox-apply-value-basic').click()
    return
  }
  if (target === 'disabled') {
    await page.getByTestId('inputbox-apply-value-disabled').click()
    return
  }
  throw new Error(`Invalid input box apply target "${target}"`)
})

Then('input box last change should be {string}', async ({ page }, expected: string) => {
  const value = await page.getByTestId('inputbox-last-change').innerText()
  if (value !== expected) {
    throw new Error(`Expected input box last change="${expected}", but got "${value}"`)
  }
})

Then('input box last change should still be {string} within {int} ms', async ({ page }, expected: string, delayMs: number) => {
  await sleep(delayMs)
  const value = await page.getByTestId('inputbox-last-change').innerText()
  if (value !== expected) {
    throw new Error(`Expected input box last change still="${expected}", but got "${value}"`)
  }
})

Then('input box last change should eventually contain {string}', async ({ page }, expected: string) => {
  await waitForContains(async () => page.getByTestId('inputbox-last-change').innerText(), expected, 2500)
})

export {}
