import { createBdd } from 'playwright-bdd'
import { copyFileSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, DESIGN_CREATION_TEMP_DIR } from '../../fixtures/design-creation.fixture'
import { openSectionOfOpenDesign } from '../../../support/designNav'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
let projectPath = ''

const CREATION_SAMPLE = join(__dirname, '../../../samples/api-design-creation-sample.restorm')
const ENV_FOLDER_ID = 'env-design-sample'

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

function sidebarRow(p: Page, itemId: string): ReturnType<Page['locator']> {
  return p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${itemId}"]`)
}

Given('a Pro project with a documented env folder is open', async ({ launchApp }) => {
  const launched = await launchApp({ plan: 'pro' })
  page = launched.page
  projectPath = join(DESIGN_CREATION_TEMP_DIR, 'design-creation.restorm')
  copyFileSync(CREATION_SAMPLE, projectPath)
  const p = page
  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (fp: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)
  await expect(sidebarRow(p, ENV_FOLDER_ID)).toBeVisible({ timeout: 10000 })
  await p.waitForTimeout(800)
})

// ── EmptyBench creation ───────────────────────────────────────────────

When('I click the EmptyBench create-design button', async () => {
  const p = requirePage()
  const button = p.locator('[data-testid="empty-bench-card-create-design-button"]')
  await expect(button).toBeVisible({ timeout: 10000 })
  await button.click()
  await p.waitForTimeout(600)
  // Creation lands in inline rename — commit the default name so the
  // scenario's assertions read a settled tree.
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
})

Then('a design tab named {string} is open', async ({}, name: string) => {
  const p = requirePage()
  await expect(p.locator('[data-testid^="design-tab-view-"]')).toBeVisible({ timeout: 10000 })
  const tab = p.locator('.tab[role="tab"][aria-selected="true"]').filter({ has: p.getByText(name, { exact: true }) })
  await expect(tab).toHaveCount(1, { timeout: 5000 })
})

Then('the sidebar carries a design node named {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(
    p.locator('[data-testid="sidebar-listview"] .list-view-row').filter({ has: p.getByText(name, { exact: true }) }).first()
  ).toBeVisible({ timeout: 5000 })
})

// ── Prefill from documentation ────────────────────────────────────────

When("I create a design from the env folder's context menu", async () => {
  const p = requirePage()
  await sidebarRow(p, ENV_FOLDER_ID).click({ button: 'right' })
  const entry = p.getByText('Créer un design à partir de cette API', { exact: true })
    .or(p.getByText('Create a design from this API', { exact: true }))
  await expect(entry.first()).toBeVisible({ timeout: 5000 })
  await entry.first().click()
  await p.waitForTimeout(800)
  await expect(p.locator('[data-testid^="design-tab-view-"]')).toBeVisible({ timeout: 10000 })
})

When('I open the models section of the open design', async () => {
  const p = requirePage()
  await openSectionOfOpenDesign(p, 'models')
  await p.mouse.move(700, 450)
  await expect(p.locator('[data-testid="design-models-section"]')).toBeVisible({ timeout: 5000 })
})

Then('the models list of the open design offers {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(
    p.locator('[data-testid="design-models-listview"] .list-view-row').filter({ has: p.getByText(name, { exact: true }) })
  ).toHaveCount(1, { timeout: 5000 })
})

Then('the enums list of the open design offers {string}', async ({}, name: string) => {
  const p = requirePage()
  await openSectionOfOpenDesign(p, 'enums')
  await p.mouse.move(700, 450)
  await expect(
    p.locator('[data-testid="design-enums-list"] .list-view-row').filter({ has: p.getByText(name, { exact: true }) })
  ).toHaveCount(1, { timeout: 5000 })
})

When('I open the routes section of the open design', async () => {
  const p = requirePage()
  await openSectionOfOpenDesign(p, 'routes')
  await p.mouse.move(700, 450)
  await expect(p.locator('[data-testid="design-routes-section"]')).toBeVisible({ timeout: 5000 })
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
    const titleOf = (row: Element): string => (row.querySelector('.list-view-title')?.textContent ?? '').trim()
    let inGroup = false
    let n = 0
    for (const row of rows) {
      if (levelOf(row) === 1) {
        inGroup = titleOf(row) === name
        continue
      }
      if (inGroup) n += 1
    }
    return n
  }, groupName)
  expect(actual).toBe(count)
})

// ── Variable resolution ───────────────────────────────────────────────

Then('the resolved base line reads {string}', async ({}, expected: string) => {
  const p = requirePage()
  // The Settings section hosts the resolved-base preview, under the base-path
  // field; the environment that resolves it is picked in the smart-bar selector.
  await openSectionOfOpenDesign(p, 'settings')
  await p.mouse.move(700, 450)
  await expect(p.locator('[data-testid="design-settings-resolved-base"]')).toHaveText(expected, { timeout: 5000 })
})

When('I pick the design environment {string}', async ({}, envName: string) => {
  const p = requirePage()
  // The environment is picked in the design smart-bar selector (shared with the
  // request env selector), visible from any section — no need to open Server.
  await p.locator('[data-testid="design-header-env-selector"]').click()
  const popover = p.locator('[data-testid="design-header-env-selector-listview"]')
  await expect(popover).toBeVisible({ timeout: 5000 })
  await popover.locator('[role="option"]').filter({ hasText: envName }).first().click()
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

Then('the saved file carries a design named {string}', async ({}, name: string) => {
  const saved = readFileSync(projectPath, 'utf-8')
  expect(saved).toContain(`name: ${name}`)
  expect(saved).toContain('type: design')
})

Then('the saved file nests the derived design inside the env folder', async () => {
  const saved = readFileSync(projectPath, 'utf-8')
  // The derived design's components are present…
  expect(saved).toContain('name: Pet')
  expect(saved).toContain('name: PetStatus')
  // …and the design sits INSIDE the env folder's items (the folder body
  // declares it after its own id and before the next root collection).
  const folderStart = saved.indexOf('id: env-design-sample')
  const nextRoot = saved.indexOf('- id: design-petstore')
  const designPos = saved.indexOf('type: design')
  expect(folderStart).toBeGreaterThanOrEqual(0)
  expect(designPos).toBeGreaterThan(folderStart)
  expect(designPos).toBeLessThan(nextRoot)
})
