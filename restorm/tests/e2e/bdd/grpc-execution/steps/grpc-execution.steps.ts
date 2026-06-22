/**
 * Steps for the `grpc-execution` BDD scenarios — the gRPC counterpart of
 * `websocket-execution`, covering all call types against the live grpcbin
 * server: unary (Invoke → response), server-streaming (Connect → echoed frames)
 * and bidirectional (Connect → Send → echo → Disconnect). Reuses the MCP fixture
 * to launch restorm (MCP on by default) and open the sample + tabs, then drives the
 * REAL request panel and asserts the button states + chat bubbles.
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestsByName = new Map<string, string>()

const CONNECT_BTN = '[data-testid="grpc-connect-button"]'
const STREAM_SEND_BTN = '[data-testid="grpc-stream-send-button"]'
const INVOKE_BTN = '[data-testid="grpc-send-button"]'
const RESPONSE_EDITOR = '[data-testid="grpc-response-message-editor"]'

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

Given('I open the gRPC sample via MCP', async ({ callMcpTool, restormRoot }) => {
  if (discovery === null) throw new Error('launch first')
  const samplePath = join(restormRoot, 'tests/e2e/samples/grpc-sample.restorm')
  const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
  expect(opened.isError ?? false).toBe(false)

  // The collection store populates asynchronously after `file:opened`; poll
  // list_requests until the sample's gRPC requests have synced through.
  const deadline = Date.now() + 15_000
  let reqs: { id: string; name: string }[] = []
  while (Date.now() < deadline) {
    const reply = await callMcpTool(discovery, 'list_requests', {})
    reqs = parsedReply(reply) as { id: string; name: string }[]
    if (reqs.some((r) => r.name === 'gRPC Echo (bidi)')) break
    await new Promise((r) => setTimeout(r, 250))
  }
  requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
  expect(requestsByName.has('gRPC Echo (bidi)'), 'gRPC requests not found in the sample').toBe(true)
})

When('I open the {string} request tab via MCP', async ({ callMcpTool }, name: string) => {
  if (discovery === null) throw new Error('open the project first')
  const id = requestsByName.get(name)
  expect(id, `request "${name}" not found in the sample`).toBeTruthy()
  const tab = await callMcpTool(discovery, 'open_tab', { itemId: id })
  expect(tab.isError ?? false).toBe(false)
  // Wait for either the streaming Connect button or the unary Invoke button.
  await page?.locator(`${CONNECT_BTN}, ${INVOKE_BTN}`).first().waitFor({ state: 'visible', timeout: 15_000 })
})

When('I click the gRPC Invoke button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(INVOKE_BTN).first().click()
})

When('I type {int} characters into the gRPC URL field within {int} ms', async ({}, count: number, windowMs: number) => {
  if (page === null) throw new Error('launch first')
  await page.evaluate(() => { (window as unknown as { __e2eResetDocUpdateCount?: () => void }).__e2eResetDocUpdateCount?.() })
  const input = page.locator('[data-testid="grpc-url-input"]').first()
  await input.click()
  const text = 'abcdefghijklmnopqrstuvwxyz'.slice(0, count)
  const delay = Math.max(0, Math.floor(windowMs / Math.max(1, count - 1)))
  await input.pressSequentially(text, { delay })
})

Then('at most {int} gRPC document-update events are emitted', async ({}, max: number) => {
  if (page === null) throw new Error('launch first')
  // Wait one debounce window so the trailing event lands before reading.
  await page.waitForTimeout(400)
  const counted = await page.evaluate(() => (window as unknown as { __e2eDocUpdateCount?: number }).__e2eDocUpdateCount ?? 0)
  if (counted > max) throw new Error(`Debounce regression: expected <= ${max} document-update events, got ${counted}`)
})

When('I click the gRPC Connect button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(CONNECT_BTN).first().click()
})

When('I click the gRPC Send button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(STREAM_SEND_BTN).first().click()
})

When('I click the gRPC Disconnect button', async () => {
  if (page === null) throw new Error('launch first')
  // Same button as Connect — it toggles to the disconnect action while listening.
  await page.locator(CONNECT_BTN).first().click()
})

Then('the gRPC Send button is disabled', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(STREAM_SEND_BTN).first()).toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 })
})

Then('the gRPC Send button is enabled', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(STREAM_SEND_BTN).first()).toHaveAttribute('aria-disabled', 'false', { timeout: 10_000 })
})

Then('the gRPC Connect button shows the connected state', async () => {
  if (page === null) throw new Error('launch first')
  // While the stream is open, the toggle shows the "disconnect" glyph.
  await expect(page.locator(`${CONNECT_BTN} .codicon-debug-disconnect`).first()).toBeVisible({ timeout: 10_000 })
})

Then('the gRPC Connect button shows the disconnected state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${CONNECT_BTN} .codicon-plug`).first()).toBeVisible({ timeout: 10_000 })
})

Then(
  'the gRPC response shows a message matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    // The read-only response editor only renders once a unary response arrives.
    await expect(page.locator(RESPONSE_EDITOR).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(RESPONSE_EDITOR).first()).toContainText(needle, { timeout: 10_000 })
  }
)

Then(
  'the gRPC chat shows a received message matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const receivedBubble = page
      .locator('[data-testid="grpc-chat-bubble"][data-direction="received"]')
      .filter({ hasText: needle })
      .first()
    await expect(receivedBubble).toBeVisible({ timeout: 15_000 })
  }
)

Then(
  'the gRPC chat shows a sent message matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const sentBubble = page
      .locator('[data-testid="grpc-chat-bubble"][data-direction="sent"]')
      .filter({ hasText: needle })
      .first()
    await expect(sentBubble).toBeVisible({ timeout: 15_000 })
  }
)
