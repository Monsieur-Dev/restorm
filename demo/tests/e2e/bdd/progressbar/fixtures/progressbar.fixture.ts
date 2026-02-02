import type { Page } from '@playwright/test'

export async function openProgressBarTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('tab', { name: 'ProgressBar', exact: true }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="progressbar-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
