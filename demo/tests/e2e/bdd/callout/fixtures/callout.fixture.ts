import type { Page } from '@playwright/test'

export async function openCalloutTab(page: Page): Promise<void> {
  await page.goto('/')

  await page.getByRole('tab', { name: 'Callout', exact: true }).click()
  await page.getByTestId('callout-info').waitFor({ state: 'visible', timeout: 5000 })
}
