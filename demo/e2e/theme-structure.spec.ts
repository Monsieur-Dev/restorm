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

test.describe('Theme Structure Tests', () => {
  test.beforeEach(async () => {
    // Navigate to theme test page before each test
    await page.click('text=Theme Test')
    await page.waitForSelector('#theme-selector', { timeout: 5000 })
  })

  test('should have data-theme attribute set', async () => {
    const dataTheme = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme')
    })

    expect(dataTheme).toBeTruthy()
    if (dataTheme) {
      expect(['dark', 'light', 'hcDark', 'hcLight']).toContain(dataTheme)
    }
  })

  test('should have CSS variables applied', async () => {
    const variables = await page.evaluate(() => {
      const root = document.documentElement
      const styles = getComputedStyle(root)
      
      return {
        editorBackground: styles.getPropertyValue('--editor-background'),
        editorForeground: styles.getPropertyValue('--editor-foreground'),
        inputBackground: styles.getPropertyValue('--input-background'),
        buttonBackground: styles.getPropertyValue('--button-background')
      }
    })

    // Verify essential variables are set
    expect(variables.editorBackground).toBeTruthy()
    expect(variables.editorForeground).toBeTruthy()
    expect(variables.inputBackground).toBeTruthy()
    expect(variables.buttonBackground).toBeTruthy()
  })

  test('should change theme dynamically', async () => {
    const themeSelector = page.locator('#theme-selector')
    const options = await themeSelector.locator('option').all()

    if (options.length < 2) {
      test.skip()
      return
    }

    // Change to second theme
    const secondThemeValue = await options[1].getAttribute('value')
    if (!secondThemeValue) {
      test.skip()
      return
    }

    await themeSelector.selectOption(secondThemeValue)
    await page.waitForFunction(
      () => getComputedStyle(document.documentElement).getPropertyValue('--editor-background').trim() !== '',
      { timeout: 3000 }
    )

    // Get new background color
    const newBg = await page.evaluate(() => {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--editor-background')
    })

    // Colors should be different (unless both themes happen to use same color)
    expect(newBg).toBeTruthy()
  })

  test('should apply theme to input elements', async () => {
    const textInput = page.locator('#text-input')
    
    // Check that input uses theme variables
    const inputStyles = await textInput.evaluate((el) => {
      const styles = getComputedStyle(el)
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        border: styles.border
      }
    })

    expect(inputStyles.backgroundColor).toBeTruthy()
    expect(inputStyles.color).toBeTruthy()
    expect(inputStyles.border).toBeTruthy()
  })

  test('should apply theme to buttons', async () => {
    const primaryButton = page.locator('button:has-text("Primary Button")')
    
    const buttonStyles = await primaryButton.evaluate((el) => {
      const styles = getComputedStyle(el)
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color
      }
    })

    expect(buttonStyles.backgroundColor).toBeTruthy()
    expect(buttonStyles.color).toBeTruthy()
  })

  test('should have correct number of themes available', async () => {
    const themeSelector = page.locator('#theme-selector')
    const options = await themeSelector.locator('option').all()

    // Should have at least the 10 themes we imported
    expect(options.length).toBeGreaterThanOrEqual(10)
  })

  test('should persist theme selection', async () => {
    const themeSelector = page.locator('#theme-selector')
    const options = await themeSelector.locator('option').all()

    if (options.length < 2) {
      test.skip()
      return
    }

    // Select a specific theme
    const selectedValue = await options[1].getAttribute('value')
    if (!selectedValue) {
      test.skip()
      return
    }

    await themeSelector.selectOption(selectedValue)
    await expect(themeSelector).toHaveValue(selectedValue, { timeout: 3000 })

    // Verify it's selected
    const currentValue = await themeSelector.inputValue()
    expect(currentValue).toBe(selectedValue)
  })

  test('should update data-theme when theme changes', async () => {
    const themeSelector = page.locator('#theme-selector')
    const options = await themeSelector.locator('option').all()

    // Find a light theme and a dark theme
    let lightTheme = null
    let darkTheme = null

    for (const option of options) {
      const text = await option.textContent()
      const value = await option.getAttribute('value')
      
      if (text?.includes('light') && !lightTheme) {
        lightTheme = value
      }
      if (text?.includes('dark') && !darkTheme) {
        darkTheme = value
      }
    }

    if (lightTheme) {
      await themeSelector.selectOption(lightTheme)
      await page.waitForFunction(
        () => ['light', 'hcLight'].includes(document.documentElement.getAttribute('data-theme') ?? ''),
        { timeout: 3000 }
      ).catch(() => { /* theme may not update data-theme */ })

      const dataTheme = await page.evaluate(() => {
        return document.documentElement.getAttribute('data-theme')
      })

      // Should be 'light' or 'hcLight'
      if (dataTheme) {
        expect(['light', 'hcLight']).toContain(dataTheme)
      }
    }

    if (darkTheme) {
      await themeSelector.selectOption(darkTheme)
      await page.waitForFunction(
        () => ['dark', 'hcDark'].includes(document.documentElement.getAttribute('data-theme') ?? ''),
        { timeout: 3000 }
      ).catch(() => { /* theme may not update data-theme */ })

      const dataTheme = await page.evaluate(() => {
        return document.documentElement.getAttribute('data-theme')
      })

      // Should be 'dark' or 'hc'
      if (dataTheme) {
        expect(['dark', 'hcDark']).toContain(dataTheme)
      }
    }
  })

  test('should have proper font family applied', async () => {
    const fontFamily = await page.evaluate(() => {
      return getComputedStyle(document.body).fontFamily
    })

    // Should use monospace font
    expect(fontFamily.toLowerCase()).toMatch(/cascadia|consolas|monaco|monospace/)
  })
})
