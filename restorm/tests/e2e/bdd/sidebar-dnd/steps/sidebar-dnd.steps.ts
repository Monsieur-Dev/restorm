import { createBdd } from 'playwright-bdd'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { test, expect, configureNextOpenDialogForE2E, SIDEBAR_DND_TEMP_DIR } from '../../fixtures/sidebar-dnd.fixture'
import { setupReferenceWorkingCopy } from '../../scenario-runlog/runLogShared'

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
let baselineNodeCount = 0

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}
function requireApp(): ElectronApplication {
  if (!electronApp) throw new Error('app must be launched before configuring dialogs')
  return electronApp
}

function sidebarRowByName(p: Page, name: string): Locator {
  return p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) })
    .first()
}

async function expandRowIfCollapsed(p: Page, name: string): Promise<void> {
  // Chevron click: with `expandOnChevronOnly` a row click never toggles —
  // a fresh project starts ALL-expanded so this is usually a no-op, but
  // after a collapse-all the chevron is the only expansion gesture.
  const row = sidebarRowByName(p, name)
  await expect(row).toBeVisible({ timeout: 15000 })
  if ((await row.getAttribute('aria-expanded')) !== 'true') {
    await row.locator('.list-view-expander').click()
    await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 10000 })
  }
}

async function itemIdForRow(p: Page, name: string): Promise<string> {
  const row = sidebarRowByName(p, name)
  await expect(row).toBeVisible({ timeout: 10000 })
  const id = await row.getAttribute('data-item-id')
  if (!id) throw new Error(`sidebar row "${name}" has no data-item-id`)
  return id
}

/**
 * Start a REAL drag from a sidebar row: dispatches a native `dragstart` with a
 * fresh DataTransfer (stashed on `window` so later steps reuse it), which runs
 * the actual ListView `onDragStart` — the selection-aware payload stamping
 * (anchor id on text/plain, multi MIME when the row belongs to a
 * multi-selection) is exactly what's under test, so nothing is hand-built.
 * Playwright's mouse-based dragTo is unreliable for HTML5 DnD under xvfb —
 * every drag suite here dispatches the sequence manually instead.
 */
async function startDragFromRow(p: Page, itemId: string): Promise<void> {
  await p.evaluate((id) => {
    const row = document.querySelector(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${id}"]`)
    if (!row) throw new Error(`drag source row not found: ${id}`)
    const dt = new DataTransfer()
    ;(window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt = dt
    const rect = row.getBoundingClientRect()
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + rect.height / 2 })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    row.dispatchEvent(ev)
  }, itemId)
}

/** Fire dragenter+dragover on a target at a relative position, reusing the
 * in-flight DataTransfer from {@link startDragFromRow}. */
async function hoverDragOver(p: Page, targetSelector: string, relX: number, relY: number): Promise<void> {
  await p.evaluate(({ targetSelector, relX, relY }) => {
    const dt = (window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt
    if (!dt) throw new Error('no in-flight drag — call startDragFromRow first')
    const target = document.querySelector(targetSelector)
    if (!target) throw new Error(`drag target not found: ${targetSelector}`)
    const rect = target.getBoundingClientRect()
    const clientX = Math.round(rect.left + rect.width * relX)
    const clientY = Math.round(rect.top + rect.height * relY)
    for (const type of ['dragenter', 'dragover']) {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX, clientY })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      target.dispatchEvent(ev)
    }
  }, { targetSelector, relX, relY })
}

/** Fire dragover+drop on the target, then dragend on the source row. */
async function dropDragOn(p: Page, targetSelector: string, relX: number, relY: number, sourceItemId: string): Promise<void> {
  await hoverDragOver(p, targetSelector, relX, relY)
  await p.evaluate(({ targetSelector, relX, relY, sourceItemId }) => {
    const dt = (window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt
    if (!dt) throw new Error('no in-flight drag')
    const target = document.querySelector(targetSelector)
    if (!target) throw new Error(`drop target not found: ${targetSelector}`)
    const rect = target.getBoundingClientRect()
    const clientX = Math.round(rect.left + rect.width * relX)
    const clientY = Math.round(rect.top + rect.height * relY)
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, clientX, clientY })
    Object.defineProperty(drop, 'dataTransfer', { value: dt })
    target.dispatchEvent(drop)
    const source = document.querySelector(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${sourceItemId}"]`)
    if (source) {
      const end = new DragEvent('dragend', { bubbles: true, cancelable: true })
      Object.defineProperty(end, 'dataTransfer', { value: dt })
      source.dispatchEvent(end)
    }
    delete (window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt
  }, { targetSelector, relX, relY, sourceItemId })
  await p.waitForTimeout(300)
}

function rowSelector(itemId: string): string {
  return `[data-testid="sidebar-listview"] .list-view-row[data-item-id="${itemId}"]`
}

let dragAnchorId: string | null = null

Given('the sidebar-dnd reference project is open', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const workingCopy = setupReferenceWorkingCopy(SIDEBAR_DND_TEMP_DIR)
  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: workingCopy })
  await requirePage().locator('[data-testid="titlebar-menubar-item-file"]').click()
  await requirePage().locator('[data-testid="titlebar-menu-item-open"]').first().click()

  await expect(sidebarRowByName(requirePage(), 'Auth Service')).toBeVisible({ timeout: 15000 })
})

Given('I expand the sidebar row {string}', async ({}, name: string) => {
  await expandRowIfCollapsed(requirePage(), name)
})

Given('I collapse all sidebar rows', async ({}) => {
  const p = requirePage()
  await p.locator('[data-testid="sidebar-collapse-all-button"]').click()
  // Exactly the root rows remain (the reference project has one root).
  await expect(p.locator('[data-testid="sidebar-listview"] .list-view-row[data-depth="1"]')).toHaveCount(0)
})

Given('I open the scenario {string} as a workbench tab', async ({}, name: string) => {
  const p = requirePage()
  await sidebarRowByName(p, name).click()
  await expect(p.locator('[data-testid="scenario-editor"]').first()).toBeVisible({ timeout: 15000 })
})

Given('I open the request {string} as a workbench tab', async ({}, name: string) => {
  const p = requirePage()
  await sidebarRowByName(p, name).click()
  await expect(p.locator('.editor-group-container').first()).toBeVisible({ timeout: 15000 })
})

let baselineNodeIds: string[] = []

Given('I count the scenario graph nodes', async ({}) => {
  const p = requirePage()
  const nodes = p.locator('[data-testid="scenario-editor"] .react-flow__node')
  baselineNodeCount = await nodes.count()
  baselineNodeIds = (await nodes.evaluateAll((els) => els.map((el) => el.getAttribute('data-id')))).filter((id): id is string => id !== null)
})

When('I activate the workbench tab {string}', async ({}, title: string) => {
  // Clicking a request row focused ITS tab — the scenario editor behind it
  // is display:none, and a drop on a hidden canvas lands at (0,0) without
  // exercising the real gesture. Re-activate the scenario tab first.
  const p = requirePage()
  const tab = p.locator('.tab').filter({ has: p.getByText(title, { exact: true }) }).first()
  await tab.click()
  await expect(p.locator('[data-testid="scenario-editor"]').first()).toBeVisible({ timeout: 10000 })
})

Given('I create a root environment folder from the empty-area menu', async ({}) => {
  const p = requirePage()
  // Dispatch `contextmenu` directly: Playwright's right-click also emits the
  // trailing mousedown/up pair, and the freshly-opened menu's click-away
  // dismiss catches it — the menu closes the same tick it opened.
  await p.evaluate(() => {
    const area = document.querySelector('[data-testid="sidebar-empty-area"]')
    if (!area) throw new Error('sidebar empty area not found')
    const rect = area.getBoundingClientRect()
    const x = rect.left + 40
    const y = rect.bottom - 40
    const target = document.elementFromPoint(x, y) ?? area
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  })
  const menu = p.locator('[data-testid="sidebar-empty-area-context-menu"]')
  await expect(menu).toBeVisible({ timeout: 5000 })
  await menu.locator('#add-root-child').hover()
  const envEntry = p.locator('#add-env-folder')
  await expect(envEntry).toBeVisible({ timeout: 5000 })
  await envEntry.click()
  // The new folder lands in inline rename — accept the default name.
  const renameInput = p.locator('[data-testid="sidebar-listview-rename-input"]')
  await expect(renameInput).toBeVisible({ timeout: 5000 })
  await renameInput.press('Enter')
  await expect(sidebarRowByName(p, 'New Environment Folder')).toBeVisible({ timeout: 5000 })
})

When('I click the sidebar row {string}', async ({}, name: string) => {
  await sidebarRowByName(requirePage(), name).click()
})

When('I ctrl-click the sidebar row {string}', async ({}, name: string) => {
  await sidebarRowByName(requirePage(), name).click({ modifiers: ['Control'] })
})

When('I start dragging the sidebar row {string}', async ({}, name: string) => {
  const p = requirePage()
  dragAnchorId = await itemIdForRow(p, name)
  await startDragFromRow(p, dragAnchorId)
})

When('I hover the drag over the row {string} for {float} seconds', async ({}, name: string, seconds: number) => {
  const p = requirePage()
  const targetId = await itemIdForRow(p, name)
  await hoverDragOver(p, rowSelector(targetId), 0.5, 0.5)
  await p.waitForTimeout(Math.round(seconds * 1000))
})

When('I drag the sidebar selection onto the middle of row {string}', async ({}, name: string) => {
  const p = requirePage()
  // Anchor the drag on the first selected row.
  const anchor = p.locator('[data-testid="sidebar-listview"] .list-view-row[aria-selected="true"]').first()
  const anchorId = await anchor.getAttribute('data-item-id')
  if (!anchorId) throw new Error('no selected row to drag')
  const targetId = await itemIdForRow(p, name)
  await startDragFromRow(p, anchorId)
  await dropDragOn(p, rowSelector(targetId), 0.5, 0.5, anchorId)
})

When('I drag the sidebar row {string} onto the middle of row {string}', async ({}, sourceName: string, targetName: string) => {
  const p = requirePage()
  const sourceId = await itemIdForRow(p, sourceName)
  const targetId = await itemIdForRow(p, targetName)
  await startDragFromRow(p, sourceId)
  await dropDragOn(p, rowSelector(targetId), 0.5, 0.5, sourceId)
})

When('I drag the sidebar row {string} below the last root row', async ({}, sourceName: string) => {
  const p = requirePage()
  const sourceId = await itemIdForRow(p, sourceName)
  const lastRoot = p.locator('[data-testid="sidebar-listview"] .list-view-row[data-depth="0"]').last()
  const targetId = await lastRoot.getAttribute('data-item-id')
  if (!targetId) throw new Error('no last root row')
  await startDragFromRow(p, sourceId)
  // relY 0.9 lands in the AFTER band of getDropPosition.
  await dropDragOn(p, rowSelector(targetId), 0.5, 0.9, sourceId)
})

When('I hover the drag over the sidebar empty area for {float} seconds', async ({}, seconds: number) => {
  const p = requirePage()
  // The empty area is the scrollable content BELOW the last row — aim just
  // under it (the content div spans the full pane height).
  await p.evaluate(() => {
    const dt = (window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt
    if (!dt) throw new Error('no in-flight drag')
    const content = document.querySelector('[data-testid="sidebar-listview"] .scrollable-content')
    if (!content) throw new Error('sidebar content not found')
    const rows = content.querySelectorAll('.list-view-row')
    const last = rows[rows.length - 1]
    const lastBottom = last ? last.getBoundingClientRect().bottom : content.getBoundingClientRect().top
    const rect = content.getBoundingClientRect()
    const clientX = Math.round(rect.left + rect.width / 2)
    const clientY = Math.round(Math.min(rect.bottom - 10, lastBottom + 60))
    for (const type of ['dragenter', 'dragover']) {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX, clientY })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      ;(document.elementFromPoint(clientX, clientY) ?? content).dispatchEvent(ev)
    }
  })
  await p.waitForTimeout(Math.round(seconds * 1000))
})

When('I drop the drag on the sidebar empty area', async ({}) => {
  const p = requirePage()
  await p.evaluate(() => {
    const dt = (window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt
    if (!dt) throw new Error('no in-flight drag')
    const content = document.querySelector('[data-testid="sidebar-listview"] .scrollable-content')
    if (!content) throw new Error('sidebar content not found')
    const rows = content.querySelectorAll('.list-view-row')
    const last = rows[rows.length - 1]
    const rect = content.getBoundingClientRect()
    const lastBottom = last ? last.getBoundingClientRect().bottom : rect.top
    const clientX = Math.round(rect.left + rect.width / 2)
    const clientY = Math.round(Math.min(rect.bottom - 10, lastBottom + 60))
    const target = document.elementFromPoint(clientX, clientY) ?? content
    for (const type of ['dragover', 'drop']) {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX, clientY })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      target.dispatchEvent(ev)
    }
    delete (window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt
  })
  dragAnchorId = null
  await p.waitForTimeout(300)
})

Then('the sidebar row {string} should still be collapsed', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowByName(p, name)).toHaveAttribute('aria-expanded', 'false')
})

When('I drag the sidebar selection onto the scenario canvas', async ({}) => {
  const p = requirePage()
  const anchor = p.locator('[data-testid="sidebar-listview"] .list-view-row[aria-selected="true"]').first()
  const anchorId = await anchor.getAttribute('data-item-id')
  if (!anchorId) throw new Error('no selected row to drag')
  await startDragFromRow(p, anchorId)
  await dropDragOn(p, '[data-testid="scenario-editor"] .react-flow__pane', 0.5, 0.5, anchorId)
})

When('I drag the sidebar selection over the workbench surface', async ({}) => {
  const p = requirePage()
  const anchor = p.locator('[data-testid="sidebar-listview"] .list-view-row[aria-selected="true"]').first()
  const anchorId = await anchor.getAttribute('data-item-id')
  if (!anchorId) throw new Error('no selected row to drag')
  await startDragFromRow(p, anchorId)
  await hoverDragOver(p, '.editor-group-container', 0.5, 0.5)
  await p.waitForTimeout(300)
})

Then('the sidebar rows {string} and {string} should both be selected', async ({}, a: string, b: string) => {
  const p = requirePage()
  await expect(sidebarRowByName(p, a)).toHaveAttribute('aria-selected', 'true')
  await expect(sidebarRowByName(p, b)).toHaveAttribute('aria-selected', 'true')
})

Then('the folder {string} should list {string} then {string} as its last children', async ({}, folderName: string, a: string, b: string) => {
  const p = requirePage()
  const folderId = await itemIdForRow(p, folderName)
  const aRow = sidebarRowByName(p, a)
  const bRow = sidebarRowByName(p, b)
  await expect(aRow).toBeVisible({ timeout: 10000 })
  await expect(bRow).toBeVisible({ timeout: 10000 })
  // Both rows sit DEEPER than the folder and AFTER it in DOM order, with the
  // moved pair keeping its visual order (a before b).
  const folderDepth = Number(await p.locator(rowSelector(folderId)).getAttribute('data-depth'))
  expect(Number(await aRow.getAttribute('data-depth'))).toBe(folderDepth + 1)
  expect(Number(await bRow.getAttribute('data-depth'))).toBe(folderDepth + 1)
  const ids = await p.locator('[data-testid="sidebar-listview"] .list-view-row').evaluateAll(
    (rows) => rows.map((r) => r.getAttribute('data-item-id'))
  )
  const aId = await aRow.getAttribute('data-item-id')
  const bId = await bRow.getAttribute('data-item-id')
  expect(ids.indexOf(String(aId))).toBeGreaterThan(ids.indexOf(folderId))
  expect(ids.indexOf(String(bId))).toBe(ids.indexOf(String(aId)) + 1)
})

Then('the first sidebar root row should be {string}', async ({}, name: string) => {
  const p = requirePage()
  const first = p.locator('[data-testid="sidebar-listview"] .list-view-row[data-depth="0"]').first()
  await expect(first).toContainText(name)
})

Then('the last sidebar root row should be {string}', async ({}, name: string) => {
  const p = requirePage()
  const last = p.locator('[data-testid="sidebar-listview"] .list-view-row[data-depth="0"]').last()
  await expect(last).toContainText(name, { timeout: 10000 })
})

Then('the sidebar row {string} should still be a root row', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowByName(p, name)).toHaveAttribute('data-depth', '0')
})

Then('the folder {string} should not contain {string}', async ({}, folderName: string, childName: string) => {
  const p = requirePage()
  await expandRowIfCollapsed(p, folderName)
  const folderId = await itemIdForRow(p, folderName)
  const childId = await itemIdForRow(p, childName)
  const folderDepth = Number(await p.locator(rowSelector(folderId)).getAttribute('data-depth'))
  const childDepth = Number(await p.locator(rowSelector(childId)).getAttribute('data-depth'))
  expect(childDepth).toBeLessThanOrEqual(folderDepth)
})

Then('the sidebar row {string} should be expanded', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowByName(p, name)).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 })
  // Tidy up the in-flight drag so the fixture teardown never sees a stray ghost.
  if (dragAnchorId) {
    await p.evaluate((id) => {
      const dt = (window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt
      const source = document.querySelector(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${id}"]`)
      if (source && dt) {
        const end = new DragEvent('dragend', { bubbles: true, cancelable: true })
        Object.defineProperty(end, 'dataTransfer', { value: dt })
        source.dispatchEvent(end)
      }
      delete (window as unknown as { __e2eDragDt?: DataTransfer }).__e2eDragDt
    }, dragAnchorId)
    dragAnchorId = null
  }
})

Then('the scenario graph should have {int} more nodes', async ({}, extra: number) => {
  const p = requirePage()
  await expect
    .poll(() => p.locator('[data-testid="scenario-editor"] .react-flow__node').count(), { timeout: 10000 })
    .toBe(baselineNodeCount + extra)
})

Then('the two newest actions should be offset by the duplication step', async ({}) => {
  const p = requirePage()
  const nodes = p.locator('[data-testid="scenario-editor"] .react-flow__node')
  const fresh = (await nodes.evaluateAll((els) => els.map((el) => ({
    id: el.getAttribute('data-id'),
    transform: (el as HTMLElement).style.transform
  })))).filter((n): n is { id: string; transform: string } => n.id !== null && !baselineNodeIds.includes(n.id))
  expect(fresh).toHaveLength(2)
  const parse = (transform: string): { x: number; y: number } => {
    const m = /translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/.exec(transform)
    if (!m) throw new Error(`unparseable node transform: ${transform}`)
    return { x: Number(m[1]), y: Number(m[2]) }
  }
  const [a, b] = fresh.map((n) => parse(n.transform))
  if (!a || !b) throw new Error('missing node positions')
  // The multi-drop fans actions out with the SAME step a duplicated action
  // uses (PASTE_STEP = 40 flow units on both axes).
  expect(Math.abs(Math.abs(b.x - a.x) - 40)).toBeLessThanOrEqual(1)
  expect(Math.abs(Math.abs(b.y - a.y) - 40)).toBeLessThanOrEqual(1)
})

Then('no workbench drop overlay should be visible', async ({}) => {
  const p = requirePage()
  // The split overlay element is ALWAYS mounted (one per editor group) and
  // fades in via opacity when a drag is overlay-eligible — a multi-item
  // sidebar drag must leave every one of them at opacity 0. Asserting on
  // the mounted elements (and requiring at least one) keeps this check
  // honest: a wrong selector would find nothing and prove nothing.
  const overlays = p.locator('[data-testid^="workbench-"][data-testid$="-overlay"]')
  expect(await overlays.count()).toBeGreaterThan(0)
  const opacities = await overlays.evaluateAll((els) => els.map((el) => window.getComputedStyle(el).opacity))
  for (const opacity of opacities) expect(Number(opacity)).toBe(0)
})
