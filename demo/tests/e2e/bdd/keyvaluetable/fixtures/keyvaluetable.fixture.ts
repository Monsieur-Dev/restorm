import type { Page } from '@playwright/test'

export async function openKeyValueTableTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('tab', { name: 'KeyValueTable' }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="keyvaluetable-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
