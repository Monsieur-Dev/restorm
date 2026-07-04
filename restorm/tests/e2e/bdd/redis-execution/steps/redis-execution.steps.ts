/**
 * Steps for the `redis-execution` BDD scenario. restorm connects to the
 * `redis:7-alpine` Docker mock both in subscribe mode (a long-lived
 * subscriber connection, toggled via the same run button used to
 * unsubscribe) and command mode (one command on a fresh connection, then
 * disconnect — a REPL-style history of runs).
 *
 * Reuses the MCP fixture to launch restorm (MCP on by default) and open the
 * sample + tabs, then drives the REAL UI via the `redis-run-button` testid
 * shared by both modes (`RedisRequestTabView`).
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
const RUN_BTN = '[data-testid="redis-run-button"]:visible'
const STREAM_FRAME = '[data-testid^="response-stream-frame-"]:visible'

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
  'I open the Redis sample via MCP',
  async ({ callMcpTool, restormRoot }) => {
    if (discovery === null) throw new Error('launch first')
    const samplePath = join(restormRoot, 'tests/e2e/samples/redis-sample.restorm')
    const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
    expect(opened.isError ?? false).toBe(false)

    // The collection store populates asynchronously after `file:opened`; poll
    // list_requests until the sample's requests have synced through.
    const deadline = Date.now() + 15_000
    let reqs: { id: string; name: string }[] = []
    while (Date.now() < deadline) {
      const reply = await callMcpTool(discovery, 'list_requests', {})
      reqs = parsedReply(reply) as { id: string; name: string }[]
      if (reqs.some((r) => r.name === 'Redis Get')) break
      await new Promise((r) => setTimeout(r, 250))
    }
    requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
    expect(requestsByName.get('Redis Get'), 'Redis Get request not found in the sample').toBeTruthy()
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
    // Wait for this tab's (now visible) run button to lay out.
    await page?.locator(RUN_BTN).waitFor({ state: 'visible', timeout: 15_000 })
  }
)

When('I click the Redis run button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(RUN_BTN).click()
})

Then('the Redis run button shows the subscribed state', async () => {
  if (page === null) throw new Error('launch first')
  // Subscribe mode toggles to the "unsubscribe" glyph once the connection is
  // (or is becoming) live — mirrors the streaming connect/close toggle button.
  await expect(page.locator(`${RUN_BTN} .codicon-debug-disconnect`)).toBeVisible({ timeout: 10_000 })
})

Then('the Redis run button shows the unsubscribed state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${RUN_BTN} .codicon-plug`)).toBeVisible({ timeout: 10_000 })
})

Then(
  'the Redis command REPL shows a reply for {string}',
  async ({}, commandLine: string) => {
    if (page === null) throw new Error('launch first')
    const entry = page.locator(STREAM_FRAME).filter({ hasText: commandLine }).first()
    await expect(entry).toBeVisible({ timeout: 10_000 })
  }
)

Then(
  'the Redis command REPL shows a reply matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const entry = page.locator(STREAM_FRAME).filter({ hasText: needle }).first()
    await expect(entry).toBeVisible({ timeout: 10_000 })
  }
)

Then(
  'the Redis response shows a stream frame on channel {string} matching {string}',
  async ({}, channel: string, needle: string) => {
    if (page === null) throw new Error('launch first')
    const frame = page.locator(STREAM_FRAME).filter({ hasText: channel }).filter({ hasText: needle }).first()
    await expect(frame).toBeVisible({ timeout: 10_000 })
  }
)
