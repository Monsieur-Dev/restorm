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
let statefulCreatedId = ''

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

// ── search coherence (MCP writes must feed the main index) ──────────

async function designMatches(query: string): Promise<unknown[]> {
  const reply = await call('search', { query, kinds: ['design'] })
  return Array.isArray(reply['matches']) ? (reply['matches'] as unknown[]) : []
}

Then('searching {string} over MCP finds a design result', async ({}, query: string) => {
  // The index feeds off the design event bus — dispatch is async, so
  // give it a moment before declaring the write invisible.
  let count = 0
  for (let i = 0; i < 10 && count === 0; i++) {
    count = (await designMatches(query)).length
    if (count === 0) await requirePage().waitForTimeout(500)
  }
  expect(count).toBeGreaterThan(0)
})

When('the agent deletes the {string} enum usage and the enum itself', async ({}, enumName: string) => {
  // The property referencing the enum goes first — deleting the enum
  // alone would leave a dangling reference (a validation issue) and the
  // scenario still serves this design afterwards.
  expect((await call('delete_design_property', { designId, model: 'User', property: 'status' }))['error']).toBeUndefined()
  expect((await call('delete_design_enum', { designId, enum: enumName }))['error']).toBeUndefined()
})

Then('searching {string} over MCP finds no design result', async ({}, query: string) => {
  let matches: unknown[] = []
  for (let i = 0; i < 10; i++) {
    matches = await designMatches(query)
    if (matches.length === 0) break
    await requirePage().waitForTimeout(500)
  }
  expect(matches).toEqual([])
})

When('the agent serves the design', async () => {
  const reply = await call('serve_design', { designId })
  expect(reply['started']).toBe(true)
})

When('the agent tries to serve the design', async () => {
  await call('serve_design', { designId })
})

When('the agent enables stateful serving', async () => {
  const reply = await call('update_design', { designId, stateful: true })
  expect(reply['error']).toBeUndefined()
})

Then('a stateful POST of email {string} then a GET list shows both users', async ({}, email: string) => {
  // POST creates a real row in the ephemeral store.
  const created = await call('create_request', { name: 'Stateful create', protocol: 'http' })
  const createId = created['id']
  await call('update_request', {
    id: createId,
    patch: { method: 'POST', url: `http://localhost:${servedPort}/api/users`, body: { type: 'text', content: JSON.stringify({ email }) } }
  })
  const createReply = JSON.stringify(await call('run_request', { id: createId, timeoutMs: 20_000 }))
  expect(createReply).toContain('20')
  expect(createReply).toContain(email)
  // Capture the created row's identifier from the response body (a
  // server-minted value — uuid here, not a fixed prefix).
  const idMatch = /"id":"([^"']+)"/.exec(createReply)
  statefulCreatedId = idMatch?.[1] ?? ''
  expect(statefulCreatedId).not.toBe('')
  // The next GET list shows the seeded example AND the new row.
  const listed = await call('create_request', { name: 'Stateful list', protocol: 'http' })
  const listId = listed['id']
  await call('update_request', { id: listId, patch: { method: 'GET', url: `http://localhost:${servedPort}/api/users?limit=20` } })
  const listReply = JSON.stringify(await call('run_request', { id: listId, timeoutMs: 20_000 }))
  expect(listReply).toContain('admin@agent.io')
  expect(listReply).toContain(email)
})

Then('a stateful DELETE then a GET list drops the created user', async () => {
  expect(statefulCreatedId).not.toBe('')
  const del = await call('create_request', { name: 'Stateful delete', protocol: 'http' })
  const delId = del['id']
  await call('update_request', { id: delId, patch: { method: 'DELETE', url: `http://localhost:${servedPort}/api/users/${statefulCreatedId}` } })
  const delReply = JSON.stringify(await call('run_request', { id: delId, timeoutMs: 20_000 }))
  expect(delReply).toMatch(/20[04]/)
  const after = await call('create_request', { name: 'Stateful list 3', protocol: 'http' })
  const afterId = after['id']
  await call('update_request', { id: afterId, patch: { method: 'GET', url: `http://localhost:${servedPort}/api/users?limit=20` } })
  const afterReply = JSON.stringify(await call('run_request', { id: afterId, timeoutMs: 20_000 }))
  expect(afterReply).not.toContain(statefulCreatedId)
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

// ── Protocol projections ────────────────────────────────────────────

When('the agent enables the {string} projections', async ({}, list: string) => {
  const reply = await call('update_design', { designId, protocols: list.split(',') })
  expect(reply['error']).toBeUndefined()
})

When('the agent allows the served origin', async () => {
  const allowed = await call('firewall_allow', { origin: `http://localhost:${servedPort}` })
  expect(allowed['error']).toBeUndefined()
})

/** Create a protocol-typed Restorm request, patch it, run it, and hand
 * back the run reply as text (status + body travel in it). */
async function runProtocolRequest(name: string, protocol: string, patch: Record<string, unknown>): Promise<string> {
  const created = await call('create_request', { name, protocol })
  const id = created['id']
  expect(typeof id).toBe('string')
  const patched = await call('update_request', { id, patch })
  expect(patched['error']).toBeUndefined()
  const reply = await call('run_request', { id, timeoutMs: 20_000 })
  return JSON.stringify(reply)
}

Then('a GraphQL query for the user list carries {string}', async ({}, needle: string) => {
  const text = await runProtocolRequest('GraphQL served list', 'graphql', {
    url: `http://localhost:${servedPort}/graphql`,
    operationType: 'query',
    query: '{ userList(limit: 2) { email status } }'
  })
  expect(text).toContain('200')
  expect(text).toContain(needle)
})

Then('an OData read of {string} carries {string}', async ({}, set: string, needle: string) => {
  const text = await runProtocolRequest('OData served set', 'odata', {
    url: `http://localhost:${servedPort}/odata/${set}`,
    operationKind: 'entity-set'
  })
  expect(text).toContain('200')
  expect(text).toContain(needle)
})

Then('a SOAP call to {string} carries {string}', async ({}, operation: string, needle: string) => {
  const envelope =
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><${operation}/></soap:Body></soap:Envelope>`
  const text = await runProtocolRequest('SOAP served call', 'soap', {
    url: `http://localhost:${servedPort}/soap`,
    soapAction: '',
    body: envelope
  })
  expect(text).toContain('200')
  expect(text).toContain(needle)
})

Then('the OData metadata describes the {string} entity', async ({}, entity: string) => {
  const text = await runProtocolRequest('OData metadata', 'http', {
    method: 'GET',
    url: `http://localhost:${servedPort}/odata/$metadata`
  })
  expect(text).toContain('EntityType')
  expect(text).toContain(entity)
})

Then('the served WSDL describes the {string} operation', async ({}, operation: string) => {
  const text = await runProtocolRequest('WSDL read', 'http', {
    method: 'GET',
    url: `http://localhost:${servedPort}/soap?wsdl`
  })
  expect(text).toContain('wsdl:service')
  expect(text).toContain(operation)
})

Then('the {string} protocol pill shows enabled', async ({}, protocol: string) => {
  await expect(requirePage().locator(`[data-testid="design-protocol-${protocol}"]`)).toHaveClass(/active/, { timeout: 5000 })
})

When('the {string} protocol pill is clicked', async ({}, protocol: string) => {
  await requirePage().locator(`[data-testid="design-protocol-${protocol}"]`).click()
  // Let the reactive edit commit + the autosave mirror reach main.
  await requirePage().waitForTimeout(2000)
})

Then('the design serves the {string} projections only', async ({}, list: string) => {
  const reply = await call('get_design', { designId })
  const serving = reply['serving'] as { protocols?: string[] } | undefined
  expect(serving?.protocols ?? []).toEqual(list.split(','))
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

Then('the template contract over MCP carries the manifest schema, the context schema and the official templates', async () => {
  const reply = await call('get_design_template_contract', {})
  expect(reply['error']).toBeUndefined()
  expect(reply['contextVersion']).toBe(1)
  const manifest = reply['manifest'] as { schema?: { required?: string[] } }
  expect(manifest.schema?.required).toEqual(
    expect.arrayContaining(['name', 'type', 'language', 'contextVersions'])
  )
  const contextSchema = reply['contextSchema'] as { required?: string[] }
  expect(contextSchema.required).toEqual(expect.arrayContaining(['contextVersion', 'design', 'models']))
  const official = reply['officialTemplates'] as { id: string; description: string }[]
  expect(official.map((entry) => entry.id)).toEqual(
    expect.arrayContaining(['server-rest-typescript', 'server-rest-dotnet', 'db-postgres'])
  )
  expect(official.every((entry) => typeof entry.description === 'string' && entry.description.length > 0)).toBe(true)
})

When("the agent sets the design's templates to a repo and a local folder", async () => {
  const reply = await call('set_design_templates', {
    designId,
    templates: [
      { repo: 'acme/restorm-template-thing', outputDir: './out/app' },
      { localPath: '/tmp/my-template', label: 'My template' }
    ]
  })
  expect(reply['error']).toBeUndefined()
})

Then('the design carries those two templates over MCP', async () => {
  const reply = await call('get_design', { designId })
  const codegen = reply['codegen'] as {
    templates?: { source: { kind: string; repo?: string; path?: string }; outputDir?: string; label?: string }[]
  }
  expect(codegen.templates).toHaveLength(2)
  expect(codegen.templates?.[0]?.source).toEqual({ kind: 'repo', repo: 'acme/restorm-template-thing' })
  expect(codegen.templates?.[0]?.outputDir).toBe('./out/app')
  expect(codegen.templates?.[1]?.source).toEqual({ kind: 'local', path: '/tmp/my-template' })
  expect(codegen.templates?.[1]?.label).toBe('My template')
})
