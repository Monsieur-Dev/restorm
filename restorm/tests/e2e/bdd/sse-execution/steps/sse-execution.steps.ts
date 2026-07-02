/**
 * Steps for the `sse-execution` BDD scenarios — the receive-only counterpart
 * of `grpc-execution` / `websocket-execution`: connect against the live SSE
 * mock server and assert frames arrive in the streaming frames list. SSE has
 * no send direction, so there is no Send-button coverage here. Reuses the
 * MCP fixture to launch restorm (MCP on by default) and open the sample +
 * tabs, then drives the REAL request panel and asserts the button states +
 * frame rows.
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestsByName = new Map<string, string>()

const CONNECT_BTN = '[data-testid="sse-connect-button"]'
const URL_INPUT = '[data-testid="sse-request-url-input"]'
// Scoped to the frame's DATA span specifically (not the whole row, which also
// renders a locale timestamp — a bare-digit needle like "1" or "3" would
// spuriously match the clock reading if matched against the full row).
const FRAME_DATA = '[data-testid^="response-stream-frame-data-"]'

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

Given('I open the SSE sample via MCP', async ({ callMcpTool, restormRoot }) => {
  if (discovery === null) throw new Error('launch first')
  const samplePath = join(restormRoot, 'tests/e2e/samples/sse-sample.restorm')
  const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
  expect(opened.isError ?? false).toBe(false)

  // The collection store populates asynchronously after `file:opened`; poll
  // list_requests until the sample's SSE requests have synced through.
  const deadline = Date.now() + 15_000
  let reqs: { id: string; name: string }[] = []
  while (Date.now() < deadline) {
    const reply = await callMcpTool(discovery, 'list_requests', {})
    reqs = parsedReply(reply) as { id: string; name: string }[]
    if (reqs.some((r) => r.name === 'SSE Reconnect')) break
    await new Promise((r) => setTimeout(r, 250))
  }
  requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
  expect(requestsByName.has('SSE Reconnect'), 'SSE requests not found in the sample').toBe(true)
})

When('I open the {string} request tab via MCP', async ({ callMcpTool }, name: string) => {
  if (discovery === null) throw new Error('open the project first')
  const id = requestsByName.get(name)
  expect(id, `request "${name}" not found in the sample`).toBeTruthy()
  const tab = await callMcpTool(discovery, 'open_tab', { itemId: id })
  expect(tab.isError ?? false).toBe(false)
  await page?.locator(CONNECT_BTN).first().waitFor({ state: 'visible', timeout: 15_000 })
})

When('I click the SSE Connect button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(CONNECT_BTN).first().click()
})

When('I click the SSE Disconnect button', async () => {
  if (page === null) throw new Error('launch first')
  // Same button as Connect — it toggles to the disconnect action while listening.
  await page.locator(CONNECT_BTN).first().click()
})

When('I type {int} characters into the SSE URL field within {int} ms', async ({}, count: number, windowMs: number) => {
  if (page === null) throw new Error('launch first')
  await page.evaluate(() => { (window as unknown as { __e2eResetDocUpdateCount?: () => void }).__e2eResetDocUpdateCount?.() })
  const input = page.locator(URL_INPUT).first()
  await input.click()
  const text = 'abcdefghijklmnopqrstuvwxyz'.slice(0, count)
  const delay = Math.max(0, Math.floor(windowMs / Math.max(1, count - 1)))
  await input.pressSequentially(text, { delay })
})

Then('at most {int} SSE document-update events are emitted', async ({}, max: number) => {
  if (page === null) throw new Error('launch first')
  // Wait one debounce window so the trailing event lands before reading.
  await page.waitForTimeout(400)
  const counted = await page.evaluate(() => (window as unknown as { __e2eDocUpdateCount?: number }).__e2eDocUpdateCount ?? 0)
  if (counted > max) throw new Error(`Debounce regression: expected <= ${max} document-update events, got ${counted}`)
})

Then('the SSE Connect button shows the connected state', async () => {
  if (page === null) throw new Error('launch first')
  // While the stream is open, the toggle shows the "disconnect" glyph.
  await expect(page.locator(`${CONNECT_BTN} .codicon-debug-disconnect`).first()).toBeVisible({ timeout: 10_000 })
})

Then('the SSE Connect button shows the disconnected state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${CONNECT_BTN} .codicon-plug`).first()).toBeVisible({ timeout: 10_000 })
})

Then(
  'the SSE frame list shows a frame matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const frame = page.locator(FRAME_DATA).filter({ hasText: needle }).first()
    await expect(frame).toBeVisible({ timeout: 15_000 })
  }
)
