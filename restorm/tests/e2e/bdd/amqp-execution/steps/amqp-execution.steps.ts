/**
 * Steps for the `amqp-execution` BDD scenario. Unlike MQTT (self-hosted),
 * AMQP connects to the `rabbitmq` Docker mock (see
 * `tests/docker/docker-compose.yml`) — "AMQP Subscribe" consumes the
 * pre-declared `restorm-e2e-queue`, "AMQP Publish" sends to it via the
 * default exchange (routing key = the queue name).
 *
 * Reuses the MCP fixture to launch restorm (MCP on by default) and open the
 * sample + tabs, then drives the REAL UI via `AmqpRequestTabView`'s testids.
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
const CONNECT_BTN = '[data-testid="amqp-connect-button"]:visible'
const SEND_BTN = '[data-testid="amqp-send-button"]:visible'
const FRAME = '[data-testid^="response-stream-frame-"]:visible'

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
  'I open the AMQP sample via MCP',
  async ({ callMcpTool, restormRoot }) => {
    if (discovery === null) throw new Error('launch first')
    const samplePath = join(restormRoot, 'tests/e2e/samples/amqp-sample.restorm')
    const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
    expect(opened.isError ?? false).toBe(false)

    // The collection store populates asynchronously after `file:opened`; poll
    // list_requests until the sample's requests have synced through.
    const deadline = Date.now() + 15_000
    let reqs: { id: string; name: string }[] = []
    while (Date.now() < deadline) {
      const reply = await callMcpTool(discovery, 'list_requests', {})
      reqs = parsedReply(reply) as { id: string; name: string }[]
      if (reqs.some((r) => r.name === 'AMQP Subscribe')) break
      await new Promise((r) => setTimeout(r, 250))
    }
    requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
    expect(requestsByName.get('AMQP Subscribe'), 'AMQP Subscribe request not found in the sample').toBeTruthy()
    expect(requestsByName.get('AMQP Publish'), 'AMQP Publish request not found in the sample').toBeTruthy()
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
    // Wait for this tab's (now visible) URL section to lay out.
    await page?.locator('[data-testid="amqp-url-section"]:visible').waitFor({ state: 'visible', timeout: 15_000 })
  }
)

When('I click the AMQP Connect button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(CONNECT_BTN).click()
})

When('I click the AMQP Send button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(SEND_BTN).click()
})

Then('the AMQP Connect button is disconnected', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${CONNECT_BTN} .codicon-plug`)).toBeVisible({ timeout: 10_000 })
})

Then('the AMQP Connect button shows the connected state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${CONNECT_BTN} .codicon-debug-disconnect`)).toBeVisible({ timeout: 15_000 })
})

Then('the AMQP Connect button shows the disconnected state', async () => {
  if (page === null) throw new Error('launch first')
  await expect(page.locator(`${CONNECT_BTN} .codicon-plug`)).toBeVisible({ timeout: 10_000 })
})

Then(
  'the AMQP response shows a sent message matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const sentFrame = page
      .locator(`${FRAME}[data-direction="sent"]`)
      .filter({ hasText: needle })
      .first()
    await expect(sentFrame).toBeVisible({ timeout: 10_000 })
  }
)

Then(
  'the AMQP response shows a received message matching {string}',
  async ({}, needle: string) => {
    if (page === null) throw new Error('launch first')
    const receivedFrame = page
      .locator(`${FRAME}[data-direction="received"]`)
      .filter({ hasText: needle })
      .first()
    await expect(receivedFrame).toBeVisible({ timeout: 15_000 })
  }
)
