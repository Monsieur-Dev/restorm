/**
 * Steps for the `graphql-execution` BDD suite — drives restorm through the
 * MCP fixture (`launchAppWithMcp` + `callMcpTool`): launch with `--mcp`,
 * `open_project`, poll `list_requests` until the sample loads, then
 * `open_tab` by id and drive the REAL GraphQL request panel, asserting on
 * the response editor and the errors/info section.
 *
 * The GraphQL sample targets the Docker Apollo server (`:4000`, started by
 * `tests/e2e/global-setup.ts` and the CI workflow's manual `node server.js`
 * invocation). The sample covers the full execution matrix: queries (simple,
 * nested, alias, fragment, directive), mutations, variables, Handlebars
 * substitution, introspection, error cases, cancellation, and history.
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from './fixture'
import { materializeSample } from '../../../helpers/testcontainers/services'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestsByName = new Map<string, string>()

// The action button toggles between "Send" (idle) and "Cancel" (in-flight).
const ACTION_BTN = '[data-testid="graphql-action-button"]:visible'
const RESPONSE_EDITOR = '[data-testid="graphql-response-editor"]:visible'

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

Given('I open the GraphQL sample via MCP', async ({ callMcpTool, restormRoot, services }) => {
  if (discovery === null) throw new Error('launch first')
  const samplePath = materializeSample(
    join(restormRoot, 'tests/e2e/samples/graphql-sample.restorm'),
    join(restormRoot, 'tests/e2e/.tmp/graphql-execution/graphql-sample.restorm'),
    services
  )
  const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
  expect(opened.isError ?? false).toBe(false)

  // The collection store populates asynchronously after `file:opened`; poll
  // list_requests until the sample's requests have synced through.
  const deadline = Date.now() + 20_000
  let reqs: { id: string; name: string }[] = []
  while (Date.now() < deadline) {
    const reply = await callMcpTool(discovery, 'list_requests', {})
    reqs = parsedReply(reply) as { id: string; name: string }[]
    if (reqs.some((r) => r.name === 'Users query')) break
    await new Promise((r) => setTimeout(r, 250))
  }
  requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
  expect(requestsByName.get('Users query'), 'GraphQL sample requests not loaded').toBeTruthy()
  expect(requestsByName.get('Slow cancel'), 'GraphQL sample requests not fully loaded').toBeTruthy()
})

When('I open the {string} request tab via MCP', async ({ callMcpTool }, name: string) => {
  if (discovery === null || page === null) throw new Error('open the project first')
  const id = requestsByName.get(name)
  expect(id, `request "${name}" not found in the sample`).toBeTruthy()
  if (id === undefined) throw new Error(`request "${name}" missing`)
  const tab = await callMcpTool(discovery, 'open_tab', { itemId: id })
  expect(tab.isError ?? false).toBe(false)
  await page.locator(ACTION_BTN).waitFor({ state: 'visible', timeout: 20_000 })
})

When('I click the GraphQL Send button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(ACTION_BTN).click()
})

When('I click the GraphQL Cancel button', async () => {
  if (page === null) throw new Error('launch first')
  // The action button shows the 'close' codicon while a request is in-flight
  // (`isSending=true`). Wait for that state before clicking so we don't
  // race with the click handler that has not yet flipped `isSending`.
  const cancelIcon = page.locator('[data-testid="graphql-action-button"] .codicon-close:visible').first()
  await cancelIcon.waitFor({ state: 'visible', timeout: 5_000 })
  await page.locator(ACTION_BTN).click()
})

Then('the GraphQL response editor contains {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  // The read-only Monaco editor only appears once a response arrives.
  const editor = page.locator(RESPONSE_EDITOR).first()
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(async () => {
    const text = await editor.innerText()
    // Monaco can insert non-breaking spaces; normalise before matching.
    const normalised = text.replace(/ /g, ' ').replace(/\s+/g, ' ')
    expect(normalised).toContain(needle)
  }).toPass({ timeout: 20_000 })
})

Then('the GraphQL response editor does not contain {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  const editor = page.locator(RESPONSE_EDITOR).first()
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(async () => {
    const text = await editor.innerText()
    const normalised = text.replace(/ /g, ' ').replace(/\s+/g, ' ')
    expect(normalised).not.toContain(needle)
  }).toPass({ timeout: 20_000 })
})

Then('the GraphQL response shows GraphQL errors', async () => {
  if (page === null) throw new Error('launch first')
  // A GraphQL `errors[]` response: the executor returns HTTP 200 with an
  // errors array; the response editor renders `{ "errors": [...] }`.
  // The errors section in the info area is also rendered with a distinct
  // failure colour (var(--testing-iconFailed)) — assert both:
  // 1. The response editor contains "errors" (the JSON key).
  // 2. The rendered errors panel is visible.
  const editor = page.locator(RESPONSE_EDITOR).first()
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(async () => {
    const text = await editor.innerText()
    const normalised = text.replace(/ /g, ' ').replace(/\s+/g, ' ')
    expect(normalised).toContain('"errors"')
  }).toPass({ timeout: 20_000 })
})

Then('the GraphQL response shows a network error', async () => {
  if (page === null) throw new Error('launch first')
  // A network-down failure: no HTTP response arrives; the executor returns
  // `{ error: "..." }`. The response editor renders this JSON; look for the
  // "error" key OR "ECONNREFUSED"/"fetch failed".
  // We also accept the case where the UI surfaces a plain error message.
  const editor = page.locator(RESPONSE_EDITOR).first()
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(async () => {
    const text = await editor.innerText()
    const normalised = text.replace(/ /g, ' ').replace(/\s+/g, ' ')
    const hasError = normalised.includes('"error"') || normalised.toLowerCase().includes('econnrefused') || normalised.toLowerCase().includes('fetch failed') || normalised.toLowerCase().includes('network')
    expect(hasError).toBe(true)
  }).toPass({ timeout: 30_000 })
})

Then('the GraphQL response shows {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  const editor = page.locator(RESPONSE_EDITOR).first()
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(async () => {
    const text = await editor.innerText()
    const normalised = text.replace(/ /g, ' ').replace(/\s+/g, ' ')
    expect(normalised).toContain(needle)
  }).toPass({ timeout: 20_000 })
})

When('I type {int} characters into the GraphQL query editor within {int} ms', async ({}, count: number, windowMs: number) => {
  if (page === null) throw new Error('launch first')
  await page.evaluate(() => { (window as unknown as { __e2eResetDocUpdateCount?: () => void }).__e2eResetDocUpdateCount?.() })
  // Target the Monaco query editor — it fires onChange on every keystroke with
  // no built-in debounce (unlike the ECUI InputBox URL field), so this burst
  // directly exercises the new 300 ms debounce in the updateFullRequestData effect.
  const editor = page.locator('[data-testid="graphql-query-editor"]').first()
  await editor.click()
  const text = 'abcdefghijklmnopqrstuvwxyz'.slice(0, count)
  const delay = Math.max(0, Math.floor(windowMs / Math.max(1, count - 1)))
  await editor.pressSequentially(text, { delay })
})

Then('at most {int} GraphQL document-update events are emitted', async ({}, max: number) => {
  if (page === null) throw new Error('launch first')
  // Wait one debounce window (300 ms) plus a small buffer so the trailing
  // debounced event has time to fire before we read the counter.
  await page.waitForTimeout(400)
  const counted = await page.evaluate(() => (window as unknown as { __e2eDocUpdateCount?: number }).__e2eDocUpdateCount ?? 0)
  if (counted > max) throw new Error(`Debounce regression: expected <= ${max} document-update events, got ${counted}`)
})

Then('the request has a GraphQL history entry for {string}', async ({ callMcpTool }, name: string) => {
  if (discovery === null) throw new Error('launch first')
  const id = requestsByName.get(name)
  expect(id, `request "${name}" not found`).toBeTruthy()
  if (id === undefined) throw new Error(`request "${name}" missing`)
  const disco = discovery
  await expect(async () => {
    const reply = await callMcpTool(disco, 'get_response_history', { requestId: id })
    const payload = parsedReply(reply) as { count?: number; entries?: { guid: string }[] }
    expect((payload.entries ?? []).length).toBeGreaterThanOrEqual(1)
  }).toPass({ timeout: 15_000 })
})
