import type { Page } from '@playwright/test'

export async function openStatusbarE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=statusbar-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="statusbar-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
