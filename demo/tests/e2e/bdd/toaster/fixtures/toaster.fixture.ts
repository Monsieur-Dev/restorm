import type { Page } from '@playwright/test'

export async function openToasterTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Toaster', exact: true }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="toaster-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
