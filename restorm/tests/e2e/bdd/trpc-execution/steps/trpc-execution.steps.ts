/**
 * Steps for the `trpc-execution` BDD suite — drives restorm through the MCP
 * fixture (`launchAppWithMcp` + `callMcpTool`): launch with `--mcp`,
 * `open_project`, poll `list_requests` until the sample loads, then
 * `open_tab` by id and drive the REAL tRPC request panel, asserting on the
 * response editor and the raw-envelope toggle.
 *
 * The tRPC sample targets the hand-rolled `tests/docker/trpc-server/` mock
 * (`:8096`, started by `tests/e2e/global-setup.ts`). The sample covers the
 * full execution matrix: a query, a mutation, a tRPC-level error, Handlebars
 * substitution on a header, cancellation, response history, and router
 * introspection import.
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

const TRPC_SCHEMA_URL = 'http://localhost:8096/.trpc/_schema'

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestsByName = new Map<string, string>()

// The action button toggles between "Send" (idle) and "Cancel" (in-flight).
const ACTION_BTN = '[data-testid="trpc-action-button"]:visible'
const RESPONSE_EDITOR = '[data-testid="trpc-response-editor"]:visible'
const RAW_ENVELOPE_TOGGLE = '[data-testid="trpc-response-raw-envelope-toggle"]:visible'

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

Given(
  'I launch restorm with the MCP server enabled',
  async ({ launchAppWithMcp }) => {
    const launched = await launchAppWithMcp()
    discovery = launched.discovery
    page = launched.page
    requestsByName = new Map()
  }
)

Given('I open the tRPC sample via MCP', async ({ callMcpTool, restormRoot }) => {
  if (discovery === null) throw new Error('launch first')
  const samplePath = join(restormRoot, 'tests/e2e/samples/trpc-sample.restorm')
  const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
  expect(opened.isError ?? false).toBe(false)

  // The collection store populates asynchronously after `file:opened`; poll
  // list_requests until the sample's requests have synced through.
  const deadline = Date.now() + 20_000
  let reqs: { id: string; name: string }[] = []
  while (Date.now() < deadline) {
    const reply = await callMcpTool(discovery, 'list_requests', {})
    reqs = parsedReply(reply) as { id: string; name: string }[]
    if (reqs.some((r) => r.name === 'Get user')) break
    await new Promise((r) => setTimeout(r, 250))
  }
  requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
  expect(requestsByName.get('Get user'), 'tRPC sample requests not loaded').toBeTruthy()
  expect(requestsByName.get('Slow cancel'), 'tRPC sample requests not fully loaded').toBeTruthy()
})

When('I open the {string} request tab via MCP', async ({ callMcpTool }, name: string) => {
  if (discovery === null || page === null) throw new Error('open the project first')
  const id = requestsByName.get(name)
  expect(id, `request "${name}" not found in the sample`).toBeTruthy()
  if (id === undefined) throw new Error(`request "${name}" missing`)
  const tab = await callMcpTool(discovery, 'open_tab', { itemId: id })
  expect(tab.isError ?? false).toBe(false)
  await page.locator(ACTION_BTN).waitFor({ state: 'visible', timeout: 20_000 })
})

When('I click the tRPC Send button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(ACTION_BTN).click()
})

When('I click the tRPC Cancel button', async () => {
  if (page === null) throw new Error('launch first')
  // The action button shows the 'close' codicon while a request is in-flight
  // (`isSending=true`). Wait for that state before clicking so we don't race
  // with the click handler that has not yet flipped `isSending`.
  const cancelIcon = page.locator('[data-testid="trpc-action-button"] .codicon-close:visible').first()
  await cancelIcon.waitFor({ state: 'visible', timeout: 5_000 })
  await page.locator(ACTION_BTN).click()
})

When('I toggle the tRPC raw envelope switch', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(RAW_ENVELOPE_TOGGLE).first().click()
})

When('I trigger variable suggestions in the tRPC URL field', async () => {
  if (page === null) throw new Error('open the project first')
  const editor = page.locator('[data-testid="trpc-url-input"] .monaco-editor').first()
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  // The variable + helper completion providers trigger on `{`; type the
  // opening braces then invoke suggest explicitly (quickSuggestions is off).
  await page.keyboard.type('{{')
})

Then('the tRPC URL suggestion list contains {string}', async ({}, expected: string) => {
  const p = page
  if (p === null) throw new Error('open the project first')
  // The env variables reach the field's completion provider asynchronously
  // (ContextService broadcast after the tab registers). Monaco snapshots the
  // provider's items when the widget opens, so a widget opened too early
  // stays stale — re-trigger the suggest session on every retry instead of
  // just re-querying the DOM. Variables rank above helpers in the list, so
  // once present the row is within the rendered (virtualized) window.
  await expect(async () => {
    await p.keyboard.press('Escape')
    await p.keyboard.press('Control+Space')
    const widget = p.locator('.suggest-widget.visible').first()
    await expect(widget).toBeVisible({ timeout: 1000 })
    await expect(widget.locator('.monaco-list-row').filter({ hasText: expected }).first())
      .toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
})

Then('the tRPC response editor contains {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  // The read-only Monaco editor only appears once a response arrives.
  const editor = page.locator(RESPONSE_EDITOR).first()
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(async () => {
    const text = await editor.innerText()
    // Monaco can insert non-breaking spaces; normalise before matching.
    const normalised = text.replace(/ /g, ' ').replace(/\s+/g, ' ')
    expect(normalised).toContain(needle)
  }).toPass({ timeout: 20_000 })
})

Then('the tRPC response editor does not contain {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  const editor = page.locator(RESPONSE_EDITOR).first()
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(async () => {
    const text = await editor.innerText()
    const normalised = text.replace(/ /g, ' ').replace(/\s+/g, ' ')
    expect(normalised).not.toContain(needle)
  }).toPass({ timeout: 20_000 })
})

When('I type {int} characters into the tRPC input editor within {int} ms', async ({}, count: number, windowMs: number) => {
  if (page === null) throw new Error('launch first')
  await page.evaluate(() => { (window as unknown as { __e2eResetDocUpdateCount?: () => void }).__e2eResetDocUpdateCount?.() })
  // Target the Monaco input editor — it fires onChange on every keystroke
  // with no built-in debounce (the reactive-proxy set-trap owns the actual
  // 250 ms coalescing), so this burst directly exercises that debounce.
  const editor = page.locator('[data-testid="trpc-request-input-editor"]').first()
  await editor.click()
  const text = 'abcdefghijklmnopqrstuvwxyz'.slice(0, count)
  const delay = Math.max(0, Math.floor(windowMs / Math.max(1, count - 1)))
  await editor.pressSequentially(text, { delay })
})

Then('at most {int} tRPC document-update events are emitted', async ({}, max: number) => {
  if (page === null) throw new Error('launch first')
  // Wait one debounce window (250 ms) plus a small buffer so the trailing
  // debounced event has time to fire before we read the counter.
  await page.waitForTimeout(400)
  const counted = await page.evaluate(() => (window as unknown as { __e2eDocUpdateCount?: number }).__e2eDocUpdateCount ?? 0)
  if (counted > max) throw new Error(`Debounce regression: expected <= ${max} document-update events, got ${counted}`)
})

Then('the request has a tRPC history entry for {string}', async ({ callMcpTool }, name: string) => {
  if (discovery === null) throw new Error('launch first')
  const id = requestsByName.get(name)
  expect(id, `request "${name}" not found`).toBeTruthy()
  if (id === undefined) throw new Error(`request "${name}" missing`)
  const disco = discovery
  await expect(async () => {
    const reply = await callMcpTool(disco, 'get_response_history', { requestId: id })
    const payload = parsedReply(reply) as { count?: number; entries?: { guid: string }[] }
    expect((payload.entries ?? []).length).toBeGreaterThanOrEqual(1)
  }).toPass({ timeout: 15_000 })
})

let importedRequestNames: string[] = []

When('I import the tRPC schema URL via the sample', async ({ callMcpTool }) => {
  if (discovery === null) throw new Error('launch first')
  const disco = discovery
  const reply = await callMcpTool(disco, 'import_from_url', { url: TRPC_SCHEMA_URL })
  expect(reply.isError ?? false).toBe(false)

  const deadline = Date.now() + 20_000
  let reqs: { id: string; name: string }[] = []
  while (Date.now() < deadline) {
    const listReply = await callMcpTool(disco, 'list_requests', {})
    reqs = parsedReply(listReply) as { id: string; name: string }[]
    if (reqs.some((r) => r.name === 'user.get')) break
    await new Promise((r) => setTimeout(r, 250))
  }
  importedRequestNames = reqs.map((r) => r.name)
})

Then('the imported folder contains a request for {string}', async ({}, procedure: string) => {
  expect(importedRequestNames, 'router introspection import produced no requests').toContain(procedure)
})
