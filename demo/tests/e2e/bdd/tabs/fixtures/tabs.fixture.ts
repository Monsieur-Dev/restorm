import type { Page } from '@playwright/test'

export async function openTabsTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Tabs', exact: true }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="tabs-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
