import type { Page } from '@playwright/test'

export async function openSelectBoxE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=selectbox-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="selectbox-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
