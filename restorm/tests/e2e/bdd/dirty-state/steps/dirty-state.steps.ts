import { createBdd } from 'playwright-bdd'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E, configureNextSaveFileDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, DIRTY_STATE_TEMP_DIR, currentElectronApp } from '../../fixtures/dirty-state.fixture'

const SAMPLES_DIR = resolve(__dirname, '../../../../unit')
const PETSTORE_SAMPLE = join(SAMPLES_DIR, 'swagger-petstore.json')

const { Given, When, Then } = createBdd(test)

// Module-level handles populated by the `Given` step so every step that
// follows can reach the current Electron + renderer pair.
let electronApp: ElectronApplication | null = null
let page: Page | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function requireApp(): ElectronApplication {
  if (!electronApp) throw new Error('app must be launched before configuring dialogs')
  return electronApp
}

/**
 * Locate a workbench tab by its exact label text. We match on a nested
 * element with `getByText(name, { exact: true })` rather than on the
 * `.label-name` wrapper — the wrapper's `textContent` includes the
 * method badge (e.g. "GET") concatenated with the name, which an
 * anchored regex can't match. `getByText(exact)` finds the inner name
 * span directly.
 */
function tabByName(currentPage: Page, name: string): Locator {
  return currentPage
    .locator('.tab[role="tab"]')
    .filter({ has: currentPage.getByText(name, { exact: true }) })
    .first()
}

// ── Given / setup ─────────────────────────────────────────────────────

Given(
  'a new single-file YAML collection named {string}',
  async ({ launchApp }, baseName: string) => {
    const launched = await launchApp()
    electronApp = launched.app
    page = launched.page

    const filePath = join(DIRTY_STATE_TEMP_DIR, `${baseName}.restorm`)
    await configureNextSaveFileDialogForE2E(electronApp, { kind: 'saveFile', path: filePath })

    await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
    await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

    const modal = page.locator('[data-testid="save-options-modal"]')
    await expect(modal).toBeVisible({ timeout: 5000 })
    await page.locator('[data-testid="save-mode-file"]').click()
    await page.locator('[data-testid="save-format-yaml"]').click()
    await page.locator('[data-testid="save-confirm-button"]').click()

    await expect(async () => {
      expect(existsSync(filePath)).toBe(true)
    }).toPass({ timeout: 10000 })
    await expect(modal).not.toBeVisible({ timeout: 5000 })
    // Give the registry its breath after first-save → file-opened → hydrate.
    await page.waitForTimeout(500)
  }
)

Given(
  'a new folder YAML collection named {string}',
  async ({ launchApp }, baseName: string) => {
    const launched = await launchApp()
    electronApp = launched.app
    page = launched.page

    const folderPath = join(DIRTY_STATE_TEMP_DIR, baseName)
    await configureNextOpenDialogForE2E(electronApp, { kind: 'openFolder', path: folderPath })

    await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
    await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

    const modal = page.locator('[data-testid="save-options-modal"]')
    await expect(modal).toBeVisible({ timeout: 5000 })
    await page.locator('[data-testid="save-mode-folder"]').click()
    await page.locator('[data-testid="save-format-yaml"]').click()
    await page.locator('[data-testid="save-confirm-button"]').click()

    await expect(async () => {
      expect(existsSync(folderPath)).toBe(true)
    }).toPass({ timeout: 10000 })
    await expect(modal).not.toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(500)
  }
)

// ── Import ────────────────────────────────────────────────────────────

When('I import the Petstore sample', async () => {
  const p = requirePage()
  expect(existsSync(PETSTORE_SAMPLE), `sample must exist: ${PETSTORE_SAMPLE}`).toBe(true)

  await p.keyboard.press('Control+I')
  const modal = p.locator('[data-testid="import-modal"]')
  await expect(modal).toBeVisible({ timeout: 10000 })

  const input = modal.locator('textarea, input[type="text"]').first()
  await input.fill(PETSTORE_SAMPLE)
  await expect(modal.locator('.import-preview-section')).toBeVisible({ timeout: 15000 })

  const importButton = modal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 15000 })
  await importButton.click()
  await expect(modal).not.toBeVisible({ timeout: 10000 })

  // Close any tab the import auto-opened so the first assertions don't
  // race against focus-stealing tabs created by the import pipeline.
  await p.waitForTimeout(500)
  const activeTab = p.locator('.tab[role="tab"][aria-selected="true"]').first()
  if (await activeTab.count() > 0 && await activeTab.isVisible()) {
    const closeBtn = activeTab.locator('button[aria-label="Close"]').first()
    if (await closeBtn.count() > 0) await closeBtn.click()
  }
  // The auto-save-on-import effect fires on the next commit. Wait for
  // the tree to settle (reactive proxies sometimes fire late updates
  // from tab lifecycle hooks), then issue a defensive Ctrl+Shift+S and
  // poll until the window title reports clean. A user who imports
  // without manually saving should eventually see a clean window.
  await p.waitForTimeout(2500)
  await p.keyboard.press('Escape')
  await p.keyboard.press('Control+Shift+s')
  await expect.poll(async () => (await p.title()).endsWith(' *'), {
    timeout: 10000,
    message: 'expected window to settle clean after import + auto-save'
  }).toBe(false)
})

// ── Tab opening ───────────────────────────────────────────────────────

When('I open the env folder {string} in a tab', async ({}, folderName: string) => {
  const p = requirePage()
  const row = p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(folderName, { exact: true }) })
    .first()
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await expect(tabByName(p, folderName)).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(300)
})

When('I open the folder {string} in a tab', async ({}, folderName: string) => {
  const p = requirePage()
  const row = p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(folderName, { exact: true }) })
    .first()
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await expect(tabByName(p, folderName)).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(300)
})

When('I open the request {string} in a tab', async ({}, requestName: string) => {
  const p = requirePage()
  const row = p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(requestName, { exact: true }) })
    .first()
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await expect(tabByName(p, requestName)).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(300)
})

When('I activate the tab {string}', async ({}, tabName: string) => {
  const p = requirePage()
  const tab = tabByName(p, tabName)
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5000 })
  await p.waitForTimeout(300)
})

// ── Editing helpers ───────────────────────────────────────────────────

/**
 * Folder + request views default to the Docs sub-tab when documentation
 * is present (imports populate it). Ensure the Notes sub-tab is active
 * before asserting against the notes editor.
 */
async function activateNotesSubTab(p: Page): Promise<void> {
  // Multiple folder views may live in the DOM at once (each workbench
  // tab mounts its own). Scope to currently-visible notes sub-tabs so
  // we click the one belonging to the active workbench tab.
  const notesSubTab = p
    .locator('[role="tab"][data-tab-id="notes"]:visible')
    .first()
  if ((await notesSubTab.count()) === 0) return
  const alreadyActive = await notesSubTab.getAttribute('aria-selected')
  if (alreadyActive === 'true') return
  await notesSubTab.click()
  await p.waitForTimeout(300)
}

When('I type {string} in the notes editor', async ({}, text: string) => {
  const p = requirePage()
  await activateNotesSubTab(p)
  const editor = p.locator('[data-testid$="-markdown-editor-notes-editor"]:visible').first()
  await expect(editor).toBeVisible({ timeout: 5000 })
  // The markdown editor is a Milkdown ProseMirror instance: the clickable
  // hit region and the actual contenteditable differ. Click both so the
  // focus lands inside the editable area.
  await editor.click()
  const contentEditable = editor.locator('[contenteditable="true"]').first()
  if (await contentEditable.count() > 0) {
    await contentEditable.click()
  }
  await p.keyboard.type(text)
  // Blur so the reactive proxy's 50ms debounce kicks in and fires the
  // FOLDER_UPDATED / REQUEST_UPDATED event. Then give the full
  // renderer → main → registry → renderer loop enough time to land
  // (debounce + two IPC hops + React commit).
  await p.mouse.click(5, 5)
  await p.waitForTimeout(1200)
})

When('I clear the notes editor', async () => {
  const p = requirePage()
  await activateNotesSubTab(p)
  const editor = p.locator('[data-testid$="-markdown-editor-notes-editor"]:visible').first()
  await expect(editor).toBeVisible({ timeout: 5000 })
  await editor.click()
  const contentEditable = editor.locator('[contenteditable="true"]').first()
  if (await contentEditable.count() > 0) {
    await contentEditable.click()
  }
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.mouse.click(5, 5)
  await p.waitForTimeout(1200)
})

When(
  'I edit the first env folder variable value to {string}',
  async ({}, newValue: string) => {
    const p = requirePage()
    // Env folder view defaults to the "Home" landing page, or "Notes"
    // if we just typed there. The variables table lives on the
    // "Configuration" sub-tab — switch there before reaching for row
    // inputs.
    const configSubTab = p.locator('[role="tab"][data-tab-id="configuration"]:visible').first()
    if ((await configSubTab.count()) > 0) {
      const alreadyActive = await configSubTab.getAttribute('aria-selected')
      if (alreadyActive !== 'true') {
        await configSubTab.click()
        await p.waitForTimeout(200)
      }
    }
    const rows = p.locator('[data-testid="environment-folder-variables-table"]:visible tbody tr')
    const firstRow = rows.first()
    await expect(firstRow).toBeVisible({ timeout: 5000 })
    const valueInput = firstRow.locator('td').nth(3).locator('input').first()
    await expect(valueInput).toBeVisible({ timeout: 5000 })
    await valueInput.click()
    await p.keyboard.press('Control+A')
    await p.keyboard.press('Delete')
    await p.keyboard.type(newValue)
    await p.keyboard.press('Tab')
    await p.waitForTimeout(800)
  }
)

When(
  'I rename the folder tab {string} to {string}',
  async ({}, oldName: string, newName: string) => {
    const p = requirePage()
    // Restorm exposes folder rename via the sidebar (F2 on the row),
    // not on the tab surface itself. Click the sidebar row, enter
    // rename mode, type, confirm.
    const row = p
      .locator('[data-testid="sidebar-listview"] .list-view-row')
      .filter({ has: p.getByText(oldName, { exact: true }) })
      .first()
    await expect(row).toBeVisible({ timeout: 5000 })
    await row.click()
    await p.keyboard.press('F2')
    await p.waitForTimeout(200)
    const input = p
      .locator('[data-testid="sidebar-listview"] input[type="text"]')
      .first()
    await expect(input).toBeVisible({ timeout: 3000 })
    await input.click()
    await p.keyboard.press('Control+A')
    await p.keyboard.press('Delete')
    await p.keyboard.type(newName)
    await p.keyboard.press('Enter')
    await p.waitForTimeout(600)
  }
)

When(
  'I set the HTTP request URL to {string}',
  async ({}, url: string) => {
    const p = requirePage()
    const urlInput = p.locator('[data-testid="http-request-url-input"]:visible').first()
    await expect(urlInput).toBeVisible({ timeout: 5000 })
    await urlInput.click()
    await p.keyboard.press('Control+A')
    await p.keyboard.press('Delete')
    await p.keyboard.type(url)
    await p.keyboard.press('Tab')
    await p.waitForTimeout(400)
  }
)

// ── Save shortcuts ────────────────────────────────────────────────────

/**
 * Blur any focused editor (Milkdown swallows Ctrl+S while focused) and
 * fire the shortcut at the body so it reaches the window-level handler.
 */
async function dispatchSaveShortcut(p: Page, shortcut: 'Control+s' | 'Control+Shift+s'): Promise<void> {
  const shift = shortcut === 'Control+Shift+s'
  // Fire the keydown directly on `window` so it reaches the App's
  // global handler — a real keyboard press can get swallowed by the
  // focused ProseMirror editor before bubbling.
  await p.evaluate((payload) => {
    const ev = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
      shiftKey: payload.shift,
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(ev)
  }, { shift })
  await p.waitForTimeout(900)
}

When('I save with Ctrl+S', async () => {
  await dispatchSaveShortcut(requirePage(), 'Control+s')
})

When('I save all with Ctrl+Shift+S', async () => {
  await dispatchSaveShortcut(requirePage(), 'Control+Shift+s')
})

// ── Dirty-state assertions ────────────────────────────────────────────

/**
 * Poll `document.title` (Electron mirrors it into the window title) and
 * return a predicate over the trailing `*` suffix. The title is owned
 * by a top-level `useEffect` in `App.tsx` that reacts to `isDirty`, so
 * a race-free way to check "dirty now" is to expect the suffix to
 * stabilize within the default expect timeout.
 */
async function expectDocumentTitleDirty(p: Page, dirty: boolean): Promise<void> {
  await expect.poll(async () => (await p.title()).endsWith(' *'), {
    timeout: 10000,
    message: dirty ? 'expected window title to end with " *"' : 'expected window title not to end with " *"'
  }).toBe(dirty)
}

Then('the window should be dirty', async () => {
  await expectDocumentTitleDirty(requirePage(), true)
})

Then('the window should be clean', async () => {
  await expectDocumentTitleDirty(requirePage(), false)
})

Then('the tab {string} should be dirty', async ({}, tabName: string) => {
  const p = requirePage()
  const tab = tabByName(p, tabName)
  await expect(tab).toBeVisible({ timeout: 5000 })
  await expect(tab.locator('.dirty-indicator').first()).toBeVisible({ timeout: 10000 })
})

Then('the tab {string} should be clean', async ({}, tabName: string) => {
  const p = requirePage()
  const tab = tabByName(p, tabName)
  await expect(tab).toBeVisible({ timeout: 5000 })
  await expect(tab.locator('.dirty-indicator').first()).toHaveCount(0, { timeout: 10000 })
})

// Keep TS happy about unused helpers — `currentElectronApp` + `requireApp`
// are there for steps that need to drive dialog mocks from `when` clauses.
void currentElectronApp
void requireApp
