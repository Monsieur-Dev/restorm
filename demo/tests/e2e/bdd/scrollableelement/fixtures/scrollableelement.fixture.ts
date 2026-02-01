import type { Page } from '@playwright/test'

export async function openScrollableElementTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('tab', { name: 'ScrollableElement' }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="scrollableelement-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
