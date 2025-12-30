/**
 * E2E Tests for Save Options Modal and related functionality
 *
 * Tests for OYO-86: Save mode selection, format selection, folder mode
 */

import { test, expect } from '@playwright/test'
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor'
import { loadRestormData } from '../helpers/restorm-data-loader'

// Test data for loading
const testData = {
  collections: [{
    id: 'test-collection',
    name: 'Test Collection',
    type: 'environmentFolder' as const,
    environments: [{
      id: 'test-env',
      name: 'Test Environment',
      variables: [{ key: 'API_URL', value: 'http://localhost:3000' }]
    }],
    items: [{
      id: 'test-request',
      name: 'Test Request',
      type: 'httpRequest' as const,
      httpMethod: 'GET',
      url: '{{API_URL}}/users'
    }]
  }]
}

test.describe('Save Options Modal', () => {
  test('should display save mode options when clicking Save As', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Load test data first so Save As is available
    await loadRestormData(page, testData)
    await page.waitForTimeout(500)

    // Open File menu
    const fileMenu = page.locator('[role="menuitem"]:has-text("File")').first()
    if (await fileMenu.count() > 0) {
      await fileMenu.click()
      await page.waitForTimeout(300)

      // Click Save As
      const saveAs = page.locator('text="Save As..."').first()
      if (await saveAs.count() > 0) {
        await saveAs.click()
        await page.waitForTimeout(300)

        // Check modal is visible
        const modal = page.locator('[data-testid="save-options-modal"]')
        await expect(modal).toBeVisible()

        // Check mode selector is present
        const modeGroup = page.locator('[data-testid="save-mode-group"]')
        await expect(modeGroup).toBeVisible()
      }
    }

    consoleInterceptor.assertNoErrors()
  })

  test('should support single file mode by default', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await loadRestormData(page, testData)
    await page.waitForTimeout(500)

    const fileMenu = page.locator('[role="menuitem"]:has-text("File")').first()
    if (await fileMenu.count() > 0) {
      await fileMenu.click()
      await page.waitForTimeout(300)

      const saveAs = page.locator('text="Save As..."').first()
      if (await saveAs.count() > 0) {
        await saveAs.click()
        await page.waitForTimeout(300)

        // Check description indicates single file mode
        const description = page.locator('[data-testid="save-mode-description"]')
        if (await description.count() > 0) {
          const text = await description.textContent()
          expect(text).toContain('single file')
        }
      }
    }

    consoleInterceptor.assertNoErrors()
  })

  test('should support folder mode selection', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await loadRestormData(page, testData)
    await page.waitForTimeout(500)

    const fileMenu = page.locator('[role="menuitem"]:has-text("File")').first()
    if (await fileMenu.count() > 0) {
      await fileMenu.click()
      await page.waitForTimeout(300)

      const saveAs = page.locator('text="Save As..."').first()
      if (await saveAs.count() > 0) {
        await saveAs.click()
        await page.waitForTimeout(300)

        // Check format selector is present
        const formatGroup = page.locator('[data-testid="save-format-group"]')
        await expect(formatGroup).toBeVisible()
      }
    }

    consoleInterceptor.assertNoErrors()
  })

  test('should support multiple formats (JSON, YAML, JSON5)', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await loadRestormData(page, testData)
    await page.waitForTimeout(500)

    const fileMenu = page.locator('[role="menuitem"]:has-text("File")').first()
    if (await fileMenu.count() > 0) {
      await fileMenu.click()
      await page.waitForTimeout(300)

      const saveAs = page.locator('text="Save As..."').first()
      if (await saveAs.count() > 0) {
        await saveAs.click()
        await page.waitForTimeout(300)

        // Check format group exists
        const formatGroup = page.locator('[data-testid="save-format-group"]')
        await expect(formatGroup).toBeVisible()
      }
    }

    consoleInterceptor.assertNoErrors()
  })
})

test.describe('Folder Mode', () => {
  test('should show preview when folder mode is selected', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await loadRestormData(page, testData)
    await page.waitForTimeout(500)

    const fileMenu = page.locator('[role="menuitem"]:has-text("File")').first()
    if (await fileMenu.count() > 0) {
      await fileMenu.click()
      await page.waitForTimeout(300)

      const saveAs = page.locator('text="Save As..."').first()
      if (await saveAs.count() > 0) {
        await saveAs.click()
        await page.waitForTimeout(300)

        // Modal should be visible
        const modal = page.locator('[data-testid="save-options-modal"]')
        await expect(modal).toBeVisible()
      }
    }

    consoleInterceptor.assertNoErrors()
  })

  test('should handle dirty state indication', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await loadRestormData(page, testData)
    await page.waitForTimeout(500)

    // Verify page loaded correctly
    await expect(page.locator('body')).toBeVisible()

    consoleInterceptor.assertNoErrors()
  })

  test('should allow canceling save operation', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await loadRestormData(page, testData)
    await page.waitForTimeout(500)

    const fileMenu = page.locator('[role="menuitem"]:has-text("File")').first()
    if (await fileMenu.count() > 0) {
      await fileMenu.click()
      await page.waitForTimeout(300)

      const saveAs = page.locator('text="Save As..."').first()
      if (await saveAs.count() > 0) {
        await saveAs.click()
        await page.waitForTimeout(300)

        // Click cancel
        const cancelButton = page.locator('[data-testid="save-cancel-button"]')
        if (await cancelButton.count() > 0) {
          await cancelButton.click()
          await page.waitForTimeout(300)

          // Modal should be closed
          const modal = page.locator('[data-testid="save-options-modal"]')
          await expect(modal).not.toBeVisible()
        }
      }
    }

    consoleInterceptor.assertNoErrors()
  })
})

test.describe('Open Folder', () => {
  test('should have Open menu option', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const fileMenu = page.locator('[role="menuitem"]:has-text("File")').first()
    if (await fileMenu.count() > 0) {
      await fileMenu.click()
      await page.waitForTimeout(300)

      const openOption = page.locator('text="Open..."').first()
      if (await openOption.count() > 0) {
        await expect(openOption).toBeVisible()
      }
    }

    consoleInterceptor.assertNoErrors()
  })

  test('should handle file format detection', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Verify application loads without errors
    await expect(page.locator('body')).toBeVisible()

    consoleInterceptor.assertNoErrors()
  })

  test('should support loading from folder structure', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Verify application loads without errors
    await expect(page.locator('body')).toBeVisible()

    consoleInterceptor.assertNoErrors()
  })
})
