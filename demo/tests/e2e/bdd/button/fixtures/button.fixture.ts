import type { Page } from '@playwright/test'

export async function openButtonTab(page: Page): Promise<void> {
  await page.goto('/')

  await page.getByRole('tab', { name: 'Button', exact: true }).click()
  await page.getByTestId('button-basic').waitFor({ state: 'visible', timeout: 5000 })
}
