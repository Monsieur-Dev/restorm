import type { Page } from '@playwright/test'

export async function openModalE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=modal-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="modal-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
