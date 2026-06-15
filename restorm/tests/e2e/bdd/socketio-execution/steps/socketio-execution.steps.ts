/**
 * Steps for the `socketio-execution` BDD scenario. Reuses the MCP fixture to
 * launch restorm with `--mcp` (open the sample + tabs + push the HTTP request
 * via MCP), then drives the REAL UI: clicks the Connect / Send / Disconnect
 * buttons and asserts the button states + the chat bubbles (including the
 * acknowledgement check on the sent bubble and the HTTP-pushed received bubble).
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let echoId: string | null = null
let pushHttpId: string | null = null

const CONNECT_BTN = '[data-testid="websocket-connect-button"]'
const SEND_BTN = '[data-testid="websocket-send-button"]'

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
    echoId = null
    pushHttpId = null
  }
)

Given(
  'I open the Socket.IO sample and the Echo request tab via MCP',
  async ({ callMcpTool, restormRoot }) => {
    if (discovery === null) throw new Error('launch first')
    const samplePath = join(restormRoot, 'tests/e2e/samples/socketio-sample.restorm')
    const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
    expect(opened.isError ?? false).toBe(false)

    // The collection store populates asynchronously after `file:opened`; poll
    // list_requests until the sample's requests have synced through.
    const deadline = Date.now() + 15_000
    let reqs: { id: string; name: string }[] = []
    while (Date.now() < deadline) {
      const reply = await callMcpTool(discovery, 'list_requests', {})
      reqs = parsedReply(reply) as { id: string; name: string }[]
      if (reqs.some((r) => r.name === 'Echo')) break
      await new Promise((r) => setTimeout(r, 250))
    }
    echoId = reqs.find((r) => r.name === 'Echo')?.id ?? null
    pushHttpId = reqs.find((r) => r.name === 'Push to echo (HTTP)')?.id ?? null
    expect(echoId, 'Echo request not found in the sample').toBeTruthy()
    expect(pushHttpId, '"Push to echo (HTTP)" request not found in the sample').toBeTruthy()
    if (echoId === null) throw new Error('Echo id missing')

    const tab = await callMcpTool(discovery, 'open_tab', { itemId: echoId })
    expect(tab.isError ?? false).toBe(false)
    // Wait for the Echo request tab (its Connect button) to mount.
    await page?.locator(CONNECT_BTN).first().waitFor({ state: 'visible', timeout: 15_000 })
  }
)

When('I click the Connect button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(CONNECT_BTN).first().click()
})

When('I click the Send button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(SEND_BTN).first().click()
})

When('I click the Disconnect button', async () => {
  if (page === null) throw new Error('launch first')
  // Same button as Connect — it toggles to the disconnect action while listening.
  await page.locator(CONNECT_BTN).first().click()
})

When(
  'I push to the {string} event over the HTTP route via MCP',
  async ({ callMcpTool }, _event: string) => {
    if (discovery === null || pushHttpId === null) throw new Error('open the project first')
    const reply = await callMcpTool(discovery, 'run_request', { id: pushHttpId, timeoutMs: 10_000 })
    const payload = parsedReply(reply) as { status?: number; error?: { message: string } }
    if (payload.error) throw new Error(`HTTP /emit failed: ${payload.error.message}`)
    expect(payload.status, 'the HTTP /emit route should return 200').toBe(200)
  }
)

When('I reopen the Echo request tab via MCP', async ({ callMcpTool }) => {
  if (discovery === null || echoId === null) throw new Error('open the project first')
  await callMcpTool(discovery, 'open_tab', { itemId: echoId })
  await page?.locator(CONNECT_BTN).first().waitFor({ state: 'visible', timeout: 10_000 })
})

Then('the Send button is disabled', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(SEND_BTN).first()).toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 })
})

Then('the Send button is enabled', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(SEND_BTN).first()).toHaveAttribute('aria-disabled', 'false', { timeout: 10_000 })
})

Then('the Connect button shows the connected state', async () => {
  if (page === null) throw new Error('launch first')
  // While listening, the toggle shows the "disconnect" glyph.
  await expect(page.locator(`${CONNECT_BTN} .codicon-debug-disconnect`).first()).toBeVisible({ timeout: 10_000 })
})

Then('the Connect button shows the disconnected state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${CONNECT_BTN} .codicon-plug`).first()).toBeVisible({ timeout: 10_000 })
})

Then(
  'the chat shows a sent message matching {string} with an acknowledgement',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const sentBubble = page
      .locator('[data-testid="ws-chat-bubble"][data-direction="sent"]')
      .filter({ hasText: needle })
      .first()
    await expect(sentBubble).toBeVisible({ timeout: 10_000 })
    // The acknowledgement folds into a check badge on the sent bubble.
    await expect(sentBubble.locator('[data-testid="ws-chat-ack-check"]')).toBeVisible({ timeout: 10_000 })
  }
)

Then(
  'the chat shows a received message matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const receivedBubble = page
      .locator('[data-testid="ws-chat-bubble"][data-direction="received"]')
      .filter({ hasText: needle })
      .first()
    await expect(receivedBubble).toBeVisible({ timeout: 10_000 })
  }
)
