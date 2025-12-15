import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { join } from 'path'

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  // Launch Electron app
  electronApp = await electron.launch({
    args: [join(__dirname, '../dist/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'development'
    }
  })

  // Get the first window
  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await electronApp.close()
})

test.describe('VSCode Themes Visual Tests', () => {
  test('should navigate to theme test page', async () => {
    // Click the Theme Test button
    await page.click('text=Theme Test')
    await page.waitForTimeout(1000)

    // Verify we're on the theme test page
    const title = await page.textContent('h1')
    expect(title).toContain('Theme Test')
  })

  test('should take screenshots of all themes', async () => {
    // Navigate to theme test page
    await page.click('text=Theme Test')
    await page.waitForTimeout(1000)

    // Get all available themes
    const themeSelector = page.locator('#theme-selector')
    const options = await themeSelector.locator('option').all()

    for (const option of options) {
      const themeValue = await option.getAttribute('value')
      const themeName = await option.textContent()

      if (!themeValue || !themeName) continue

      // Select the theme
      await themeSelector.selectOption(themeValue)
      await page.waitForTimeout(1000) // Wait for theme to apply

      // Take screenshot
      const sanitizedName = themeValue.replace(/[^a-zA-Z0-9-]/g, '-')
      await page.screenshot({
        path: `test-results/themes/${sanitizedName}.png`,
        fullPage: true
      })
    }
  })

  test('should verify theme applies correctly', async () => {
    // Navigate to theme test page
    await page.click('text=Theme Test')
    await page.waitForTimeout(1000)

    // Select a specific theme (Monokai)
    const themeSelector = page.locator('#theme-selector')
    const options = await themeSelector.locator('option').all()

    // Find Monokai theme
    let monokaiValue = null
    for (const option of options) {
      const text = await option.textContent()
      if (text?.includes('Monokai')) {
        monokaiValue = await option.getAttribute('value')
        break
      }
    }

    if (monokaiValue) {
      await themeSelector.selectOption(monokaiValue)
      await page.waitForTimeout(1000)

      // Verify theme is applied by checking CSS variables
      const backgroundColor = await page.evaluate(() => {
        return getComputedStyle(document.documentElement)
          .getPropertyValue('--vscode-editor-background')
      })

      expect(backgroundColor).toBeTruthy()
    }
  })

  test('should display all component types', async () => {
    // Navigate to theme test page
    await page.click('text=Theme Test')
    await page.waitForTimeout(1000)

    // Verify all component sections are present
    const sections = [
      'Text Inputs',
      'Checkboxes',
      'Buttons',
      'Select / Dropdown',
      'Text Area',
      'Panels',
      'Lists',
      'Text Variants'
    ]

    for (const section of sections) {
      const element = page.locator(`text=${section}`).first()
      await expect(element).toBeVisible()
    }
  })
})
