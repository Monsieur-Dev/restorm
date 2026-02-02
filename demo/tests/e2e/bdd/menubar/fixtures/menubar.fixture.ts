import type { Page } from '@playwright/test'

export async function openMenuBarE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=menubar-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="menubar-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
