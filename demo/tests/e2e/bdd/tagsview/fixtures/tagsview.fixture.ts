import type { Page } from '@playwright/test'

export async function openTagsViewE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=tagsview-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="tagsview-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
