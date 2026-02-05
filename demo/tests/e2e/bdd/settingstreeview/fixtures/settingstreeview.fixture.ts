import type { Page } from '@playwright/test'

export async function openSettingsTreeViewE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=settingstreeview-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="settingstreeview-e2e-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
