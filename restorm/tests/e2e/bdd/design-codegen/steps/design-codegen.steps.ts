import { createBdd } from 'playwright-bdd'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { Page } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, type LaunchedMcpApp, type McpToolReply } from '../../fixtures/design-mcp.fixture'
import { openDesignSection } from '../../../support/designNav'

const { Given, When, Then } = createBdd(test)

const FIXTURE_TEMPLATE = resolve(__dirname, '../../../fixtures/codegen-template')
const FIXTURE_TEMPLATE_POSTGRES = resolve(__dirname, '../../../fixtures/codegen-template-postgres')
const FIXTURE_TEMPLATE_HOSTILE = resolve(__dirname, '../../../fixtures/codegen-template-hostile')

let launched: LaunchedMcpApp | null = null
let designId = ''
let outputDir = ''

function requireApp(): LaunchedMcpApp {
  if (!launched) throw new Error('launch first')
  return launched
}

function requirePage(): Page {
  return requireApp().page
}

function parsed(reply: McpToolReply): Record<string, unknown> {
  const text = (reply as { content?: { text?: string }[] }).content?.[0]?.text ?? ''
  try { return JSON.parse(text) as Record<string, unknown> } catch { return { raw: text } }
}

let callTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>

async function launchFor(
  launchAppWithMcp: (opts?: { plan?: 'pro' | 'enterprise' | null }) => Promise<LaunchedMcpApp>,
  callMcpTool: (discovery: LaunchedMcpApp['discovery'], name: string, args?: Record<string, unknown>) => Promise<McpToolReply>,
  plan: 'pro' | null
): Promise<void> {
  launched = await launchAppWithMcp(plan === null ? { plan: null } : { plan })
  callTool = async (name, args) => parsed(await callMcpTool(requireApp().discovery, name, args))
  await requirePage().waitForTimeout(1200)
  const projectPath = join(mkdtempSync(join(tmpdir(), 'design-codegen-')), 'design-codegen.restorm')
  expect((await callTool('create_project', { filePath: projectPath }))['error']).toBeUndefined()
  await requirePage().waitForTimeout(800)
}

Given('restorm is launched with MCP for codegen work', async ({ launchAppWithMcp, callMcpTool }) => {
  await launchFor(launchAppWithMcp, callMcpTool, 'pro')
})

Given('restorm is launched with MCP for codegen work without a plan', async ({ launchAppWithMcp, callMcpTool }) => {
  await launchFor(launchAppWithMcp, callMcpTool, null)
})

async function authorDesign(name: string): Promise<void> {
  const created = await callTool('create_design', { name, basePath: '/api', port: 7489 })
  designId = typeof created['id'] === 'string' ? created['id'] : ''
  expect(designId).not.toBe('')
  expect((await callTool('create_design_model', { designId, name: 'Item' }))['error']).toBeUndefined()
  expect((await callTool('set_design_property', { designId, model: 'Item', name: 'id', type: 'string', readOnly: true }))['error']).toBeUndefined()
  expect((await callTool('set_design_property', { designId, model: 'Item', name: 'label', type: 'string', required: true }))['error']).toBeUndefined()
  expect((await callTool('generate_design_crud', { designId, model: 'Item' }))['error']).toBeUndefined()
}

When('the agent authors a valid {string} design', async ({}, name: string) => {
  await authorDesign(name)
})

When('the agent authors a {string} design with a duplicate route', async ({}, name: string) => {
  await authorDesign(name)
  // The CRUD group already answers GET / — a second list route on the
  // same composed surface is the routePathDuplicate issue.
  const reply = await callTool('create_design_route', {
    designId, group: 'Items', method: 'GET', urlPattern: '/', summary: 'Duplicate list'
  })
  expect(reply['error']).toBeUndefined()
})

When('the design tab is opened on the code section', async () => {
  const p = requirePage()
  await callTool('open_tab', { itemId: designId, kind: 'design' })
  await expect(p.locator(`[data-testid="design-tab-view-${designId}"]`)).toBeVisible({ timeout: 10000 })
  await openDesignSection(p, designId, 'code')
  await expect(p.locator('[data-testid="design-code-section"]')).toBeVisible({ timeout: 5000 })
})

When('the local fixture template is added', async () => {
  const p = requirePage()
  // Open the template library, pick the Custom tab, point it at the local
  // fixture and add it — the modal closes and one template row appears.
  await p.locator('[data-testid="design-code-add"]').click()
  await expect(p.locator('[data-testid="design-template-library-modal"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="design-template-library-tabs-tab-custom"]').click()
  await p.locator('[data-testid="design-template-library-local-input"]').fill(FIXTURE_TEMPLATE)
  await p.locator('[data-testid="design-template-library-local-add"]').click()
  await expect(
    p.locator('[data-testid="design-code-template-list"] .design-code-template-body')
  ).toHaveCount(1, { timeout: 5000 })
  // The library is a MULTI-add surface: it stays open (closed via Done). Close
  // it so it stops covering the code section behind it. In headless the footer
  // sits under its own scroll overlay, so dispatch the click straight to the
  // Done button element (fires onClose regardless of what paints on top).
  await p.locator('[data-testid="design-template-library-done"]').dispatchEvent('click')
  await expect(p.locator('[data-testid="design-template-library-modal"]')).toHaveCount(0, { timeout: 5000 })
})

When('the output folder is picked through the system dialog', async () => {
  outputDir = mkdtempSync(join(tmpdir(), 'design-codegen-out-'))
  await configureNextOpenDialogForE2E(requireApp().app, { kind: 'openFolder', path: outputDir })
  await requirePage().locator('[data-testid^="design-code-browse-"]').click()
  await expect(
    requirePage().locator('[data-testid^="design-code-output-"][data-testid$="-input"]')
  ).toHaveValue(outputDir, { timeout: 5000 })
})

When('the generation is launched', async () => {
  await requirePage().locator('[data-testid^="design-code-generate-"]').click()
})

Then('the preview lists the generated files', async () => {
  const p = requirePage()
  // Cold Pyodide + wheel provisioning: the first sandbox boot is slow.
  await expect(p.locator('[data-testid="design-code-preview"]')).toBeVisible({ timeout: 240_000 })
  const preview = p.locator('[data-testid="design-code-preview"]')
  await expect(preview).toContainText('README.md')
  await expect(preview).toContainText('server.txt')
})

When('the generated tree is confirmed', async () => {
  await requirePage().locator('[data-testid="design-code-confirm"]').click()
  // On success the preview panel is dismissed (the result surfaces as a toast).
  await expect(requirePage().locator('[data-testid="design-code-preview"]')).toHaveCount(0, { timeout: 30_000 })
})

Then('the rendered project sits in the output folder', () => {
  const readme = join(outputDir, 'README.md')
  expect(existsSync(readme)).toBe(true)
  const content = readFileSync(readme, 'utf8')
  // Both authoring scenarios name their design '…Codegen API'.
  expect(content.startsWith('# ')).toBe(true)
  expect(content).toContain('Codegen API')
  expect(content).toContain('- Item')
  expect(readFileSync(join(outputDir, 'server.txt'), 'utf8')).toContain('static file, copied verbatim')
})

When('the agent requests a generation preview over MCP', async () => {
  outputDir = mkdtempSync(join(tmpdir(), 'design-codegen-mcp-'))
  const reply = await callTool('generate_design_code', { designId, localPath: FIXTURE_TEMPLATE })
  expect(reply['error']).toBeUndefined()
  expect(reply['written']).toBe(false)
  const preview = reply['preview'] as { path: string }[]
  expect(preview.map((f) => f.path)).toEqual(expect.arrayContaining(['README.md', 'server.txt']))
})

Then('the MCP reply carries the preview without writing anything', () => {
  expect(existsSync(join(outputDir, 'README.md'))).toBe(false)
})

When('the agent confirms the generation over MCP', async () => {
  const reply = await callTool('generate_design_code', {
    designId, localPath: FIXTURE_TEMPLATE, confirm: true, outputDir
  })
  expect(reply['error']).toBeUndefined()
  expect(reply['written']).toBe(true)
})

When('the agent generates with the local postgres template over MCP', async () => {
  outputDir = mkdtempSync(join(tmpdir(), 'design-codegen-pg-'))
  const reply = await callTool('generate_design_code', {
    designId, localPath: FIXTURE_TEMPLATE_POSTGRES, confirm: true, outputDir
  })
  expect(reply['error']).toBeUndefined()
  expect(reply['written']).toBe(true)
})

Then('the SQL trio sits in the output folder and carries the design', () => {
  const schema = readFileSync(join(outputDir, 'schema.sql'), 'utf8')
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS "item"')
  // The searchable intention became an index; required became NOT NULL.
  expect(schema).toContain('"label" text NOT NULL')
  expect(existsSync(join(outputDir, 'seed.sql'))).toBe(true)
  expect(readFileSync(join(outputDir, 'crud.sql'), 'utf8')).toContain('INSERT INTO "item"')
})

When('the agent generates with the hostile template over MCP', async () => {
  outputDir = mkdtempSync(join(tmpdir(), 'design-codegen-hostile-'))
  const reply = await callTool('generate_design_code', {
    designId, localPath: FIXTURE_TEMPLATE_HOSTILE, confirm: true, outputDir
  })
  // The SANDBOXED environment refuses the attribute traversal — a clean
  // template error, never a crash, never an escape.
  const err = typeof reply['error'] === 'string' ? reply['error'] : ''
  expect(err).toMatch(/template error|SecurityError|unsafe/i)
})

Then('the generation is refused as a template error and nothing is written', () => {
  expect(existsSync(join(outputDir, 'evil.txt'))).toBe(false)
})

Then('the generate button is disabled with the validation explanation', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid^="design-code-generate-"]')).toBeDisabled()
  await expect(p.locator('[data-testid="design-code-blocked"]')).toBeVisible()
})

Then('the generate control is plan-gated', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid^="design-code-gate-"]')).toBeVisible()
  await expect(p.locator('[data-testid^="design-code-generate-"]')).toBeDisabled()
})
