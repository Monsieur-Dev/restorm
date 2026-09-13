import { createBdd } from 'playwright-bdd'
import { copyFileSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import type { Page, Locator } from '@playwright/test'
import { test, expect, RECORDING_SHELL_TEMP_DIR } from '../../fixtures/recording-shell.fixture'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
let projectPath = ''

/** The committed creation sample: an env folder + a scenario at the root. */
const SAMPLE = join(__dirname, '../../../samples/api-design-creation-sample.restorm')
const ENV_FOLDER_ID = 'env-design-sample'
const DEFAULT_SESSION_NAME = 'New recording session'

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

function sidebarRow(p: Page, itemId: string): Locator {
  return p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${itemId}"]`)
}

function sidebarRowByTitle(p: Page, title: string): Locator {
  return p.locator('[data-testid="sidebar-listview"] .list-view-row').filter({ has: p.getByText(title, { exact: true }) }).first()
}

/** The tree item id behind the session row (a UUID minted at creation). */
async function sessionId(p: Page): Promise<string> {
  const row = sidebarRowByTitle(p, DEFAULT_SESSION_NAME)
  await expect(row).toBeVisible({ timeout: 5000 })
  const id = await row.getAttribute('data-item-id')
  if (id === null || id === '') throw new Error('the session row carries no item id')
  return id
}

function nodeRowId(id: string, kind: string): string {
  return `recording-node:${id}:${kind}`
}

async function openProject(): Promise<void> {
  const p = requirePage()
  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (p: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)
  await expect(sidebarRow(p, ENV_FOLDER_ID)).toBeVisible({ timeout: 10000 })
  await p.waitForTimeout(800)
}

async function openAddSubmenu(p: Page, row: Locator): Promise<void> {
  // Let any debounced sidebar rebuild land before anchoring a menu on a row.
  await p.waitForTimeout(500)
  await row.click({ button: 'right' })
  // Exact match: a favouritable row also carries "Add to favorites" ahead of "Add".
  const addParent = p.getByRole('menuitem', { name: /^(Add|Ajouter)$/ }).first()
  await addParent.waitFor({ state: 'visible', timeout: 10_000 })
  // Pointer-based submenu opening is unreliable (the menu anchors under the
  // pointer); the keyboard path opens the submenu synchronously.
  await addParent.focus()
  await addParent.press('ArrowRight')
  await p.waitForTimeout(500)
}

Given('a project with an env folder is open', async ({ launchApp }) => {
  const launched = await launchApp()
  page = launched.page
  projectPath = join(RECORDING_SHELL_TEMP_DIR, 'recording-shell.restorm')
  copyFileSync(SAMPLE, projectPath)
  await openProject()
})

When("I add a recording session from the env folder's context menu", async () => {
  const p = requirePage()
  await openAddSubmenu(p, sidebarRow(p, ENV_FOLDER_ID))
  const entry = p.locator('[data-testid="sidebar-context-menu-add-recording"]')
  await expect(entry).toBeVisible({ timeout: 5000 })
  await entry.click()
  // The new row lands in inline rename; keep the default name.
  await p.waitForTimeout(400)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
})

Then('the sidebar carries a recording session named {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowByTitle(p, name)).toBeVisible({ timeout: 5000 })
})

Then('the session row is expanded with a {string} row and a {string} row', async ({}, first: string, second: string) => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(sidebarRow(p, nodeRowId(id, first))).toBeVisible({ timeout: 5000 })
  await expect(sidebarRow(p, nodeRowId(id, second))).toBeVisible({ timeout: 5000 })
})

Then('the session has no {string} row', async ({}, kind: string) => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(sidebarRow(p, nodeRowId(id, kind))).toHaveCount(0)
})

Then('the recording {string} tab is open', async ({}, node: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="recording-tab-${node}"]`)).toBeVisible({ timeout: 10000 })
})

When('I click the session {string} row', async ({}, kind: string) => {
  const p = requirePage()
  const id = await sessionId(p)
  await sidebarRow(p, nodeRowId(id, kind)).click()
  await p.waitForTimeout(400)
})

When('I click the session row', async () => {
  const p = requirePage()
  await sidebarRowByTitle(p, DEFAULT_SESSION_NAME).click()
  await p.waitForTimeout(400)
})

When("I add a scenario from the env folder's context menu", async () => {
  const p = requirePage()
  await openAddSubmenu(p, sidebarRow(p, ENV_FOLDER_ID))
  const entry = p.locator('[data-testid="sidebar-context-menu-add-scenario"]')
  await expect(entry).toBeVisible({ timeout: 5000 })
  await entry.click()
  await p.waitForTimeout(400)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  await expect(sidebarRowByTitle(p, 'New scenario')).toBeVisible({ timeout: 5000 })
})

When('I open the Add submenu of the new scenario row', async () => {
  const p = requirePage()
  await openAddSubmenu(p, sidebarRowByTitle(p, 'New scenario'))
})

Then('the Add submenu offers no recording session entry', async () => {
  const p = requirePage()
  // The design entry is there (the submenu is open) — the recording one is not.
  await expect(p.locator('[data-testid="sidebar-context-menu-add-design"]')).toBeVisible({ timeout: 5000 })
  await expect(p.locator('[data-testid="sidebar-context-menu-add-recording"]')).toHaveCount(0)
  await p.keyboard.press('Escape')
})

When('I save the project', async () => {
  const p = requirePage()
  await p.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', code: 'KeyS', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
    }))
  })
  await p.waitForTimeout(1500)
})

Then('the saved file carries a recording session named {string}', async ({}, name: string) => {
  const saved = readFileSync(projectPath, 'utf-8')
  expect(saved).toContain(`name: ${name}`)
  expect(saved).toContain('type: recording')
  // Only the configuration persists — never any captured call.
  expect(saved).not.toContain('captures:')
})

Then('the saved file declares file format version {string}', async ({}, version: string) => {
  const saved = readFileSync(projectPath, 'utf-8')
  expect(saved.startsWith(`fileFormatVersion: ${version}\n`)).toBe(true)
})

// ── Config page + record button ───────────────────────────────────────

const LOCAL_PAGE = `file://${resolve(__dirname, '../../../samples/fixtures/recording-page.html')}`

function recordButton(p: Page): Locator {
  return p.locator('[data-testid="recording-config-record"]')
}

Then('the record button is disabled', async () => {
  const p = requirePage()
  await expect(recordButton(p)).toBeVisible({ timeout: 10000 })
  // The ECUI Button carries its disabled state as a class (see design-server).
  await expect(recordButton(p)).toHaveClass(/disabled/, { timeout: 5000 })
})

Then('the record button is enabled', async () => {
  const p = requirePage()
  await expect(recordButton(p)).not.toHaveClass(/disabled/, { timeout: 5000 })
})

When('I set the session url to the local test page', async () => {
  const p = requirePage()
  // The ECUI InputBox suffixes its own test id on the native input.
  const input = p.locator('[data-testid="recording-config-url-input"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.click()
  await input.fill(LOCAL_PAGE)
  // The InputBox debounces its onChange; let the value land on the session.
  await p.waitForTimeout(700)
})

When('I click the record button', async () => {
  const p = requirePage()
  await recordButton(p).click()
  await p.waitForTimeout(800)
})

Then('the session has a {string} row', async ({}, kind: string) => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(sidebarRow(p, nodeRowId(id, kind))).toBeVisible({ timeout: 10000 })
})

Then('the session is on air', async () => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(p.locator(`[data-testid="recording-on-air-${id}"]`).first()).toHaveAttribute('data-recording-state', 'recording', { timeout: 10000 })
})

Then('the session is idle', async () => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(p.locator(`[data-testid="recording-on-air-${id}"]`).first()).toHaveAttribute('data-recording-state', 'idle', { timeout: 10000 })
})
