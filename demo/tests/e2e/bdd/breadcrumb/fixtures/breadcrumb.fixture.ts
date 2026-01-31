import type { Page } from '@playwright/test'

export async function openBreadcrumbTab(page: Page): Promise<void> {
  await page.goto('/')

  // The app renders ThemeTestPage by default. Select the Breadcrumb tab.
  await page.getByRole('tab', { name: 'Breadcrumb' }).click()

  // Ensure the harness is present.
  await page.getByTestId('breadcrumb-main').waitFor({ state: 'visible', timeout: 5000 })
}
