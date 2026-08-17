import { createBdd } from 'playwright-bdd'
import { copyFileSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, DESIGN_ROUTES_TEMP_DIR } from '../../fixtures/design-routes.fixture'

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
  await p.locator(`[data-testid="design-rail-${section}"]`).click()
  await p.mouse.move(700, 450)
  await expect(p.locator(`[data-testid="design-${section}-section"]`)).toBeVisible({ timeout: 5000 })
}

/** Resolve a route row's item id INSIDE its group: rows are flat DOM
 * siblings, so walk from the level-1 group row through its level-2
 * children, matching pattern + method badge. */
async function routeRowId(p: Page, groupName: string, method: string, pattern: string): Promise<string> {
  const id = await p.evaluate(({ groupName, method, pattern }) => {
    const rows = Array.from(document.querySelectorAll('[data-testid="design-routes-listview"] .list-view-row'))
    const levelOf = (row: Element): number => Number(row.getAttribute('aria-level') ?? row.closest('[aria-level]')?.getAttribute('aria-level') ?? '1')
    let inGroup = false
    for (const row of rows) {
      const level = levelOf(row)
      const text = row.textContent
      if (level === 1) {
        inGroup = text.includes(groupName)
        continue
      }
      if (!inGroup) continue
      const title = row.querySelector('.list-view-title')?.textContent ?? ''
      if (title.trim() === pattern && text.includes(method)) {
        return row.getAttribute('data-item-id')
      }
    }
    return null
  }, { groupName, method, pattern })
  if (id === null) throw new Error(`route ${method} ${pattern} not found under group ${groupName}`)
  return id
}

async function openRoute(p: Page, groupName: string, method: string, pattern: string): Promise<void> {
  // Ensure the group is expanded (clicking it selects + shows its card;
  // the chevron toggles expansion — click the row first, harmless).
  const groupRow = p.locator('[data-testid="design-routes-listview"] .list-view-row').filter({ has: p.getByText(groupName, { exact: true }) }).first()
  await groupRow.click()
  await p.waitForTimeout(300)
  const chevron = groupRow.locator('button:has(.codicon-chevron-right)')
  if (await chevron.count() > 0) {
    await chevron.click()
    await p.waitForTimeout(300)
  }
  const id = await routeRowId(p, groupName, method, pattern)
  await p.locator(`[data-testid="design-routes-listview"] .list-view-row[data-item-id="${id}"]`).click()
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
  await p.locator('[data-testid="design-routes-add-group"]').click()
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
  const input = p.locator('[data-testid="design-route-path-input"]')
  await input.click()
  await input.fill(path)
  await input.blur()
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

When('I open the route {string} of the group {string}', async ({}, routeSpec: string, groupName: string) => {
  const p = requirePage()
  // "POST /" carries the method; a bare "/{{id}}" defaults to GET.
  const parts = routeSpec.split(' ')
  const [method, pattern] = parts.length === 2 ? [parts[0] ?? 'GET', parts[1] ?? '/'] : ['GET', routeSpec]
  await openRoute(p, groupName, method, pattern)
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

// ── Models-side actions (rename / delete / generators) ────────────────

When('I open the models section and rename the property {string} of {string} to {string}', async ({}, propName: string, modelName: string, newName: string) => {
  const p = requirePage()
  await openSection(p, 'models')
  await p.locator('[data-testid="design-models-listview"] .list-view-row').filter({ has: p.getByText(modelName, { exact: true }) }).first().click()
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
  await p.locator('[data-testid="design-models-listview"] .list-view-row').filter({ has: p.getByText(modelName, { exact: true }) }).first().click()
  await p.waitForTimeout(400)
  await p.locator('[data-testid="design-model-delete"]').click()
  await expect(p.locator('[data-testid="design-model-delete-modal"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="design-model-delete-confirm"]').click()
  await p.waitForTimeout(500)
})

When('I open the models section and generate the CRUD of {string}', async ({}, modelName: string) => {
  const p = requirePage()
  await openSection(p, 'models')
  await p.locator('[data-testid="design-models-listview"] .list-view-row').filter({ has: p.getByText(modelName, { exact: true }) }).first().click()
  await p.waitForTimeout(400)
  await p.locator('[data-testid="design-model-tabs"] [role="tab"][data-tab-id="settings"]').click()
  await p.locator('[data-testid="design-model-generate-crud"]').click()
  // The generator jumps to the routes section on the fresh group.
  await expect(p.locator('[data-testid="design-routes-section"]')).toBeVisible({ timeout: 5000 })
})

When('I open the models section and generate the search routes of {string}', async ({}, modelName: string) => {
  const p = requirePage()
  await openSection(p, 'models')
  await p.locator('[data-testid="design-models-listview"] .list-view-row').filter({ has: p.getByText(modelName, { exact: true }) }).first().click()
  await p.waitForTimeout(400)
  await p.locator('[data-testid="design-model-tabs"] [role="tab"][data-tab-id="settings"]').click()
  await p.locator('[data-testid="design-model-generate-search"]').click()
  await expect(p.locator('[data-testid="design-routes-section"]')).toBeVisible({ timeout: 5000 })
})

Then('the models list offers {string}', async ({}, modelName: string) => {
  const p = requirePage()
  await openSection(p, 'models')
  await expect(
    p.locator('[data-testid="design-models-listview"] .list-view-row').filter({ has: p.getByText(modelName, { exact: true }) })
  ).toHaveCount(1, { timeout: 5000 })
  await openSection(p, 'routes')
})

Then('the routes tree shows the group {string} with {int} routes', async ({}, groupName: string, count: number) => {
  const p = requirePage()
  const groupRow = p.locator('[data-testid="design-routes-listview"] .list-view-row').filter({ has: p.getByText(groupName, { exact: true }) }).first()
  await expect(groupRow).toBeVisible({ timeout: 5000 })
  const chevron = groupRow.locator('button:has(.codicon-chevron-right)')
  if (await chevron.count() > 0) {
    await chevron.click()
    await p.waitForTimeout(300)
  }
  const actual = await p.evaluate((name: string) => {
    const rows = Array.from(document.querySelectorAll('[data-testid="design-routes-listview"] .list-view-row'))
    const levelOf = (row: Element): number => Number(row.getAttribute('aria-level') ?? row.closest('[aria-level]')?.getAttribute('aria-level') ?? '1')
    let inGroup = false
    let n = 0
    for (const row of rows) {
      if (levelOf(row) === 1) {
        inGroup = row.textContent.includes(name)
        continue
      }
      if (inGroup) n += 1
    }
    return n
  }, groupName)
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
