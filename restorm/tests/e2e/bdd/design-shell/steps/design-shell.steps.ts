import { createBdd } from 'playwright-bdd'
import { copyFileSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, DESIGN_SHELL_TEMP_DIR } from '../../fixtures/design-shell.fixture'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
let projectPath = ''

/** The committed 1.1 sample carrying the reference design. */
const DESIGN_SAMPLE = join(__dirname, '../../../samples/api-design-sample.restorm')
const DESIGN_ID = 'design-petstore'
const DESIGN_NAME = 'Petstore design'
const ENV_FOLDER_NAME = 'Petstore design project'

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

function sidebarRow(p: Page, itemId: string): ReturnType<Page['locator']> {
  return p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${itemId}"]`)
}

function sectionRowId(section: string): string {
  return `design-section:${DESIGN_ID}:${section}`
}

async function openProject(plan?: 'pro'): Promise<void> {
  const p = requirePage()
  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (p: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)
  await expect(sidebarRow(p, DESIGN_ID)).toBeVisible({ timeout: 10000 })
  if (plan === 'pro') {
    // The gate scenarios rely on the seeded plan being live before any
    // assertion on editability.
    await expect(p.locator('[data-testid="app-statusbar-version-plan"]')).toContainText('Pro', { timeout: 10000 })
  }
  await p.waitForTimeout(800)
}

async function launchWithProject(launchApp: (opts?: { plan?: 'pro' | 'enterprise' }) => Promise<{ page: Page }>, plan?: 'pro'): Promise<void> {
  const launched = await launchApp(plan !== undefined ? { plan } : undefined)
  page = launched.page
  projectPath = join(DESIGN_SHELL_TEMP_DIR, `design-shell-${plan ?? 'community'}.restorm`)
  copyFileSync(DESIGN_SAMPLE, projectPath)
  await openProject(plan)
}

Given('a Pro project carrying an API design is open', async ({ launchApp }) => {
  await launchWithProject(launchApp, 'pro')
})

Given('a Community project carrying an API design is open', async ({ launchApp }) => {
  await launchWithProject(launchApp)
})

When('I click the design row in the sidebar', async () => {
  const p = requirePage()
  await sidebarRow(p, DESIGN_ID).click()
  await p.waitForTimeout(500)
})

When('I expand the design node', async () => {
  const p = requirePage()
  const row = sidebarRow(p, DESIGN_ID)
  const collapsedChevron = row.locator('button:has(.codicon-chevron-right)')
  if (await collapsedChevron.count() > 0) {
    await collapsedChevron.click()
  }
  await expect(sidebarRow(p, sectionRowId('settings'))).toBeVisible({ timeout: 5000 })
})

When('I click the design group entry {string}', async ({}, section: string) => {
  const p = requirePage()
  await sidebarRow(p, sectionRowId(section)).click()
  await p.waitForTimeout(400)
})

Then('the design tab is open on the {string} section', async ({}, section: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-tab-view-${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  await expect(p.locator(`[data-testid="design-section-${section}"]`)).toBeVisible({ timeout: 5000 })
})

Then('exactly one design tab is open', async () => {
  const p = requirePage()
  const tabs = p.locator('.tab[role="tab"]').filter({ has: p.getByText(DESIGN_NAME, { exact: true }) })
  await expect(tabs).toHaveCount(1)
})

When('I click the rail icon {string}', async ({}, section: string) => {
  const p = requirePage()
  await p.locator(`[data-testid="design-rail-${section}"]`).click()
  await p.waitForTimeout(300)
})

Then('the {string} section lists {string}', async ({}, section: string, name: string) => {
  const p = requirePage()
  await expect(
    p.locator(`[data-testid="design-${section}-list"] .list-view-row`).filter({ has: p.getByText(name, { exact: true }) })
  ).toHaveCount(1, { timeout: 5000 })
})

Then('the {string} section does not list {string}', async ({}, section: string, name: string) => {
  const p = requirePage()
  await expect(
    p.locator(`[data-testid="design-${section}-list"] .list-view-row`).filter({ has: p.getByText(name, { exact: true }) })
  ).toHaveCount(0, { timeout: 5000 })
})

When('I filter the {string} section with {string}', async ({}, section: string, term: string) => {
  const p = requirePage()
  const filterInput = p.locator(`[data-testid="design-${section}-filter-input"]`)
  await filterInput.click()
  await filterInput.fill(term)
  // InputBox debounces by default — give the value time to commit.
  await p.waitForTimeout(600)
})

// ── Drag & drop refusal ───────────────────────────────────────────────
// Same manual HTML5 DnD dispatch as the sidebar-dnd suite: Playwright's
// mouse-based dragTo is unreliable for HTML5 DnD under xvfb.

When('I start dragging the design group entry {string}', async ({}, section: string) => {
  const p = requirePage()
  await p.evaluate((id: string) => {
    const row = document.querySelector(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${id}"]`)
    if (!row) throw new Error(`drag source row not found: ${id}`)
    const dt = new DataTransfer()
    ;(window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt = dt
    const rect = row.getBoundingClientRect()
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + rect.height / 2 })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    row.dispatchEvent(ev)
  }, sectionRowId(section))
})

When('I hover the drag over the env folder row', async () => {
  const p = requirePage()
  await p.evaluate((envName: string) => {
    const dt = (window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt
    if (!dt) throw new Error('no in-flight drag')
    const rows = Array.from(document.querySelectorAll('[data-testid="sidebar-listview"] .list-view-row'))
    const target = rows.find((r) => r.textContent.includes(envName))
    if (!target) throw new Error('env folder row not found')
    const rect = target.getBoundingClientRect()
    for (const type of ['dragenter', 'dragover']) {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2) })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      target.dispatchEvent(ev)
    }
  }, ENV_FOLDER_NAME)
})

Then('the drop is refused', async () => {
  const p = requirePage()
  // The hover ghost carries the error badge while the gesture is
  // incoherent, and no drop indicator is painted on the target.
  const invalidGhost = p.locator('.list-view-drag-ghost.is-invalid, .list-view-drag-ghost-error:visible')
  const dropIndicator = p.locator('[data-testid="sidebar-listview"] .list-view-row.drop-into, [data-testid="sidebar-listview"] .list-view-row.drop-before, [data-testid="sidebar-listview"] .list-view-row.drop-after')
  const ghostFlagged = await invalidGhost.count() > 0
  const indicatorAbsent = await dropIndicator.count() === 0
  expect(ghostFlagged || indicatorAbsent, 'an incoherent drag must be flagged or indicator-less').toBe(true)
})

Then('dropping there leaves the tree unchanged', async () => {
  const p = requirePage()
  const before = readFileSync(projectPath, 'utf-8')
  await p.evaluate((envName: string) => {
    const dt = (window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt
    if (!dt) throw new Error('no in-flight drag')
    const rows = Array.from(document.querySelectorAll('[data-testid="sidebar-listview"] .list-view-row'))
    const target = rows.find((r) => r.textContent.includes(envName))
    if (!target) throw new Error('env folder row not found')
    const rect = target.getBoundingClientRect()
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2) })
    Object.defineProperty(drop, 'dataTransfer', { value: dt })
    target.dispatchEvent(drop)
    delete (window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt
  }, ENV_FOLDER_NAME)
  await p.waitForTimeout(1000)
  // The section rows are still under the design node, and nothing moved
  // (a refused drop writes nothing).
  await expect(sidebarRow(p, sectionRowId('models'))).toBeVisible()
  expect(readFileSync(projectPath, 'utf-8')).toBe(before)
  // The file-byte check alone cannot distinguish a refused drop from an
  // accepted one (a drop only mutates memory until a save). Assert the
  // IN-MEMORY tree too: the design still lives at the root, not under
  // the env folder.
  const placement = await p.evaluate((envName: string) => {
    const helpers = (window as unknown as {
      __restormTestHelpers?: { findItemIndexPath?: (chain: string[]) => number[] | null }
    }).__restormTestHelpers
    if (!helpers?.findItemIndexPath) throw new Error('findItemIndexPath helper not exposed')
    return {
      atRoot: helpers.findItemIndexPath(['Petstore design']) !== null,
      underEnvFolder: helpers.findItemIndexPath([envName, 'Petstore design']) !== null
    }
  }, ENV_FOLDER_NAME)
  expect(placement.atRoot, 'the design must still sit at the root').toBe(true)
  expect(placement.underEnvFolder, 'the design must NOT have moved under the env folder').toBe(false)
})

// ── Favorites ─────────────────────────────────────────────────────────

When('I toggle the design favorite star', async () => {
  const p = requirePage()
  const star = p.locator('[data-testid$="-favorite-toggle"]:visible').first()
  await expect(star).toBeVisible({ timeout: 5000 })
  await star.click()
  await p.waitForTimeout(300)
})

Then('the design appears in the favorites pane', async () => {
  const p = requirePage()
  await expect(
    p.locator('[data-testid="sidebar-favorites-listview"] .list-view-row').filter({ hasText: DESIGN_NAME })
  ).toHaveCount(1, { timeout: 5000 })
})

When('I open the env folder tab', async () => {
  const p = requirePage()
  const row = p.locator('[data-testid="sidebar-listview"] .list-view-row').filter({ hasText: ENV_FOLDER_NAME }).first()
  await row.click()
  await p.waitForTimeout(500)
})

When('I click the design in the favorites pane', async () => {
  const p = requirePage()
  await p.locator('[data-testid="sidebar-favorites-listview"] .list-view-row').filter({ hasText: DESIGN_NAME }).first().click()
  await p.waitForTimeout(500)
})

Then('the design tab is the active tab', async () => {
  const p = requirePage()
  const activeTab = p.locator('.tab[role="tab"][aria-selected="true"]').filter({ has: p.getByText(DESIGN_NAME, { exact: true }) })
  await expect(activeTab).toHaveCount(1, { timeout: 5000 })
})

// ── No edit gate — every plan designs freely ─────────────────────────
// (Yoann, 2026-08-17: the plan gates RUNNING the design — serve/codegen
// buttons, asserted by their own suites when they land — not editing.)

Then('the design settings are editable', async () => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-tab-view-${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  // The RUN gate on the serve spin is the one legitimate Community gate
  // (the plan gates PLAYING a design, never editing). Editing surfaces
  // stay gate-free on EVERY plan: no `.ecu-gated` outside the serve
  // block. This step runs for both the Community and the Pro launch.
  const settingsSection = p.locator('[data-testid="design-settings-section"]')
  await expect(settingsSection).toBeVisible({ timeout: 10000 })
  await expect(settingsSection.locator('.ecu-gated:not([data-testid="design-serve-gate"])')).toHaveCount(0)
  const titleInput = p.locator('[data-testid="design-settings-title-input"]')
  await expect(titleInput).toBeVisible({ timeout: 5000 })
  await expect(titleInput).toBeEnabled()
})

// Community-only: playing the design IS gated — the serve spin sits
// behind the plan gate (visible-but-locked, with the upsell).
Then('the design serve spin is plan-gated', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-serve-gate"]')).toHaveCount(1, { timeout: 5000 })
})

// ── Split panel ───────────────────────────────────────────────────────

When('I open the design in a split panel from its context menu', async () => {
  const p = requirePage()
  await sidebarRow(p, DESIGN_ID).click({ button: 'right' })
  const entry = p.getByText('Ouvrir dans un panneau divisé', { exact: true })
    .or(p.getByText('Open in split panel', { exact: true }))
  await expect(entry.first()).toBeVisible({ timeout: 5000 })
  await entry.first().click()
  await p.waitForTimeout(800)
})

Then('two workbench groups are visible', async () => {
  const p = requirePage()
  await expect(p.locator('.editor-group-container')).toHaveCount(2, { timeout: 5000 })
})
