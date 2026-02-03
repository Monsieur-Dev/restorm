import type { Page } from '@playwright/test'

export async function openListViewE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=listview-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="listview-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
