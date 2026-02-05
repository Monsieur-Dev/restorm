import type { Page } from '@playwright/test'

export async function openSettingsE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=settings-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="settings-e2e-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
