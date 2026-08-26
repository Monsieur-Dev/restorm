import { createBdd } from 'playwright-bdd'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type LaunchedMcpApp, type McpToolReply } from '../../fixtures/design-mcp.fixture'
import { createBlankDesign, addModel, renameModel, addProperty } from '../../../support/designGuiDriver'

const { Given, When, Then } = createBdd(test)

let launched: LaunchedMcpApp | null = null

function requirePage(): Page {
  if (!launched) throw new Error('launch first')
  return launched.page
}
function parsed(reply: McpToolReply): Record<string, unknown> {
  const text = (reply as { content?: { text?: string }[] }).content?.[0]?.text ?? ''
  try { return JSON.parse(text) as Record<string, unknown> } catch { return { raw: text } }
}

Given('restorm is launched blank for GUI design work', async ({ launchAppWithMcp, callMcpTool }) => {
  launched = await launchAppWithMcp({ plan: 'pro' })
  const app = launched
  const projectPath = join(mkdtempSync(join(tmpdir(), 'design-gui-')), 'design-gui.restorm')
  const reply = parsed(await callMcpTool(app.discovery, 'create_project', { filePath: projectPath }))
  expect(reply['error']).toBeUndefined()
  await app.page.waitForTimeout(1200)
})

When('I create a design and add a model with a property named {string}', async ({}, propName: string) => {
  const p = requirePage()
  const designId = await createBlankDesign(p)
  await addModel(p, designId)
  await renameModel(p, 'GeoPoint')
  await addProperty(p, propName)
})

Then('the property fields are visible', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-property-tabs"]')).toBeVisible({ timeout: 5000 })
  await expect(p.locator('[data-testid="design-property-name-input"]')).toBeVisible({ timeout: 5000 })
  await expect(p.locator('[data-testid="design-property-type-trigger"]')).toBeVisible({ timeout: 5000 })
})

Then('switching to the code-generation tab hides the property fields', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-property-tab-codegen"]').click()
  await p.waitForTimeout(300)
  await expect(p.locator('[data-testid="design-property-name-input"]')).toHaveCount(0, { timeout: 5000 })
})

Then('switching back to the property tab shows the property fields again', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-property-tab-property"]').click()
  await p.waitForTimeout(300)
  await expect(p.locator('[data-testid="design-property-name-input"]')).toBeVisible({ timeout: 5000 })
})
