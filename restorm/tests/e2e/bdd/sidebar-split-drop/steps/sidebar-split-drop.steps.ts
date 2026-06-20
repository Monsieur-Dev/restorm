import { createBdd } from 'playwright-bdd'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, SIDEBAR_SPLIT_DROP_TEMP_DIR } from '../../fixtures/sidebar-split-drop.fixture'
import { setupReferenceWorkingCopy } from '../../scenario-runlog/runLogShared'

const { Given, When, Then } = createBdd(test)

// MIME marking a ListView item drag — must match LIST_VIEW_DRAG_MIME in ECUI.
const LIST_VIEW_DRAG_MIME = 'application/x-listview-item'

let electronApp: ElectronApplication | null = null
let page: Page | null = null
let lastNodeCount = 0

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
  const row = sidebarRowByName(p, name)
  await expect(row).toBeVisible({ timeout: 15000 })
  const expanded = await row.getAttribute('aria-expanded')
  if (expanded !== 'true') await row.click()
}

/** Number of open editor groups (tab strips) in the workbench. */
async function editorGroupCount(p: Page): Promise<number> {
  return p.locator('.editor-group-container').count()
}

/**
 * Drive an HTML5 drag of a sidebar row onto a target element, releasing at a
 * relative position inside the target. Dispatches a manual DnD sequence sharing
 * one `DataTransfer` carrying the ListView payload (item id on `text/plain` +
 * the marker MIME) so the workbench's / scenario's NATIVE drop listeners fire
 * deterministically — Playwright's mouse-based dragTo is unreliable for HTML5
 * DnD under xvfb, and a real DataTransfer is what the handlers read.
 */
async function dragSidebarItemToTarget(
  p: Page,
  itemId: string,
  targetSelector: string,
  relX: number,
  relY: number
): Promise<void> {
  await p.locator(targetSelector).first().waitFor({ state: 'visible', timeout: 10000 })
  await p.evaluate(
    ({ itemId, targetSelector, relX, relY, mime }) => {
      const target = document.querySelector(targetSelector)
      if (!target) throw new Error(`drop target not found: ${targetSelector}`)
      const rect = target.getBoundingClientRect()
      const clientX = Math.round(rect.left + rect.width * relX)
      const clientY = Math.round(rect.top + rect.height * relY)
      const dt = new DataTransfer()
      dt.setData('text/plain', itemId)
      dt.setData(mime, itemId)
      const fire = (type: string): void => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX, clientY })
        // jsdom/Chromium: assign the shared DataTransfer (read-only via ctor).
        Object.defineProperty(ev, 'dataTransfer', { value: dt })
        target.dispatchEvent(ev)
      }
      fire('dragenter')
      fire('dragover')
      fire('drop')
    },
    { itemId, targetSelector, relX, relY, mime: LIST_VIEW_DRAG_MIME }
  )
}

async function itemIdForRow(p: Page, name: string): Promise<string> {
  const row = sidebarRowByName(p, name)
  await expect(row).toBeVisible({ timeout: 10000 })
  const id = await row.getAttribute('data-item-id')
  if (!id) throw new Error(`sidebar row "${name}" has no data-item-id`)
  return id
}

Given('the sidebar-split-drop reference project is open', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const workingCopy = setupReferenceWorkingCopy(SIDEBAR_SPLIT_DROP_TEMP_DIR)
  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: workingCopy })
  await requirePage().locator('[data-testid="titlebar-menubar-item-file"]').click()
  await requirePage().locator('[data-testid="titlebar-menu-item-open"]').first().click()

  await expect(sidebarRowByName(requirePage(), 'Auth Service')).toBeVisible({ timeout: 15000 })
})

Given('I expand the path {string} then {string}', async ({}, a: string, b: string) => {
  const p = requirePage()
  await expandRowIfCollapsed(p, a)
  await expandRowIfCollapsed(p, b)
})

Given('I open the request {string} as a workbench tab', async ({}, name: string) => {
  const p = requirePage()
  await sidebarRowByName(p, name).click()
  // The request tab content renders a breadcrumb + the request editor; wait for
  // the workbench group to hold a content placeholder.
  await expect(p.locator('.editor-group-content-placeholder').first()).toBeVisible({ timeout: 15000 })
})

Given('I open the scenario {string} as a workbench tab', async ({}, name: string) => {
  const p = requirePage()
  await sidebarRowByName(p, name).click()
  await expect(p.locator('[data-testid="scenario-editor"]').first()).toBeVisible({ timeout: 15000 })
})

Given('the workbench has {int} editor group', async ({}, count: number) => {
  await expect.poll(() => editorGroupCount(requirePage()), { timeout: 10000 }).toBe(count)
})

Given('I count the scenario graph nodes', async ({}) => {
  const p = requirePage()
  lastNodeCount = await p.locator('[data-testid="scenario-editor"] .react-flow__node').count()
})

When('I drag the sidebar request {string} onto the open tab {string} edge', async ({}, name: string, edge: string) => {
  const p = requirePage()
  const itemId = await itemIdForRow(p, name)
  // 10% margin zones in EditorGroupView: aim well inside the edge band.
  const rel = edge === 'right' ? { x: 0.95, y: 0.5 }
    : edge === 'left' ? { x: 0.05, y: 0.5 }
      : edge === 'top' ? { x: 0.5, y: 0.05 }
        : { x: 0.5, y: 0.95 }
  await dragSidebarItemToTarget(p, itemId, '.editor-group-content-placeholder', rel.x, rel.y)
})

When('I drag the sidebar request {string} onto the open tab {string} zone', async ({}, name: string, zone: string) => {
  const p = requirePage()
  const itemId = await itemIdForRow(p, name)
  if (zone !== 'center') throw new Error(`unexpected zone: ${zone}`)
  await dragSidebarItemToTarget(p, itemId, '.editor-group-content-placeholder', 0.5, 0.5)
})

When('I drag the sidebar request {string} onto the open scenario surface', async ({}, name: string) => {
  const p = requirePage()
  const itemId = await itemIdForRow(p, name)
  // Drop on the React Flow PANE (a descendant of the scenario wrapper), not the
  // wrapper itself: that mirrors the real gesture (the canvas is what's under
  // the cursor) and is where a previous regression hid — a native-listener
  // drop handler never fired over the pane, so the add was silently lost while
  // the wrapper-targeted test stayed green. Dropping here keeps the test honest.
  await dragSidebarItemToTarget(p, itemId, '[data-testid="scenario-editor"] .react-flow__pane', 0.5, 0.5)
})

Then('the workbench has {int} editor groups', async ({}, count: number) => {
  await expect.poll(() => editorGroupCount(requirePage()), { timeout: 10000 }).toBe(count)
})

Then('the workbench still has {int} editor group', async ({}, count: number) => {
  // Give a split a chance to (wrongly) appear, then assert it did NOT.
  await requirePage().waitForTimeout(500)
  expect(await editorGroupCount(requirePage())).toBe(count)
})

Then('a workbench tab for {string} is open', async ({}, name: string) => {
  const p = requirePage()
  await expect(
    p.locator('.editor-group-container .tab').filter({ has: p.getByText(name, { exact: false }) }).first()
  ).toBeVisible({ timeout: 10000 })
})

Then('the scenario graph gained a node', async ({}) => {
  const p = requirePage()
  await expect
    .poll(() => p.locator('[data-testid="scenario-editor"] .react-flow__node').count(), { timeout: 10000 })
    .toBeGreaterThan(lastNodeCount)
})
