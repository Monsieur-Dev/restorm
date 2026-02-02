import type { Page } from '@playwright/test'

export async function openDateTimePickerE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=datetimepicker-e2e')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="datetimepicker-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
