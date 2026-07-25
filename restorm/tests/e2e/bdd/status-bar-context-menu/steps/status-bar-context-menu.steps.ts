import { createBdd } from 'playwright-bdd'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { configureNextSaveFileDialogForE2E } from 'electron-core-ui/testing'
import { test, expect } from '../../fixtures/dirty-state.fixture'

const { Given, When, Then } = createBdd(test)

/**
 * Own scratch root, per the one-directory-per-suite convention every
 * other fixture follows. The launcher fixture is reused as-is, but its
 * `DIRTY_STATE_TEMP_DIR` is NOT: that directory is wiped on every
 * dirty-state scenario start, so sharing it would let the two suites
 * delete each other's collections the day the runner goes back above
 * one worker.
 *
 * Three levels up, not two: this file sits in `bdd/<suite>/steps/`, one
 * deeper than the `bdd/fixtures/` modules that use `../../`. Only
 * `tests/e2e/.tmp/` is gitignored, so a shallower path drops scratch
 * collections into the working tree as untracked files.
 */
const STATUS_BAR_TEMP_DIR = resolve(__dirname, '../../../.tmp/status-bar-context-menu')

// Module-level handles populated by the `Given` steps so every step that
// follows can reach the current Electron + renderer pair, plus the file
// path the scenario is exercising.
let electronApp: ElectronApplication | null = null
let page: Page | null = null
let currentFilePath: string | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function requireApp(): ElectronApplication {
  if (!electronApp) throw new Error('app must be launched before configuring dialogs')
  return electronApp
}

/**
 * Monkey-patches the main process's `shell.showItemInFolder` with a spy
 * that records every call into a global array — `electron`'s modules are
 * singletons within the main process, so this patches the exact same
 * reference `IPCHandlers.ts` calls through the `restorm:reveal-in-folder`
 * handler. There is no OS file explorer to assert against in CI, so the
 * spy is the only way to verify the IPC round-trip actually invoked the
 * native reveal call with the right path.
 */
async function installRevealInFolderSpy(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __e2eRevealedPaths?: string[] }
    g.__e2eRevealedPaths = []
    shell.showItemInFolder = (path: string): void => {
      g.__e2eRevealedPaths?.push(path)
    }
  })
}

async function revealedPaths(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __e2eRevealedPaths?: string[] }).__e2eRevealedPaths ?? [])
}

// ── Given / setup ─────────────────────────────────────────────────────

Given(
  'a new single-file YAML collection named {string}',
  async ({ launchApp }, baseName: string) => {
    const launched = await launchApp()
    electronApp = launched.app
    page = launched.page
    await installRevealInFolderSpy(electronApp)

    rmSync(STATUS_BAR_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(STATUS_BAR_TEMP_DIR, { recursive: true })
    const filePath = join(STATUS_BAR_TEMP_DIR, `${baseName}.restorm`)
    currentFilePath = filePath
    await configureNextSaveFileDialogForE2E(electronApp, { kind: 'saveFile', path: filePath })

    await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
    await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

    await expect(async () => {
      expect(existsSync(filePath)).toBe(true)
    }).toPass({ timeout: 10000 })
    // Give the registry its breath after first-save → file-opened → hydrate,
    // same wait the dirty-state suite uses for the identical bootstrap.
    await page.waitForTimeout(500)
  }
)

Given('the app is freshly launched with no project open', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page
  currentFilePath = null
  await installRevealInFolderSpy(electronApp)
})

// ── When ──────────────────────────────────────────────────────────────

When('I activate the status bar file-path cell', async () => {
  const p = requirePage()
  const cell = p.locator('[data-testid="app-statusbar-element"]')
  await expect(cell).toBeVisible({ timeout: 5000 })
  await cell.click()
  await expect(p.locator('[data-testid="statusbar-path-actions"]')).toBeVisible({ timeout: 2000 })
})

When('I click {string} in the status bar path popover', async ({}, label: string) => {
  const p = requirePage()
  const testIdByLabel: Record<string, string> = {
    'Open containing folder': 'statusbar-path-actions-reveal',
    'Copy file name': 'statusbar-path-actions-copy-name',
    'Copy full path': 'statusbar-path-actions-copy-path'
  }
  const testId = testIdByLabel[label]
  if (!testId) throw new Error(`unknown status bar path action: ${label}`)
  await p.locator(`[data-testid="${testId}"]`).click()
})

// ── Then ──────────────────────────────────────────────────────────────

/**
 * Drives the IPC channel directly rather than through the menu — the menu
 * can only ever name the open project, so the guard is unreachable from
 * the UI. What ships is the channel, and this is the only way to exercise
 * a caller that names something else.
 *
 * Called repeatedly within one scenario so a single app launch covers
 * every shape the guard must refuse: foreign absolute, traversal,
 * relative, and empty.
 */
Then('the reveal channel refuses {string}', async ({}, target: string) => {
  const p = requirePage()
  const result = await p.evaluate(async (path) => {
    const api = (window as unknown as {
      restorm?: { file: { revealInFolder: (input: string) => Promise<{ success: boolean; error?: string }> } }
    }).restorm
    if (!api) throw new Error('window.restorm is not exposed')
    return api.file.revealInFolder(path)
  }, target)
  expect(result.success, `expected "${target}" to be refused`).toBe(false)
  // A refusal must carry a reason, otherwise the renderer can't tell it
  // apart from a silent no-op.
  expect(result.error, `expected "${target}" to be refused with a reason`).toBeTruthy()
})

Then('the OS file explorer was never called', async () => {
  // The load-bearing half: the guard returned BEFORE the shell call, so
  // the main-process spy recorded nothing. A guard that reported failure
  // while still calling through would pass the assertions above and fail
  // this one.
  expect(await revealedPaths(requireApp())).toEqual([])
})

Then(
  'the status bar path popover shows exactly 3 actions: reveal in folder, copy file name, copy full path',
  async () => {
    const p = requirePage()
    const popover = p.locator('[data-testid="statusbar-path-actions"]')
    await expect(popover).toBeVisible({ timeout: 2000 })
    await expect(popover.locator('[role="option"]')).toHaveCount(3)
    await expect(p.locator('[data-testid="statusbar-path-actions-reveal"]')).toBeVisible()
    await expect(p.locator('[data-testid="statusbar-path-actions-copy-name"]')).toBeVisible()
    await expect(p.locator('[data-testid="statusbar-path-actions-copy-path"]')).toBeVisible()
  }
)

// The popover must dismiss itself once an action fires — that is the
// `closeTooltip` wiring, and a surface that stayed open after acting would
// otherwise pass every other assertion in this suite.
Then('the status bar path popover is closed', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="statusbar-path-actions"]')).toHaveCount(0, { timeout: 2000 })
})

Then('the OS file explorer was asked to reveal the open file\'s path', async () => {
  if (!currentFilePath) throw new Error('no file open in this scenario')
  const app = requireApp()
  await expect(async () => {
    const paths = await revealedPaths(app)
    expect(paths).toEqual([currentFilePath])
  }).toPass({ timeout: 2000 })
})

Then('the clipboard holds only the open file\'s name', async () => {
  if (!currentFilePath) throw new Error('no file open in this scenario')
  const expectedName = currentFilePath.split(/[/\\]/).pop()
  const app = requireApp()
  await expect(async () => {
    const text = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(text).toBe(expectedName)
  }).toPass({ timeout: 5000 })
})

Then('the clipboard holds the open file\'s full path', async () => {
  if (!currentFilePath) throw new Error('no file open in this scenario')
  const app = requireApp()
  await expect(async () => {
    const text = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(text).toBe(currentFilePath)
  }).toPass({ timeout: 5000 })
})

Then('the status bar file-path cell is absent', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="app-statusbar-element"]')).toHaveCount(0)
})
