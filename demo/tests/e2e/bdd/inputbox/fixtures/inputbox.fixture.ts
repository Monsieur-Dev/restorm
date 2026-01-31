import type { Page } from '@playwright/test'

export async function openInputBoxTab(page: Page): Promise<void> {
  await page.goto('/')

  await page.getByRole('tab', { name: 'InputBox', exact: true }).click()
  await page.getByTestId('inputbox-ready').waitFor({ state: 'visible', timeout: 5000 })
}

export {}
