import { createBdd } from 'playwright-bdd'
import { copyFileSync } from 'fs'
import { createServer, type Server } from 'net'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, DESIGN_SERVER_TEMP_DIR } from '../../fixtures/design-server.fixture'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
let portBlocker: Server | null = null

const DESIGN_SAMPLE = join(__dirname, '../../../samples/api-design-server-sample.restorm')
const DESIGN_ID = 'design-petstore'
const SERVED_PORT = 7482

/** Sidebar row title → the pre-authored request's item id in the sample. */
const REQUEST_IDS: Record<string, string> = {
  'List users': 'req-design-list',
  'Get one user': 'req-design-get',
  'Create user (invalid)': 'req-design-create-invalid',
  'List users without auth': 'req-design-noauth',
  'Served OpenAPI document': 'req-design-swagger'
}

/** Route summary → the route's id in the sample design. */
const ROUTE_IDS: Record<string, string> = {
  'Fetch one user': 'route-user-get',
  'List users': 'route-user-list',
  'Create a user': 'route-user-create'
}

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

function sidebarRow(p: Page, itemId: string): ReturnType<Page['locator']> {
  return p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${itemId}"]`)
}

/** Focus the design tab (opens it when needed) and settle. */
async function focusDesignTab(p: Page): Promise<void> {
  await sidebarRow(p, DESIGN_ID).click()
  await expect(p.locator(`[data-testid="design-tab-view-${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  await p.mouse.move(700, 450)
  await p.waitForTimeout(300)
}

/** Switch the response panel to the "Infos" sub-tab (status DOM). */
async function openInfosTab(p: Page): Promise<void> {
  const responseTabs = p.locator('[data-testid="base-request-tabs-response"]').first()
  await responseTabs.waitFor({ state: 'visible', timeout: 20_000 })
  await responseTabs.locator('[role="tab"]', { hasText: 'Infos' }).first().click({ timeout: 10_000 })
}

/** Switch the response panel to the "Response" sub-tab (body editor). */
async function openResponseTab(p: Page): Promise<void> {
  const responseTabs = p.locator('[data-testid="base-request-tabs-response"]').first()
  await responseTabs.waitFor({ state: 'visible', timeout: 20_000 })
  await responseTabs.locator('[role="tab"]', { hasText: 'Response' }).first().click({ timeout: 10_000 })
}

Given('a Pro project carrying a servable API design is open on its settings', async ({ launchApp }) => {
  const launched = await launchApp({ plan: 'pro' })
  page = launched.page
  const projectPath = join(DESIGN_SERVER_TEMP_DIR, 'design-server.restorm')
  copyFileSync(DESIGN_SAMPLE, projectPath)
  const p = page
  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (fp: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)
  await expect(sidebarRow(p, DESIGN_ID)).toBeVisible({ timeout: 10000 })
  await p.waitForTimeout(800)
  await focusDesignTab(p)
  // The serve controls + run panel now live in their own Server section.
  await p.locator('[data-testid="design-rail-server"]').click()
  await expect(p.locator('[data-testid="design-serve-block"]')).toBeVisible({ timeout: 5000 })
})

Given('the design port is already occupied', async () => {
  portBlocker = createServer()
  await new Promise<void>((resolve, reject) => {
    portBlocker?.once('error', reject)
    portBlocker?.listen(SERVED_PORT, '127.0.0.1', () => { resolve() })
  })
})

When('I spin the design server', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-serve-spin"]').click()
  await expect(p.locator('[data-testid="design-run-modal"]')).toBeVisible({ timeout: 10000 })
})

When('I try to spin the design server', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-serve-spin"]').click()
  await p.waitForTimeout(500)
})

When('I stop the design server from the run panel', async () => {
  const p = requirePage()
  // The spin above the inline run panel is the single start/stop control.
  await p.locator('[data-testid="design-serve-spin"]').click()
  await p.waitForTimeout(500)
})

Then('the run panel opens listing the design routes with zeroed counters', async () => {
  const p = requirePage()
  for (const routeId of Object.values(ROUTE_IDS)) {
    await expect(p.locator(`[data-testid="design-run-route-${routeId}"]`)).toBeVisible({ timeout: 5000 })
    await expect(p.locator(`[data-testid="design-run-count-${routeId}"]`)).toHaveText('0')
  }
})

Then('the serving beam runs on the design sidebar badge', async () => {
  const p = requirePage()
  const beam = p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${DESIGN_ID}"] .ecu-border-beam`)
  await expect(beam.first()).toBeAttached({ timeout: 10000 })
})

Then('the run panel reports the server stopped', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-run-modal"]')).toBeVisible()
  // The status dot loses its `listening` modifier when the server stops —
  // its absence IS the stopped state (no i18n coupling).
  await expect(p.locator('.design-run-status-dot.listening')).toHaveCount(0, { timeout: 10000 })
  // And the beam winds down on the sidebar badge.
  const beam = p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${DESIGN_ID}"] .ecu-border-beam`)
  await expect(beam).toHaveCount(0, { timeout: 20000 })
})

When('I run the {string} request', async ({}, requestName: string) => {
  const p = requirePage()
  const requestId = REQUEST_IDS[requestName]
  if (requestId === undefined) throw new Error(`unknown sample request "${requestName}"`)
  const row = sidebarRow(p, requestId)
  if (!(await row.isVisible().catch(() => false))) {
    // The requests live under the env folder — expand it once.
    await sidebarRow(p, 'env-design-sample').click()
    await p.waitForTimeout(400)
  }
  await row.click()
  const send = p.locator('[data-testid="http-request-send-button"]:visible').first()
  await expect(send).toBeVisible({ timeout: 10000 })
  await send.click()
  await p.waitForTimeout(500)
})

Then('the response status is {string}', async ({}, status: string) => {
  const p = requirePage()
  await openInfosTab(p)
  const statusEl = p.locator('[data-testid="http-response-status"]:visible').first()
  await expect(statusEl).toBeVisible({ timeout: 20_000 })
  await expect(statusEl).toHaveAttribute('data-status-code', status, { timeout: 10_000 })
})

Then('the response body contains {string}', async ({}, needle: string) => {
  const p = requirePage()
  await openResponseTab(p)
  // Monaco paints asynchronously; poll the editor's text for the needle.
  await expect(async () => {
    const text = await p.locator('[data-testid="base-request-tabs-response"] .monaco-editor').first().innerText()
    expect(text).toContain(needle)
  }).toPass({ timeout: 15_000 })
})

Then('the run panel counts calls on the design routes', async () => {
  const p = requirePage()
  await focusDesignTab(p)
  await p.locator('[data-testid="design-rail-server"]').click()
  await expect(p.locator('[data-testid="design-run-modal"]')).toBeVisible({ timeout: 10000 })
  // List route answered twice (200 with auth, then 401 without), the
  // single fetch once, the invalid create once.
  await expect(p.locator('[data-testid="design-run-count-route-user-list"]')).toHaveText('2', { timeout: 10000 })
  await expect(p.locator('[data-testid="design-run-count-route-user-get"]')).toHaveText('1')
  await expect(p.locator('[data-testid="design-run-count-route-user-create"]')).toHaveText('1')
})

When('I force the {string} route to answer 404', async ({}, routeSummary: string) => {
  const p = requirePage()
  const routeId = ROUTE_IDS[routeSummary]
  if (routeId === undefined) throw new Error(`unknown sample route "${routeSummary}"`)
  await focusDesignTab(p)
  await p.locator(`[data-testid="design-run-route-header-${routeId}"]`).click()
  await p.locator(`[data-testid="design-run-return-404-${routeId}"]`).click()
  await expect(p.locator(`[data-testid="design-run-forced-pill-${routeId}"]`)).toBeVisible({ timeout: 5000 })
})

When('I reset the {string} route to the design response', async ({}, routeSummary: string) => {
  const p = requirePage()
  const routeId = ROUTE_IDS[routeSummary]
  if (routeId === undefined) throw new Error(`unknown sample route "${routeSummary}"`)
  await focusDesignTab(p)
  const header = p.locator(`[data-testid="design-run-route-header-${routeId}"]`)
  const defaultBullet = p.locator(`[data-testid="design-run-return-default-${routeId}"]`)
  if (!(await defaultBullet.isVisible().catch(() => false))) {
    await header.click()
  }
  await defaultBullet.click()
  await expect(p.locator(`[data-testid="design-run-forced-pill-${routeId}"]`)).toHaveCount(0, { timeout: 5000 })
})

/** Open the models section and select the model card by its name. */
async function openModel(p: Page, modelName: string): Promise<void> {
  await p.locator('[data-testid="design-rail-models"]').click()
  await p.mouse.move(700, 450)
  await expect(p.locator('[data-testid="design-models-section"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="design-models-listview"] .list-view-row').filter({ hasText: modelName }).first().click()
  await expect(p.locator('[data-testid="design-model-name"]')).toContainText(modelName, { timeout: 5000 })
}

/** Back to the Server section (where the spin button + run panel live). */
async function backToSettings(p: Page): Promise<void> {
  await p.locator('[data-testid="design-rail-server"]').click()
  await p.mouse.move(700, 450)
  await expect(p.locator('[data-testid="design-serve-block"]')).toBeVisible({ timeout: 5000 })
}

When('I add an unnamed property to the {string} model', async ({}, modelName: string) => {
  const p = requirePage()
  await openModel(p, modelName)
  await p.locator('[data-testid="design-add-property"]').click()
  await expect(p.locator('[data-testid="design-property-name-input"]')).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(400)
  await backToSettings(p)
})

When('I delete the unnamed property of the {string} model', async ({}, modelName: string) => {
  const p = requirePage()
  await openModel(p, modelName)
  await p.locator('.design-prop-cell').filter({ hasText: '(unnamed)' }).first().click()
  const deleteButton = p.locator('[data-testid="design-property-delete"]')
  await expect(deleteButton).toBeVisible({ timeout: 5000 })
  await deleteButton.click()
  await p.waitForTimeout(400)
  await backToSettings(p)
})

Then('the design spin button is disabled', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-serve-spin"]')).toHaveClass(/disabled/, { timeout: 5000 })
})

Then('the design spin button is enabled', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-serve-spin"]')).not.toHaveClass(/disabled/, { timeout: 5000 })
})

Then('a design server error mentions the failed start', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-serve-error"]')).toBeVisible({ timeout: 10000 })
  if (portBlocker !== null) {
    await new Promise<void>((resolve) => { portBlocker?.close(() => { resolve() }) })
    portBlocker = null
  }
})
