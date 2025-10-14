/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions, @typescript-eslint/explicit-function-return-type, @typescript-eslint/prefer-for-of */
import { chromium, type Page } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'

interface ThemeConfig {
  name: string
  displayName: string
  outputFileName: string
}

const THEMES: ThemeConfig[] = [
  { name: 'Dark+', displayName: 'Dark+ (default dark)', outputFileName: 'vscode-dark' },
  { name: 'Light+', displayName: 'Light+ (default light)', outputFileName: 'vscode-light' },
  { name: 'Dark High Contrast', displayName: 'Dark High Contrast', outputFileName: 'vscode-hc-dark' },
  { name: 'Light High Contrast', displayName: 'Light High Contrast', outputFileName: 'vscode-hc-light' }
]

const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'renderer', 'src', 'styles')
const THEMES_DIR = path.join(OUTPUT_DIR, 'themes')

// Ensure output directories exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}
if (!fs.existsSync(THEMES_DIR)) {
  fs.mkdirSync(THEMES_DIR, { recursive: true })
}

async function extractClassNames(page: Page): Promise<Record<string, string[]>> {
  console.log('🔍 Extracting class names from Settings page...')

  try {
    const classNames = await page.evaluate(() => {
      const result: Record<string, string[]> = {}

      // Find all elements in the settings editor
      const selectors = [
        { name: 'settings-editor', selector: '.settings-editor' },
        { name: 'settings-header', selector: '.settings-header' },
        { name: 'settings-search-container', selector: '.settings-search-container' },
        { name: 'settings-search-input', selector: 'input.settings-search-input' },
        { name: 'settings-body', selector: '.settings-body' },
        { name: 'settings-toc-container', selector: '.settings-toc-container' },
        { name: 'settings-tree-item', selector: '.settings-tree-item' },
        { name: 'settings-editor-tree', selector: '.settings-editor-tree' },
        { name: 'settings-group-title-label', selector: '.setting-item-category-title' },
        { name: 'setting-item', selector: '.setting-item' },
        { name: 'setting-item-title', selector: '.setting-item-title' },
        { name: 'setting-item-description', selector: '.setting-item-description' },
        { name: 'setting-item-control', selector: '.setting-item-control' }
      ]

      selectors.forEach(({ name, selector }) => {
        const elements = document.querySelectorAll(selector)
        if (elements.length > 0) {
          const element = elements[0]
          result[name] = Array.from(element.classList)
        }
      })

      return result
    })

    return classNames
  } catch (error) {
    console.error('Error extracting class names:', error)
    return {}
  }
}

async function extractCSSVariables(page: Page, themeName: string): Promise<Record<string, string>> {
  console.log(`🎨 Extracting CSS variables for theme: ${themeName}...`)

  try {
    const variables = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      const result: Record<string, string> = {}

      // Get all CSS custom properties (variables starting with --)
      for (let i = 0; i < styles.length; i++) {
        const prop = styles[i]
        if (prop.startsWith('--vscode-')) {
          const value = styles.getPropertyValue(prop).trim()
          if (value) {
            result[prop] = value
          }
        }
      }

      return result
    })

    console.log(`  ✓ Found ${Object.keys(variables).length} CSS variables`)
    return variables
  } catch (error) {
    console.error('Error extracting CSS variables:', error)
    return {}
  }
}

async function extractStructuralStyles(page: Page): Promise<Record<string, any>> {
  console.log('📐 Extracting structural styles (layout, spacing, typography)...')

  try {
    const styles = await page.evaluate(() => {
      const result: Record<string, any> = {}

      const selectors = [
        '.settings-editor',
        '.settings-header',
        '.settings-search-container',
        '.settings-body',
        '.settings-toc-container',
        '.setting-item',
        '.setting-item-title',
        '.setting-item-description'
      ]

      selectors.forEach((selector) => {
        const element = document.querySelector(selector)
        if (element) {
          const computed = getComputedStyle(element)
          result[selector] = {
            display: computed.display,
            flexDirection: computed.flexDirection,
            flexGrow: computed.flexGrow,
            flexShrink: computed.flexShrink,
            padding: computed.padding,
            paddingTop: computed.paddingTop,
            paddingRight: computed.paddingRight,
            paddingBottom: computed.paddingBottom,
            paddingLeft: computed.paddingLeft,
            margin: computed.margin,
            marginTop: computed.marginTop,
            marginBottom: computed.marginBottom,
            fontSize: computed.fontSize,
            fontWeight: computed.fontWeight,
            lineHeight: computed.lineHeight,
            fontFamily: computed.fontFamily,
            gap: computed.gap
          }
        }
      })

      return result
    })

    return styles
  } catch (error) {
    console.error('Error extracting structural styles:', error)
    return {}
  }
}

async function changeTheme(page: Page, themeName: string): Promise<boolean> {
  console.log(`🎨 Changing theme to: ${themeName}...`)

  try {
    // Use mouse to open command palette (more reliable than keyboard shortcut)
    await page.keyboard.press('F1')
    await page.waitForTimeout(1000)

    // Type the theme command
    await page.keyboard.type('Preferences: Color Theme')
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1000)

    // Type part of the theme name
    const searchTerm = themeName.includes('High Contrast') ? 'High Contrast' : themeName
    await page.keyboard.type(searchTerm)
    await page.waitForTimeout(500)

    // Press down arrow and enter to select (more reliable)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2000)

    console.log(`  ✓ Theme ${themeName} applied`)
    return true
  } catch (error) {
    console.error(`Error changing theme to ${themeName}:`, error)
    return false
  }
}

async function navigateToSettings(page: Page): Promise<boolean> {
  console.log('⚙️  Navigating to Settings...')

  try {
    // Wait for the page to load
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    // Close any welcome/getting started dialogs
    try {
      const closeButton = page.locator('button[aria-label="Close"]').first()
      if (await closeButton.isVisible({ timeout: 2000 })) {
        await closeButton.click()
        await page.waitForTimeout(500)
      }
    } catch (e) {
      // No dialog to close
    }

    // Open settings with keyboard shortcut
    await page.keyboard.press('Control+,')
    await page.waitForTimeout(3000)

    // Try to find any settings-related element
    const selectors = [
      '.settings-editor',
      '.settings-body',
      'input[placeholder*="Search"]',
      '.setting-item'
    ]

    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 })
        console.log(`✅ Settings page loaded (found ${selector})`)
        return true
      } catch (e) {
        continue
      }
    }

    console.error('❌ Could not find settings page elements')
    return false
  } catch (error) {
    console.error('Error navigating to settings:', error)
    return false
  }
}

function generateThemeCSS(variables: Record<string, string>, themeName: string): string {
  const lines = [`[data-theme="${themeName}"] {`]

  // Sort variables for consistency
  const sortedKeys = Object.keys(variables).sort()

  sortedKeys.forEach((key) => {
    lines.push(`  ${key}: ${variables[key]};`)
  })

  lines.push('}')
  return lines.join('\n')
}

function generateStructuralCSS(styles: Record<string, any>): string {
  const lines: string[] = []

  Object.entries(styles).forEach(([selector, props]) => {
    lines.push(`${selector} {`)

    Object.entries(props).forEach(([prop, value]) => {
      if (value && value !== 'none' && value !== 'auto' && value !== 'normal' && value !== '0px') {
        // Convert camelCase to kebab-case
        const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase()
        lines.push(`  ${cssProp}: ${value};`)
      }
    })

    lines.push('}')
    lines.push('')
  })

  return lines.join('\n')
}

async function main() {
  console.log('🚀 Starting VSCode theme scraper...\n')

  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 100 
  })
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  })
  
  const page = await context.newPage()

  try {
    // Navigate to vscode.dev
    console.log('🌐 Opening vscode.dev...')
    await page.goto('https://vscode.dev', { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForTimeout(5000)

    // Navigate to settings
    const settingsLoaded = await navigateToSettings(page)
    if (!settingsLoaded) {
      throw new Error('Failed to load settings page')
    }

    // Extract class names (only once, independent of theme)
    const classNames = await extractClassNames(page)
    if (Object.keys(classNames).length > 0) {
      fs.writeFileSync(
        path.join(OUTPUT_DIR, 'vscode-classes.json'),
        JSON.stringify(classNames, null, 2)
      )
      console.log('✅ Class names saved to vscode-classes.json\n')
    }

    // Extract structural styles (only once, independent of theme)
    const structuralStyles = await extractStructuralStyles(page)
    if (Object.keys(structuralStyles).length > 0) {
      const structuralCSS = generateStructuralCSS(structuralStyles)
      fs.writeFileSync(path.join(OUTPUT_DIR, 'vscode-settings.css'), structuralCSS)
      console.log('✅ Structural styles saved to vscode-settings.css\n')
    }

    // Extract variables for each theme
    for (const theme of THEMES) {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`Processing theme: ${theme.displayName}`)
      console.log('='.repeat(60))

      // Change to the theme
      const themeChanged = await changeTheme(page, theme.name)
      if (!themeChanged) {
        console.warn(`⚠️  Skipping theme ${theme.name} due to errors`)
        continue
      }

      // Extract CSS variables
      const variables = await extractCSSVariables(page, theme.displayName)

      if (Object.keys(variables).length === 0) {
        console.warn(`⚠️  No variables found for theme ${theme.name}`)
        continue
      }

      // Save JSON
      const jsonPath = path.join(THEMES_DIR, `${theme.outputFileName}.json`)
      fs.writeFileSync(jsonPath, JSON.stringify(variables, null, 2))
      console.log(`✅ Variables saved to themes/${theme.outputFileName}.json`)

      // Generate and save CSS
      const css = generateThemeCSS(variables, theme.outputFileName)
      const cssPath = path.join(THEMES_DIR, `${theme.outputFileName}.css`)
      fs.writeFileSync(cssPath, css)
      console.log(`✅ CSS saved to themes/${theme.outputFileName}.css`)
    }

    console.log('\n🎉 All themes scraped successfully!')
    console.log(`\nGenerated files in: ${OUTPUT_DIR}`)
  } catch (error) {
    console.error('❌ Error during scraping:', error)
    process.exit(1)
  } finally {
    console.log('\nClosing browser in 3 seconds...')
    await page.waitForTimeout(3000)
    await browser.close()
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
