import type { Page } from '@playwright/test'

export async function openCustomWcoTab(page: Page): Promise<void> {
  await page.goto('/')

  await page.getByRole('tab', { name: 'CustomWCO', exact: true }).click()
  await page.getByTestId('customwco-linux').waitFor({ state: 'visible', timeout: 5000 })
}
