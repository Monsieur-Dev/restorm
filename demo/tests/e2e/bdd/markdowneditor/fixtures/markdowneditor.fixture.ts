import type { Page } from '@playwright/test'

export async function openMarkdownEditorTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('tab', { name: 'MarkdownEditor', exact: true }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="markdowneditor-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
  await page.waitForSelector('[data-testid="markdowneditor-basic-editor"]', { state: 'attached' })
}
