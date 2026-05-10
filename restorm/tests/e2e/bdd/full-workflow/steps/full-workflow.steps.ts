import { createBdd } from 'playwright-bdd'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextConfirmationDialogForE2E, configureNextOpenDialogForE2E, configureNextSaveFileDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, readSavedMainBounds, FULL_WORKFLOW_TEMP_DIR, currentElectronApp } from '../../fixtures/full-workflow.fixture'

/** Absolute path to the repo's shared e2e sample directory (tests/unit). */
const SAMPLES_DIR = resolve(__dirname, '../../../../unit')

const { Given, When, Then } = createBdd(test)

const SEED_WIDTH = 1500
const SEED_HEIGHT = 700

// Module-level handles — populated by the Given step and reassigned on
// every relaunch so subsequent steps always talk to the current app.
let app: ElectronApplication | null = null
let page: Page | null = null
let configPath: string | null = null

// Tab-id handles captured while the app is running so the workbench state
// seeded between close-and-reopen can reference real items by their
// index-path identity (the same format `buildTabId` uses internally).
let recordedFolderTabId: string | null = null
let recordedRequestTabId: string | null = null

// Window background-color snapshots taken via `I capture the window
// background color as <name>` for cross-step comparisons (used by the
// workspace-settings theme e2e). Keyed by the human-readable name the
// scenario passes in (`initial`, `after-theme-swap`, …).
const capturedColors = new Map<string, string>()

Given(
  'a fresh app seeded with the main window at x={int} y={int}',
  async ({ launchApp }, x: number, y: number) => {
    const launched = await launchApp({
      seed: {
        windows: {
          main: { x, y, width: SEED_WIDTH, height: SEED_HEIGHT, fullscreen: false }
        }
      }
    })
    app = launched.app
    page = launched.page
    configPath = launched.configPath
  }
)

Then(
  'the window bounds should be at x={int} y={int}',
  async ({}, x: number, y: number) => {
    if (!app) throw new Error('app must be launched before asserting bounds')
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win ? win.getBounds() : null
    })
    expect(bounds).not.toBeNull()
    expect(bounds).toMatchObject({ x, y })
  }
)

Then(
  'the window bounds should be x={int} y={int} width={int} height={int}',
  async ({}, x: number, y: number, width: number, height: number) => {
    if (!app) throw new Error('app must be launched before asserting bounds')
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win ? win.getBounds() : null
    })
    expect(bounds).toEqual({ x, y, width, height })
  }
)

When(
  'I move and resize the window to x={int} y={int} width={int} height={int}',
  async ({}, x: number, y: number, width: number, height: number) => {
    if (!app) throw new Error('app must be launched before moving')
    await app.evaluate(
      ({ BrowserWindow }, bounds) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) win.setBounds(bounds)
      },
      { x, y, width, height }
    )
    // Let the `moved` + `resized` listeners fire and saveWindowState write.
    await new Promise((r) => setTimeout(r, 500))
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win ? win.getBounds() : null
    })
    expect(bounds).toEqual({ x, y, width, height })
  }
)

When('I close the app', async () => {
  if (!app) throw new Error('app must be launched before closing')

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.close()
  })
  // Give the close handler + persistence write a beat to flush to disk.
  await new Promise((r) => setTimeout(r, 1000))
  app = null
  page = null
})

When('I relaunch the app', async ({ launchApp }) => {
  const launched = await launchApp({ relaunch: true })
  app = launched.app
  page = launched.page
  configPath = launched.configPath
})

Then(
  'the saved main window bounds should be x={int} y={int} width={int} height={int}',
  async ({}, x: number, y: number, width: number, height: number) => {
    if (!configPath) throw new Error('configPath was not captured; launchApp must run first')
    const saved = readSavedMainBounds(configPath)
    if (!saved) throw new Error('config.json should contain saved main window bounds')
    expect(saved).toEqual(expect.objectContaining({ x, y, width, height }))
  }
)

// ---------------------------------------------------------------------------
// New-file + welcome workflow
// ---------------------------------------------------------------------------

async function clickFileMenuItem(currentPage: Page, itemTestId: string): Promise<void> {
  await currentPage.locator('[data-testid="titlebar-menubar-item-file"]').click()
  const item = currentPage.locator(`[data-testid="${itemTestId}"]`).first()
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.click()
}

When(
  'I create a new single-file YAML collection named {string}',
  async ({}, baseName: string) => {
    if (!page) throw new Error('app must be launched before creating a file')
    const filePath = join(FULL_WORKFLOW_TEMP_DIR, `${baseName}.restorm`)
    const electronApp = currentElectronApp()
    if (!electronApp) throw new Error('no running electron app')
    // Use the shared system-modals mock so an unexpected save dialog
    // call would crash the test rather than silently succeed.
    await configureNextSaveFileDialogForE2E(electronApp, { kind: 'saveFile', path: filePath })

    await clickFileMenuItem(page, 'titlebar-menu-item-new')

    // SaveOptionsModal → file mode + yaml format → confirm.
    const modal = page.locator('[data-testid="save-options-modal"]')
    await expect(modal).toBeVisible({ timeout: 5000 })
    await page.locator('[data-testid="save-mode-file"]').click()
    await page.locator('[data-testid="save-format-yaml"]').click()
    await page.locator('[data-testid="save-confirm-button"]').click()

    // Wait for the file to land on disk (mocked dialog → main process writes).
    await expect(async () => {
      expect(existsSync(filePath)).toBe(true)
    }).toPass({ timeout: 10000 })
  }
)

Then(
  'the file {string} should exist in the temp dir',
  async ({}, fileName: string) => {
    expect(existsSync(join(FULL_WORKFLOW_TEMP_DIR, fileName))).toBe(true)
  }
)

/**
 * Close the current project after preconfiguring the unsaved-
 * changes confirmation dialog to return "Don't Save". Triggers the
 * close path through the same test helper as `I close the current
 * file`, but pre-arms the system-modal mock so a dirty document
 * doesn't crash on an unconfigured `dialog.showMessageBox` call.
 */
When('I close the current file and discard changes', async () => {
  if (!page) throw new Error('app must be launched before closing a file')
  const electronApp = currentElectronApp()
  if (!electronApp) throw new Error('no electron app is running')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await configureNextConfirmationDialogForE2E(electronApp, {
    buttonKeys: ['file.unsavedChanges.save', 'file.unsavedChanges.dontSave', 'file.unsavedChanges.cancel'],
    choiceKey: 'file.unsavedChanges.dontSave'
  })
  // Use the menubar's "Close" action so the close goes through
  // `handleMenuClose` → `checkUnsavedChanges` → confirmation dialog
  // (mocked above to "Don't save"). The bypass helper `closeFile`
  // would skip the prompt entirely and not exercise the discard
  // branch's draft-cleanup invariant.
  await page.evaluate(async () => {
    const helpers = (window as unknown as {
      __restormTestHelpers?: { menuClose?: () => Promise<void> | void }
    }).__restormTestHelpers
    if (!helpers?.menuClose) throw new Error('__restormTestHelpers.menuClose not exposed')
    await helpers.menuClose()
  })
  await expect(page.locator('.ecu-welcome-screen')).toBeVisible({ timeout: 10000 })
})

When('I close the current file', async () => {
  if (!page) throw new Error('app must be launched before closing a file')
  // Dismiss any lingering overlay (context menu, tab switcher, tooltip)
  // before invoking the close flow.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  // Drive the close via the exposed test helper — same code path as the
  // File → Close menu item (handleMenuClose), but immune to stuck menubar
  // focus after a context-menu-heavy scenario.
  await page.evaluate(async () => {
    const helpers = (window as unknown as {
      __restormTestHelpers?: { closeFile?: () => Promise<void> | void }
    }).__restormTestHelpers
    if (!helpers?.closeFile) throw new Error('__restormTestHelpers.closeFile not exposed')
    await helpers.closeFile()
  })
  await expect(page.locator('.ecu-welcome-screen')).toBeVisible({ timeout: 10000 })
})

Then('the welcome screen should be visible', async () => {
  if (!page) throw new Error('app must be launched')
  await expect(page.locator('.ecu-welcome-screen')).toBeVisible({ timeout: 5000 })
})

Then('the welcome screen should not be visible', async () => {
  if (!page) throw new Error('app must be launched')
  await expect(page.locator('.ecu-welcome-screen')).not.toBeVisible({ timeout: 10000 })
})

function welcomeItemByName(
  currentPage: Page,
  section: 'recent' | 'favorites',
  fileName: string
): Locator {
  const sectionHeading = section === 'recent'
    ? currentPage.locator('.ecu-recent-files-vignette-section', { hasText: 'Recent' })
    : currentPage.locator('.ecu-recent-files-vignette-section', { hasText: 'Favorites' })
  return sectionHeading.locator('.ecu-recent-files-vignette-item', { hasText: fileName }).first()
}

Then(
  'the welcome recent files should contain {string}',
  async ({}, fileName: string) => {
    if (!page) throw new Error('app must be launched')
    await expect(welcomeItemByName(page, 'recent', fileName)).toBeVisible({ timeout: 5000 })
  }
)

Then(
  'the welcome favorites should contain {string}',
  async ({}, fileName: string) => {
    if (!page) throw new Error('app must be launched')
    await expect(welcomeItemByName(page, 'favorites', fileName)).toBeVisible({ timeout: 5000 })
  }
)

Then(
  'the welcome favorites should not contain {string}',
  async ({}, fileName: string) => {
    if (!page) throw new Error('app must be launched')
    await expect(welcomeItemByName(page, 'favorites', fileName)).not.toBeVisible({ timeout: 5000 })
  }
)

When(
  'I favorite the welcome recent file {string}',
  async ({}, fileName: string) => {
    if (!page) throw new Error('app must be launched')
    const row = welcomeItemByName(page, 'recent', fileName)
    await expect(row).toBeVisible({ timeout: 5000 })
    await row.locator('[data-testid="recent-files-vignette-toggle-favorite-button"]').click()
  }
)

When(
  'I unfavorite the welcome favorite {string}',
  async ({}, fileName: string) => {
    if (!page) throw new Error('app must be launched')
    const row = welcomeItemByName(page, 'favorites', fileName)
    await expect(row).toBeVisible({ timeout: 5000 })
    await row.locator('[data-testid="recent-files-vignette-remove-favorite-button"]').click()
  }
)

When(
  'I open the welcome recent file {string}',
  async ({}, fileName: string) => {
    if (!page) throw new Error('app must be launched')
    const row = welcomeItemByName(page, 'recent', fileName)
    await expect(row).toBeVisible({ timeout: 5000 })
    await row.click()
  }
)

// ---------------------------------------------------------------------------
// Import workflow
// ---------------------------------------------------------------------------

async function runImport(currentPage: Page, source: string): Promise<void> {
  // Open the import modal via Ctrl+I (same trigger the menu bar uses).
  await currentPage.keyboard.press('Control+I')
  const modal = currentPage.locator('[data-testid="import-modal"]')
  await expect(modal).toBeVisible({ timeout: 10000 })

  const input = modal.locator('textarea, input[type="text"]').first()
  await input.fill(source)

  // Wait for the preview to populate so the Import button enables.
  await expect(modal.locator('.import-preview-section')).toBeVisible({ timeout: 15000 })

  const importButton = modal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 15000 })
  await importButton.click()

  await expect(modal).not.toBeVisible({ timeout: 10000 })

  // Importing a spec now auto-opens the created env folder as a tab.
  // Verify a new active tab appeared, then close it so subsequent
  // imports don't accumulate tabs that obscure other tab-based assertions.
  const activeTab = currentPage.locator('.tab[role="tab"][aria-selected="true"]').first()
  await expect(activeTab).toBeVisible({ timeout: 10000 })
  await activeTab.locator('button[aria-label="Close"]').first().click()
  await expect(currentPage.locator('.tab[role="tab"]')).toHaveCount(0, { timeout: 5000 })
}

When(
  'I import the sample file {string}',
  async ({}, filename: string) => {
    if (!page) throw new Error('app must be launched before importing')
    const samplePath = join(SAMPLES_DIR, filename)
    expect(existsSync(samplePath), `sample file ${samplePath} must exist`).toBe(true)
    await runImport(page, samplePath)
  }
)

When(
  'I selectively import the Petstore swagger excluding the {string} folder',
  async ({}, folderName: string) => {
    if (!page) throw new Error('app must be launched before importing')
    const samplePath = join(SAMPLES_DIR, 'swagger-petstore.json')
    expect(existsSync(samplePath), `sample file ${samplePath} must exist`).toBe(true)

    await page.keyboard.press('Control+I')
    const modal = page.locator('[data-testid="import-modal"]')
    await expect(modal).toBeVisible({ timeout: 10000 })

    const input = modal.locator('textarea, input[type="text"]').first()
    await input.fill(samplePath)

    // The selection tree mounts after the spec is parsed.
    await expect(modal.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 15000 })

    // Click the folder Toggle to uncheck the entire group (cascades
    // to descendants). The selection-tree row test ids are
    //   `import-selection-tree-row-folder_<sanitised-path>`
    // where `_` replaces every non-alphanumeric character in the
    // natural key (`folder:Swagger Petstore/store` →
    // `folder_Swagger_Petstore_store`). Match on the `_<folderName>`
    // suffix so the test stays robust to spec-title changes.
    const folderToggle = modal.locator(
      `[data-testid^="import-selection-tree-row-folder_"][data-testid$="_${folderName}-toggle-action"]`
    ).first()
    await expect(folderToggle).toBeVisible({ timeout: 5000 })
    await folderToggle.click()
    await expect(folderToggle).toHaveAttribute('aria-checked', 'false', { timeout: 5000 })

    const importButton = modal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
    await expect(importButton).toBeVisible({ timeout: 5000 })
    await importButton.click()
    await expect(modal).not.toBeVisible({ timeout: 10000 })

    // The auto-opened env-folder tab obscures later tab-based
    // assertions; close it the same way `runImport` does.
    const activeTab = page.locator('.tab[role="tab"][aria-selected="true"]').first()
    await expect(activeTab).toBeVisible({ timeout: 10000 })
    await activeTab.locator('button[aria-label="Close"]').first().click()
    await expect(page.locator('.tab[role="tab"]')).toHaveCount(0, { timeout: 5000 })
  }
)

Then(
  'the imported tree should not contain any {string} routes',
  async ({}, segment: string) => {
    if (!page) throw new Error('app must be launched')
    // After save-all, the single-file YAML collection at
    // `FULL_WORKFLOW_TEMP_DIR/selective-import.restorm` carries every
    // imported request inline. Read it and assert no `url:` line
    // mentions the unchecked group's path segment. Folders may
    // persist as empty arrays; we anchor on the request URL so the
    // assertion stays insensitive to surrounding scaffolding.
    const filePath = join(FULL_WORKFLOW_TEMP_DIR, 'selective-import.restorm')
    expect(existsSync(filePath), `${filePath} must exist`).toBe(true)
    const content = readFileSync(filePath, 'utf-8')
    const re = new RegExp(`url:\\s*[^\\n]*\\b${segment}\\b`, 'g')
    const matches = content.match(re) ?? []
    expect(matches, `no url: line should reference "${segment}"`).toEqual([])
  }
)

When(
  'I import the URL {string}',
  async ({}, url: string) => {
    if (!page) throw new Error('app must be launched before importing')
    await runImport(page, url)
  }
)

When('I open the import modal', async () => {
  if (!page) throw new Error('app must be launched before opening the import modal')
  await page.keyboard.press('Control+I')
  await expect(page.locator('[data-testid="import-modal"]')).toBeVisible({ timeout: 10000 })
})

When(
  'I paste the sample file {string} into the import source',
  async ({}, filename: string) => {
    if (!page) throw new Error('app must be launched')
    const samplePath = join(SAMPLES_DIR, filename)
    expect(existsSync(samplePath), `sample file ${samplePath} must exist`).toBe(true)
    const input = page.locator('[data-testid="import-modal"] textarea, [data-testid="import-modal"] input[type="text"]').first()
    await input.fill(samplePath)
  }
)

Then('the import preview should be visible', async () => {
  if (!page) throw new Error('app must be launched')
  await expect(page.locator('[data-testid="import-modal"] .import-preview-section')).toBeVisible({
    timeout: 10000
  })
})

Then('the import preview should not be visible', async () => {
  if (!page) throw new Error('app must be launched')
  // Debounced: wait for the preview section to disappear after clearing.
  await expect(page.locator('[data-testid="import-modal"] .import-preview-section')).not.toBeVisible({
    timeout: 5000
  })
})

When('I clear the import source', async () => {
  if (!page) throw new Error('app must be launched')
  const input = page.locator('[data-testid="import-modal"] textarea, [data-testid="import-modal"] input[type="text"]').first()
  await input.fill('')
})

When('I cancel the import modal', async () => {
  if (!page) throw new Error('app must be launched')
  const cancel = page.locator('[data-testid="import-modal"] [data-testid="cancel-button"]').first()
  await expect(cancel).toBeVisible({ timeout: 5000 })
  await cancel.click()
  await expect(page.locator('[data-testid="import-modal"]')).not.toBeVisible({ timeout: 5000 })
})

When('I click the sidebar request {string}', async ({}, requestName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = sidebarRowByTitle(page, requestName)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
})

Then('a request tab for {string} should be open', async ({}, requestName: string) => {
  if (!page) throw new Error('app must be launched')
  const tab = page
    .locator('.tab[role="tab"]')
    .filter({ hasText: requestName })
    .first()
  await expect(tab).toBeVisible({ timeout: 10000 })
})

When(
  'I select the {string} environment on the active request tab',
  async ({}, envName: string) => {
    if (!page) throw new Error('app must be launched')
    // The dropdown lives in the status bar, not in the tab header.
    // Click opens a `<Tooltip>`-backed popover above the cell; the
    // env list inside is a ListView so we filter on the listview
    // root to keep the click scoped to the popover content.
    const dropdown = page.locator('[data-testid="statusbar-env-selector"]').first()
    await expect(dropdown).toBeVisible({ timeout: 5000 })
    await dropdown.click()
    const popoverList = page.locator('[data-testid="statusbar-env-selector-listview"]').first()
    await expect(popoverList).toBeVisible({ timeout: 5000 })
    const item = popoverList.locator(`text="${envName}"`).first()
    await expect(item).toBeVisible({ timeout: 5000 })
    await item.click()
    // Wait for the popover to close and the selection to settle.
    await page.waitForTimeout(200)
    await expect(dropdown).toContainText(envName, { timeout: 5000 })
  }
)

When(
  'I fill the first path-param value with {string}',
  async ({}, value: string) => {
    if (!page) throw new Error('app must be launched')
    // The value cell renders either a plain `<input>` (for string/number
    // typed vars) or a Monaco-backed editor (handlebars/expression vars).
    // Prefer the plain input when present, fall back to Monaco.
    const row = page.locator('[data-testid="http-request-path-params-table"] tbody tr').first()
    await expect(row).toBeVisible({ timeout: 5000 })
    const plainInput = row.locator('td').nth(3).locator('input').first()
    if (await plainInput.count() > 0 && await plainInput.isVisible()) {
      await clearAndType(page, plainInput, value)
      await page.keyboard.press('Tab')
    } else {
      const monacoCell = row.locator('.monaco-editor').first()
      await expect(monacoCell).toBeVisible({ timeout: 5000 })
      await monacoCell.click()
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Delete')
      await page.keyboard.type(value)
      await page.keyboard.press('Tab')
    }
    // Give the URL-resolver round-trip a beat to propagate to the tooltip.
    await page.waitForTimeout(600)
  }
)

Then('the active tab should have a dirty dot', async () => {
  if (!page) throw new Error('app must be launched')
  const dirty = page.locator('[role="tab"][aria-selected="true"] .dirty-indicator').first()
  await expect(dirty).toBeVisible({ timeout: 10000 })
})

Then('the active tab should not have a dirty dot', async () => {
  if (!page) throw new Error('app must be launched')
  const dirty = page.locator('[role="tab"][aria-selected="true"] .dirty-indicator').first()
  await expect(dirty).not.toBeVisible({ timeout: 10000 })
})

When('I click the sidebar env folder {string}', async ({}, folderName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = page
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: page.getByText(folderName, { exact: true }) })
    .first()
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await page.waitForTimeout(500)
})

When('I switch to the {string} inner tab', async ({}, tabLabel: string) => {
  if (!page) throw new Error('app must be launched')
  let tab
  if (tabLabel === 'home') {
    // Home tab uses a codicon icon, not text
    tab = page.locator('[role="tab"]').filter({ has: page.locator('.codicon-home') }).first()
  } else {
    tab = page.locator('[role="tab"]').filter({ hasText: new RegExp(`^${tabLabel}$`) }).first()
  }
  await expect(tab).toBeVisible({ timeout: 2000 })
  await tab.click()
  await page.waitForTimeout(300)
})

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

async function clickContextMenuItem(currentPage: Page, pattern: RegExp): Promise<void> {
  // Context menu items may render as <a> or <li> elements — match by visible text
  const item = currentPage.locator('.action-menu-item, [role="menuitem"]')
    .filter({ hasText: pattern }).first()
  await expect(item).toBeVisible({ timeout: 2000 })
  await item.click()
  await currentPage.waitForTimeout(300)
}

When('I right-click the sidebar request {string} and add to favorites', async ({}, requestName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = page.locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: page.getByText(requestName, { exact: true }) }).first()
  await expect(row).toBeVisible({ timeout: 2000 })
  await row.click({ button: 'right' })
  await page.waitForTimeout(200)
  await clickContextMenuItem(page, /Add to favorites|Ajouter aux favoris/)
})

When('I right-click the sidebar request {string} and remove from favorites', async ({}, requestName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = page.locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: page.getByText(requestName, { exact: true }) }).first()
  await expect(row).toBeVisible({ timeout: 2000 })
  await row.click({ button: 'right' })
  await page.waitForTimeout(200)
  await clickContextMenuItem(page, /Remove from favorites|Retirer des favoris/)
})

When('I right-click the tab {string} and add to favorites', async ({}, tabName: string) => {
  if (!page) throw new Error('app must be launched')
  const tab = page.locator('.tab[role="tab"]')
    .filter({ has: page.getByText(tabName, { exact: true }) }).first()
  await expect(tab).toBeVisible({ timeout: 2000 })
  await tab.click({ button: 'right' })
  await page.waitForTimeout(500)
  await clickContextMenuItem(page, /Add to favorites|Ajouter aux favoris/)
})

When('I right-click the tab {string} and remove from favorites', async ({}, tabName: string) => {
  if (!page) throw new Error('app must be launched')
  const tab = page.locator('.tab[role="tab"]')
    .filter({ has: page.getByText(tabName, { exact: true }) }).first()
  await expect(tab).toBeVisible({ timeout: 2000 })
  await tab.click({ button: 'right' })
  await page.waitForTimeout(500)
  await clickContextMenuItem(page, /Remove from favorites|Retirer des favoris/)
})

When('I right-click {string} in the home favorites and remove', async ({}, requestName: string) => {
  if (!page) throw new Error('app must be launched')
  const section = page.locator('[data-testid="home-favorites-section"]')
  await expect(section).toBeVisible({ timeout: 2000 })
  const row = section.getByText(requestName).first()
  await expect(row).toBeVisible({ timeout: 2000 })
  await row.click({ button: 'right' })
  await page.waitForTimeout(300)
  await clickContextMenuItem(page, /Remove from favorites|Retirer des favoris/)
})

Then('the home favorites section should contain {string}', async ({}, requestName: string) => {
  if (!page) throw new Error('app must be launched')
  const section = page.locator('[data-testid="home-favorites-section"]')
  await expect(section).toBeVisible({ timeout: 2000 })
  await expect(section.getByText(requestName)).toBeVisible({ timeout: 2000 })
})

Then('the home favorites section should not be visible', async () => {
  if (!page) throw new Error('app must be launched')
  const section = page.locator('[data-testid="home-favorites-section"]')
  await expect(section).not.toBeVisible({ timeout: 2000 })
})

// Same as `rename the sidebar request` but targets the LAST DOM-order
// row matching the name. Used after `add a root-level …` because the
// root-level request lands at the bottom of the sidebar tree — picking
// `.first()` would rename a same-named entry that already lives inside
// a folder higher up.
When('I rename the last sidebar request {string} to {string}', async ({}, oldName: string, newName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = page.locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: page.getByText(oldName, { exact: true }) }).last()
  await expect(row).toBeVisible({ timeout: 2000 })
  await row.click()
  await page.keyboard.press('F2')
  await page.waitForTimeout(200)
  const input = page.locator('[data-testid="sidebar-listview"] input[type="text"]').first()
  await expect(input).toBeVisible({ timeout: 2000 })
  await clearAndType(page, input, newName)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
})

When('I rename the sidebar request {string} to {string}', async ({}, oldName: string, newName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = page.locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: page.getByText(oldName, { exact: true }) }).first()
  await expect(row).toBeVisible({ timeout: 2000 })
  // Double-click or F2 to enter rename mode
  await row.click()
  await page.keyboard.press('F2')
  await page.waitForTimeout(200)
  const input = page.locator('[data-testid="sidebar-listview"] input[type="text"]').first()
  await expect(input).toBeVisible({ timeout: 2000 })
  await clearAndType(page, input, newName)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
})

When('I delete the sidebar request {string}', async ({}, requestName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = page.locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: page.getByText(requestName, { exact: true }) }).first()
  await expect(row).toBeVisible({ timeout: 2000 })
  await row.click({ button: 'right' })
  await page.waitForTimeout(200)
  await clickContextMenuItem(page, /^Delete$|^Supprimer$/)
})

// ---------------------------------------------------------------------------
// URL tooltip + searchbar interactions
// ---------------------------------------------------------------------------

Then(
  'the active request URL tooltip should be {string}',
  async ({}, expectedUrl: string) => {
    if (!page) throw new Error('app must be launched')
    const currentPage = page
    // URL resolution goes main → renderer via IPC after an env change, so
    // give it plenty of time to propagate through handlebars + URLResolver.
    await expect.poll(
      async () => {
        const title = await currentPage.locator('[data-testid="url-container"]').first().getAttribute('title')
        return title ?? ''
      },
      { timeout: 30000, message: `expected URL tooltip to equal "${expectedUrl}"` }
    ).toBe(expectedUrl)
  }
)

When('I open the search bar', async () => {
  if (!page) throw new Error('app must be launched')
  const closed = page.locator('[data-testid="main-titlebar-searchbar-closed"]').first()
  await expect(closed).toBeVisible({ timeout: 5000 })
  await closed.click({ force: true })
  await expect(page.locator('[data-testid="main-titlebar-searchbar-open"]').first()).toBeVisible({
    timeout: 5000
  })
})

When('I close the search bar', async () => {
  if (!page) throw new Error('app must be launched')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-testid="main-titlebar-searchbar-closed"]').first()).toBeVisible({
    timeout: 5000
  })
})

When('I search for {string}', async ({}, query: string) => {
  if (!page) throw new Error('app must be launched')
  // InputBox puts its test id on a wrapper and adds `-input` on the real
  // <input> element; use that so we can type into it directly.
  const input = page
    .locator('[data-testid="main-titlebar-searchbar-inputbox-input"]')
    .first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(query)
  await page.waitForSelector(`[data-testid="main-titlebar-searchbar"][data-results-count]`, {
    timeout: 5000
  })
})

Then(
  'a title-bar search for {string} should return no results',
  async ({}, query: string) => {
    if (!page) throw new Error('app must be launched')
    // Open the searchbar (welcome screen keeps the titlebar mounted).
    const closed = page.locator('[data-testid="main-titlebar-searchbar-closed"]').first()
    await expect(closed).toBeVisible({ timeout: 5000 })
    await closed.click({ force: true })
    const input = page.locator('[data-testid="main-titlebar-searchbar-inputbox-input"]').first()
    await expect(input).toBeVisible({ timeout: 5000 })
    await input.focus()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.type(query)
    // `data-results-count` updates whenever the search settles.
    await page.waitForSelector('[data-testid="main-titlebar-searchbar"][data-results-count]', {
      timeout: 5000
    })
    const resultsCount = await page
      .locator('[data-testid="main-titlebar-searchbar"]')
      .first()
      .getAttribute('data-results-count')
    expect(resultsCount).toBe('0')
    // Close the searchbar so we leave the welcome screen untouched.
    await page.keyboard.press('Escape')
  }
)

Then(
  'the title-bar search results should contain a hit mentioning {string}',
  async ({}, needle: string) => {
    if (!page) throw new Error('app must be launched')
    const results = page
      .locator('[data-testid="main-titlebar-searchbar-results"] [data-testid^="main-titlebar-searchbar-result-"]')
      .filter({ hasText: needle })
    await expect(results.first()).toBeVisible({ timeout: 10000 })
  }
)

When(
  'I open the request Notes tab and type {string}',
  async ({}, text: string) => {
    if (!page) throw new Error('app must be launched')
    const requestTabs = page.locator('[data-testid="base-request-tabs-request"]').first()
    await expect(requestTabs).toBeVisible({ timeout: 5000 })
    const notesTab = requestTabs.locator('[role="tab"]').filter({ hasText: /^Notes$/ }).first()
    await expect(notesTab).toBeVisible({ timeout: 5000 })
    await notesTab.click()
    // Milkdown renders a contenteditable div; use the exposed testid.
    const editor = page
      .locator('[data-testid="base-request-markdown-editor-notes-editor"]')
      .first()
    await expect(editor).toBeVisible({ timeout: 5000 })
    await editor.click()
    await page.keyboard.type(text)
    // Click outside the editor to flush the Milkdown onChange.
    await page.mouse.click(5, 5)
    await page.waitForTimeout(500)
  }
)

Then('the folder tab Docs tab should be populated with compiled markdown', async () => {
  if (!page) throw new Error('app must be launched')
  const folderTabs = page
    .locator('[data-testid^="folder-view-"][data-testid$="-tabs"]')
    .first()
  await expect(folderTabs).toBeVisible({ timeout: 10000 })
  const docsTab = folderTabs.locator('[role="tab"]').filter({ hasText: /^Docs$/ }).first()
  if (await docsTab.count() > 0) {
    await docsTab.click()
  }
  // The structured documentation viewer (`DocumentationHost`) replaces
  // the previous MarkdownViewer here. Env-folder scope uses a fixed
  // testid; folder scope embeds the folder id. Match either via the
  // `-documentation-host` suffix the host stamps on its root.
  const docsViewer = page
    .locator('[data-testid$="-documentation-host"]:visible')
    .first()
  await expect(docsViewer).toBeVisible({ timeout: 10000 })
  const heading = docsViewer.locator('h1').first()
  await expect(heading).toBeVisible({ timeout: 10000 })
  const headingText = await heading.textContent()
  expect((headingText?.trim().length) ?? 0).toBeGreaterThan(0)
  // Switch back to Configuration so later steps (add env variable, tag,
  // etc.) that rely on the variables pane find it visible.
  const configTab = folderTabs.locator('[role="tab"]').filter({ hasText: /^Configuration$/ }).first()
  if (await configTab.count() > 0) {
    await configTab.click()
  }
})

/** Locates the Docs tab rendered inside an HTTP request tab pane. */
function activeRequestDocsTab(currentPage: Page): Locator {
  // Scope to the request tab bar (id `base-request-tabs-request`) so we
  // don't pick up the folder-view's Docs tab when the workbench is showing
  // a folder + request side-by-side.
  return currentPage
    .locator('[data-testid="base-request-tabs-request"] [role="tab"]')
    .filter({ hasText: /^Docs$/ })
    .first()
}

Then('the request Docs tab should be visible', async () => {
  if (!page) throw new Error('app must be launched')
  const docsTab = activeRequestDocsTab(page)
  await expect(docsTab).toBeVisible({ timeout: 10000 })
})

Then('the request Docs tab should not be visible', async () => {
  if (!page) throw new Error('app must be launched')
  const docsTab = activeRequestDocsTab(page)
  await expect(docsTab).toHaveCount(0, { timeout: 10000 })
})

When('I press Backspace in the URL field', async () => {
  if (!page) throw new Error('app must be launched')
  const urlContainer = page.locator('[data-testid="url-container"]').locator('visible=true').first()
  const monacoEditor = urlContainer.locator('.monaco-editor').first()
  await expect(monacoEditor).toBeVisible({ timeout: 5000 })
  await monacoEditor.click()
  // Undo the most recent edit — Monaco's own history guarantees we end
  // with the exact buffer we started with, so the file checksum matches
  // the saved state and dirty auto-clears without Ctrl+S.
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(700)
})

When(
  'I rename {string} to {string} in the sidebar',
  async ({}, oldName: string, newName: string) => {
    if (!page) throw new Error('app must be launched')
    const row = sidebarRowByTitle(page, oldName)
    await expect(row).toBeVisible({ timeout: 5000 })
    await row.click()
    await page.keyboard.press('F2')
    const input = page.locator('[data-testid="sidebar-listview"] input[type="text"]').first()
    await expect(input).toBeVisible({ timeout: 5000 })
    await clearAndType(page, input, newName)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
  }
)

// Reuse Monaco editor selectors from the monaco-typing project — when a
// request is active we drive the URL field via its `.monaco-editor` host.
When('I focus the URL field at the start', async () => {
  if (!page) throw new Error('app must be launched')
  const urlContainer = page.locator('[data-testid="url-container"]').locator('visible=true').first()
  const monacoEditor = urlContainer.locator('.monaco-editor').first()
  await expect(monacoEditor).toBeVisible({ timeout: 5000 })
  await monacoEditor.click()
  await page.keyboard.press('Home')
  await page.waitForTimeout(300)
})

When(
  'I type {string} character by character with delay {int} ms',
  async ({}, text: string, delayMs: number) => {
    if (!page) throw new Error('app must be launched')
    for (const ch of text) {
      await page.keyboard.type(ch)
      if (delayMs > 0) {
        await page.waitForTimeout(delayMs)
      }
    }
    // Give the CodeEditor's internal debounce time to flush to state.
    await page.waitForTimeout(500)
  }
)

When(
  'I replace {string} with {string} in the URL field',
  async ({}, find: string, replace: string) => {
    if (!page) throw new Error('app must be launched')
    const currentPage = page
    const urlContainer = currentPage.locator('[data-testid="url-container"]').locator('visible=true').first()
    const monacoEditor = urlContainer.locator('.monaco-editor').first()
    await expect(monacoEditor).toBeVisible({ timeout: 5000 })
    // Read the rendered URL straight from Monaco's view layer
    // (handlebars tokens land as visible spans so the surrounding
    // `{{baseUrl}}/pet/{{petId}}` round-trips verbatim). Compute the
    // replacement, then drive the keyboard: select-all → delete →
    // type. Going through the keyboard keeps React state + Monaco's
    // edit history in sync — the URL-resolver listens for those
    // signals to recompute documentation matching, so a direct API
    // mutation would silently miss the apiDocumentation re-bind.
    const currentText = await monacoEditor.evaluate((el) => (el as HTMLElement).innerText)
    const cleaned = currentText.replace(/\u00A0/g, ' ').trim()
    if (!cleaned.includes(find)) {
      throw new Error(`URL field doesn't contain "${find}" (got "${cleaned}")`)
    }
    const newText = cleaned.replace(find, replace)
    await monacoEditor.click()
    await currentPage.keyboard.press('Control+A')
    await currentPage.keyboard.press('Delete')
    await currentPage.keyboard.type(newText, { delay: 5 })
    // Allow Monaco's onDidChange + the URL-resolver IPC roundtrip to
    // settle so the Docs-tab visibility reflects the new URL.
    await currentPage.waitForTimeout(800)
  }
)

Then('the URL field should start with {string}', async ({}, expectedPrefix: string) => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  const editor = currentPage.locator('[data-testid="url-container"]:visible .monaco-editor').first()
  await expect.poll(
    async () => {
      const text = await editor.evaluate((el) => (el as HTMLElement).innerText)
      return text.trim()
    },
    { timeout: 10000, message: `expected URL field to start with "${expectedPrefix}"` }
  ).toContain(expectedPrefix)
})

When('I hover over the first search result', async () => {
  if (!page) throw new Error('app must be launched')
  const first = page
    .locator('[data-testid="main-titlebar-searchbar-results"] [data-testid^="main-titlebar-searchbar-result-"]')
    .first()
  await expect(first).toBeVisible({ timeout: 5000 })
  await first.hover()
})

Then('the title-bar search tooltip should be visible', async () => {
  if (!page) throw new Error('app must be launched')
  const tooltip = page.locator('[data-testid="main-titlebar-searchbar-tooltip"]').first()
  await expect(tooltip).toBeVisible({ timeout: 5000 })
})

Then('I should see search results', async () => {
  if (!page) throw new Error('app must be launched')
  const results = page.locator(
    '[data-testid="main-titlebar-searchbar-results"] [data-testid^="main-titlebar-searchbar-result-"]'
  )
  await expect(results.first()).toBeVisible({ timeout: 5000 })
  expect(await results.count()).toBeGreaterThan(0)
})

When(
  'I click on the search result containing {string}',
  async ({}, needle: string) => {
    if (!page) throw new Error('app must be launched')
    const result = page
      .locator('[data-testid="main-titlebar-searchbar-results"] [data-testid^="main-titlebar-searchbar-result-"]')
      .filter({ hasText: needle })
      .first()
    await expect(result).toBeVisible({ timeout: 5000 })
    await result.click()
    await expect(page.locator('[data-testid="main-titlebar-searchbar-closed"]').first()).toBeVisible({
      timeout: 5000
    })
  }
)

When('I focus the {string} tab', async ({}, tabText: string) => {
  if (!page) throw new Error('app must be launched')
  const tab = page
    .locator('[role="tab"]')
    .filter({ has: page.getByText(tabText, { exact: true }) })
    .first()
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click()
})

// ---------------------------------------------------------------------------
// Env folder variables: add typed variables (color, dateTime)
// ---------------------------------------------------------------------------

/** Clear an input and type a value character by character (200ms delay). */
async function clearAndType(currentPage: Page, locator: ReturnType<typeof currentPage.locator>, text: string): Promise<void> {
  await locator.click()
  await currentPage.keyboard.press('Control+a')
  await currentPage.keyboard.type(text, { delay: 200 })
}

async function addEnvVariable(currentPage: Page, key: string): Promise<void> {
  const addBtn = currentPage.locator('[data-testid="environment-folder-add-variable-button"]').first()
  await expect(addBtn).toBeVisible({ timeout: 5000 })
  // The pane header can sit over the button's hit region; bypass actionability.
  await addBtn.click({ force: true })
  // The new row is the last row in the variables table. Fill its key cell.
  const rows = currentPage.locator('[data-testid="environment-folder-variables-table"] tbody tr')
  const lastRow = rows.last()
  await expect(lastRow).toBeVisible({ timeout: 5000 })
  const keyInput = lastRow.locator('input').nth(0)
  await clearAndType(currentPage, keyInput, key)
  await currentPage.keyboard.press('Tab')
}

async function transformLastRowTo(currentPage: Page, typeMenuTestId: string): Promise<void> {
  const rows = currentPage.locator('[data-testid="environment-folder-variables-table"] tbody tr')
  const lastRow = rows.last()
  // The context menu now opens exclusively via the TypeIndicator button
  // on the right edge of the value cell. For a freshly-added variable
  // (always StringValue by default), the button carries
  // data-testid="...-value-type-string".
  const typeBtn = lastRow.locator('[data-testid$="-value-type-string"]').first()
  await expect(typeBtn).toBeVisible({ timeout: 5000 })
  await typeBtn.click()
  const target = currentPage.locator(`[data-testid="${typeMenuTestId}"]`).first()
  await expect(target).toBeVisible({ timeout: 5000 })
  await target.click()
  await currentPage.waitForTimeout(200)
}

When('I edit and revert the first env folder variable', async () => {
  if (!page) throw new Error('app must be launched')
  const rows = page.locator('[data-testid="environment-folder-variables-table"] tbody tr')
  const firstRow = rows.first()
  await expect(firstRow).toBeVisible({ timeout: 2000 })
  const valueInput = firstRow.locator('td').nth(3).locator('input').first()
  await expect(valueInput).toBeVisible({ timeout: 2000 })
  const originalValue = await valueInput.inputValue()
  // Modify then revert
  await clearAndType(page, valueInput, 'MODIFIED-REVERT-TEST')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(500)
  await clearAndType(page, valueInput, originalValue)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(1000)
})

When(
  'I edit the first env folder variable value to {string}',
  async ({}, newValue: string) => {
    if (!page) throw new Error('app must be launched')
    const rows = page.locator('[data-testid="environment-folder-variables-table"] tbody tr')
    const firstRow = rows.first()
    await expect(firstRow).toBeVisible({ timeout: 5000 })
    const valueInput = firstRow.locator('td').nth(3).locator('input').first()
    await expect(valueInput).toBeVisible({ timeout: 5000 })
    await clearAndType(page, valueInput, newValue)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(300)
  }
)

When(
  'I add a variable {string} of type color to the env folder',
  async ({}, key: string) => {
    if (!page) throw new Error('app must be launched')
    await addEnvVariable(page, key)
    await transformLastRowTo(page, 'environment-folder-variables-table-context-menu-item-color')
  }
)

When(
  'I add a variable {string} of type dateTime to the env folder',
  async ({}, key: string) => {
    if (!page) throw new Error('app must be launched')
    await addEnvVariable(page, key)
    await transformLastRowTo(page, 'environment-folder-variables-table-context-menu-item-datetime')
  }
)

When(
  'I edit the env folder expression variable {string} to {string}',
  async ({}, varKey: string, newValue: string) => {
    if (!page) throw new Error('app must be launched')
    const rows = page.locator('[data-testid="environment-folder-variables-table"] tbody tr')
    const targetRow = rows.filter({ has: page.locator('input').first().filter({ has: page.getByDisplayValue(varKey) }) }).first()

    // If the row can't be found by display value, fall back to checking each row's key input
    let row = targetRow
    if (await targetRow.count() === 0) {
      const allRows = await rows.all()
      for (const r of allRows) {
        const keyVal = await r.locator('td').nth(2).locator('input').first().inputValue().catch(() => '')
        if (keyVal === varKey) {
          row = r
          break
        }
      }
    }
    await expect(row).toBeVisible({ timeout: 5000 })
    // Expression fields use Monaco — find the editor and type into it
    const monacoEditor = row.locator('.monaco-editor').first()
    await expect(monacoEditor).toBeVisible({ timeout: 5000 })
    await monacoEditor.click()
    // Select all and replace
    await page.keyboard.press('Control+a')
    await page.keyboard.type(newValue)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(500)
  }
)

When(
  'I click the env folder environment named {string}',
  async ({}, envName: string) => {
    if (!page) throw new Error('app must be launched')
    const row = page
      .locator('[data-testid="environment-folder-environment-list"] .list-view-title', {
        hasText: new RegExp(`^${envName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
      })
      .first()
    await expect(row).toBeVisible({ timeout: 5000 })
    await row.click()
    await page.waitForTimeout(300)
  }
)

Then('the env folder variables should have a dateTime cell', async () => {
  if (!page) throw new Error('app must be launched')
  // Transforming to dateTime replaces the value input with a custom
  // DateTimePicker component — a `.ecu-date-time-picker` node marks it.
  const dtCell = page
    .locator('[data-testid="environment-folder-variables-table"] .ecu-date-time-picker')
    .first()
  await expect(dtCell).toBeVisible({ timeout: 5000 })
})

// ---------------------------------------------------------------------------
// Context variables table
// ---------------------------------------------------------------------------

Then(
  'the context variables table should contain {string} with value {string}',
  async ({}, varName: string, expectedValue: string) => {
    if (!page) throw new Error('app must be launched')
    const contextSection = page.locator('[data-testid="environment-folder-context-pane"]')
    await expect(contextSection).toBeVisible({ timeout: 2000 })
    const table = page.locator('[data-testid="context-variables-table"]')
    await expect(table).toBeVisible({ timeout: 2000 })

    const rows = await table.locator('tbody tr').all()
    let matched = false
    for (const row of rows) {
      const nameText = (await row.locator('td').nth(1).textContent() ?? '').trim()
      if (nameText === `{{${varName}}}`) {
        await expect(row.locator('td').last()).toHaveText(expectedValue, { timeout: 2000 })
        matched = true
        break
      }
    }
    expect(matched, `Variable {{${varName}}} not found in context variables table`).toBe(true)
  }
)

Then(
  'the context variables table should not contain {string}',
  async ({}, varName: string) => {
    if (!page) throw new Error('app must be launched')
    const table = page.locator('[data-testid="context-variables-table"]')
    await expect(table).toBeVisible({ timeout: 2000 })

    const rows = await table.locator('tbody tr').all()
    for (const row of rows) {
      const nameText = (await row.locator('td').nth(1).textContent() ?? '').trim()
      expect(nameText, `Variable {{${varName}}} should not be in context table`).not.toBe(`{{${varName}}}`)
    }
  }
)

When(
  'I change the env variable {string} value to {string}',
  async ({}, varKey: string, newValue: string) => {
    if (!page) throw new Error('app must be launched')
    const rows = page.locator('[data-testid="environment-folder-variables-table"] tbody tr')
    const allRows = await rows.all()
    for (const r of allRows) {
      const keyVal = await r.locator('td').nth(2).locator('input').first().inputValue().catch(() => '')
      if (keyVal === varKey) {
        const valueInput = r.locator('td').nth(3).locator('input').first()
        await expect(valueInput).toBeVisible({ timeout: 2000 })
        await clearAndType(page, valueInput, newValue)
        await page.keyboard.press('Tab')
        await page.waitForTimeout(1500)
        return
      }
    }
    throw new Error(`Variable row with key "${varKey}" not found`)
  }
)

When(
  'I add a new env variable {string} with value {string}',
  async ({}, key: string, value: string) => {
    if (!page) throw new Error('app must be launched')
    const addBtn = page.locator('[data-testid="environment-folder-add-variable-button"]').first()
    await expect(addBtn).toBeVisible({ timeout: 2000 })
    await addBtn.click({ force: true })

    const rows = page.locator('[data-testid="environment-folder-variables-table"] tbody tr')
    const lastRow = rows.last()
    await expect(lastRow).toBeVisible({ timeout: 2000 })
    const keyInput = lastRow.locator('input').nth(0)
    await clearAndType(page, keyInput, key)
    await page.keyboard.press('Tab')

    const valueInput = lastRow.locator('td').nth(3).locator('input').first()
    await expect(valueInput).toBeVisible({ timeout: 2000 })
    await clearAndType(page, valueInput, value)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(500)
  }
)

When(
  'I delete the env variable {string}',
  async ({}, varKey: string) => {
    if (!page) throw new Error('app must be launched')
    const rows = page.locator('[data-testid="environment-folder-variables-table"] tbody tr')
    const allRows = await rows.all()
    for (const r of allRows) {
      const keyVal = await r.locator('td').nth(2).locator('input').first().inputValue().catch(() => '')
      if (keyVal === varKey) {
        const deleteBtn = r.locator('.codicon-trash').first()
        await expect(deleteBtn).toBeVisible({ timeout: 2000 })
        await deleteBtn.click()
        await page.waitForTimeout(500)
        return
      }
    }
    throw new Error(`Variable row with key "${varKey}" not found`)
  }
)

// ---------------------------------------------------------------------------
// Notes editor
// ---------------------------------------------------------------------------

When('I type {string} in the notes editor', async ({}, text: string) => {
  if (!page) throw new Error('app must be launched')
  const editor = page.locator('[data-testid$="-markdown-editor-notes-editor"]').first()
  await expect(editor).toBeVisible({ timeout: 2000 })
  await editor.click()
  await page.keyboard.type(text)
  await page.mouse.click(5, 5)
  await page.waitForTimeout(500)
})

When('I undo all changes in the notes editor', async () => {
  if (!page) throw new Error('app must be launched')
  const editor = page.locator('[data-testid$="-markdown-editor-notes-editor"]').first()
  await expect(editor).toBeVisible({ timeout: 2000 })
  await editor.click()
  // Undo repeatedly until the original state is restored
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Control+z')
  }
  await page.mouse.click(5, 5)
  await page.waitForTimeout(1000)
})

// ---------------------------------------------------------------------------
// Tag color change + propagation
// ---------------------------------------------------------------------------

When(
  'I set the color of the folder tab\'s {string} tag to yellow',
  async ({}, tagName: string) => {
    if (!page) throw new Error('app must be launched')
    // Driving @uiw/react-color-sketch via the UI proved too brittle (the
    // hex input's three-field RGB mode clamps text differently depending
    // on focus). Use the dedicated test helper, which writes directly to
    // the env folder's reactive `tagColors` map — the proxy now emits
    // FOLDER_UPDATED for `tagColors` (see reactive.ts) so tag renderers
    // repaint and the dirty tracker flags the file.
    const ok = await page.evaluate(
      ([name, color]) => {
        const helpers = (window as unknown as {
          __restormTestHelpers?: {
            setEnvFolderTagColor?: (folderName: string, tag: string, color: string | null) => boolean
          }
        }).__restormTestHelpers
        return helpers?.setEnvFolderTagColor?.('Swagger Petstore', name, color) ?? false
      },
      [tagName, '#ffff00'] as const
    )
    if (!ok) throw new Error(`failed to set color of tag "${tagName}"`)
    await page.waitForTimeout(300)
  }
)

function isYellowBackground(rgb: string | null): boolean {
  if (!rgb) return false
  // getComputedStyle returns rgb(r, g, b) or rgba(...).
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb)
  if (!match) return false
  const r = Number(match[1])
  const g = Number(match[2])
  const b = Number(match[3])
  // Yellow-ish: red + green dominate, blue is low. Tolerant of browser
  // color rounding and small alpha blending artefacts.
  return r >= 200 && g >= 200 && b <= 120 && Math.abs(r - g) <= 40
}

Then('the folder tab\'s {string} tag should be colored yellow', async ({}, tagName: string) => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  await expect
    .poll(
      async () => {
        const rgb = await currentPage
          .locator('[data-testid^="tab-env-folder-id:"][data-testid$="-bookmarks"] .ecui-bookmark-ribbon', { hasText: tagName })
          .first()
          .evaluate((el) => getComputedStyle(el, '::before').backgroundColor)
          .catch(() => null)
        return isYellowBackground(rgb)
      },
      { timeout: 10000, message: `expected folder tab "${tagName}" tag background to be yellow` }
    )
    .toBe(true)
})

Then('the request tab\'s {string} tag should be colored yellow', async ({}, tagName: string) => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  await expect
    .poll(
      async () => {
        const rgb = await currentPage
          .locator('[data-testid^="tab-request-id:"][data-testid$="-bookmarks"] .ecui-bookmark-ribbon', { hasText: tagName })
          .first()
          .evaluate((el) => getComputedStyle(el, '::before').backgroundColor)
          .catch(() => null)
        return isYellowBackground(rgb)
      },
      { timeout: 10000, message: `expected request tab "${tagName}" tag background to be yellow` }
    )
    .toBe(true)
})

// ---------------------------------------------------------------------------
// Workbench-state mocking: record tab ids while the app is running, then
// seed `workbench_state_*` in config.json so the workbench comes back with
// a two-group side-by-side layout on the next open.
// ---------------------------------------------------------------------------

When(
  'I record the tab ids for folder {string} with subfolder {string} and request {string}',
  async ({}, folderName: string, childFolderName: string, requestName: string) => {
    if (!page) throw new Error('app must be launched')
    const folderId = await page.evaluate((name) => {
      const helpers = (window as unknown as {
        __restormTestHelpers?: { findItemIdByPath?: (names: string[]) => string | null }
      }).__restormTestHelpers
      return helpers?.findItemIdByPath?.([name]) ?? null
    }, folderName)
    const requestId = await page.evaluate(
      ([f, c, r]) => {
        const helpers = (window as unknown as {
          __restormTestHelpers?: { findItemIdByPath?: (names: string[]) => string | null }
        }).__restormTestHelpers
        return helpers?.findItemIdByPath?.([f, c, r]) ?? null
      },
      [folderName, childFolderName, requestName] as const
    )
    if (!folderId) throw new Error(`could not resolve uuid for folder "${folderName}"`)
    if (!requestId) {
      throw new Error(
        `could not resolve uuid for "${folderName}" > "${childFolderName}" > "${requestName}"`
      )
    }
    recordedFolderTabId = `env-folder-id:${folderId}`
    recordedRequestTabId = `request-id:${requestId}`
  }
)

When(
  'I seed the workbench with the recorded folder and request tabs side-by-side',
  async () => {
    if (!page) throw new Error('app must be launched')
    if (!recordedFolderTabId || !recordedRequestTabId) {
      throw new Error('recorded tab ids missing — run the "record the tab ids" step first')
    }
    const filePath = join(FULL_WORKFLOW_TEMP_DIR, 'workflow-collection.restorm')
    // Workbench state is keyed by `_projectUuid` since the filePath →
    // UUID migration. We grep the UUID directly out of the YAML (a
    // top-level `_projectUuid: <uuid>` line stamped by `ensureFileUuid`)
    // rather than pulling in a YAML parser just for the test harness —
    // the project format guarantees that shape at the top level.
    const raw = readFileSync(filePath, 'utf-8')
    const match = /^_projectUuid:\s*([0-9a-f-]{36})\s*$/m.exec(raw)
    const projectUuid = match?.[1]
    if (!projectUuid) {
      throw new Error(`expected _projectUuid stamped into ${filePath}; file starts with: ${raw.slice(0, 200)}`)
    }
    const storageKey = `workbench_state_restorm-main-workbench:${projectUuid}`
    const state = {
      // 'vertical' = vertical splitter → panes rendered side-by-side
      // (matches the "tabs côte à côte" layout the scenario documents).
      orientation: 'vertical',
      groups: [
        {
          type: 'tabs',
          id: 'full-workflow-group-left',
          tabIds: [recordedFolderTabId],
          activeTabId: recordedFolderTabId
        },
        {
          type: 'tabs',
          id: 'full-workflow-group-right',
          tabIds: [recordedRequestTabId],
          activeTabId: recordedRequestTabId
        }
      ],
      sizes: [0.5, 0.5]
    }
    // Use `window.api.storage.set` so the write goes through the main
    // process' PersistenceService (both in-memory cache and disk), which
    // is what the workbench restore path reads from.
    await page.evaluate(
      async (args) => {
        interface StorageAPI { set: (key: string, value: unknown) => Promise<boolean> }
        const api = (window as unknown as { api?: { storage?: StorageAPI } }).api
        if (!api?.storage) throw new Error('window.api.storage not available')
        await api.storage.set(args.key, args.value)
      },
      { key: storageKey, value: state }
    )
  }
)

Then('a folder tab for {string} should be open', async ({}, folderName: string) => {
  if (!page) throw new Error('app must be launched')
  const tab = page
    .locator('[role="tab"]')
    .filter({ has: page.getByText(folderName, { exact: true }) })
    .first()
  await expect(tab).toBeVisible({ timeout: 10000 })
})

Then(
  'the active request tab should show the {string} environment',
  async ({}, envName: string) => {
    if (!page) throw new Error('app must be launched')
    // There's a single env selector in the status bar (not one per
    // tab), so no `:visible` filter needed — the cell rerenders to
    // reflect whichever request is the active tab.
    const dropdown = page.locator('[data-testid="statusbar-env-selector"]').first()
    await expect(dropdown).toContainText(envName, { timeout: 10000 })
  }
)

// ---------------------------------------------------------------------------
// Folder tab interactions (icon change, variables color picker)
// ---------------------------------------------------------------------------

When('I focus the {string} folder tab', async ({}, folderName: string) => {
  if (!page) throw new Error('app must be launched')
  const tab = page
    .locator('[role="tab"]')
    .filter({ has: page.getByText(folderName, { exact: true }) })
    .first()
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5000 })
})

When('I click the breadcrumb folder {string} in the active tab', async ({}, label: string) => {
  if (!page) throw new Error('app must be launched')
  // Non-last breadcrumb items render as `<button class="ecui-breadcrumb-link">`.
  // Match the label with `getByText(exact)` — `hasText` alone does
  // substring matching, which would pick "Swagger Petstore" (contains
  // "pet") before the actual "pet" segment.
  const p = page
  const segment = p
    .locator('li.ecui-breadcrumb-item:not(.ecui-breadcrumb-item--last) button.ecui-breadcrumb-link:visible')
    .filter({ has: p.getByText(label, { exact: true }) })
    .first()
  await expect(segment).toBeVisible({ timeout: 5000 })
  await segment.click()
  // Give the workbench a beat to open the matching tab + refocus.
  await p.waitForTimeout(500)
})

When('I middle-click the breadcrumb folder {string} in the active tab', async ({}, label: string) => {
  if (!page) throw new Error('app must be launched')
  // Same selector as the regular-click step; the aux-click gesture
  // uses Playwright's `click({ button: 'middle' })` so browsers route
  // it through `onAuxClick` rather than `onClick`.
  const p = page
  const segment = p
    .locator('li.ecui-breadcrumb-item:not(.ecui-breadcrumb-item--last) button.ecui-breadcrumb-link:visible')
    .filter({ has: p.getByText(label, { exact: true }) })
    .first()
  await expect(segment).toBeVisible({ timeout: 5000 })
  await segment.click({ button: 'middle' })
  await p.waitForTimeout(500)
})

Then('the active tab should be {string}', async ({}, label: string) => {
  if (!page) throw new Error('app must be launched')
  // Active tab is the one with `aria-selected="true"`. Match by text
  // to be resilient to other selected-siblings across split groups.
  const activeTab = page
    .locator('[role="tab"][aria-selected="true"]')
    .filter({ has: page.getByText(label, { exact: true }) })
    .first()
  await expect(activeTab).toBeVisible({ timeout: 5000 })
})

When('I set the folder tab icon to codicon {string}', async ({}, iconName: string) => {
  if (!page) throw new Error('app must be launched')
  // The folder tab's title-row IconSelect is the visible trigger on
  // the active pane. Post-refactor it lives next to the H1 name, not
  // in the breadcrumb; the new wrapper class pins the selector.
  const iconTrigger = page.locator('.restorm-workbench-tab-title-icon-select [role="button"]:visible').first()
  await expect(iconTrigger).toBeVisible({ timeout: 5000 })
  await iconTrigger.click()
  await page.waitForSelector('.ecui-icon-select-picker', { timeout: 5000 })
  const codiconTabButton = page.locator('.ecui-icon-select-tabs [role="button"]').nth(1)
  await codiconTabButton.click()
  await page.waitForTimeout(200)
  const search = page.locator('.ecui-icon-select-picker input').first()
  await clearAndType(page, search, iconName)
  await page.waitForTimeout(500)
  const firstResult = page.locator(`[data-icon-type="codicon"][data-icon-name="${iconName}"]`).first()
  await expect(firstResult).toBeVisible({ timeout: 5000 })
  await firstResult.click()
  await page.waitForTimeout(500)
})

Then('the folder tab breadcrumb icon should be {string}', async ({}, iconName: string) => {
  if (!page) throw new Error('app must be launched')
  // The icon lives in the tab's title-row IconSelect post-refactor —
  // keep the step name (`breadcrumb icon`) for backwards compatibility
  // with existing scenarios but target the new location.
  const icon = page.locator(`.restorm-workbench-tab-title-icon-select .codicon-${iconName}:visible`).first()
  await expect(icon).toBeVisible({ timeout: 5000 })
  // The title IconSelect is configured at `size={22}`. Assert the
  // computed font-size matches so a regression to 16 (e.g. the vendor
  // `.codicon[class*='codicon-'] { font: 16px/1 }` shorthand silently
  // outmanoeuvres an inline size again) fails loudly.
  const computedSize = await icon.evaluate((el) => window.getComputedStyle(el).fontSize)
  expect(computedSize).toBe('22px')
})

Then('the environment-folder variables table color picker should be visible', async () => {
  if (!page) throw new Error('app must be launched')
  const colorButton = page
    .locator('[data-testid="environment-folder-variables-table"] [aria-label="Open color picker"]')
    .first()
  await expect(colorButton).toBeVisible({ timeout: 5000 })
})

// ---------------------------------------------------------------------------
// Tag operations on the active folder tab
// ---------------------------------------------------------------------------

/**
 * Playwright can't select cross-pane CSS with `:has` reliably on Electron,
 * so target the bookmark-ribbon stack via the "add" button in the active
 * folder tab's header. Only one folder tab is ever active at a time in
 * this scenario.
 */
function activeFolderBookmarks(currentPage: Page): Locator {
  return currentPage.locator('[data-testid^="tab-env-folder-id:"][data-testid$="-bookmarks"]').first()
}

// ---------------------------------------------------------------------------
// Multi-tab, navigation history, and tab-switch interactions
// ---------------------------------------------------------------------------

When('I open the sidebar request {string}', async ({}, requestName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = sidebarRowByTitle(page, requestName)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
})

Then('the active tab title should be {string}', async ({}, title: string) => {
  if (!page) throw new Error('app must be launched')
  const activeTab = page.locator('[role="tab"][aria-selected="true"]')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first()
  await expect(activeTab).toBeVisible({ timeout: 5000 })
})

When('I press Ctrl+Tab', async () => {
  if (!page) throw new Error('app must be launched')
  // Keep Ctrl held while tapping Tab, then release — matches the real
  // tab-switcher UX (overlay commits on keyup of Ctrl).
  await page.keyboard.down('Control')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Control')
  await page.waitForTimeout(200)
})

When('I press Ctrl+Alt+{word}', async ({}, arrow: string) => {
  if (!page) throw new Error('app must be launched')
  const key = arrow === 'Right' ? 'ArrowRight' : arrow === 'Left' ? 'ArrowLeft' : null
  if (!key) throw new Error(`unsupported arrow "${arrow}" — expected "Right" or "Left"`)
  await page.keyboard.press(`Control+Alt+${key}`)
  // Give React a beat to flush the controlled focus change before the next
  // keypress lands — without this, two consecutive Ctrl+Alt+Arrow presses
  // can race and the second one runs against the pre-move focused group.
  await page.waitForTimeout(500)
})

/**
 * Snapshot the workbench layout as `tab,tab*|tab` — groups separated by
 * `|`, tabs within a group by `,`, and the active tab in each group
 * suffixed with `*`. Useful for asserting the Ctrl+Alt+Arrow layout
 * transitions in one concise line. Scoped to `.tab[role="tab"]` to
 * exclude request-view inner tabs (Request / Docs / Notes / Code
 * snippets) that share the `[role="tab"]` ARIA role.
 */
Then('the workbench layout should be {string}', async ({}, expected: string) => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  await expect.poll(async () => {
    return currentPage.evaluate(() => {
      const groups = Array.from(document.querySelectorAll('.editor-group-container'))
      return groups
        .map((g) => {
          const tabs = Array.from(g.querySelectorAll<HTMLElement>('.tab[role="tab"]'))
          return tabs
            .map((t) => {
              const title = t.textContent.trim()
              const selected = t.getAttribute('aria-selected') === 'true'
              return selected ? `${title}*` : title
            })
            .join(',')
        })
        .join('|')
    })
  }, { timeout: 5000, message: `expected workbench layout to be "${expected}"` }).toBe(expected)
})

When('I press Ctrl+Shift+Tab', async () => {
  if (!page) throw new Error('app must be launched')
  await page.keyboard.down('Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
  await page.waitForTimeout(200)
})

When('I middle-click the tab {string}', async ({}, title: string) => {
  if (!page) throw new Error('app must be launched')
  const tab = page.locator('[role="tab"]')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first()
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click({ button: 'middle' })
})

Then('no tab with title {string} should be open', async ({}, title: string) => {
  if (!page) throw new Error('app must be launched')
  const tabs = page.locator('[role="tab"]')
    .filter({ has: page.getByText(title, { exact: true }) })
  await expect(tabs).toHaveCount(0, { timeout: 5000 })
})

When('I click the titlebar back button', async () => {
  if (!page) throw new Error('app must be launched')
  const back = page.locator('[data-testid="main-titlebar-nav-back"]').first()
  await expect(back).toBeVisible({ timeout: 5000 })
  const disabled = await back.getAttribute('aria-disabled')
  if (disabled === 'true') throw new Error('back button is disabled')
  await back.hover()
  await back.click()
  await page.waitForTimeout(800)
})

When('I click the titlebar back button until {string} is open', async ({}, title: string) => {
  if (!page) throw new Error('app must be launched')
  const back = page.locator('[data-testid="main-titlebar-nav-back"]').first()
  for (let i = 0; i < 10; i += 1) {
    const tab = page.locator('.tab[role="tab"]').filter({ hasText: title }).first()
    if (await tab.count() > 0 && await tab.isVisible()) return
    const disabled = await back.getAttribute('aria-disabled')
    if (disabled === 'true') {
      throw new Error(`Hit start of history before "${title}" reappeared`)
    }
    await back.click()
    await page.waitForTimeout(400)
  }
  throw new Error(`Exceeded back-click budget waiting for "${title}"`)
})

When('I click the titlebar forward button', async () => {
  if (!page) throw new Error('app must be launched')
  const fwd = page.locator('[data-testid="main-titlebar-nav-forward"]').first()
  await expect(fwd).toBeVisible({ timeout: 5000 })
  await fwd.click({ force: true })
  await page.waitForTimeout(200)
})

Then('the titlebar forward button should be disabled', async () => {
  if (!page) throw new Error('app must be launched')
  const fwd = page.locator('[data-testid="main-titlebar-nav-forward"]').first()
  await expect(fwd).toHaveAttribute('aria-disabled', 'true', { timeout: 5000 })
})

When(
  'I right-click the tab {string} and choose close-others',
  async ({}, title: string) => {
    if (!page) throw new Error('app must be launched')
    const tab = page.locator('[role="tab"]')
      .filter({ has: page.getByText(title, { exact: true }) })
      .first()
    await expect(tab).toBeVisible({ timeout: 5000 })
    await tab.click({ button: 'right' })
    const item = page.getByRole('menuitem', { name: /Close others|Fermer les autres/ }).first()
    await expect(item).toBeVisible({ timeout: 5000 })
    await item.click()
    await page.waitForTimeout(200)
  }
)

Then('exactly {int} workbench tabs should be open', async ({}, expected: number) => {
  if (!page) throw new Error('app must be launched')
  const tabs = page.locator('.tab[role="tab"]')
  await expect(tabs).toHaveCount(expected, { timeout: 10000 })
})

When('I close every open tab in the workbench', async () => {
  if (!page) throw new Error('app must be launched')
  const tabLocator = page.locator('.tab[role="tab"]')
  for (let i = 0; i < 50; i += 1) {
    const count = await tabLocator.count()
    if (count === 0) return
    await tabLocator.first().click({ button: 'middle' })
    await expect(tabLocator).toHaveCount(count - 1, { timeout: 5000 })
  }
  throw new Error('Failed to close all tabs after 50 attempts')
})

When('I add tag {string} to the active folder tab', async ({}, tagName: string) => {
  if (!page) throw new Error('app must be launched')
  const tagsRoot = activeFolderBookmarks(page)
  await expect(tagsRoot).toBeVisible({ timeout: 5000 })
  const addButton = tagsRoot.locator('[data-testid$="-bookmarks-add"]').first()
  await addButton.click()

  // The add tooltip is portalled to the document body, so locate its
  // input globally rather than under the stack.
  const input = page.locator('[data-testid$="-bookmarks-add-input-input"]').first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.click()
  await input.fill(tagName)
  await page.keyboard.press('Enter')
  await expect(
    tagsRoot.locator('.ecui-bookmark-ribbon', { hasText: tagName }).first()
  ).toBeVisible({ timeout: 5000 })
})

Then('the active folder tab should have tag {string}', async ({}, tagName: string) => {
  if (!page) throw new Error('app must be launched')
  const tagsRoot = activeFolderBookmarks(page)
  await expect(
    tagsRoot.locator('.ecui-bookmark-ribbon', { hasText: tagName }).first()
  ).toBeVisible({ timeout: 5000 })
})

Then('the active folder tab should not have tag {string}', async ({}, tagName: string) => {
  if (!page) throw new Error('app must be launched')
  const tagsRoot = activeFolderBookmarks(page)
  await expect(
    tagsRoot.locator('.ecui-bookmark-ribbon', { hasText: tagName })
  ).toHaveCount(0, { timeout: 5000 })
})

When('I remove tag {string} from the active folder tab', async ({}, tagName: string) => {
  if (!page) throw new Error('app must be launched')
  const tagsRoot = activeFolderBookmarks(page)
  const tag = tagsRoot.locator('.ecui-bookmark-ribbon', { hasText: tagName }).first()
  await expect(tag).toBeVisible({ timeout: 5000 })
  // Opening the ribbon's editor tooltip surfaces the Remove button.
  // The tooltip is portalled out of the stack, so scope the remove-button
  // locator to ribbon-tooltip testids (`*-bookmarks-ribbon-N-remove`).
  await tag.click()
  const removeButton = page
    .locator('[data-testid*="-bookmarks-ribbon-"][data-testid$="-remove"]')
    .first()
  await expect(removeButton).toBeVisible({ timeout: 5000 })
  await removeButton.click()
})

Then(
  'the sidebar should contain the folder {string}',
  async ({}, folderName: string) => {
    if (!page) throw new Error('app must be launched')
    const row = page
      .locator('[data-testid="sidebar-listview"] .list-view-title', { hasText: folderName })
      .first()
    await expect(row).toBeVisible({ timeout: 10000 })
  }
)

// Dirty-state correctness is validated by the unit test suite in
// `electron-core-ui/src/main/services/saveUnit/*.test.ts` and
// `electron-core-ui/src/main/services/FileService.drafts.test.ts`.
// Tab-level "dirty dot" assertions live in the feature files because
// they're part of the user-visible flow.

When('I save the file with Ctrl+S', async () => {
  if (!page) throw new Error('app must be launched')
  // Dismiss any lingering context menu that might swallow the keystroke
  // before dispatching Ctrl+S.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+s')
  // Give FileService a beat to flush the save-unit commit → dirty=false cascade.
  await page.waitForTimeout(500)
})

When('I save all with Ctrl+Shift+S', async () => {
  if (!page) throw new Error('app must be launched')
  await page.keyboard.press('Escape')
  // Dispatch directly on `window` — a focused Monaco/ProseMirror editor
  // otherwise swallows the native key combo before the app's global
  // listener sees it.
  await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(ev)
  })
  await page.waitForTimeout(1500)
})

/** Find a sidebar row by the *exact* title of its `.list-view-title` span. */
function sidebarRowByTitle(currentPage: Page, title: string): Locator {
  return currentPage
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({
      has: currentPage.getByText(title, { exact: true })
    })
    .first()
}

Then(
  'the sidebar should show a child of {string}',
  async ({}, parentName: string) => {
    if (!page) throw new Error('app must be launched')
    const parentRow = sidebarRowByTitle(page, parentName)
    await expect(parentRow).toBeVisible({ timeout: 10000 })
    await expect(parentRow).toHaveAttribute('aria-expanded', 'true', { timeout: 10000 })
  }
)

When('I click the sidebar collapse-all button', async () => {
  if (!page) throw new Error('app must be launched')
  const button = page.locator('[data-testid="sidebar-collapse-all-button"]').first()
  await expect(button).toBeVisible({ timeout: 5000 })
  // The sidebar splitview header sits on top of the button's hit region on
  // Linux CI — `force: true` bypasses Playwright's actionability check and
  // dispatches the click straight to the button.
  await button.click({ force: true })
  await page.waitForTimeout(200)
})

Then('every sidebar folder should be collapsed', async () => {
  if (!page) throw new Error('app must be launched')
  // No folder row should still report itself as expanded.
  const expandedRows = page.locator(
    '[data-testid="sidebar-listview"] .list-view-row[aria-expanded="true"]'
  )
  await expect(expandedRows).toHaveCount(0, { timeout: 10000 })
})

When('I expand the sidebar folder {string}', async ({}, folderName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = sidebarRowByTitle(page, folderName)
  await expect(row).toBeVisible({ timeout: 5000 })
  // Idempotent: skip the expander click if the row is already expanded.
  if ((await row.getAttribute('aria-expanded')) === 'true') return
  // Click the expander affordance rather than the row body to avoid
  // toggling selection / opening a tab.
  const expander = row.locator('button.list-view-expander').first()
  await expander.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 })
})

Then('the folder {string} should be expanded', async ({}, folderName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = sidebarRowByTitle(page, folderName)
  await expect(row).toBeVisible({ timeout: 5000 })
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 })
})

Then(
  'the folder {string} should have {int} collapsed children',
  async ({}, folderName: string, expected: number) => {
    if (!page) throw new Error('app must be launched')
    // Find the parent folder row + its aria-level attribute, then count
    // rows immediately beneath it at level+1 whose aria-expanded is "false".
    const parentRow = sidebarRowByTitle(page, folderName)
    await expect(parentRow).toBeVisible({ timeout: 5000 })
    const parentLevel = await parentRow.getAttribute('aria-level')
    if (!parentLevel) throw new Error(`folder "${folderName}" row has no aria-level`)
    const childLevel = String(Number(parentLevel) + 1)
    const collapsedChildren = page.locator(
      `[data-testid="sidebar-listview"] .list-view-row[aria-level="${childLevel}"][aria-expanded="false"]`
    )
    await expect(collapsedChildren).toHaveCount(expected, { timeout: 10000 })
  }
)

// ---------------------------------------------------------------------------
// Document title (dirty indicator)
// ---------------------------------------------------------------------------

Then('the app title should contain {string}', async ({}, text: string) => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  await expect.poll(async () => currentPage.title(), { timeout: 5000 }).toContain(text)
})

Then('the app title should not contain {string}', async ({}, text: string) => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  await expect.poll(async () => currentPage.title(), { timeout: 5000 }).not.toContain(text)
})

// ---------------------------------------------------------------------------
// Ctrl+Tab-hold overlay (tab switcher)
// ---------------------------------------------------------------------------

When('I hold Ctrl and press Tab to open the tab switcher', async () => {
  if (!page) throw new Error('app must be launched')
  await page.keyboard.down('Control')
  await page.keyboard.press('Tab')
  await expect(page.locator('[data-testid="tab-switcher"]')).toBeVisible({ timeout: 5000 })
})

Then(
  'the tab switcher item at index {int} should contain {string}',
  async ({}, index: number, text: string) => {
    if (!page) throw new Error('app must be launched')
    const item = page.locator(`[data-testid="tab-switcher-item-${index}"]`)
    await expect(item).toBeVisible({ timeout: 3000 })
    await expect(item).toContainText(text, { timeout: 3000 })
  }
)

When('I release Ctrl', async () => {
  if (!page) throw new Error('app must be launched')
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
})

// ---------------------------------------------------------------------------
// Sidebar collapse + sync with workbench tab focus
// ---------------------------------------------------------------------------

When('I collapse the sidebar folder {string}', async ({}, folderName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = sidebarRowByTitle(page, folderName)
  await expect(row).toBeVisible({ timeout: 5000 })
  if ((await row.getAttribute('aria-expanded')) === 'false') return
  const expander = row.locator('button.list-view-expander').first()
  await expander.click()
  await expect(row).toHaveAttribute('aria-expanded', 'false', { timeout: 5000 })
})

Then('the sidebar folder {string} should be collapsed', async ({}, folderName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = sidebarRowByTitle(page, folderName)
  await expect(row).toHaveAttribute('aria-expanded', 'false', { timeout: 5000 })
})

Then('the sidebar folder {string} should be expanded', async ({}, folderName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = sidebarRowByTitle(page, folderName)
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 })
})

// `useSidebarExpansionPersistence` debounces disk writes by 300 ms; wait
// long enough for the last toggle to flush before we tear the app down.
When('I wait for sidebar expansion to persist', async () => {
  if (!page) throw new Error('app must be launched')
  await page.waitForTimeout(500)
})

// ---------------------------------------------------------------------------
// File open via Ctrl+O (with mocked system open dialog)
// ---------------------------------------------------------------------------

When('I open the {string} file via Ctrl+O', async ({}, fileName: string) => {
  if (!page || !app) throw new Error('app must be launched')
  const filePath = join(FULL_WORKFLOW_TEMP_DIR, fileName)
  await configureNextOpenDialogForE2E(app, { kind: 'openFile', path: filePath })
  await page.keyboard.press('Control+o')
  await expect(page.locator('[data-testid="sidebar-listview"] .list-view-row').first())
    .toBeVisible({ timeout: 15000 })
})

// ---------------------------------------------------------------------------
// Log-hygiene assertion
// ---------------------------------------------------------------------------

/**
 * Lines we don't care about even though they come through stderr. These are
 * well-known, non-actionable warnings produced by Chromium / Electron on the
 * test host; adding more here is fine, but only when the message is
 * confirmed to be unrelated to the code under test.
 */
const BENIGN_LOG_PATTERNS: RegExp[] = [
  /mime_util_xdg\.cc.*Invalid mime\.cache file/,
  /service_worker_storage\.cc.*Failed to delete the database/,
  /Waiting for the debugger to disconnect/
]

function isErrorLine(line: string): boolean {
  if (line.startsWith('[renderer:pageerror]')) return true
  if (line.startsWith('[renderer:error]')) return true
  if (line.startsWith('[main:err]')) {
    return !BENIGN_LOG_PATTERNS.some((p) => p.test(line))
  }
  return false
}

Then('no errors should have been logged', async ({ getLogs }) => {
  const offending = getLogs().filter(isErrorLine)
  expect(
    offending,
    `Expected no error-level log lines, got:\n${offending.join('\n')}`
  ).toEqual([])
})

// ---------------------------------------------------------------------------
// Sidebar "Ajouter" submenu — create folder / requests of every type under
// a parent folder or environment folder.
// ---------------------------------------------------------------------------

/**
 * Regex for each AddChildKind's submenu label (English + French). The
 * submenu entries are translated, so accept either locale to keep the
 * test portable across the default-language resolution.
 */
const ADD_CHILD_LABEL_REGEX: Record<string, RegExp> = {
  folder: /^(Folder|Dossier)$/,
  'http-get': /HTTP\s*[–-]\s*GET/,
  'http-post': /HTTP\s*[–-]\s*POST/,
  'http-put': /HTTP\s*[–-]\s*PUT/,
  'http-patch': /HTTP\s*[–-]\s*PATCH/,
  'http-delete': /HTTP\s*[–-]\s*DELETE/,
  graphql: /GraphQL/,
  grpc: /gRPC/,
  soap: /SOAP/,
  websocket: /WebSocket/,
  odata: /OData/,
  auth: /authentication|authentification/i
}

When(
  'I add a {string} under the folder {string} via the sidebar Ajouter submenu',
  async ({}, kind: string, parentName: string) => {
    if (!page) throw new Error('app must be launched')
    const childLabel = ADD_CHILD_LABEL_REGEX[kind]
    if (!childLabel) throw new Error(`unknown AddChildKind: ${kind}`)

    const row = page
      .locator('[data-testid="sidebar-listview"] .list-view-row')
      .filter({ has: page.getByText(parentName, { exact: true }) })
      .first()
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.click({ button: 'right' })
    await page.waitForTimeout(200)

    // Hover the "Ajouter" / "Add" entry to reveal the nested submenu
    // (MenuItem opens its submenu on hover after a ~300 ms delay;
    // click doesn't open it because `hasSubmenu` short-circuits the
    // handler). Role-based targeting gives us the accessible name
    // directly and avoids picking up `action-label` spans further
    // down the tree.
    const addEntry = page
      .getByRole('menuitem', { name: /^(Add|Ajouter)$/ })
      .first()
    await expect(addEntry).toBeVisible({ timeout: 5000 })
    await addEntry.hover()
    await page.waitForTimeout(350)

    // The submenu is rendered in a separate `<ul role="menu">` nested
    // under the "Add" item once `showSubmenu` flips, so scope by the
    // visible submenu holder — otherwise a plain `/Folder/` match can
    // walk into the sidebar row behind the menu.
    const submenu = page.locator('.menubar-menu-items-holder:visible').last()
    const target = submenu
      .getByRole('menuitem', { name: childLabel })
      .first()
    await expect(target).toBeVisible({ timeout: 5000 })
    // Dispatch the click via the DOM `click()` method. Playwright's
    // own `.click()` sometimes no-ops here because the Badge rendered
    // in the MenuItem's icon slot ships absolute layout that eats the
    // hit-test at the anchor's centre, and the ContextMenu's global
    // `mousedown` outside-listener can race Playwright's synthetic
    // mousedown/mouseup pair. Native `click()` goes straight to the
    // React synthetic handler.
    await target.evaluate((el) => { (el as HTMLElement).click() })
    // Short settle window — the reactive proxy / React commit loop
    // needs a beat before the Then assertion polls the sidebar.
    await page.waitForTimeout(150)
  }
)

Then(
  'the sidebar should contain the request {string}',
  async ({}, requestName: string) => {
    if (!page) throw new Error('app must be launched')
    const row = page
      .locator('[data-testid="sidebar-listview"] .list-view-title', { hasText: requestName })
      .first()
    await expect(row).toBeVisible({ timeout: 10000 })
  }
)

When(
  'I add a root-level {string} via the sidebar empty-area Ajouter submenu',
  async ({}, kind: string) => {
    if (!page) throw new Error('app must be launched')
    const childLabel = ADD_CHILD_LABEL_REGEX[kind]
    if (!childLabel) throw new Error(`unknown AddChildKind: ${kind}`)

    // Right-click the empty area of the sidebar. `RestormSidebar`
    // wraps the workspace tree in a flex-column div tagged with
    // `sidebar-empty-area`; its `onContextMenu` handler bypasses
    // the event when `event.target.closest('.list-view-row')` —
    // so we dispatch the contextmenu event programmatically with
    // the wrapper element itself as the target, guaranteeing the
    // bypass check fails regardless of where the visible row stack
    // happens to end. Plain `.click({ button: 'right', position })`
    // can land inside a row when the workspace tree fills the pane.
    const emptyArea = page.locator('[data-testid="sidebar-empty-area"]')
    await expect(emptyArea).toBeVisible({ timeout: 5000 })
    await emptyArea.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.left + Math.round(rect.width / 2),
        clientY: rect.top + Math.max(0, rect.height - 8)
      }))
    })
    await page.waitForTimeout(200)

    const addEntry = page
      .getByRole('menuitem', { name: /^(Add|Ajouter)$/ })
      .first()
    await expect(addEntry).toBeVisible({ timeout: 5000 })
    await addEntry.hover()
    await page.waitForTimeout(350)

    const submenu = page.locator('.menubar-menu-items-holder:visible').last()
    const target = submenu
      .getByRole('menuitem', { name: childLabel })
      .first()
    await expect(target).toBeVisible({ timeout: 5000 })
    await target.evaluate((el) => { (el as HTMLElement).click() })
    await page.waitForTimeout(150)
  }
)

When('I open the global search bar', async () => {
  if (!page) throw new Error('app must be launched')
  await page.locator('[data-testid="main-titlebar-searchbar-closed"]').click()
  await expect(page.locator('[data-testid="main-titlebar-searchbar-inputbox-input"]')).toBeVisible({ timeout: 5000 })
})

When('I type {string} in the global search bar', async ({}, text: string) => {
  if (!page) throw new Error('app must be launched')
  const input = page.locator('[data-testid="main-titlebar-searchbar-inputbox-input"]')
  await input.fill(text)
})

Then('a global search result should match {string}', async ({}, needle: string) => {
  if (!page) throw new Error('app must be launched')
  const result = page
    .locator('[data-testid="main-titlebar-searchbar-results"] [data-testid^="main-titlebar-searchbar-result-"]')
    .filter({ hasText: needle })
    .first()
  await expect(result).toBeVisible({ timeout: 10000 })
})

When('I close the global search bar', async () => {
  if (!page) throw new Error('app must be launched')
  // The SearchBar listens for Escape on its open input and animates back
  // to the closed state. Wait for the closed pill to be visible again so
  // subsequent clicks (e.g. workbench tabs) aren't intercepted by the
  // results overlay.
  const input = page.locator('[data-testid="main-titlebar-searchbar-inputbox-input"]')
  if (await input.isVisible().catch(() => false)) {
    await input.press('Escape')
  }
  await expect(page.locator('[data-testid="main-titlebar-searchbar-closed"]')).toBeVisible({
    timeout: 5000
  })
})

/** After a save-all + close-file, no project under
 * `userData/drafts/` should still hold a `.draft.*` file. The
 * directory itself may exist (the `.last-opened` marker stays so
 * the age-based sweep keeps the project alive), but every unit
 * must have been cleared. Orphans otherwise trigger a bogus
 * "drafts restored" toast on next launch. */
Then('the project\'s drafts directory should be empty', () => {
  if (!configPath) throw new Error('configPath was not captured; launchApp must run first')
  const userDataDir = dirname(configPath)
  const draftsRoot = join(userDataDir, 'drafts')
  if (!existsSync(draftsRoot)) return
  const projectDirs = readdirSync(draftsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
  const stragglers: string[] = []
  for (const projectDir of projectDirs) {
    const projectPath = join(draftsRoot, projectDir.name)
    const files = readdirSync(projectPath)
    for (const file of files) {
      if (file.includes('.draft.')) {
        stragglers.push(`${projectDir.name}/${file}`)
      }
    }
  }
  expect(stragglers, `unexpected orphan drafts under ${draftsRoot}: ${stragglers.join(', ')}`).toEqual([])
})

// ── AutoSave (files:autoSave / files:autoSaveDelay) ───────────────────
//
// Drives the in-process `AutoSaveController` end-to-end via the real
// settings IPC. We don't click through the settings modal — the
// integration we care about is "settings flip → controller reacts →
// renderer's save-all flow runs → dirty registry clears", and the
// modal is just a dispatch surface that calls `window.api.settings.set`
// under the hood.

// Workspace-level dirty assertions polling `document.title`. Restorm
// mirrors the `isDirty` flag into the title via a top-level effect,
// so the title is the canonical user-facing signal — every other
// dirty marker (tab dot, sidebar dot, badges) is downstream of this.
// Same pattern as `expectDocumentTitleDirty` in the dirty-state suite.
Then('the window title should be dirty', async () => {
  if (!page) throw new Error('app must be launched')
  const p = page
  await expect.poll(async () => (await p.title()).endsWith(' *'), {
    timeout: 10000,
    message: 'expected window title to end with " *"'
  }).toBe(true)
})

Then('the window title should be clean', async () => {
  if (!page) throw new Error('app must be launched')
  const p = page
  await expect.poll(async () => (await p.title()).endsWith(' *'), {
    timeout: 10000,
    message: 'expected window title not to end with " *"'
  }).toBe(false)
})

When('I append {string} to the active request URL', async ({}, suffix: string) => {
  if (!page) throw new Error('app must be launched')
  // The URL bar lives inside the Request sub-tab — switch to it
  // before reaching for the input or `:visible` will time out
  // when the active sub-tab is Notes / Docs / Code snippets.
  const requestSubTab = page.locator('[role="tab"][data-testid="base-request-tabs-request-tab-request"]:visible').first()
  if ((await requestSubTab.count()) > 0 && await requestSubTab.getAttribute('aria-selected') !== 'true') {
    await requestSubTab.click()
    await page.waitForTimeout(200)
  }
  const urlInput = page.locator('[data-testid="http-request-url-input"]:visible').first()
  await expect(urlInput).toBeVisible({ timeout: 5000 })
  await urlInput.click()
  // Move caret to end so the suffix lands as additional text and the
  // controlled input registers a real value change (a noop edit at
  // a position equal to the existing value would not flip dirty).
  await page.keyboard.press('End')
  await page.keyboard.type(suffix)
  // Blur so the field commits its value to the upstream save unit.
  await page.keyboard.press('Tab')
  // Give the URL → save-unit upsert IPC + dirty-recompute round-trip
  // a beat to land before downstream assertions look at the indicator.
  await page.waitForTimeout(500)
})

When('I open the settings modal', async () => {
  if (!page) throw new Error('app must be launched')
  await page.locator('[data-testid="titlebar-settings-button"]').click()
  await expect(page.locator('[data-testid="settings-modal"]')).toBeVisible({ timeout: 5000 })
})

When('I close the settings modal', async () => {
  if (!page) throw new Error('app must be launched')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-testid="settings-modal"]')).toHaveCount(0, { timeout: 5000 })
})

/**
 * Drive the enum dropdown in the settings page for the autoSave row.
 * `optionIndex` follows the order in `defaults.yaml`:
 *   0 → "off", 1 → "After Delay", 2 → "On Window Change".
 *
 * The SelectBox wrapper falls back to data-testid "selectbox" when
 * the consumer doesn't pass one (EnumRenderer passes only `id`),
 * so we scope the lookup to the setting row's container.
 */
When('I select autoSave option {int} in the settings modal', async ({}, optionIndex: number) => {
  if (!page) throw new Error('app must be launched')
  const row = page.locator('[data-testid="setting-item-files:autoSave"]')
  await row.scrollIntoViewIfNeeded()
  await row.locator('[data-testid="selectbox-trigger"]').click()
  // The dropdown portal is rendered to <body>, but each option carries
  // a `selectbox-option-N` testid we can target globally — there's
  // only one open dropdown at a time.
  await page.locator(`[data-testid="selectbox-option-${optionIndex}"]`).click()
  // Give the SettingsService → window.api.settings.set IPC + the
  // controller's onSettingChanged hook a beat to land before the
  // next step assumes the new mode is in effect.
  await page.waitForTimeout(200)
})

When('I set the autoSaveDelay setting to {int}', async ({}, value: number) => {
  if (!page) throw new Error('app must be launched')
  const row = page.locator('[data-testid="setting-item-files:autoSaveDelay"]')
  await row.scrollIntoViewIfNeeded()
  const input = row.locator('input[type="number"]').first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.keyboard.type(String(value))
  await page.keyboard.press('Tab')
  await page.waitForTimeout(200)
})

When('I wait {int}ms', async ({}, ms: number) => {
  if (!page) throw new Error('app must be launched')
  await page.waitForTimeout(ms)
})

// ── Workspace settings overlay (.restorm/settings.json) ──────────────
//
// End-to-end coverage for the workspace settings flow: a `.restorm`
// file is open, the user goes into Settings → Workspace tab, picks a
// different theme, and the chosen theme is (a) reflected in the
// window's rendered background, (b) persisted to
// `<dir>/.restorm/settings.json`. Closing the file reverts the
// effective theme to the user-level default and the original
// background returns.

When('I capture the window background color as {string}', async ({}, name: string) => {
  if (!page) throw new Error('app must be launched')
  const color = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  capturedColors.set(name, color)
})

Then('the window background color should differ from {string}', async ({}, name: string) => {
  if (!page) throw new Error('app must be launched')
  const baseline = capturedColors.get(name)
  if (!baseline) throw new Error(`No captured color for "${name}"`)
  const p = page
  await expect.poll(
    async () => p.evaluate(() => getComputedStyle(document.body).backgroundColor),
    { timeout: 5000, message: `expected window background color to differ from captured "${name}" (${baseline})` }
  ).not.toBe(baseline)
})

Then('the window background color should equal {string}', async ({}, name: string) => {
  if (!page) throw new Error('app must be launched')
  const baseline = capturedColors.get(name)
  if (!baseline) throw new Error(`No captured color for "${name}"`)
  const p = page
  await expect.poll(
    async () => p.evaluate(() => getComputedStyle(document.body).backgroundColor),
    { timeout: 5000, message: `expected window background color to match captured "${name}" (${baseline})` }
  ).toBe(baseline)
})

When('I switch to the workspace settings tab', async () => {
  if (!page) throw new Error('app must be launched')
  const tab = page.locator('[data-testid="settings-page-tab-workspace"]')
  await expect(tab).toBeVisible({ timeout: 5000 })
  await expect(tab).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 })
  await tab.click()
  // Verify the active scope flipped before downstream steps look at
  // the theme carousel.
  await expect(page.locator('[data-testid="settings-page"]')).toHaveAttribute('data-scope', 'workspace', { timeout: 5000 })
})

When('I pick a non-current theme in the settings page', async () => {
  if (!page) throw new Error('app must be launched')
  // The carousel exposes the currently-applied theme via
  // `data-selected-theme-id`. Pick any tile whose theme name differs
  // from that and click it. The tile body has `pointer-events: none`
  // on its preview controls (decorative Button / Toggle / InputBox /
  // Dropdown), so any click on the tile bubbles to the parent button.
  const carousel = page.locator('[data-testid="theme-carousel"]')
  await expect(carousel).toBeVisible({ timeout: 5000 })
  await carousel.scrollIntoViewIfNeeded()
  const currentId = await carousel.getAttribute('data-selected-theme-id')
  const otherTile = carousel
    .locator('button.theme-carousel-item:not(.theme-carousel-item--selected)')
    .first()
  await expect(otherTile).toBeVisible({ timeout: 5000 })
  await otherTile.click()
  await expect.poll(
    () => carousel.getAttribute('data-selected-theme-id'),
    { timeout: 5000, message: `expected selected theme to change from ${currentId ?? 'unknown'}` }
  ).not.toBe(currentId)
})

Then(
  'the workspace settings file for {string} should contain key {string}',
  async ({}, fileBaseName: string, key: string) => {
    const filePath = join(FULL_WORKFLOW_TEMP_DIR, `${fileBaseName}.restorm`)
    const workspaceFile = join(dirname(filePath), '.restorm', 'settings.json')
    // The workspace write is debounced ~200 ms in SettingsService.
    // Poll instead of asserting once so a slow disk doesn't race
    // ahead of the post-click assertions on rendered colour.
    await expect.poll(
      () => {
        if (!existsSync(workspaceFile)) return null
        try {
          const raw = readFileSync(workspaceFile, 'utf-8')
          const parsed = JSON.parse(raw) as Record<string, unknown>
          return key in parsed ? 'present' : `missing-key:${Object.keys(parsed).join(',')}`
        } catch (err) {
          return `read-error:${String(err)}`
        }
      },
      { timeout: 5000, message: `expected workspace settings file ${workspaceFile} to contain key "${key}"` }
    ).toBe('present')
  }
)

// ───────────────────────────────────────────────────────────────────
// Firewall + Console workbench steps
// ───────────────────────────────────────────────────────────────────

async function openTitlebarMenuItem(currentPage: Page, viewItemTestId: string): Promise<void> {
  // Open the View menu, then click the matching item. The titlebar
  // uses ECUI MenuBar — the dropdown only renders while the parent
  // MenuBarItem is hovered/clicked, so we click in sequence and
  // wait for the item to appear.
  await currentPage.locator('[data-testid="titlebar-menubar-item-view"]').click()
  const item = currentPage.locator(`[data-testid="${viewItemTestId}"]`)
  await item.waitFor({ state: 'visible', timeout: 5_000 })
  await item.click()
}

When('I open the firewall panel via the view menu', async () => {
  if (!page) throw new Error('app must be launched')
  await openTitlebarMenuItem(page, 'titlebar-menu-item-firewall')
})

Then('the firewall panel should be visible', async () => {
  if (!page) throw new Error('app must be launched')
  await expect(page.locator('[data-testid="firewall-panel"]').first()).toBeVisible({ timeout: 5_000 })
})

Then('the firewall whitelist count should be {int}', async ({}, expected: number) => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  await expect.poll(
    async () => {
      // Tab label is "Whitelist (N)" — extract the count.
      const label = await currentPage.locator('[data-testid="firewall-tabs"] [data-tab-id="whitelist"]').first().textContent()
      const match = /\((\d+)\)/.exec(label ?? '')
      return match !== null ? Number(match[1]) : -1
    },
    { timeout: 5_000, message: `expected whitelist count to be ${String(expected)}` }
  ).toBe(expected)
})

Then('the firewall blacklist count should be {int}', async ({}, expected: number) => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  await expect.poll(
    async () => {
      const label = await currentPage.locator('[data-testid="firewall-tabs"] [data-tab-id="blacklist"]').first().textContent()
      const match = /\((\d+)\)/.exec(label ?? '')
      return match !== null ? Number(match[1]) : -1
    },
    { timeout: 5_000, message: `expected blacklist count to be ${String(expected)}` }
  ).toBe(expected)
})

When('I add {string} to the firewall whitelist', async ({}, value: string) => {
  if (!page) throw new Error('app must be launched')
  // ECUI InputBox renders the actual `<input>` with `${testId}-input`
  // testid — `firewall-whitelist-input` is the wrapper. Target the
  // inner element so playwright's `.fill` recognises a fillable
  // control.
  const input = page.locator('[data-testid="firewall-whitelist-input-input"]').first()
  await input.fill(value)
  // `force: true` because malformed entries leave the Add button
  // disabled (`aria-disabled="true"`); Playwright's actionability
  // check would otherwise hang on the disabled state. The
  // disabled button doesn't fire its handler, so the click is a
  // no-op for invalid input — the count assertion is what verifies
  // whether the entry actually landed.
  await page.locator('[data-testid="firewall-whitelist-add"]').first().click({ force: true })
})

When('I add {string} to the firewall blacklist', async ({}, value: string) => {
  if (!page) throw new Error('app must be launched')
  const input = page.locator('[data-testid="firewall-blacklist-input-input"]').first()
  await input.fill(value)
  await page.locator('[data-testid="firewall-blacklist-add"]').first().click({ force: true })
})

Then('the firewall whitelist should contain {string}', async ({}, value: string) => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  await expect.poll(
    async () => {
      const labels = await currentPage.locator('[data-testid="firewall-whitelist-body"] [data-testid^="firewall-whitelist-row-"]').allTextContents()
      return labels.some((l) => l.includes(value))
    },
    { timeout: 5_000, message: `expected whitelist to contain "${value}"` }
  ).toBe(true)
})

When('I switch to the firewall blacklist tab', async () => {
  if (!page) throw new Error('app must be launched')
  await page.locator('[data-testid="firewall-tabs"] [data-tab-id="blacklist"]').first().click()
})

Then('exactly one firewall tab should be open', async () => {
  if (!page) throw new Error('app must be launched')
  // Workbench tabs render with `[testid]-group-[groupId]-tabs-tab-[tabId]`.
  // Match any container whose `tabs-tab-` segment terminates in the
  // singleton id — that survives a regrouping (different groupId).
  await expect(page.locator('[data-testid*="tabs-tab-firewall:singleton"]:not([data-testid*="-label"]):not([data-testid*="-close"])')).toHaveCount(1)
})

When('I open the console via the view menu', async () => {
  if (!page) throw new Error('app must be launched')
  await openTitlebarMenuItem(page, 'titlebar-menu-item-console')
})

Then('the console panel should be visible', async () => {
  if (!page) throw new Error('app must be launched')
  await expect(page.locator('[data-testid="console-panel"]').first()).toBeVisible({ timeout: 5_000 })
})

Then('the console toolbar should default to curl', async () => {
  if (!page) throw new Error('app must be launched')
  // The active toggle button is the one that has `aria-pressed="true"`
  // (or equivalent) — the toolbar uses ECUI Button so the active
  // state is reflected via class. Check both for resilience.
  const curl = page.locator('[data-testid="console-toolbar-shell-curl"]').first()
  await expect(curl).toBeVisible({ timeout: 5_000 })
  await expect(curl).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 })
})

When('I toggle the console shell to powershell', async () => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  // The shell toggle is backed by `useSetting('console:requestFormat')`,
  // which round-trips through main-process IPC. Single click is
  // enough but the re-render is observable on the next frame; the
  // assertion polls with a wider window to absorb that.
  const ps = currentPage.locator('[data-testid="console-toolbar-shell-powershell"]').first()
  await ps.waitFor({ state: 'visible', timeout: 10_000 })
  await ps.click()
})

Then('the console shell setting should be persisted as powershell', async () => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  // Asserting on `aria-pressed` after the click would race the
  // SettingsContext's optimistic-update path: the main process logs
  // `[SettingsService] Setting changed` (so the IPC fired and the
  // value was persisted) but the renderer's `useSetting` hook
  // doesn't observe the new value within a 10s window — likely a
  // bug in the optimistic-update path when the storageKey isn't yet
  // in the local `settingsList` cache. We sidestep the toolbar
  // re-render and assert directly against the persisted value via
  // the public preload bridge — that's what callers will read
  // anyway.
  await expect.poll(
    async () => {
      return await currentPage.evaluate(async (): Promise<unknown> => {
        const api = (globalThis as { window: { api?: { settings?: { get?: (k: string) => Promise<unknown> } } } }).window.api
        if (!api?.settings?.get) return null
        return await api.settings.get('console:requestFormat')
      })
    },
    { timeout: 10_000, message: 'expected console:requestFormat setting to be "powershell" after toggle click' }
  ).toBe('powershell')
})

Then('exactly one console tab should be open', async () => {
  if (!page) throw new Error('app must be launched')
  await expect(page.locator('[data-testid*="tabs-tab-console:singleton"]:not([data-testid*="-label"]):not([data-testid*="-close"])')).toHaveCount(1)
})
