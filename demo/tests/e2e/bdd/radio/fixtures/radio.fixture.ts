import type { Page } from '@playwright/test'

export async function openRadioTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Radio', exact: true }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="radio-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
