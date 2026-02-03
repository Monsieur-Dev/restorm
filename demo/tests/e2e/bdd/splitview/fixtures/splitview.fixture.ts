import type { Page } from '@playwright/test'

export async function openSplitViewE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=splitview-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="splitview-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
