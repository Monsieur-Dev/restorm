import { createBdd } from 'playwright-bdd'
import {
  defineButtonBddSteps,
  defineModalBddSteps,
  defineScrollableElementBddSteps,
  defineSelectBoxBddSteps,
  defineSettingsBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openSettingsE2ETab } from '../fixtures/settings.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineButtonBddSteps(bdd)
defineModalBddSteps(bdd)
defineSettingsBddSteps(bdd)
defineSelectBoxBddSteps(bdd)
defineScrollableElementBddSteps(bdd)

Given('I open the settings e2e tab', async ({ page }) => {
  await openSettingsE2ETab(page)
})

Given('I am on the theme test page', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
})

Then('element {string} should be visible', async ({ page }, testId: string) => {
  await page
    .locator(`[data-testid="${testId}"]`)
    .waitFor({ state: 'visible', timeout: 5000 })
})

export {}
