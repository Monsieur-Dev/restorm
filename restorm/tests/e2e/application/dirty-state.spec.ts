import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join, resolve } from 'path'
import electronPath from 'electron'

/**
 * E2E tests for dirty state indicator functionality.
 * Tests verify that:
 * - Asterisk (*) appears in titlebar, taskbar, AND individual tabs when modified
 * - Dirty state is shown per-tab independently
 * - Reverting changes removes the dirty indicator
 */
test.describe('Dirty State Indicators', () => {
  let electronApp: ElectronApplication
  let page: Page
  const restormRoot = resolve(__dirname, '../../..')
  const petstoreFilePath = join(restormRoot, 'tests/e2e/samples/Petstore.restorm')

  test.beforeEach(async () => {
    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    // Launch Electron with Petstore FILE (easier for testing)
    electronApp = await electron.launch({
      executablePath: electronExePath,
      args: ['--no-sandbox', mainJsPath, '-o', petstoreFilePath],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    page = await electronApp.firstWindow()
    
    // Listen to console logs
    page.on('console', msg => {
      console.log(`[Renderer] ${msg.type()}: ${msg.text()}`)
    })
    
    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    await page.waitForTimeout(10000)
  })

  test.afterEach(() => {
    try {
      electronApp.process().kill('SIGKILL')
    } catch {
      // Ignore kill errors
    }
  })

  // Helper to modify content in the Notes tab
  async function modifyNotesContent(page: Page, text: string): Promise<void> {
    // Click on "Notes" inner tab - try multiple selectors
    const notesSelectors = [
      '[role="tabpanel"] [role="tab"]:has-text("Notes")',
      '[role="tablist"]:not(.tabs-container) [role="tab"]:has-text("Notes")',
      'button:has-text("Notes")',
      '[data-state] button:has-text("Notes")'
    ]
    
    let notesClicked = false
    for (const selector of notesSelectors) {
      const notesTab = page.locator(selector).first()
      if (await notesTab.isVisible({ timeout: 1000 }).catch(() => false)) {
        await notesTab.click()
        await page.waitForTimeout(500)
        notesClicked = true
        break
      }
    }
    
    if (!notesClicked) {
      // Fallback: try generic text selector
      const notesText = page.getByText('Notes', { exact: true })
      const all = await notesText.all()
      for (const el of all) {
        if (await el.isVisible().catch(() => false)) {
          await el.click()
          await page.waitForTimeout(500)
          break
        }
      }
    }

    // Wait for editor to become visible
    await page.waitForTimeout(500)

    // Find the Milkdown editor - try multiple selectors
    const editorSelectors = [
      '.ProseMirror[contenteditable="true"]',
      '.milkdown .editor',
      '[role="textbox"][contenteditable="true"]'
    ]
    
    let editor = null
    for (const selector of editorSelectors) {
      const loc = page.locator(selector).first()
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        editor = loc
        break
      }
    }
    
    if (!editor) {
      throw new Error('Could not find visible Milkdown editor')
    }

    await editor.click()
    await page.keyboard.type(text)
    await page.waitForTimeout(500)
  }

  // Helper to revert changes using Ctrl+Z
  async function revertNotesContent(page: Page): Promise<void> {
    // Click on "Notes" inner tab - try multiple selectors
    const notesSelectors = [
      '[role="tabpanel"] [role="tab"]:has-text("Notes")',
      '[role="tablist"]:not(.tabs-container) [role="tab"]:has-text("Notes")',
      'button:has-text("Notes")',
      '[data-state] button:has-text("Notes")'
    ]
    
    for (const selector of notesSelectors) {
      const notesTab = page.locator(selector).first()
      if (await notesTab.isVisible({ timeout: 1000 }).catch(() => false)) {
        await notesTab.click()
        await page.waitForTimeout(500)
        break
      }
    }

    await page.waitForTimeout(500)

    // Find the editor
    const editorSelectors = [
      '.ProseMirror[contenteditable="true"]',
      '.milkdown .editor',
      '[role="textbox"][contenteditable="true"]'
    ]
    
    let editor = null
    for (const selector of editorSelectors) {
      const loc = page.locator(selector).first()
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        editor = loc
        break
      }
    }
    
    if (!editor) {
      throw new Error('Could not find visible Milkdown editor for revert')
    }

    // Focus and undo
    await editor.click()
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Control+z')
    }
    await page.waitForTimeout(500)
  }

  test('should show dirty indicator on tab, titlebar, and taskbar when content is modified', async () => {
    // Wait for data to load
    await expect(page.locator('[role="treeitem"]:has-text("Swagger Petstore")').first()).toBeVisible({ timeout: 15000 })

    // Get initial title - should NOT have asterisk
    const initialTitle = await page.title()
    expect(initialTitle).not.toContain(' *')

    // Click on "Swagger Petstore" folder to open it in a tab
    const swaggerFolder = page.locator('[role="treeitem"]:has-text("Swagger Petstore")').first()
    await swaggerFolder.click()
    await page.waitForTimeout(1000)

    // A workbench tab should now be open
    const tab = page.locator('[role="tab"]').first()
    await expect(tab).toBeVisible({ timeout: 5000 })

    // Tab should NOT have dirty indicator initially
    const dirtyIndicator = tab.locator('.dirty-indicator')
    await expect(dirtyIndicator).not.toBeVisible()

    // Modify notes content
    await modifyNotesContent(page, 'Test modification for dirty state')

    // Wait for event propagation
    await page.waitForTimeout(1000)

    // Tab should now have dirty indicator icon
    await expect(dirtyIndicator).toBeVisible()

    // Title (taskbar) should have asterisk
    const modifiedTitle = await page.title()
    expect(modifiedTitle).toContain(' *')

    // Revert changes
    await revertNotesContent(page)
    await page.waitForTimeout(1000)

    // Tab should NOT have dirty indicator anymore
    await expect(dirtyIndicator).not.toBeVisible()

    // Title should NOT have asterisk
    const restoredTitle = await page.title()
    expect(restoredTitle).not.toContain(' *')
  })

  test('should show dirty indicator on tab when content is modified in folder mode', async () => {
    // Wait for data to load
    await expect(page.locator('[role="treeitem"]:has-text("Swagger Petstore")').first()).toBeVisible({ timeout: 15000 })

    // Open folder
    const folder = page.locator('[role="treeitem"]:has-text("Swagger Petstore")').first()
    await folder.click()
    await page.waitForTimeout(1000)

    // Tab should be open
    const tab = page.locator('[role="tab"]').first()
    await expect(tab).toBeVisible({ timeout: 5000 })

    // Tab should NOT have dirty indicator initially
    const dirtyIndicator = tab.locator('.dirty-indicator')
    await expect(dirtyIndicator).not.toBeVisible()

    // Modify an environment variable
    const input = page.locator('input[type="text"], input:not([type])').first()
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      await input.click()
      await page.keyboard.press('End')
      await page.keyboard.type(' modified')
      await page.keyboard.press('Tab')
    }
    await page.waitForTimeout(1500)

    // Tab should have dirty indicator icon
    await expect(dirtyIndicator).toBeVisible()

    // Title should have asterisk
    const title = await page.title()
    expect(title).toContain(' *')
  })
})
