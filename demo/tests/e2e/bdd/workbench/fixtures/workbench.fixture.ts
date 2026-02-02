import type { Page } from '@playwright/test'

const STORAGE_KEY = 'ecui_workbench_state_demo-workbench-e2e'

export async function openWorkbenchE2ETab(page: Page): Promise<void> {
  await page.goto('/?tab=workbench-e2e')
  // Clear persisted workbench state before mounting the harness tab
  await page.evaluate((key) => {
    try { localStorage.removeItem(key) } catch { /* noop */ }
  }, STORAGE_KEY)
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="editorworkbench-ready"]')
    return (el?.textContent ?? '').trim() === 'true'
  })
}
