import type { Page } from '@playwright/test'

const STORAGE_KEYS = ['demo-e2e-sash-vertical', 'demo-e2e-sash-horizontal']

export async function openSashTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate((keys: string[]) => {
    for (const k of keys) localStorage.removeItem(k)
  }, STORAGE_KEYS)
  await page.getByRole('tab', { name: 'Sash', exact: true }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="sash-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
