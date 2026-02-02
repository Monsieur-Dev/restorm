import { createBdd } from 'playwright-bdd'
import { defineSashBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openSashTab } from '../fixtures/sash.fixture'

const bdd = createBdd()
const { Given, When } = bdd

defineSashBddSteps(bdd)

Given('I open the sash tab', async ({ page }) => {
  await openSashTab(page)
})

When('I reload the page', async ({ page }) => {
  await page.reload()
  await page.getByRole('tab', { name: 'Sash', exact: true }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="sash-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
})

export {}
