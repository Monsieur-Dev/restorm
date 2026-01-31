import type { Page } from '@playwright/test'

export async function openVariableInputBoxTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('tab', { name: 'VariableInputBox' }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="variableinputbox-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })

  // Ensure Monaco editors are mounted and ready to receive keyboard events.
  await page.waitForSelector('[data-testid="variableinputbox-basic-codeeditor-textarea"]', { state: 'attached' })
  await page.waitForSelector('[data-testid="variableinputbox-no-providers-codeeditor-textarea"]', { state: 'attached' })
  await page.waitForSelector('[data-testid="variableinputbox-custom-menu-codeeditor-textarea"]', { state: 'attached' })
}
