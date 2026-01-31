import { createBdd } from 'playwright-bdd'
import { defineKeyValueTableBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openKeyValueTableTab } from '../fixtures/keyvaluetable.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineKeyValueTableBddSteps(bdd)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

async function waitForContains(getText: () => Promise<string>, expected: string, timeoutMs = 2500): Promise<void> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const value = await getText()
    if (value.includes(expected)) return
    await sleep(50)
  }
  const finalValue = await getText()
  throw new Error(`Timed out waiting for text to contain "${expected}". Last value="${finalValue}"`)
}

async function waitForNotContains(getText: () => Promise<string>, expected: string, timeoutMs = 2500): Promise<void> {
  const start = Date.now()
  while (Date.now() - start <= timeoutMs) {
    const value = await getText()
    if (!value.includes(expected)) return
    await sleep(50)
  }
  const finalValue = await getText()
  throw new Error(`Timed out waiting for text to not contain "${expected}". Last value="${finalValue}"`)
}

Given('I open the key value table tab', async ({ page }) => {
  await openKeyValueTableTab(page)
})

Then('key value table last rows should contain {string}', async ({ page }, expected: string) => {
  await waitForContains(async () => page.getByTestId('keyvaluetable-last-rows').innerText(), expected)
})

Then('key value table last rows should not contain {string}', async ({ page }, expected: string) => {
  await waitForNotContains(async () => page.getByTestId('keyvaluetable-last-rows').innerText(), expected)
})

export {}
