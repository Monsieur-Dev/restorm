/**
 * Steps for the `stomp-execution` BDD scenario. STOMP is client-only — it
 * connects to the docker `rmohr/activemq` mock (`ws://localhost:61614`), not a
 * restorm-hosted broker, unlike WebSocket/Socket.IO/MQTT. The "STOMP Chat"
 * sample request subscribes to `/topic/restorm-e2e-chat` on connect and its
 * Send button publishes to that SAME destination, so a single request both
 * sends and receives (the round-trip through its own subscription).
 *
 * Reuses the MCP fixture to launch restorm (MCP on by default) and open the
 * sample + tabs, then drives the REAL UI.
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestsByName = new Map<string, string>()

const CONNECT_BTN = '[data-testid="stomp-connect-button"]:visible'
const SEND_BTN = '[data-testid="stomp-send-button"]:visible'
const URL_CONTAINER = '[data-testid="url-container"]:visible'
const URL_INPUT = '[data-testid="stomp-url-input"]:visible'

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
  'I open the STOMP sample via MCP',
  async ({ callMcpTool, restormRoot }) => {
    if (discovery === null) throw new Error('launch first')
    const samplePath = join(restormRoot, 'tests/e2e/samples/stomp-sample.restorm')
    const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
    expect(opened.isError ?? false).toBe(false)

    // The collection store populates asynchronously after `file:opened`; poll
    // list_requests until the sample's request has synced through.
    const deadline = Date.now() + 15_000
    let reqs: { id: string; name: string }[] = []
    while (Date.now() < deadline) {
      const reply = await callMcpTool(discovery, 'list_requests', {})
      reqs = parsedReply(reply) as { id: string; name: string }[]
      if (reqs.some((r) => r.name === 'STOMP Chat')) break
      await new Promise((r) => setTimeout(r, 250))
    }
    requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
    expect(requestsByName.get('STOMP Chat'), 'STOMP Chat request not found in the sample').toBeTruthy()
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

When('I click the STOMP Connect button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(CONNECT_BTN).click()
})

When('I click the STOMP Send button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(SEND_BTN).click()
})

When('I click the STOMP Disconnect button', async () => {
  if (page === null) throw new Error('launch first')
  // Same button as Connect — it toggles to the disconnect action while connected.
  await page.locator(CONNECT_BTN).click()
})

Then('the STOMP Send button is disabled', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(SEND_BTN)).toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 })
})

Then('the STOMP Send button is enabled', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(SEND_BTN)).toHaveAttribute('aria-disabled', 'false', { timeout: 10_000 })
})

Then('the STOMP Connect button shows the connected state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${CONNECT_BTN} .codicon-debug-disconnect`)).toBeVisible({ timeout: 10_000 })
})

Then('the STOMP Connect button shows the disconnected state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${CONNECT_BTN} .codicon-plug`)).toBeVisible({ timeout: 10_000 })
})

Then('the STOMP URL resolves to {string}', async ({}, expected: string) => {
  if (page === null) throw new Error('launch first')
  // Handlebars resolution round-trips through the main process; poll for it.
  await expect.poll(
    async () => page?.locator(URL_CONTAINER).getAttribute('data-resolved-url') ?? '',
    { timeout: 15_000, message: `expected the resolved URL to equal "${expected}"` }
  ).toBe(expected)
})

Then(
  'the STOMP frame stream shows a sent SEND frame matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const sentFrame = page
      .locator('[data-testid^="response-stream-frame-"][data-direction="sent"]:visible')
      .filter({ hasText: needle })
      .first()
    await expect(sentFrame).toBeVisible({ timeout: 10_000 })
  }
)

Then(
  'the STOMP frame stream shows a received MESSAGE frame matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const receivedFrame = page
      .locator('[data-testid^="response-stream-frame-"][data-direction="received"]:visible')
      .filter({ hasText: needle })
      .first()
    await expect(receivedFrame).toBeVisible({ timeout: 10_000 })
  }
)

When('I type {int} characters into the STOMP URL field within {int} ms', async ({}, count: number, windowMs: number) => {
  if (page === null) throw new Error('launch first')
  await page.evaluate(() => { (window as unknown as { __e2eResetDocUpdateCount?: () => void }).__e2eResetDocUpdateCount?.() })
  const input = page.locator(URL_INPUT).first()
  await input.click()
  const text = 'abcdefghijklmnopqrstuvwxyz'.slice(0, count)
  const delay = Math.max(0, Math.floor(windowMs / Math.max(1, count - 1)))
  await input.pressSequentially(text, { delay })
})

Then('at most {int} STOMP document-update events are emitted', async ({}, max: number) => {
  if (page === null) throw new Error('launch first')
  // Wait one debounce window so the trailing event lands before reading.
  await page.waitForTimeout(400)
  const counted = await page.evaluate(() => (window as unknown as { __e2eDocUpdateCount?: number }).__e2eDocUpdateCount ?? 0)
  if (counted > max) throw new Error(`Debounce regression: expected <= ${max} document-update events, got ${counted}`)
})
