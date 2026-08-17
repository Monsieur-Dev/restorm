import { createBdd } from 'playwright-bdd'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type LaunchedMcpApp, type McpToolReply } from '../../fixtures/design-mcp.fixture'

const { Given, When, Then } = createBdd(test)

let launched: LaunchedMcpApp | null = null
let designId = ''
let servedPort = 0
let requestId = ''
let lastReply: McpToolReply | null = null
let lastRunReply: Record<string, unknown> = {}

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

// Bound in the Given via the fixture (kept simple: module holder —
// scenarios are serial within this project).
let callTool: (discovery: LaunchedMcpApp['discovery'], name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>

async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { discovery } = requireApp()
  return callTool(discovery, name, args)
}

async function launchFor(
  launchAppWithMcp: (opts?: { plan?: 'pro' | 'enterprise' | null }) => Promise<LaunchedMcpApp>,
  callMcpTool: (discovery: LaunchedMcpApp['discovery'], name: string, args?: Record<string, unknown>) => Promise<McpToolReply>,
  plan: 'pro' | null
): Promise<void> {
  launched = await launchAppWithMcp(plan === null ? { plan: null } : { plan })
  callTool = async (discovery, name, args) => {
    lastReply = await callMcpTool(discovery, name, args)
    return parsed(lastReply)
  }
  await requirePage().waitForTimeout(1200)
  // A project must be open for the tree tools to have a home — with a
  // real FILE PATH, or every autosave would demand a save dialog.
  const projectPath = join(mkdtempSync(join(tmpdir(), 'design-mcp-')), 'design-mcp.restorm')
  const created = await call('create_project', { filePath: projectPath })
  expect(created['error']).toBeUndefined()
  await requirePage().waitForTimeout(800)
}

Given('restorm is launched with MCP for design work', async ({ launchAppWithMcp, callMcpTool }) => {
  await launchFor(launchAppWithMcp, callMcpTool, 'pro')
})

Given('restorm is launched with MCP without a plan', async ({ launchAppWithMcp, callMcpTool }) => {
  await launchFor(launchAppWithMcp, callMcpTool, null)
})

When('the agent creates a design named {string} on port {int}', async ({}, name: string, port: number) => {
  const reply = await call('create_design', { name, basePath: '/api', port })
  designId = typeof reply['id'] === 'string' ? reply['id'] : ''
  servedPort = port
})

Then('the design creation succeeded', () => {
  expect(designId).not.toBe('')
})

When('the agent models a {string} with an identifier, a searchable email and a {string} enum', async ({}, modelName: string, enumName: string) => {
  expect((await call('create_design_model', { designId, name: modelName }))['error']).toBeUndefined()
  expect((await call('set_design_property', { designId, model: modelName, name: 'id', type: 'string', format: 'uuid', readOnly: true }))['error']).toBeUndefined()
  expect((await call('update_design_model', { designId, model: modelName, identifierProperty: 'id', identifierStrategy: 'uuid' }))['error']).toBeUndefined()
  expect((await call('set_design_property', { designId, model: modelName, name: 'email', type: 'string', format: 'email', required: true, searchable: true }))['error']).toBeUndefined()
  expect((await call('set_design_property', { designId, model: modelName, name: 'name', type: 'string' }))['error']).toBeUndefined()
  expect((await call('create_design_enum', { designId, name: enumName, values: ['active', 'blocked'] }))['error']).toBeUndefined()
  expect((await call('set_design_property', { designId, model: modelName, name: 'status', enumRef: enumName }))['error']).toBeUndefined()
})

When('the agent seeds a named example with email {string}', async ({}, email: string) => {
  const reply = await call('set_design_example', { designId, model: 'User', name: 'an admin User', values: { email } })
  expect(reply['error']).toBeUndefined()
})

When('the agent generates CRUD routes for {string}', async ({}, modelName: string) => {
  const reply = await call('generate_design_crud', { designId, model: modelName })
  expect(reply['routes']).toBe(5)
})

Then('the design reports no validation issues over MCP', async () => {
  const reply = await call('get_design', { designId })
  expect(Array.isArray(reply['issues']) ? (reply['issues'] as unknown[]).length : -1).toBe(0)
})

When('the agent serves the design', async () => {
  const reply = await call('serve_design', { designId })
  expect(reply['started']).toBe(true)
})

When('the agent tries to serve the design', async () => {
  await call('serve_design', { designId })
})

Then('the serve call is refused as payment required', () => {
  expect(lastReply).not.toBeNull()
  const reply = lastReply as unknown as { isError?: boolean; structuredContent?: { code?: string }; content?: { text?: string }[] }
  expect(reply.isError).toBe(true)
  const text = reply.content?.[0]?.text ?? ''
  const code = reply.structuredContent?.code
  expect(code === 'payment_required' || text.includes('Restorm Pro')).toBe(true)
})

When('the agent calls the served list route through a Restorm request', async () => {
  const created = await call('create_request', { name: 'List served users', protocol: 'http' })
  requestId = typeof created['id'] === 'string' ? created['id'] : ''
  expect(requestId).not.toBe('')
  const patched = await call('update_request', {
    id: requestId,
    patch: { method: 'GET', url: `http://localhost:${String(servedPort)}/api/users?limit=3` }
  })
  expect(patched['error']).toBeUndefined()
  // An MCP-authored URL is NOT firewall-exempt (provenance decides) —
  // the agent whitelists the served origin like a real agent would.
  const allowed = await call('firewall_allow', { origin: `http://localhost:${String(servedPort)}` })
  expect(allowed['error']).toBeUndefined()
  // run_request replies with the status + body directly.
  lastRunReply = await call('run_request', { id: requestId, timeoutMs: 20_000 })
})

Then('the request response is 200 and carries {string}', ({}, needle: string) => {
  const text = JSON.stringify(lastRunReply)
  expect(text).toContain('200')
  expect(text).toContain(needle)
})

Then('the design server status reports served calls', async () => {
  const reply = await call('get_design_server_status', { designId })
  expect(reply['listening']).toBe(true)
  const counters = reply['counters'] as { total?: number } | undefined
  expect((counters?.total ?? 0) > 0).toBe(true)
})

When('the agent stops the design server', async () => {
  const reply = await call('stop_design_server', { designId })
  expect(reply['error']).toBeUndefined()
  await requirePage().waitForTimeout(500)
})

Then('the design server status reports it stopped', async () => {
  const reply = await call('get_design_server_status', { designId })
  expect(reply['listening']).toBe(false)
})

// ── UI coherence ────────────────────────────────────────────────────

When('the design tab is opened with the title field edited to {string}', async ({}, draft: string) => {
  const p = requirePage()
  await call('open_tab', { itemId: designId, kind: 'design' })
  await expect(p.locator(`[data-testid="design-tab-view-${designId}"]`)).toBeVisible({ timeout: 10000 })
  const input = p.locator('[data-testid="design-settings-title-input"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(draft)
  // Let the debounced edit commit + the autosave mirror push to main —
  // the coherence contract of the EXISTING write pattern.
  await p.waitForTimeout(2000)
})

When('the agent adds a {string} enum to the design over MCP', async ({}, enumName: string) => {
  const reply = await call('create_design_enum', { designId, name: enumName, values: ['red', 'green'] })
  expect(reply['error']).toBeUndefined()
  await requirePage().waitForTimeout(800)
})

Then('the edited title field still shows {string}', async ({}, draft: string) => {
  const input = requirePage().locator('[data-testid="design-settings-title-input"]')
  await expect(input).toHaveValue(draft, { timeout: 5000 })
})

When('the design tab is opened', async () => {
  const p = requirePage()
  await call('open_tab', { itemId: designId, kind: 'design' })
  await expect(p.locator(`[data-testid="design-tab-view-${designId}"]`)).toBeVisible({ timeout: 10000 })
})

Then('the design spin button shows the serving state', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-serve-spin"]')).toHaveClass(/design-serve-spin-active/, { timeout: 10000 })
})

Then('the design spin button shows the idle state', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-serve-spin"]')).not.toHaveClass(/design-serve-spin-active/, { timeout: 10000 })
})
