import { createBdd } from 'playwright-bdd'
import { existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextSaveFileDialogForE2E } from 'electron-core-ui/testing'
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

    await expect(async () => {
      expect(existsSync(filePath)).toBe(true)
    }).toPass({ timeout: 10000 })
    // Give the registry its breath after first-save → file-opened → hydrate.
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
    const closeBtn = activeTab.locator('[aria-label="Close"]').first()
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

// ── Close + reopen (round-trip a saved file with no in-session save) ──

When('I close the current file', async () => {
  const p = requirePage()
  await p.keyboard.press('Escape')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(200)
  await p.evaluate(async () => {
    const helpers = (window as unknown as {
      __restormTestHelpers?: { closeFile?: () => Promise<void> | void }
    }).__restormTestHelpers
    if (!helpers?.closeFile) throw new Error('__restormTestHelpers.closeFile not exposed')
    await helpers.closeFile()
  })
  await expect(p.locator('.ecu-welcome-screen')).toBeVisible({ timeout: 10000 })
})

When('I reopen the welcome recent file {string}', async ({}, fileName: string) => {
  const p = requirePage()
  // The Recent section needs a tick to render after the file:closed
  // event lands; poll the row instead of failing the first try.
  const recentRow = p.locator('.ecu-recent-files-vignette-section', { hasText: 'Recent' })
    .locator('.ecu-recent-files-vignette-item', { hasText: fileName })
    .first()
  try {
    await expect(recentRow).toBeVisible({ timeout: 15000 })
  } catch (err) {
    // This assertion has failed under full-suite conditions with an EMPTY
    // Recent section while the main log showed the file saved and opened.
    // Capture the three states that disambiguate the failure mode: the file
    // on disk (existence-filter input), the service's recents over IPC (main
    // in-memory state), and the app version cell (a 'v0.0' reading marks a
    // degraded main that also failed to read its package.json).
    const onDisk = existsSync(join(DIRTY_STATE_TEMP_DIR, fileName))
    let dirListing: string
    try {
      dirListing = JSON.stringify(readdirSync(DIRTY_STATE_TEMP_DIR))
    } catch (e) {
      dirListing = `dir unreadable: ${String(e)}`
    }
    const apiRecents = await p.evaluate(async () => {
      const w = window as unknown as { api?: { file?: { getRecentFiles?: () => Promise<{ path: string }[]> } } }
      try {
        const list = await w.api?.file?.getRecentFiles?.()
        return list ? list.map((f) => f.path) : 'api absent'
      } catch (e) {
        return `getRecentFiles threw: ${String(e)}`
      }
    })
    const versionCell = await p.locator('[data-testid="app-statusbar-version-plan"]').textContent().catch(() => 'unreadable')
    throw new Error(
      `Recent row for "${fileName}" absent. Diagnostics — on disk: ${String(onDisk)}; ` +
      `dir listing: ${dirListing}; ` +
      `api.getRecentFiles: ${JSON.stringify(apiRecents)}; version cell: ${JSON.stringify(versionCell)}`,
      { cause: err }
    )
  }
  await recentRow.click()
  await expect(p.locator('.ecu-welcome-screen')).not.toBeVisible({ timeout: 10000 })
  // Wait for the registry to re-hydrate after file:opened so the next
  // edit's mutate sees the freshly-stamped reference.
  await p.waitForTimeout(800)
})

// ── URL field char-level edits (first-edit-cycle regression target) ──

/**
 * The URL bar (verb select + URL input + send button) lives inside the
 * Request sub-tab of the request view; switching to Notes / Docs / Code
 * snippets hides the whole control row. Tests that interact with the
 * URL input must activate the Request sub-tab first or Playwright's
 * `:visible` filter will time out — sibling sub-tabs are kept mounted
 * with `visibility: hidden`. This helper is a no-op when the Request
 * sub-tab is already active.
 */
async function activateRequestSubTab(p: Page): Promise<void> {
  const tab = p.locator('[role="tab"][data-testid="base-request-tabs-request-tab-request"]:visible').first()
  if ((await tab.count()) === 0) return
  const alreadyActive = await tab.getAttribute('aria-selected')
  if (alreadyActive === 'true') return
  await tab.click()
  await p.waitForTimeout(200)
}

/**
 * Place the caret at the end of the URL input. The reactive proxy fires
 * its set event on every value change, so we drive the keyboard directly
 * — no `fill()` shortcut, no `press('Tab')` blur — to land each
 * `Reflect.set` exactly as the user would.
 *
 * The URL input wraps a Monaco-backed CodeEditor (via VariableInputBox).
 * Monaco wires its keystroke pipeline on `mousedown` over the rendered
 * viewport, not on focus. Clicking the outer wrapper (or focusing the
 * hidden textarea) drops every subsequent keystroke. Click the
 * `.monaco-editor` viewport so Monaco actually arms input.
 */
async function focusUrlAtEnd(p: Page): Promise<void> {
  await activateRequestSubTab(p)
  const urlInput = p.locator('[data-testid="http-request-url-input"]:visible').first()
  await expect(urlInput).toBeVisible({ timeout: 5000 })
  const viewport = urlInput.locator('.monaco-editor').first()
  await expect(viewport).toBeVisible({ timeout: 5000 })
  await viewport.click({ force: true })
  await p.keyboard.press('End')
}

When('I append a space to the URL', async () => {
  const p = requirePage()
  await focusUrlAtEnd(p)
  await p.keyboard.press('Space')
  // Wait past the 300 ms upsert debounce + IPC round-trip + state
  // propagation before any subsequent dirty assertion. The poll on
  // `expectDocumentTitleDirty` retries for up to 10 s so we don't have
  // to be exact, but a leading wait keeps the failure mode obvious
  // when the bug is "stays dirty" vs "race".
  await p.waitForTimeout(600)
})

When('I press backspace in the URL', async () => {
  const p = requirePage()
  // Don't re-focus / click — the URL field is a Monaco editor, and a
  // mid-edit click can blur+remount and swallow the next keystroke.
  // We just appended a space with the caret at the end, so Backspace
  // applies to that exact position.
  await p.keyboard.press('Backspace')
  await p.waitForTimeout(600)
})

/**
 * Open the Body sub-tab (request views default to Headers / Params /
 * Auth depending on what has content) and place the caret at the end
 * of the Monaco body editor. Same rationale as `focusUrlAtEnd`.
 *
 * The body lives in a SplitView Pane (HTTP requests) or as a sub-tab
 * (other request types). For HTTP the pane is always rendered, so the
 * `data-tab-id="body"` lookup short-circuits to the editor click.
 *
 * Clicking the wrapper `[data-testid="http-request-body-editor"]` is
 * enough to *show* Monaco but not always enough to focus its inner
 * `<textarea>` — Monaco delegates focus on mousedown, and on an empty
 * editor there's no rendered glyph to land on, so the click can fall
 * through to the wrapper. CodeEditor stamps the inner textarea with
 * `${dataTestId}-textarea` once Monaco mounts; focus that directly so
 * the subsequent `keyboard.press` lands on Monaco's input target.
 */
async function focusBodyAtEnd(p: Page): Promise<void> {
  const bodySubTab = p.locator('[role="tab"][data-tab-id="body"]:visible').first()
  if ((await bodySubTab.count()) > 0) {
    const active = await bodySubTab.getAttribute('aria-selected')
    if (active !== 'true') {
      await bodySubTab.click()
      await p.waitForTimeout(300)
    }
  }
  const editor = p.locator('[data-testid="http-request-body-editor"]:visible').first()
  await expect(editor).toBeVisible({ timeout: 5000 })
  // Monaco delegates focus on `mousedown` over its rendered viewport,
  // not on the hidden screen-reader textarea. A bare wrapper click
  // (or `textarea.focus()`) lands the DOM focus but skips Monaco's
  // input wiring, so subsequent keystrokes are dropped before
  // reaching the model. Click the `.monaco-editor` viewport so
  // Monaco arms input the same way a real user click would.
  const viewport = editor.locator('.monaco-editor').first()
  await expect(viewport).toBeVisible({ timeout: 10000 })
  await viewport.click({ force: true })
  await p.keyboard.press('End')
}

When('I append a space to the body', async () => {
  const p = requirePage()
  await focusBodyAtEnd(p)
  await p.keyboard.press('Space')
  await p.waitForTimeout(600)
})

When('I press backspace in the body', async () => {
  const p = requirePage()
  await p.keyboard.press('Backspace')
  await p.waitForTimeout(600)
})

/**
 * Locate the value cell of the first env folder variable row,
 * focusing the inner `<input>` (text values render as a plain
 * `<input>`; numeric/handlebars render as Monaco). Mirrors the
 * helper in `full-workflow.steps.ts` but scoped to the env-folder
 * Configuration sub-tab.
 */
async function focusFirstEnvVarValueAtEnd(p: Page): Promise<void> {
  const configSubTab = p.locator('[role="tab"][data-tab-id="environments"]:visible').first()
  if ((await configSubTab.count()) > 0) {
    const active = await configSubTab.getAttribute('aria-selected')
    if (active !== 'true') {
      await configSubTab.click()
      await p.waitForTimeout(300)
    }
  }
  const row = p.locator('[data-testid="environment-folder-variables-table"] tbody tr').first()
  await expect(row).toBeVisible({ timeout: 5000 })
  const valueCell = row.locator('td').nth(2)
  const plainInput = valueCell.locator('input').first()
  if (await plainInput.count() > 0 && await plainInput.isVisible()) {
    await plainInput.click()
    await p.keyboard.press('End')
    return
  }
  const monaco = valueCell.locator('.monaco-editor').first()
  await expect(monaco).toBeVisible({ timeout: 5000 })
  await monaco.click()
  await p.keyboard.press('End')
}

When('I append a space to the first env folder variable value', async () => {
  const p = requirePage()
  await focusFirstEnvVarValueAtEnd(p)
  await p.keyboard.press('Space')
  await p.waitForTimeout(600)
})

When('I press backspace in the first env folder variable value', async () => {
  const p = requirePage()
  await p.keyboard.press('Backspace')
  await p.waitForTimeout(600)
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
    const configSubTab = p.locator('[role="tab"][data-tab-id="environments"]:visible').first()
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

/**
 * Env folder view defaults to the "Home" landing sub-tab, not the
 * "Environments" sub-tab where the envs list + add button live. Switch
 * before reaching for the inner controls.
 */
async function activateEnvFolderConfigSubTab(p: Page): Promise<void> {
  const configSubTab = p.locator('[role="tab"][data-tab-id="environments"]:visible').first()
  if ((await configSubTab.count()) === 0) return
  const alreadyActive = await configSubTab.getAttribute('aria-selected')
  if (alreadyActive === 'true') return
  await configSubTab.click()
  await p.waitForTimeout(200)
}

When('I add a new environment in the env folder', async () => {
  const p = requirePage()
  await activateEnvFolderConfigSubTab(p)
  // `openEnvironmentFolderTab` schedules the dirty-baseline registration
  // on a 500 ms `setTimeout` (KV table normalization). If we click the
  // add button before that fires, the deferred `registerItem` lands
  // AFTER the add mutation and resets the baseline — the window
  // reappears clean even though the mutation went through. Wait past
  // the timeout so the baseline is stamped before we mutate.
  await p.waitForTimeout(700)
  const addBtn = p
    .locator('[data-testid="environment-folder-add-environment-button"]:visible')
    .first()
  await expect(addBtn).toBeVisible({ timeout: 5000 })
  await addBtn.click()
  // handleAddEnvironment selects the new env synchronously, then the
  // reactive proxy's 50 ms debounce fires FOLDER_UPDATED, which the
  // dirty tracker turns into a title update over two IPC hops.
  await p.waitForTimeout(800)
})

When('I add a variable to the current environment', async () => {
  const p = requirePage()
  await activateEnvFolderConfigSubTab(p)
  const addBtn = p
    .locator('[data-testid="environment-folder-add-variable-button"]:visible')
    .first()
  await expect(addBtn).toBeVisible({ timeout: 5000 })
  await addBtn.click()
  // RestormKeyValueTable.addRow → onRowsChange →
  // handleEnvironmentVariablesChange → reactive env proxy set →
  // ENVIRONMENT_UPDATED (debounced). Give it a beat to propagate.
  await p.waitForTimeout(900)
})

When(
  'I set the HTTP request URL to {string}',
  async ({}, url: string) => {
    const p = requirePage()
    await activateRequestSubTab(p)
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

// ── Clone → dirty + search-indexing ───────────────────────────────────

/** Click a context-menu entry by visible label (menu items render as
 * `.action-menu-item` / `[role="menuitem"]`). */
async function clickContextMenuItem(currentPage: Page, pattern: RegExp): Promise<void> {
  const item = currentPage
    .locator('.action-menu-item, [role="menuitem"]')
    .filter({ hasText: pattern })
    .first()
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.click()
  await currentPage.waitForTimeout(300)
}

When('I clone the sidebar request {string}', async ({}, requestName: string) => {
  const p = requirePage()
  const row = p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(requestName, { exact: true }) })
    .first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click({ button: 'right' })
  await p.waitForTimeout(200)
  await clickContextMenuItem(p, /Clone|Cloner/)
})

When('I open the search bar', async () => {
  const p = requirePage()
  const closed = p.locator('[data-testid="main-titlebar-searchbar-closed"]').first()
  await expect(closed).toBeVisible({ timeout: 5000 })
  await closed.click({ force: true })
  await expect(p.locator('[data-testid="main-titlebar-searchbar-open"]').first()).toBeVisible({ timeout: 5000 })
})

When('I search for {string}', async ({}, query: string) => {
  const p = requirePage()
  const input = p.locator('[data-testid="main-titlebar-searchbar-inputbox-input"]').first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.focus()
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Backspace')
  await p.keyboard.type(query)
  await p.waitForSelector('[data-testid="main-titlebar-searchbar"][data-results-count]', { timeout: 5000 })
})

Then('the title-bar search results should contain a hit mentioning {string}', async ({}, needle: string) => {
  const p = requirePage()
  const results = p
    .locator('[data-testid="main-titlebar-searchbar-results"] [data-testid^="main-titlebar-searchbar-result-"]')
    .filter({ hasText: needle })
  await expect(results.first()).toBeVisible({ timeout: 10000 })
})

// Keep TS happy about unused helpers — `currentElectronApp` + `requireApp`
// are there for steps that need to drive dialog mocks from `when` clauses.
void currentElectronApp
void requireApp
