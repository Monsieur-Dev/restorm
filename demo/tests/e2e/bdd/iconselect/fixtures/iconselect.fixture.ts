import type { Page } from '@playwright/test'

export async function openIconSelectE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=iconselect-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="iconselect-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
