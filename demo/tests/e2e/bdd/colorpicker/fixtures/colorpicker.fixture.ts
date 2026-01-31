import type { Page } from '@playwright/test'

export async function openColorPickerTab(page: Page): Promise<void> {
  await page.goto('/')

  await page.getByRole('tab', { name: 'ColorPicker', exact: true }).click()
  await page.getByTestId('colorpicker-basic').waitFor({ state: 'visible', timeout: 5000 })
}
