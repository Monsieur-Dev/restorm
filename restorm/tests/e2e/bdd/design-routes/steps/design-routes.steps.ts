import { createBdd } from 'playwright-bdd'
import { copyFileSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, DESIGN_ROUTES_TEMP_DIR } from '../../fixtures/design-routes.fixture'
import { openDesignSection, addDesignEntity, expandDesignSection, designEntityNode, designEntityNodes, openDesignEntity, deleteDesignEntityNode } from '../../../support/designNav'
import { fillVariableInput, pickSelect, pickSelectExact } from '../../../support/designGuiDriver'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
let projectPath = ''

const DESIGN_SAMPLE = join(__dirname, '../../../samples/api-design-sample.restorm')
const DESIGN_ID = 'design-petstore'

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

function sidebarRow(p: Page, itemId: string): ReturnType<Page['locator']> {
  return p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${itemId}"]`)
}

async function openSection(p: Page, section: 'routes' | 'models'): Promise<void> {
  await openDesignSection(p, DESIGN_ID, section)
  await p.mouse.move(700, 450)
  await expect(p.locator(`[data-testid="design-${section}-section"]`)).toBeVisible({ timeout: 5000 })
}

/** Resolve a route node's item id INSIDE its group in the SIDEBAR: rows are
 * flat DOM siblings, so find the group row by exact title and walk its deeper
 * descendants matching the route TITLE exactly (the summary — or the pattern
 * when the route has none). Exact-name group matching avoids the "PowerUsers vs
 * Users" substring trap. */
async function routeRowId(p: Page, groupName: string, routeTitle: string): Promise<string> {
  const id = await p.evaluate(({ designId, groupName, routeTitle }) => {
    const rows = Array.from(document.querySelectorAll(`[data-testid="sidebar-listview"] .list-view-row[data-item-id^="design-entity:${designId}:routes:"]`))
    const levelOf = (row: Element): number => Number(row.getAttribute('aria-level') ?? row.closest('[aria-level]')?.getAttribute('aria-level') ?? '1')
    const titleOf = (row: Element): string => (row.querySelector('.list-view-title')?.textContent ?? '').trim()
    const gi = rows.findIndex((r) => titleOf(r) === groupName)
    if (gi < 0) return null
    const gl = levelOf(rows[gi])
    for (let i = gi + 1; i < rows.length; i++) {
      if (levelOf(rows[i]) <= gl) break
      if (titleOf(rows[i]) === routeTitle) return rows[i].getAttribute('data-item-id')
    }
    return null
  }, { designId: DESIGN_ID, groupName, routeTitle })
  if (id === null) throw new Error(`route "${routeTitle}" not found under group ${groupName}`)
  return id
}

async function openRoute(p: Page, groupName: string, routeTitle: string): Promise<void> {
  await expandDesignSection(p, DESIGN_ID, 'routes')
  // Select + expand the group so its routes are in the tree.
  const groupRow = designEntityNode(p, DESIGN_ID, 'routes', groupName)
  await expect(groupRow).toBeVisible({ timeout: 5000 })
  await groupRow.click()
  await p.waitForTimeout(300)
  const chevron = groupRow.locator('button:has(.codicon-chevron-right)')
  if (await chevron.count() > 0) {
    await chevron.click()
    await p.waitForTimeout(300)
  }
  const id = await routeRowId(p, groupName, routeTitle)
  await p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${id}"]`).click()
  await expect(p.locator('[data-testid="design-route-tabs"]')).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(300)
}

Given('a Pro project carrying an API design is open in the routes editor', async ({ launchApp }) => {
  const launched = await launchApp({ plan: 'pro' })
  page = launched.page
  projectPath = join(DESIGN_ROUTES_TEMP_DIR, 'design-routes.restorm')
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
  await sidebarRow(p, DESIGN_ID).click()
  await expect(p.locator(`[data-testid="design-tab-view-${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  await openSection(p, 'routes')
})

// ── Groups ────────────────────────────────────────────────────────────

When('I add a route group', async () => {
  const p = requirePage()
  await addDesignEntity(p, DESIGN_ID, 'routes', /Add a group/)
  await p.waitForTimeout(400)
})

Then('the group card is shown', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-group-name"]')).toBeVisible({ timeout: 5000 })
})

When('I set the group base path to {string}', async ({}, basePath: string) => {
  const p = requirePage()
  const input = p.locator('[data-testid="design-group-base-path-input"]')
  await input.click()
  await input.fill(basePath)
  await input.blur()
  await p.waitForTimeout(400)
})

When('I add a route to the selected group', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-group-add-route"]').click()
  await expect(p.locator('[data-testid="design-route-tabs"]')).toBeVisible({ timeout: 5000 })
})

// ── Route definition ──────────────────────────────────────────────────

When('I set the route path to {string}', async ({}, path: string) => {
  const p = requirePage()
  // The path is a RestormVariableInputBox (Monaco), testid `design-route-path`
  // → editor `design-route-path-codeeditor` (no `-input`). Typing fires
  // syncPathParams, which auto-creates/removes the path-param rows.
  await fillVariableInput(p, 'design-route-path', path)
  await p.waitForTimeout(500)
})

Then('the path parameter row {string} exists', async ({}, name: string) => {
  const p = requirePage()
  await expect(p.locator('.design-param-name').filter({ hasText: `{{${name}}}` })).toHaveCount(1, { timeout: 5000 })
})

Then('no path parameter row exists', async () => {
  const p = requirePage()
  await expect(p.locator('.design-param-name')).toHaveCount(0, { timeout: 5000 })
})

Then('the resolved path line reads {string}', async ({}, expected: string) => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-route-resolved"]')).toHaveText(expected, { timeout: 5000 })
})

When('I open the route {string} of the group {string}', async ({}, routeTitle: string, groupName: string) => {
  const p = requirePage()
  // Routes are addressed by their DISPLAYED name — the summary (or the
  // raw pattern for a summary-less route), exactly what the user reads.
  await openRoute(p, groupName, routeTitle)
})

Then('the parameter {string} shows the inherited type {string}', async ({}, name: string, typeText: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-param-type-${name}"]`)).toHaveText(typeText, { timeout: 5000 })
})

Then('the parameter {string} carries the auto description badge', async ({}, name: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-param-auto-${name}"]`)).toBeVisible({ timeout: 5000 })
})

Then('the parameter {string} link points at {string}', async ({}, name: string, label: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-param-link-${name}-trigger"]`)).toContainText(label, { timeout: 5000 })
})

Then('the query parameter row {string} exists', async ({}, name: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-param-link-${name}-trigger"]`)).toBeVisible({ timeout: 5000 })
})

Then('the body combo shows {string}', async ({}, label: string) => {
  const p = requirePage()
  const expected = label === '(empty)' ? /\(vide\)|\(empty\)/ : new RegExp(label)
  await expect(p.locator('[data-testid="design-route-body-trigger"]')).toHaveText(expected, { timeout: 5000 })
})

When('I set the route method to {string}', async ({}, method: string) => {
  await pickSelect(requirePage(), 'design-route-method', method)
})

Then('the request body non-standard hint is visible', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-route-body-nonstandard-hint"]')).toBeVisible({ timeout: 5000 })
})

Then('the request body non-standard hint is not visible', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-route-body-nonstandard-hint"]')).toHaveCount(0, { timeout: 5000 })
})

When('I add a query parameter', async () => {
  await requirePage().locator('[data-testid="design-route-add-param"]').click()
  await requirePage().waitForTimeout(250)
})

When('I type the query parameter {string} as the enum {string} via the type control', async ({}, name: string, enumName: string) => {
  // The compact type combo lists the design's named enums directly (no modal).
  await pickSelectExact(requirePage(), `design-param-type-${name}`, `${enumName} (enum)`)
})

Then('the query parameter {string} type reads {string}', async ({}, name: string, summary: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-param-type-${name}-trigger"]`)).toHaveText(new RegExp(summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 5000 })
})

// ── Models-side actions (rename / delete / generators) ────────────────

When('I open the models section and rename the property {string} of {string} to {string}', async ({}, propName: string, modelName: string, newName: string) => {
  const p = requirePage()
  await openSection(p, 'models')
  await openDesignEntity(p, DESIGN_ID, 'models', modelName)
  await p.waitForTimeout(400)
  await p.locator('.design-prop-cell').filter({ has: p.getByText(propName, { exact: true }) }).first().click()
  await expect(p.locator('[data-testid="design-property-name-input"]')).toBeVisible({ timeout: 5000 })
  const input = p.locator('[data-testid="design-property-name-input"]')
  await input.click()
  await input.fill(newName)
  await input.blur()
  await p.waitForTimeout(500)
})

When('I open the routes section', async () => {
  const p = requirePage()
  await openSection(p, 'routes')
})

When('I open the models section and delete the model {string}', async ({}, modelName: string) => {
  const p = requirePage()
  await openSection(p, 'models')
  await deleteDesignEntityNode(p, DESIGN_ID, 'models', modelName)
  await expect(p.locator('[data-testid="design-model-delete-modal"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="design-model-delete-confirm"]').click()
  await p.waitForTimeout(500)
})

When('I open the models section and generate the CRUD of {string}', async ({}, modelName: string) => {
  const p = requirePage()
  await openSection(p, 'models')
  await openDesignEntity(p, DESIGN_ID, 'models', modelName)
  await p.waitForTimeout(400)
  await p.locator('[data-testid="design-model-tabs"] [role="tab"][data-tab-id="settings"]').click()
  await p.locator('[data-testid="design-model-generate-crud"]').click()
  // Generation opens a confirm modal (replace / auth-writes options); confirm it.
  await expect(p.locator('[data-testid="design-crud-modal"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="design-crud-confirm"]').click()
  await expect(p.locator('[data-testid="design-crud-modal"]')).toHaveCount(0, { timeout: 5000 })
  // The generator jumps to the routes section on the fresh group.
  await expect(p.locator('[data-testid="design-routes-section"]')).toBeVisible({ timeout: 5000 })
})

When('I open the models section and generate the search routes of {string}', async ({}, modelName: string) => {
  const p = requirePage()
  await openSection(p, 'models')
  await openDesignEntity(p, DESIGN_ID, 'models', modelName)
  await p.waitForTimeout(400)
  await p.locator('[data-testid="design-model-tabs"] [role="tab"][data-tab-id="settings"]').click()
  await p.locator('[data-testid="design-model-generate-search"]').click()
  await expect(p.locator('[data-testid="design-routes-section"]')).toBeVisible({ timeout: 5000 })
})

Then('the models list offers {string}', async ({}, modelName: string) => {
  const p = requirePage()
  await expandDesignSection(p, DESIGN_ID, 'models')
  await expect(designEntityNodes(p, DESIGN_ID, 'models', modelName)).toHaveCount(1, { timeout: 5000 })
  await openSection(p, 'routes')
})

Then('the routes tree shows the group {string} with {int} routes', async ({}, groupName: string, count: number) => {
  const p = requirePage()
  await expandDesignSection(p, DESIGN_ID, 'routes')
  const groupRow = designEntityNode(p, DESIGN_ID, 'routes', groupName)
  await expect(groupRow).toBeVisible({ timeout: 5000 })
  const chevron = groupRow.locator('button:has(.codicon-chevron-right)')
  if (await chevron.count() > 0) {
    await chevron.click()
    await p.waitForTimeout(300)
  }
  // Routes moved into the sidebar tree: count the group's DIRECT route children
  // (one aria-level deeper, excluding sub-group folder nodes).
  const actual = await p.evaluate(({ designId, name }: { designId: string, name: string }) => {
    const rows = Array.from(document.querySelectorAll(`[data-testid="sidebar-listview"] .list-view-row[data-item-id^="design-entity:${designId}:routes:"]`))
    const levelOf = (row: Element): number => Number(row.getAttribute('aria-level') ?? '1')
    const titleOf = (row: Element): string => (row.querySelector('.list-view-title')?.textContent ?? '').trim()
    const gi = rows.findIndex((r) => titleOf(r) === name)
    if (gi < 0) return -1
    const gl = levelOf(rows[gi])
    let n = 0
    for (let i = gi + 1; i < rows.length; i++) {
      const l = levelOf(rows[i])
      if (l <= gl) break
      if (l === gl + 1 && rows[i].querySelector('.codicon-folder') === null) n += 1
    }
    return n
  }, { designId: DESIGN_ID, name: groupName })
  expect(actual).toBe(count)
})

// ── Responses ─────────────────────────────────────────────────────────

When('I open the route responses tab', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-route-tabs"] [role="tab"][data-tab-id="responses"]').click()
  await expect(p.locator('[data-testid^="design-route-responses-"]')).toBeVisible({ timeout: 5000 })
})

When('I add the response code {string}', async ({}, code: string) => {
  const p = requirePage()
  const input = p.locator('[data-testid="design-response-new-code-input"]')
  await input.click()
  await input.fill(code)
  await p.waitForTimeout(500)
  await p.locator('[data-testid="design-response-add"]').click()
  await p.waitForTimeout(400)
})

Then('the response row {string} exists', async ({}, code: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-response-${code}"]`)).toBeVisible({ timeout: 5000 })
})

Then('the response row {string} does not exist', async ({}, code: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-response-${code}"]`)).toHaveCount(0, { timeout: 5000 })
})

When('I post the standard errors', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-response-standard-errors"]').click()
  await p.waitForTimeout(500)
})

When('I delete the response {string}', async ({}, code: string) => {
  const p = requirePage()
  // The header click TOGGLES the accordion — only expand when the
  // delete affordance is not already on screen.
  const deleteButton = p.locator(`[data-testid="design-response-delete-${code}"]`)
  if (await deleteButton.count() === 0) {
    await p.locator(`[data-testid="design-response-header-${code}"]`).click()
  }
  await deleteButton.click()
  await p.waitForTimeout(400)
})

// ── Settings ──────────────────────────────────────────────────────────

When('I open the route settings tab', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-route-tabs"] [role="tab"][data-tab-id="settings"]').click()
  await expect(p.locator('[data-testid^="design-route-settings-"]')).toBeVisible({ timeout: 5000 })
})

When('I set the cache seconds to {string}', async ({}, value: string) => {
  const p = requirePage()
  const input = p.locator('[data-testid="design-route-cache-input"]')
  await input.click()
  await input.fill(value)
  await input.blur()
  await p.waitForTimeout(400)
})

When('I toggle the route deprecated flag', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-route-deprecated"]').click()
  await p.waitForTimeout(300)
})

When('I click the edit-in-group link', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-route-open-group"]').click()
  await p.waitForTimeout(400)
})

// ── Save / file assertions ────────────────────────────────────────────

When('I save the project', async () => {
  const p = requirePage()
  await p.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', code: 'KeyS', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
    }))
  })
  await p.waitForTimeout(1500)
})

Then('the saved file still links the parameter to the property id {string}', async ({}, propertyId: string) => {
  const saved = readFileSync(projectPath, 'utf-8')
  expect(saved).toContain(`propertyId: ${propertyId}`)
  // The rename reached the property itself.
  expect(saved).toContain('name: uid')
})

Then('the saved file carries cacheSeconds 120 and a deprecated route', async () => {
  const saved = readFileSync(projectPath, 'utf-8')
  expect(saved).toContain('cacheSeconds: 120')
  expect(saved).toContain('deprecated: true')
})
