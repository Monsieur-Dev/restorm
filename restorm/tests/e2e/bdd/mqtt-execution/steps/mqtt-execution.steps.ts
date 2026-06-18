/**
 * Steps for the `mqtt-execution` BDD scenario. restorm HOSTS a local MQTT broker
 * (aedes) AND connects to it as a client — no external Mosquitto. The broker
 * subscribes internally to its topic (surfacing every published frame) and its
 * Send button publishes to that topic; the client subscribes to the same topic
 * on connect and its Send publishes there too — so a client publish round-trips
 * straight back through its own subscription (sent + received bubble) and a
 * broker Send reaches the connected client.
 *
 * Reuses the MCP fixture to launch restorm with `--mcp` and open the sample +
 * tabs, then drives the REAL UI. MQTT reuses `WebSocketRequestTabView`, so the
 * Connect / Send / chat-bubble / server-client-count testids are the shared
 * `websocket-*` / `ws-chat-*` ones.
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestsByName = new Map<string, string>()
// The payload of the most recently asserted sent bubble — so a follow-up step
// can assert the delivery check on that same bubble ("that sent message …").
let lastSentNeedle: string | null = null

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
    lastSentNeedle = null
  }
)

Given(
  'I open the MQTT sample via MCP',
  async ({ callMcpTool, restormRoot }) => {
    if (discovery === null) throw new Error('launch first')
    const samplePath = join(restormRoot, 'tests/e2e/samples/mqtt-sample.restorm')
    const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
    expect(opened.isError ?? false).toBe(false)

    // The collection store populates asynchronously after `file:opened`; poll
    // list_requests until the sample's request has synced through.
    const deadline = Date.now() + 15_000
    let reqs: { id: string; name: string }[] = []
    while (Date.now() < deadline) {
      const reply = await callMcpTool(discovery, 'list_requests', {})
      reqs = parsedReply(reply) as { id: string; name: string }[]
      if (reqs.some((r) => r.name === 'MQTT Chat')) break
      await new Promise((r) => setTimeout(r, 250))
    }
    requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
    expect(requestsByName.get('MQTT Chat'), 'MQTT Chat request not found in the sample').toBeTruthy()
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
    // Wait for this tab's (now visible) Connect button to lay out.
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
  // Same button as Connect — it toggles to the disconnect action while connected.
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
  // While connected, the toggle shows the "disconnect" glyph.
  await expect(page.locator(`${CONNECT_BTN} .codicon-debug-disconnect`)).toBeVisible({ timeout: 10_000 })
})

Then('the Connect button shows the disconnected state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${CONNECT_BTN} .codicon-plug`)).toBeVisible({ timeout: 10_000 })
})

Then('the server shows {int} connected client', async ({}, n: number) => {
  if (page === null) throw new Error('launch first')
  // The broker's Response tab banner shows the live connected-client count.
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
    lastSentNeedle = needle
  }
)

Then(
  // The client publishes to a topic it is itself subscribed to, so its own
  // publish round-trips back through the subscription. The chat folds that
  // round-trip into a delivery check on the originating sent bubble (the same
  // confirmation UX as a Socket.IO ack) rather than rendering a duplicate
  // inbound bubble — assert the check on the sent bubble from the prior step.
  'that sent message shows a delivery check',
  async () => {
    if (page === null) throw new Error('launch first')
    if (lastSentNeedle === null) throw new Error('assert a sent message first')
    const ackCheck = page
      .locator('[data-testid="ws-chat-bubble"][data-direction="sent"]:visible')
      .filter({ hasText: lastSentNeedle })
      .first()
      .locator('[data-testid="ws-chat-ack-check"]')
    await expect(ackCheck).toBeVisible({ timeout: 10_000 })
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
