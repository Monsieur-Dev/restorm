/**
 * Steps for the `kafka-execution` BDD suite. Drives restorm through the MCP
 * fixture (`launchAppWithMcp` + `callMcpTool`): launch with MCP on,
 * `open_project` with the Kafka sample, poll `list_requests` until the
 * sample's requests appear, then `open_tab` by id and drive the REAL
 * `<KafkaRequestTabView>` panel, asserting on its `data-testid`s.
 *
 * The sample targets the local `restorm-kafka` mock broker (:9092, KRaft
 * single-node — see `tests/docker/docker-compose.yml`), seeded with the
 * `restorm-test` topic (3 messages, 1 partition — see `kafka-seed.sh`).
 * Kafka has no persistent per-request connection: produce is a one-shot
 * connect -> send -> disconnect (its history is checked via
 * `get_response_history`, mirroring `soap-execution`'s pattern — the Infos
 * pane has no per-field testids, so history is the robust signal), consume
 * is a long-lived consumer group whose received frames render with the
 * shared `response-stream-frame-<n>` testid (Section 8 of the protocol
 * playbook).
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestsByName = new Map<string, string>()
let currentRequestId: string | null = null

const MODE_SELECT = '[data-testid="kafka-mode-select"]:visible'
const URL_INPUT = '[data-testid="kafka-url-input"] input:visible'
const PRODUCE_BTN = '[data-testid="kafka-produce-button"]:visible'
const CONSUME_BTN = '[data-testid="kafka-consume-button"]:visible'

interface DocUpdateCounterWindow {
  __e2eDocUpdateCount?: number
  __e2eResetDocUpdateCount?: () => void
}

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

/** The message/no-messages block lives in the response panel's "Response" tab
 * (the mode-agnostic `renderMessages` output), not the default-selected tab. */
async function openResponseTab(p: Page): Promise<void> {
  const responseTab = p.locator('[data-testid="base-request-tabs-response-tab-response"]:visible').first()
  await responseTab.waitFor({ state: 'visible', timeout: 30_000 })
  await responseTab.click()
  await p
    .locator('[data-testid="base-request-tabs-response-tabpanel-response"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
}

Given(
  'I launch restorm with the MCP server enabled',
  async ({ launchAppWithMcp }) => {
    const launched = await launchAppWithMcp()
    discovery = launched.discovery
    page = launched.page
    requestsByName = new Map()
    currentRequestId = null
  }
)

Given('I open the Kafka sample via MCP', async ({ callMcpTool, restormRoot }) => {
  if (discovery === null) throw new Error('launch first')
  const samplePath = join(restormRoot, 'tests/e2e/samples/kafka-sample.restorm')
  const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
  expect(opened.isError ?? false).toBe(false)

  // Poll list_requests until the sample's requests have synced.
  const deadline = Date.now() + 20_000
  let reqs: { id: string; name: string }[] = []
  while (Date.now() < deadline) {
    const reply = await callMcpTool(discovery, 'list_requests', {})
    reqs = parsedReply(reply) as { id: string; name: string }[]
    if (reqs.some((r) => r.name === 'Kafka Produce') && reqs.some((r) => r.name === 'Kafka Consume')) break
    await new Promise((r) => setTimeout(r, 250))
  }
  requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
  expect(requestsByName.get('Kafka Produce'), 'Kafka sample requests not loaded').toBeTruthy()
})

When('I open the {string} request tab via MCP', async ({ callMcpTool }, name: string) => {
  if (discovery === null || page === null) throw new Error('open the project first')
  const id = requestsByName.get(name)
  expect(id, `request "${name}" not found`).toBeTruthy()
  if (id === undefined) throw new Error(`request "${name}" missing`)
  currentRequestId = id
  const tab = await callMcpTool(discovery, 'open_tab', { itemId: id })
  expect(tab.isError ?? false).toBe(false)
  await page.locator(MODE_SELECT).waitFor({ state: 'visible', timeout: 20_000 })
})

When('I click the Kafka Produce button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(PRODUCE_BTN).waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator(PRODUCE_BTN).click()
})

When('I click the Kafka Consume button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(CONSUME_BTN).waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator(CONSUME_BTN).click()
})

Then('the Kafka Consume button reverts to the idle state', async () => {
  if (page === null) throw new Error('launch first')
  // `plug` = idle (start consuming), `debug-disconnect` = active (stop
  // consuming) — mirrors the mqtt-execution / websocket-execution Connect
  // button's icon-swap convention.
  await expect(page.locator(`${CONSUME_BTN} .codicon-plug`)).toBeVisible({ timeout: 15_000 })
})

Then('the Kafka response panel shows {int} message frames', async ({}, count: number) => {
  if (page === null) throw new Error('launch first')
  const p = page
  await openResponseTab(p)
  await expect(async () => {
    const frames = p.locator('[data-testid^="response-stream-frame-"]:visible')
    await expect(frames).toHaveCount(count, { timeout: 20_000 })
  }).toPass({ timeout: 20_000 })
})

/** produce / consume / browse in the exact order `modeOptions` builds them
 * (`KafkaRequestTabView.tsx`), matching the ECUI SelectBox's index-based
 * `<testId>-option-<n>` convention (see `odata-execution`'s `selectBoxOption`
 * helper). */
const MODE_INDEX: Record<string, number> = { produce: 0, consume: 1, browse: 2 }

Then('the Kafka mode selector reads {string}', async ({}, mode: string) => {
  if (page === null) throw new Error('launch first')
  const select = page.locator(MODE_SELECT).first()
  await expect(select).toBeVisible({ timeout: 10_000 })
  const label = mode.charAt(0).toUpperCase() + mode.slice(1)
  await expect(select).toContainText(label, { timeout: 10_000 })
})

When('I select the Kafka mode {string}', async ({}, mode: string) => {
  if (page === null) throw new Error('launch first')
  const index = MODE_INDEX[mode]
  if (index === undefined) throw new Error(`unknown Kafka mode "${mode}"`)
  await page.locator('[data-testid="kafka-mode-select-trigger"]').first().click({ force: true })
  await page.locator(`[data-testid="kafka-mode-select-option-${index}"]`).first().click({ force: true })
})

When(/^I type (\d+) characters into the Kafka broker URL field within (\d+) ms$/, async ({}, ...args) => {
  if (page === null) throw new Error('launch first')
  const p = page
  const count = Number(args[0])
  const windowMs = Number(args[1])
  await p.evaluate(() => { (window as unknown as DocUpdateCounterWindow).__e2eResetDocUpdateCount?.() })
  const delay = Math.max(0, Math.floor(windowMs / Math.max(1, count - 1)))
  const input = p.locator(URL_INPUT).first()
  await input.focus()
  const text = 'abcdefghijklmnopqrstuvwxyz'.slice(0, count)
  await input.pressSequentially(text, { delay })
})

Then(/^at most (\d+) document-update events are emitted for the request$/, async ({}, ...args) => {
  if (page === null) throw new Error('launch first')
  const max = Number(args[0])
  await new Promise((r) => setTimeout(r, 300))
  const count = await page.evaluate(() => (window as unknown as DocUpdateCounterWindow).__e2eDocUpdateCount ?? 0)
  expect(count, `Debounce regression: expected <= ${max} document-update events, got ${count}`).toBeLessThanOrEqual(max)
})

Then('the Kafka request has at least {int} history entry', async ({ callMcpTool }, n: number) => {
  if (discovery === null) throw new Error('launch first')
  if (currentRequestId === null) throw new Error('open a request first')
  const disco = discovery
  const reqId = currentRequestId
  await expect(async () => {
    const reply = await callMcpTool(disco, 'get_response_history', { requestId: reqId })
    const payload = parsedReply(reply) as { entries?: { guid: string; success?: boolean }[] }
    expect((payload.entries ?? []).length).toBeGreaterThanOrEqual(n)
  }).toPass({ timeout: 20_000 })
})

Then('the Kafka request has at least {int} history entries', async ({ callMcpTool }, n: number) => {
  if (discovery === null) throw new Error('launch first')
  if (currentRequestId === null) throw new Error('open a request first')
  const disco = discovery
  const reqId = currentRequestId
  await expect(async () => {
    const reply = await callMcpTool(disco, 'get_response_history', { requestId: reqId })
    const payload = parsedReply(reply) as { entries?: { guid: string; success?: boolean }[] }
    expect((payload.entries ?? []).length).toBeGreaterThanOrEqual(n)
  }).toPass({ timeout: 20_000 })
})

Then('that history entry succeeded', async ({ callMcpTool }) => {
  if (discovery === null) throw new Error('launch first')
  if (currentRequestId === null) throw new Error('open a request first')
  const reply = await callMcpTool(discovery, 'get_response_history', { requestId: currentRequestId })
  const payload = parsedReply(reply) as { entries?: { guid: string; success?: boolean }[] }
  const freshest = (payload.entries ?? [])[0]
  expect(freshest, 'no history entry found').toBeTruthy()
  expect(freshest?.success, 'freshest history entry did not succeed').toBe(true)
})
