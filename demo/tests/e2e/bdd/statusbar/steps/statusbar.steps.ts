import { createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import {
  defineStatusbarBddSteps,
  defineTooltipBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openStatusbarE2ETab } from '../fixtures/statusbar.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineStatusbarBddSteps(bdd)
defineTooltipBddSteps(bdd)

Given('I open the statusbar e2e tab', async ({ page }) => {
  await openStatusbarE2ETab(page)
})

Then('statusbar last action should be {string}', async ({ page }, expected: string) => {
  const start = Date.now()
  const timeoutMs = 5000
  for (;;) {
    const text = await page.getByTestId('statusbar-last-action').innerText()
    if (text.trim() === expected) return
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Expected statusbar last action="${expected}", got "${text}"`)
    }
    await page.waitForTimeout(50)
  }
})

Then('statusbar action count should be {int}', async ({ page }, expected: number) => {
  const start = Date.now()
  const timeoutMs = 5000
  for (;;) {
    const text = await page.getByTestId('statusbar-action-count').innerText()
    const actual = Number(text.trim())
    if (actual === expected) return
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Expected statusbar action count=${expected}, got ${actual}`)
    }
    await page.waitForTimeout(50)
  }
})

let activePage: Page | null = null

Given('I remember the current page as active page', ({ page }) => {
  activePage = page
})

Then('active page should not change', ({ page }) => {
  if (activePage !== page) {
    throw new Error('Expected active page to remain the same')
  }
})

export {}
