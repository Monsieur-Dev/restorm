import { createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import {
  defineDateTimePickerBddSteps,
  defineTooltipBddSteps,
  defineVariableInputBoxBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openDateTimePickerE2ETab } from '../fixtures/datetimepicker.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineDateTimePickerBddSteps(bdd)
defineTooltipBddSteps(bdd)
defineVariableInputBoxBddSteps(bdd)

Given('I open the datetime picker e2e tab', async ({ page }) => {
  await openDateTimePickerE2ETab(page)
})

Then('datetime picker value utc iso should contain {string}', async ({ page }, expected: string) => {
  const text = await page.getByTestId('datetimepicker-value-utc-iso').innerText()
  if (!text.includes(expected)) {
    throw new Error(`Expected datetimepicker value iso to contain "${expected}", got "${text}"`)
  }
})

Then('datetime picker preview value should not be empty', async ({ page }) => {
  const text = await page.locator('[data-testid="datetimepicker-basic-preview-value"]').innerText()
  if (text.trim().length === 0) {
    throw new Error('Expected preview value to be non-empty')
  }
})

let rememberedPreview = ''

Then('I remember datetime picker preview value', async ({ page }) => {
  rememberedPreview = await page.locator('[data-testid="datetimepicker-basic-preview-value"]').innerText()
})

Then('datetime picker preview value should be different from remembered', async ({ page }) => {
  const start = Date.now()
  while (Date.now() - start <= 2500) {
    const next = await page.locator('[data-testid="datetimepicker-basic-preview-value"]').innerText()
    if (next !== rememberedPreview) return
    await page.waitForTimeout(50)
  }
  const next = await page.locator('[data-testid="datetimepicker-basic-preview-value"]').innerText()
  throw new Error(`Expected preview value to change, but it did not. current="${next}"`)
})

let rememberedPage: Page | null = null

Given('I remember the current page as datetime picker page', ({ page }) => {
  rememberedPage = page
})

Then('datetime picker page should not change', ({ page }) => {
  if (rememberedPage !== page) throw new Error('Expected page to remain the same')
})

export {}
