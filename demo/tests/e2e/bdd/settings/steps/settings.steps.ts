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
const { Given } = bdd

defineButtonBddSteps(bdd)
defineModalBddSteps(bdd)
defineSettingsBddSteps(bdd)
defineSelectBoxBddSteps(bdd)
defineScrollableElementBddSteps(bdd)

Given('I open the settings e2e tab', async ({ page }) => {
  await openSettingsE2ETab(page)
})

export {}
