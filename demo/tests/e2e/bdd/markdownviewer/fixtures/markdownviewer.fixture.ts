import type { Page } from '@playwright/test'

export async function openMarkdownViewerTab(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('tab', { name: 'MarkdownViewer', exact: true }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="markdownviewer-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
