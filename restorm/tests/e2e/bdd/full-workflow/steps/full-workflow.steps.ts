import { createBdd } from 'playwright-bdd'
import { existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E, configureNextSaveFileDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, readSavedMainBounds, FULL_WORKFLOW_TEMP_DIR, currentElectronApp } from '../../fixtures/full-workflow.fixture'

/** Absolute path to the repo's shared e2e sample directory (tests/unit). */
const SAMPLES_DIR = resolve(__dirname, '../../../../unit')

const { Given, When, Then } = createBdd(test)

const SEED_WIDTH = 1000
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

  // Snapshot the app's final state before we tear down the window, unless
  // a previous step (e.g. the yellow-tag verification) already recorded
  // the scenario's "final screenshot" — we don't want to overwrite it.
  if (page) {
    try {
      const testInfo = test.info()
      mkdirSync(testInfo.outputDir, { recursive: true })
      const shotPath = join(testInfo.outputDir, 'end-state.png')
      if (!existsSync(shotPath)) {
        await page.screenshot({ path: shotPath, fullPage: true })
        await testInfo.attach('end-state-screenshot', { path: shotPath, contentType: 'image/png' })
      }
    } catch {
      // Best-effort — never fail the scenario on screenshot issues.
    }
  }

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
  await expect(page.locator('.welcome-container')).toBeVisible({ timeout: 10000 })
})

Then('the welcome screen should be visible', async () => {
  if (!page) throw new Error('app must be launched')
  await expect(page.locator('.welcome-container')).toBeVisible({ timeout: 5000 })
})

Then('the welcome screen should not be visible', async () => {
  if (!page) throw new Error('app must be launched')
  await expect(page.locator('.welcome-container')).not.toBeVisible({ timeout: 10000 })
})

function welcomeItemByName(
  currentPage: Page,
  section: 'recent' | 'favorites',
  fileName: string
): Locator {
  const sectionHeading = section === 'recent'
    ? currentPage.locator('.welcome-section', { hasText: 'Recent' })
    : currentPage.locator('.welcome-section', { hasText: 'Favorites' })
  return sectionHeading.locator('.welcome-file-item', { hasText: fileName }).first()
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
    await row.locator('[data-testid="toggle-favorite-button"]').click()
  }
)

When(
  'I unfavorite the welcome favorite {string}',
  async ({}, fileName: string) => {
    if (!page) throw new Error('app must be launched')
    const row = welcomeItemByName(page, 'favorites', fileName)
    await expect(row).toBeVisible({ timeout: 5000 })
    await row.locator('[data-testid="remove-favorite-button"]').click()
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
    const dropdown = page.locator('[data-testid="environment-dropdown-button"]').first()
    await expect(dropdown).toBeVisible({ timeout: 5000 })
    await dropdown.click()
    const item = page.locator(`text="${envName}"`).first()
    await expect(item).toBeVisible({ timeout: 5000 })
    await item.click()
    // Wait for the dropdown to close and the selection to settle.
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
      await plainInput.click()
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Delete')
      await page.keyboard.type(value)
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
  const docsViewer = page
    .locator('[data-testid^="folder-view-"][data-testid$="-markdown-viewer-docs"]')
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
    await input.fill(newName)
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
  await keyInput.click()
  await keyInput.fill(key)
  await currentPage.keyboard.press('Tab')
}

async function transformLastRowTo(currentPage: Page, typeMenuTestId: string): Promise<void> {
  const rows = currentPage.locator('[data-testid="environment-folder-variables-table"] tbody tr')
  const lastRow = rows.last()
  // The RestormKeyValueTable attaches `onContextMenu` to the wrapping div
  // around the value cell renderer, not the <input> itself. Right-click
  // the value <td> so the handler is on the event's currentTarget chain.
  const valueTd = lastRow.locator('td').nth(3)
  await valueTd.click({ button: 'right', force: true })
  // Type-transform entries are now rendered directly at the top level of
  // the context menu — no more "Transform to" submenu hover. Target the
  // JSX context menu explicitly via its data-testid; Monaco renders its
  // own contextMenuItems flyout with the same labels and would otherwise
  // collide with the JSX menu.
  const target = currentPage.locator(`[data-testid="${typeMenuTestId}"]`).first()
  await expect(target).toBeVisible({ timeout: 5000 })
  await target.click()
  await currentPage.waitForTimeout(200)
}

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
          .locator('[data-testid^="tab-env-folder-idx:"][data-testid$="-tags"] .ecui-tag', { hasText: tagName })
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor)
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
          .locator('[data-testid^="tab-request-idx:"][data-testid$="-tags"] .ecui-tag', { hasText: tagName })
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor)
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
    const folderPath = await page.evaluate((name) => {
      const helpers = (window as unknown as {
        __restormTestHelpers?: { findItemIndexPath?: (names: string[]) => number[] | null }
      }).__restormTestHelpers
      return helpers?.findItemIndexPath?.([name]) ?? null
    }, folderName)
    const requestPath = await page.evaluate(
      ([f, c, r]) => {
        const helpers = (window as unknown as {
          __restormTestHelpers?: { findItemIndexPath?: (names: string[]) => number[] | null }
        }).__restormTestHelpers
        return helpers?.findItemIndexPath?.([f, c, r]) ?? null
      },
      [folderName, childFolderName, requestName] as const
    )
    if (!folderPath) throw new Error(`could not resolve index path for folder "${folderName}"`)
    if (!requestPath) {
      throw new Error(
        `could not resolve index path for "${folderName}" > "${childFolderName}" > "${requestName}"`
      )
    }
    recordedFolderTabId = `env-folder-idx:${folderPath.join('.')}`
    recordedRequestTabId = `request-idx:${requestPath.join('.')}`
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
    const storageKey = `workbench_state_restorm-main-workbench:${filePath}`
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
    // The workbench keeps every tab's content panel mounted (hidden
    // panels stay in the DOM with display:none), so a plain `.first()`
    // selector on the env dropdown picks the leftmost mounted panel
    // instead of the visible one. Filter for visibility so we only
    // assert the dropdown the user can actually see.
    const dropdown = page.locator('[data-testid="environment-dropdown-button"]:visible').first()
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

When('I set the folder tab icon to codicon {string}', async ({}, iconName: string) => {
  if (!page) throw new Error('app must be launched')
  // Active folder tab's pane: role="tabpanel" is what wraps the tab content.
  // The breadcrumb IconSelect trigger sits at the top of the pane.
  const iconTrigger = page.locator('.ecui-breadcrumb-icon-select [role="button"]').first()
  await expect(iconTrigger).toBeVisible({ timeout: 5000 })
  await iconTrigger.click()
  await page.waitForSelector('.ecui-icon-select-picker', { timeout: 5000 })
  const codiconTabButton = page.locator('.ecui-icon-select-tabs [role="button"]').nth(1)
  await codiconTabButton.click()
  await page.waitForTimeout(200)
  const search = page.locator('.ecui-icon-select-picker input').first()
  await search.fill(iconName)
  await page.waitForTimeout(500)
  const firstResult = page.locator(`[data-icon-type="codicon"][data-icon-name="${iconName}"]`).first()
  await expect(firstResult).toBeVisible({ timeout: 5000 })
  await firstResult.click()
  await page.waitForTimeout(500)
})

Then('the folder tab breadcrumb icon should be {string}', async ({}, iconName: string) => {
  if (!page) throw new Error('app must be launched')
  const icon = page.locator(`.ecui-breadcrumb .codicon-${iconName}`).first()
  await expect(icon).toBeVisible({ timeout: 5000 })
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
 * so target the TagsView via the "add" button in the active folder tab's
 * header. Only one folder tab is ever active at a time in this scenario.
 */
function activeFolderTagsRoot(currentPage: Page): Locator {
  return currentPage.locator('[data-testid^="tab-env-folder-idx:"][data-testid$="-tags"]').first()
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

When('I snapshot the current window as the final screenshot', async () => {
  if (!page) throw new Error('app must be launched')
  const testInfo = test.info()
  mkdirSync(testInfo.outputDir, { recursive: true })
  const shotPath = join(testInfo.outputDir, 'end-state.png')
  await page.screenshot({ path: shotPath, fullPage: true })
  await testInfo.attach('end-state-screenshot', { path: shotPath, contentType: 'image/png' })
})

When('I add tag {string} to the active folder tab', async ({}, tagName: string) => {
  if (!page) throw new Error('app must be launched')
  const tagsRoot = activeFolderTagsRoot(page)
  await expect(tagsRoot).toBeVisible({ timeout: 5000 })
  const addButton = tagsRoot.locator('[data-testid$="-tags-add"]').first()
  await addButton.click()

  // The new tag enters edit mode via a contentEditable span.
  const editing = tagsRoot.locator('.ecui-tag.ecui-tag--editing [contenteditable="true"]').first()
  await expect(editing).toBeVisible({ timeout: 5000 })
  await editing.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type(tagName)
  await page.keyboard.press('Enter')
  await expect(
    tagsRoot.locator('.ecui-tag', { hasText: tagName }).first()
  ).toBeVisible({ timeout: 5000 })
})

Then('the active folder tab should have tag {string}', async ({}, tagName: string) => {
  if (!page) throw new Error('app must be launched')
  const tagsRoot = activeFolderTagsRoot(page)
  await expect(
    tagsRoot.locator('.ecui-tag', { hasText: tagName }).first()
  ).toBeVisible({ timeout: 5000 })
})

Then('the active folder tab should not have tag {string}', async ({}, tagName: string) => {
  if (!page) throw new Error('app must be launched')
  const tagsRoot = activeFolderTagsRoot(page)
  await expect(
    tagsRoot.locator('.ecui-tag', { hasText: tagName })
  ).toHaveCount(0, { timeout: 5000 })
})

When('I remove tag {string} from the active folder tab', async ({}, tagName: string) => {
  if (!page) throw new Error('app must be launched')
  const tagsRoot = activeFolderTagsRoot(page)
  const tag = tagsRoot.locator('.ecui-tag', { hasText: tagName }).first()
  await expect(tag).toBeVisible({ timeout: 5000 })
  await tag.click({ button: 'right' })
  // The context menu may also surface "Remove tag color" (when the tag
  // carries a color). Match "Remove tag" *without* a trailing "color"
  // so the wrong item isn't clicked.
  const removeItem = page
    .getByRole('menuitem', { name: /^(Remove tag|Supprimer le tag)$/ })
    .first()
  await expect(removeItem).toBeVisible({ timeout: 5000 })
  await removeItem.click()
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

Then('the file\'s dirty-state should be: {word}', async ({}, state: string) => {
  if (!page) throw new Error('app must be launched')
  const currentPage = page
  if (state === 'dirty') {
    await expect.poll(
      async () => currentPage.title(),
      { message: 'expected title to end with " *"', timeout: 10000 }
    ).toMatch(/ \*$/)
  } else if (state === 'clean') {
    await expect.poll(
      async () => currentPage.title(),
      { message: 'expected title not to end with " *"', timeout: 10000 }
    ).not.toMatch(/ \*$/)
  } else {
    throw new Error(`unknown dirty-state "${state}" (expected "clean" or "dirty")`)
  }
})

When('I save the file with Ctrl+S', async () => {
  if (!page) throw new Error('app must be launched')
  // Dismiss any lingering context menu that might swallow the keystroke
  // before dispatching Ctrl+S.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+s')
  // Give FileService a beat to flush the commitChecksums → dirty=false cascade.
  await page.waitForTimeout(500)
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
