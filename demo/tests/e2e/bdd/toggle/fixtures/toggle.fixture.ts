import type { Page } from '@playwright/test'

export async function openToggleTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Toggle' }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="toggle-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
