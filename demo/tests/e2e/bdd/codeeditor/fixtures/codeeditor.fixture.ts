import type { Page } from '@playwright/test'

export async function openCodeEditorTab(page: Page): Promise<void> {
  await page.goto('/')

  await page.getByRole('tab', { name: 'CodeEditor', exact: true }).click()
  await page.getByTestId('codeeditor-basic').waitFor({ state: 'visible', timeout: 5000 })
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="codeeditor-ready"]')
    const text = el ? el.textContent : null
    return (text ?? '').trim() === 'true'
  }, { timeout: 10000 })
}
export {}
