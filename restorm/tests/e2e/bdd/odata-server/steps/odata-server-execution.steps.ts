/**
 * Steps for the self-hosted `odata-server` BDD scenario — restorm acts as BOTH
 * the local OData v4 mock service AND the client consuming it, no external
 * service. Reuses the MCP fixture to launch restorm with `--mcp` and open the
 * sample + tabs, then drives the REAL request panel: starts the Pets Mock
 * (Listen), sends the Pets Consumer against it (asserting the served collection
 * body), then stops the mock.
 *
 * Two request tabs are open at once (mock + consumer). restorm keeps inactive
 * tabs mounted but laid out at 0×0, so every interaction targets the VISIBLE
 * tab via the `:visible` engine rather than `.first()`.
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
const LISTEN_BTN = '[data-testid="odata-server-listen"]:visible'
const SEND_BTN = '[data-testid="odata-request-send"]:visible'
const SERVED_BANNER = '[data-testid="odata-server-served-banner"]:visible'
const RESPONSE_BODY = '[data-testid="odata-response-body-editor"]:visible'

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
  'I open the OData mock sample via MCP',
  async ({ callMcpTool, restormRoot }) => {
    if (discovery === null) throw new Error('launch first')
    const samplePath = join(restormRoot, 'tests/e2e/samples/odata-server-sample.restorm')
    const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
    expect(opened.isError ?? false).toBe(false)

    const deadline = Date.now() + 15_000
    let reqs: { id: string; name: string }[] = []
    while (Date.now() < deadline) {
      const reply = await callMcpTool(discovery, 'list_requests', {})
      reqs = parsedReply(reply) as { id: string; name: string }[]
      if (reqs.some((r) => r.name === 'Pets Mock') && reqs.some((r) => r.name === 'Pets Consumer')) break
      await new Promise((r) => setTimeout(r, 250))
    }
    requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
    expect(requestsByName.get('Pets Mock'), 'Pets Mock request not found').toBeTruthy()
    expect(requestsByName.get('Pets Consumer'), 'Pets Consumer request not found').toBeTruthy()
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
    // Wait for the visible URL section of whichever tab just opened (the mock's
    // server URL row or the consumer's client URL row).
    await page?.locator('[data-testid="odata-server-url-section"]:visible, [data-testid="odata-request-url-section"]:visible')
      .first().waitFor({ state: 'visible', timeout: 15_000 })
  }
)

When('I click the Listen button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(LISTEN_BTN).click()
})

When('I click the Stop button', async () => {
  if (page === null) throw new Error('launch first')
  // Same button as Listen — it toggles to the stop action while listening.
  await page.locator(LISTEN_BTN).click()
})

When('I click the Send button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(SEND_BTN).click()
})

Then('the Listen button shows the listening state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${LISTEN_BTN} .codicon-debug-disconnect`)).toBeVisible({ timeout: 10_000 })
})

Then('the Listen button shows the stopped state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${LISTEN_BTN} .codicon-plug`)).toBeVisible({ timeout: 10_000 })
})

Then('the mock shows the listening banner', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(SERVED_BANNER)).toBeVisible({ timeout: 10_000 })
})

Then('the mock shows at least {int} request served', async ({}, _n: number) => {
  if (page === null) throw new Error('launch first')
  // The served banner shows "Listening — N request(s) served"; after one
  // consumer call the count is at least 1 (asserting it is no longer 0).
  const banner = page.locator(SERVED_BANNER)
  await expect(banner).toBeVisible({ timeout: 10_000 })
  await expect(banner).not.toContainText('0 request', { timeout: 10_000 })
})

Then(
  'the response body contains {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    await expect(page.locator(RESPONSE_BODY)).toContainText(needle, { timeout: 15_000 })
  }
)

Then(
  'the {string} request shows the SRV badge in the tree',
  async ({}, name: string) => {
    if (page === null) throw new Error('launch first')
    // A saved OData mock service renders the SRV capsule (vs a bare ODATA badge),
    // so it's distinguishable from a normal request in the sidebar tree.
    const row = sidebarRowByName(page, name)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.locator('.badge-capsule-glyph')).toHaveText('SRV', { timeout: 10_000 })
  }
)
