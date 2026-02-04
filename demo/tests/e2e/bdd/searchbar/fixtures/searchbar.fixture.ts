import type { Page } from '@playwright/test'

export async function openSearchBarE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=searchbar-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="searchbar-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
