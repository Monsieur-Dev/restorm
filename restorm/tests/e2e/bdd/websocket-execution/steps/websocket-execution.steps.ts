/**
 * Steps for the self-hosted `websocket-execution` BDD scenario — the raw-WS
 * counterpart of `socketio-execution`. restorm acts as BOTH the raw WebSocket
 * server and the client connecting to it — no external mock. Reuses the MCP
 * fixture to launch restorm (MCP on by default) and open the sample + tabs, then drives
 * the REAL request panel: starts the WS Echo Server, connects the WS Echo
 * client, sends a frame (raw WS has no ack), broadcasts from the server's Send
 * button (the client receives it), then disconnects.
 *
 * Two request tabs are open at once (server + client). restorm keeps inactive
 * tabs mounted but laid out at 0×0, so every interaction targets the VISIBLE
 * tab via the `:visible` engine rather than `.first()`.
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestsByName = new Map<string, string>()

// `:visible` → the active tab (inactive tabs are mounted but 0×0).
const CONNECT_BTN = '[data-testid="websocket-connect-button"]:visible'
const SEND_BTN = '[data-testid="websocket-send-button"]:visible'

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

Given(
  'I open the WebSocket sample via MCP',
  async ({ callMcpTool, restormRoot }) => {
    if (discovery === null) throw new Error('launch first')
    const samplePath = join(restormRoot, 'tests/e2e/samples/ws-sample.restorm')
    const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
    expect(opened.isError ?? false).toBe(false)

    const deadline = Date.now() + 15_000
    let reqs: { id: string; name: string }[] = []
    while (Date.now() < deadline) {
      const reply = await callMcpTool(discovery, 'list_requests', {})
      reqs = parsedReply(reply) as { id: string; name: string }[]
      if (reqs.some((r) => r.name === 'WS Echo Server') && reqs.some((r) => r.name === 'WS Echo')) break
      await new Promise((r) => setTimeout(r, 250))
    }
    requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
    expect(requestsByName.get('WS Echo Server'), 'WS Echo Server request not found').toBeTruthy()
    expect(requestsByName.get('WS Echo'), 'WS Echo request not found').toBeTruthy()
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
    await page?.locator(CONNECT_BTN).waitFor({ state: 'visible', timeout: 15_000 })
  }
)

When('I click the Connect button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(CONNECT_BTN).click()
})

When('I click the Send button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(SEND_BTN).click()
})

When('I click the Disconnect button', async () => {
  if (page === null) throw new Error('launch first')
  // Same button as Connect — it toggles to the disconnect action while listening.
  await page.locator(CONNECT_BTN).click()
})

Then('the Send button is disabled', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(SEND_BTN)).toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 })
})

Then('the Send button is enabled', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(SEND_BTN)).toHaveAttribute('aria-disabled', 'false', { timeout: 10_000 })
})

Then('the Connect button shows the connected state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${CONNECT_BTN} .codicon-debug-disconnect`)).toBeVisible({ timeout: 10_000 })
})

Then('the Connect button shows the disconnected state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${CONNECT_BTN} .codicon-plug`)).toBeVisible({ timeout: 10_000 })
})

Then('the server shows {int} connected client', async ({}, n: number) => {
  if (page === null) throw new Error('launch first')
  // The server's Response tab banner shows the live connected-client count.
  await expect(page.locator('[data-testid="websocket-server-client-count"]:visible'))
    .toContainText(String(n), { timeout: 10_000 })
})

Then(
  'the chat shows a sent message matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const sentBubble = page
      .locator('[data-testid="ws-chat-bubble"][data-direction="sent"]:visible')
      .filter({ hasText: needle })
      .first()
    await expect(sentBubble).toBeVisible({ timeout: 10_000 })
  }
)

Then(
  'the chat shows a received message matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const receivedBubble = page
      .locator('[data-testid="ws-chat-bubble"][data-direction="received"]:visible')
      .filter({ hasText: needle })
      .first()
    await expect(receivedBubble).toBeVisible({ timeout: 10_000 })
  }
)
