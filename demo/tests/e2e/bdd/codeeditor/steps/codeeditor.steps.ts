import { createBdd } from 'playwright-bdd'
import { defineCodeEditorBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openCodeEditorTab } from '../fixtures/codeeditor.fixture'

export async function setCodeEditorValueInput(page: { getByTestId: (id: string) => { fill: (value: string) => Promise<void> } }, value: string): Promise<void> {
  await page.getByTestId('codeeditor-value-input').fill(value)
}

export async function setDocumentThemeFromHarness(
  page: { getByTestId: (id: string) => { innerText: () => Promise<string>; click: () => Promise<void> } },
  theme: string
): Promise<void> {
  const current = await page.getByTestId('codeeditor-theme-mode').innerText()
  if (current === theme) return
  await page.getByTestId('codeeditor-toggle-theme').click()
}

const bdd = createBdd()
const { Given, When, Then } = bdd

defineCodeEditorBddSteps(bdd)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

async function waitForContains(getText: () => Promise<string>, expected: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  // Basic polling to avoid depending on expect() here.
  while (Date.now() - start <= timeoutMs) {
    const value = await getText()
    if (value.includes(expected)) return
    await sleep(50)
  }
  const finalValue = await getText()
  throw new Error(`Timed out waiting for text to contain "${expected}". Last value="${finalValue}"`)
}

Given('I open the code editor tab', async ({ page }) => {
  await openCodeEditorTab(page)
})

Then('code editor last change should be {string}', async ({ page }, expected: string) => {
  const value = await page.getByTestId('codeeditor-last-change').innerText()
  if (value !== expected) {
    throw new Error(`Expected code editor last change="${expected}", but got "${value}"`)
  }
})

Then('code editor last change should still be {string} within {int} ms', async ({ page }, expected: string, delayMs: number) => {
  await sleep(delayMs)
  const value = await page.getByTestId('codeeditor-last-change').innerText()
  if (value !== expected) {
    throw new Error(`Expected code editor last change still="${expected}", but got "${value}"`)
  }
})

Then('code editor last change should eventually contain {string}', async ({ page }, expected: string) => {
  await waitForContains(async () => page.getByTestId('codeeditor-last-change').innerText(), expected, 2500)
})

When('I place the cursor on the handlebars variable', async ({ page }) => {
  await page.getByTestId('codeeditor-place-cursor-var').click()
})

When('I run go to definition in the demo code editor', async ({ page }) => {
  await page.getByTestId('codeeditor-run-go-to-definition').click()
})

When('I set code editor value input to {string}', async ({ page }, value: string) => {
  await setCodeEditorValueInput(page, value)
})

When('I apply code editor value to {string}', async ({ page }, target: string) => {
  if (target === 'basic') {
    await page.getByTestId('codeeditor-apply-value-basic').click()
    return
  }
  if (target === 'no-debounce') {
    await page.getByTestId('codeeditor-apply-value-no-debounce').click()
    return
  }
  throw new Error(`Invalid code editor target "${target}"`)
})

Then('code editor go to definition should be {string}', async ({ page }, expected: string) => {
  await waitForContains(async () => page.getByTestId('codeeditor-go-to-definition').innerText(), expected, 2500)
})

When('I set document theme to {string}', async ({ page }, theme: string) => {
  await setDocumentThemeFromHarness(page, theme)
})
export {}
