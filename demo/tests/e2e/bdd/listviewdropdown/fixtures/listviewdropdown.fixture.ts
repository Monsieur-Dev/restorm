import type { Page } from '@playwright/test'

export async function openListViewDropdownE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=listviewdropdown-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="listviewdropdown-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
