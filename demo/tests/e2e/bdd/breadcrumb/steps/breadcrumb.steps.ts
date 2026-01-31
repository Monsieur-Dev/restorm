import { createBdd } from 'playwright-bdd'
import { defineBreadcrumbBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openBreadcrumbTab } from '../fixtures/breadcrumb.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineBreadcrumbBddSteps(bdd)

Given('I open the breadcrumb tab', async ({ page }) => {
  await openBreadcrumbTab(page)
})

Then(
  'breadcrumb {string} should have emitted a click event for index {int} and id {string}',
  async ({ page }, breadcrumbTestId: string, expectedIndex: number, expectedId: string) => {
    const indexText = await page.getByTestId(`${breadcrumbTestId}-last-click-index`).innerText()
    const idText = await page.getByTestId(`${breadcrumbTestId}-last-click-id`).innerText()

    const parsedIndex = Number.parseInt(indexText.trim(), 10)
    if (!Number.isFinite(parsedIndex) || parsedIndex !== expectedIndex) {
      throw new Error(`Expected last click index=${expectedIndex}, but got "${indexText}"`)
    }

    if (idText.trim() !== expectedId) {
      throw new Error(`Expected last click id="${expectedId}", but got "${idText}"`)
    }
  }
)

Then('breadcrumb {string} last change value should be {string}', async ({ page }, breadcrumbTestId: string, expectedValue: string) => {
  const value = await page.getByTestId(`${breadcrumbTestId}-last-change`).innerText()
  if (value.trim() !== expectedValue) {
    throw new Error(`Expected last change value="${expectedValue}", but got "${value}"`)
  }
})
