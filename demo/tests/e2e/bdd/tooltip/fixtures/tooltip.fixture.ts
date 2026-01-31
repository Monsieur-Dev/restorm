import type { Page } from '@playwright/test'

export async function openTooltipTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Tooltip' }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="tooltip-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
