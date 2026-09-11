import { createBdd } from 'playwright-bdd'
import { copyFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, DESIGN_MODELS_TEMP_DIR } from '../../fixtures/design-models.fixture'
import { openDesignSection, expandDesignSection, expandAllSidebarChildren } from '../../../support/designNav'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null

const DESIGN_SAMPLE = join(__dirname, '../../../samples/api-design-collisions-sample.restorm')
const DESIGN_ID = '063073c4-bcb0-4b3b-8918-a9001ce56d93'

/** Sidebar-node error-dot testid prefix per singular entity kind. */
const ERROR_DOT_TESTID: Record<string, string> = {
  model: 'design-model-node-error',
  enum: 'design-enum-node-error',
  route: 'design-route-node-error',
  group: 'design-group-node-error'
}

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

function sidebarRow(p: Page, itemId: string): ReturnType<Page['locator']> {
  return p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${itemId}"]`)
}

async function openSection(p: Page, section: 'models' | 'enums' | 'routes'): Promise<void> {
  await openDesignSection(p, DESIGN_ID, section)
  await p.mouse.move(700, 400)
  await expect(p.locator(`[data-testid="design-${section}-section"]`)).toBeVisible({ timeout: 5000 })
}

/** Click a design entity node by its exact id — the twin routes share a display
 * title ("/all"), so a text filter can't tell them apart; the id can. */
async function openDesignEntityById(
  p: Page,
  section: 'models' | 'enums' | 'routes',
  entityId: string
): Promise<void> {
  await expandDesignSection(p, DESIGN_ID, section)
  const itemId = `design-entity:${DESIGN_ID}:${section}:${entityId}`
  let node = sidebarRow(p, itemId)
  for (let i = 0; i < 4 && (await node.count()) === 0; i++) {
    await expandAllSidebarChildren(p, DESIGN_ID, section)
    await p.waitForTimeout(250)
    node = sidebarRow(p, itemId)
  }
  await expect(node).toBeVisible({ timeout: 5000 })
  await node.click()
  await p.waitForTimeout(400)
}

Given('the collisions design is open on the {string} section', async ({ launchApp }, section: string) => {
  const launched = await launchApp({ plan: 'pro' })
  page = launched.page
  const p = page
  const projectPath = join(DESIGN_MODELS_TEMP_DIR, 'design-collisions.restorm')
  copyFileSync(DESIGN_SAMPLE, projectPath)
  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (fp: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)
  await expect(sidebarRow(p, DESIGN_ID)).toBeVisible({ timeout: 10000 })
  await expect(p.locator('[data-testid="app-statusbar-version-plan"]')).toContainText('Pro', { timeout: 10000 })
  await p.waitForTimeout(800)
  await openSection(p, section as 'models' | 'enums' | 'routes')
})

Then('the {string} node {string} carries an error dot', async ({}, kind: string, entityId: string) => {
  const p = requirePage()
  const prefix = ERROR_DOT_TESTID[kind]
  if (prefix === undefined) throw new Error(`unknown entity kind: ${kind}`)
  // Routes live under their group node — expand so the node (and its dot) render.
  await expandAllSidebarChildren(p, DESIGN_ID, 'routes').catch(() => undefined)
  await expect(p.locator(`[data-testid="${prefix}-${entityId}"]`)).toBeVisible({ timeout: 5000 })
})

When('I open the design entity {string} {string}', async ({}, section: string, entityId: string) => {
  const p = requirePage()
  await openDesignEntityById(p, section as 'models' | 'enums' | 'routes', entityId)
})

Then('the entity issues callout is visible', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-entity-issues-callout"]')).toBeVisible({ timeout: 5000 })
})

Then('a collision twin chip links to {string}', async ({}, twinId: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-collision-twin-${twinId}"]`)).toBeVisible({ timeout: 5000 })
})

When('I click the collision twin chip to {string}', async ({}, twinId: string) => {
  const p = requirePage()
  await p.locator(`[data-testid="design-collision-twin-${twinId}"]`).click()
  await p.waitForTimeout(400)
})

Then('the collision twin list is anchored on {string}', async ({}, entityId: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-collision-twins-${entityId}"]`)).toBeVisible({ timeout: 5000 })
})
