import type { Page } from '@playwright/test'

export async function openTitlebarE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=titlebar-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="titlebar-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
