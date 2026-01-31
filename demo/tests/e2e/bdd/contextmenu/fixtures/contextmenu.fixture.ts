import type { Page } from '@playwright/test'

export async function openContextMenuTab(page: Page): Promise<void> {
  await page.goto('/')

  await page.getByRole('tab', { name: 'ContextMenu', exact: true }).click()
  await page.getByTestId('contextmenu-target').waitFor({ state: 'visible', timeout: 5000 })
}
