import { createBdd } from 'playwright-bdd'
import { copyFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, DESIGN_DOCVIEWER_TEMP_DIR } from '../../fixtures/design-docviewer.fixture'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null

const DESIGN_SAMPLE = join(__dirname, '../../../samples/api-design-sample.restorm')
const DESIGN_ID = 'design-petstore'

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

async function openSection(p: Page, section: 'documentation' | 'models'): Promise<void> {
  await p.locator(`[data-testid="design-rail-${section}"]`).click()
  await p.mouse.move(700, 450)
  await p.waitForTimeout(300)
}

Given('a project carrying an API design is open on its documentation', async ({ launchApp }) => {
  const launched = await launchApp()
  page = launched.page
  const projectPath = join(DESIGN_DOCVIEWER_TEMP_DIR, 'design-docviewer.restorm')
  copyFileSync(DESIGN_SAMPLE, projectPath)
  const p = page
  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (fp: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)
  await expect(p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  await p.waitForTimeout(800)
  await p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${DESIGN_ID}"]`).click()
  await expect(p.locator(`[data-testid="design-tab-view-${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  await openSection(p, 'documentation')
  await expect(p.locator('[data-testid="design-documentation-host"]')).toBeVisible({ timeout: 10000 })
})

Then('the documentation host renders the design\'s routes and models', async () => {
  const p = requirePage()
  const host = p.locator('[data-testid="design-documentation-host"]')
  // Same component + testids as an imported API's doc viewer: route
  // blocks by operation slug, model/operation counts stamped on the
  // root, the model-graph node for the design's User model.
  await expect(host).toHaveAttribute('data-operation-count', '3')
  await expect(p.locator('[data-testid="documentation-host-route-getUser"]')).toBeVisible({ timeout: 10000 })
  await expect(p.locator('[data-testid="documentation-model-edit-User"]')).toBeVisible({ timeout: 15000 })
})

When('I rename the {string} model to {string} from the models section', async ({}, from: string, to: string) => {
  const p = requirePage()
  await openSection(p, 'models')
  await expect(p.locator('[data-testid="design-models-section"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="design-models-listview"] .list-view-row').filter({ hasText: from }).first().click()
  await expect(p.locator('[data-testid="design-model-name"]')).toContainText(from, { timeout: 5000 })
  // EditableLabel: click the trigger, type into the revealed input,
  // commit with Enter.
  await p.locator('[data-testid="design-model-name"]').click()
  const input = p.locator('[data-testid="design-model-name-input"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(to)
  await input.press('Enter')
  await p.waitForTimeout(400)
  await expect(p.locator('[data-testid="design-model-name"]')).toContainText(to, { timeout: 5000 })
})

When('I return to the documentation section', async () => {
  const p = requirePage()
  await openSection(p, 'documentation')
  await expect(p.locator('[data-testid="design-documentation-host"]')).toBeVisible({ timeout: 10000 })
})

Then('the documentation host renders a model named {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="documentation-model-edit-${name}"]`)).toBeVisible({ timeout: 15000 })
})

When('I click the edit link of the {string} model in the documentation', async ({}, name: string) => {
  const p = requirePage()
  const editButton = p.locator(`[data-testid="documentation-model-edit-${name}"]`)
  await expect(editButton).toBeVisible({ timeout: 15000 })
  await editButton.click()
})

Then('the models section opens on the {string} model card', async ({}, name: string) => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-models-section"]')).toBeVisible({ timeout: 5000 })
  await expect(p.locator('[data-testid="design-model-name"]')).toContainText(name, { timeout: 5000 })
})

When('I click the edit link of the {string} route in the documentation', async ({}, slug: string) => {
  const p = requirePage()
  const editButton = p.locator(`[data-testid="documentation-host-route-header-edit-${slug}"]`)
  await expect(editButton).toBeVisible({ timeout: 10000 })
  await editButton.click()
})

Then('the routes section opens on a route card', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-routes-section"]')).toBeVisible({ timeout: 5000 })
  await expect(p.locator('[data-testid="design-route-tabs"]')).toBeVisible({ timeout: 5000 })
})
