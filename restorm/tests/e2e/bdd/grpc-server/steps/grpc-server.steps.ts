/**
 * Steps for the self-hosted `grpc-server` BDD scenario — restorm acts as BOTH
 * the local gRPC mock server AND the client consuming it, no external service.
 * Reuses the MCP fixture to launch restorm with `--mcp` and open the sample +
 * tabs, then drives the REAL request panel: starts the Greeter Mock (Start),
 * sends the consumers against it (asserting the canned message + the configured
 * non-OK status), then stops the mock.
 *
 * Steps are project-scoped (see the `grpc-server` BDD project in
 * playwright.config.ts), so the shared phrases redefined here don't collide with
 * the `grpc-execution` project's identical phrases.
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { Page, Locator } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestsByName = new Map<string, string>()

// `:visible` → the active tab (inactive tabs are mounted but 0×0).
const START_BTN = '[data-testid="grpc-server-listen-button"]:visible'
const SERVED_BANNER = '[data-testid="grpc-server-served-banner"]:visible'
const INVOKE_BTN = '[data-testid="grpc-send-button"]:visible'
const RESPONSE_EDITOR = '[data-testid="grpc-response-message-editor"]:visible'

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

/** The sidebar tree row whose label matches `name`. */
function sidebarRowByName(p: Page, name: string): Locator {
  return p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) })
    .first()
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

Given(
  'I open the gRPC mock sample via MCP',
  async ({ callMcpTool, restormRoot }) => {
    if (discovery === null) throw new Error('launch first')
    const samplePath = join(restormRoot, 'tests/e2e/samples/grpc-server-sample.restorm')
    const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
    expect(opened.isError ?? false).toBe(false)

    const deadline = Date.now() + 15_000
    let reqs: { id: string; name: string }[] = []
    while (Date.now() < deadline) {
      const reply = await callMcpTool(discovery, 'list_requests', {})
      reqs = parsedReply(reply) as { id: string; name: string }[]
      if (reqs.some((r) => r.name === 'Greeter Mock') && reqs.some((r) => r.name === 'Greeter Consumer')) break
      await new Promise((r) => setTimeout(r, 250))
    }
    requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
    expect(requestsByName.get('Greeter Mock'), 'Greeter Mock request not found').toBeTruthy()
    expect(requestsByName.get('Greeter Consumer'), 'Greeter Consumer request not found').toBeTruthy()
  }
)

When(
  'I open the gRPC server {string} request tab via MCP',
  async ({ callMcpTool }, name: string) => {
    if (discovery === null) throw new Error('open the project first')
    const id = requestsByName.get(name)
    expect(id, `request "${name}" not found`).toBeTruthy()
    if (id === undefined) throw new Error(`request "${name}" missing`)
    const tab = await callMcpTool(discovery, 'open_tab', { itemId: id })
    expect(tab.isError ?? false).toBe(false)
    await page?.locator('[data-testid="grpc-server-url-section"]:visible').waitFor({ state: 'visible', timeout: 15_000 })
  }
)

When(
  'I open the {string} request tab via MCP',
  async ({ callMcpTool }, name: string) => {
    if (discovery === null) throw new Error('open the project first')
    const id = requestsByName.get(name)
    expect(id, `request "${name}" not found`).toBeTruthy()
    if (id === undefined) throw new Error(`request "${name}" missing`)
    const tab = await callMcpTool(discovery, 'open_tab', { itemId: id })
    expect(tab.isError ?? false).toBe(false)
    // The client consumer tab shows the gRPC URL section + Invoke button.
    await page?.locator(INVOKE_BTN).waitFor({ state: 'visible', timeout: 15_000 })
  }
)

When('I click the gRPC Start button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(START_BTN).click()
})

When('I click the gRPC Stop button', async () => {
  if (page === null) throw new Error('launch first')
  // Same button as Start — it toggles to the stop action while listening.
  await page.locator(START_BTN).click()
})

When('I click the gRPC Invoke button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(INVOKE_BTN).click()
})

Then('the gRPC Start button shows the listening state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${START_BTN} .codicon-debug-disconnect`)).toBeVisible({ timeout: 10_000 })
})

Then('the gRPC Start button shows the stopped state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${START_BTN} .codicon-plug`)).toBeVisible({ timeout: 10_000 })
})

Then('the gRPC mock shows the listening banner', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(SERVED_BANNER)).toBeVisible({ timeout: 10_000 })
})

Then('the gRPC mock shows at least {int} calls served', async ({}, _n: number) => {
  if (page === null) throw new Error('launch first')
  // The served banner shows "Listening — N call(s) served"; after the two
  // consumer calls the count is at least 2 (asserting it is not 0 or 1).
  const banner = page.locator(SERVED_BANNER)
  await expect(banner).toBeVisible({ timeout: 10_000 })
  await expect(banner).not.toContainText('0 call', { timeout: 10_000 })
  await expect(banner).not.toContainText('1 call', { timeout: 10_000 })
})

Then(
  'the gRPC response shows a message matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    await expect(page.locator(RESPONSE_EDITOR)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(RESPONSE_EDITOR)).toContainText(needle, { timeout: 10_000 })
  }
)

Then(
  'the gRPC response shows a non-OK status code {int}',
  async ({}, code: number) => {
    if (page === null) throw new Error('launch first')
    const statusEl = page.locator(`[data-testid="grpc-response-status"][data-status-code="${code}"]:visible`)
    await expect(statusEl).toBeVisible({ timeout: 15_000 })
  }
)

Then(
  'the {string} request shows the SRV badge in the tree',
  async ({}, name: string) => {
    if (page === null) throw new Error('launch first')
    // A saved gRPC mock server renders the SRV capsule (vs a bare call-type
    // badge), so it's distinguishable from a normal request in the sidebar.
    const row = sidebarRowByName(page, name)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.locator('.badge-capsule-glyph')).toHaveText('SRV', { timeout: 10_000 })
  }
)
