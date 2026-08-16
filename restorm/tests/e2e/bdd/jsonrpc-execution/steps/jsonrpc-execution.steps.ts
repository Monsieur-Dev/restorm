/**
 * Steps for the `jsonrpc-execution` BDD suite (execution + OpenRPC import).
 * Drives restorm through the MCP fixture (`launchAppWithMcp` + `callMcpTool`):
 * launch with MCP on, `open_project` with the JSON-RPC sample (execution
 * scenarios) or `create_project` + `import_from_url` (the import scenario),
 * then `open_tab` by id and drive the REAL request panel, asserting on the
 * response panel `data-testid`s. Mirrors `soap-execution.steps.ts` for the
 * response-panel helpers and `graphql-execution.steps.ts` for the debounce
 * assertion (both share the same generic mechanisms: `BaseRequestTabView`'s
 * Tabs testids, and the `__e2eDocUpdateCount` window counter).
 *
 * The suite runs its OWN jsonrpc mock container (worker-scoped, ephemeral
 * port) — a deterministic zero-dependency node:http server dispatching on the
 * envelope's `method`. The committed sample speaks the canonical port; it is
 * materialized with the mapped one before opening.
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
let currentRequestId: string | null = null
let lastImportReply: McpToolReply | null = null

/** The action button toggles between send and cancel via isSending state. */
const ACTION_BTN = '[data-testid="jsonrpc-action-button"]:visible'
const BATCH_ACTION_BTN = '[data-testid="jsonrpc-batch-action-button"]:visible'

/**
 * The status / error blocks live in the response panel's "Infos" tab, which
 * is NOT the default-selected tab (the "Response" body editor is). The Tabs
 * primitive mounts only the active tab's content (active-only strategy), so
 * those testids are absent from the DOM until the Infos tab is selected.
 */
async function openInfosTab(p: Page): Promise<void> {
  const infosTab = p.locator('[data-testid="base-request-tabs-response-tab-infos"]:visible').first()
  await infosTab.waitFor({ state: 'visible', timeout: 30_000 })
  await infosTab.click()
  await p
    .locator('[data-testid="base-request-tabs-response-tabpanel-infos"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
}

/** Select the response panel's "Response" tab (the body editor / notification
 * label). A preceding infos assertion may have switched the active tab. */
async function openResponseTab(p: Page): Promise<void> {
  const responseTab = p.locator('[data-testid="base-request-tabs-response-tab-response"]:visible').first()
  await responseTab.waitFor({ state: 'visible', timeout: 30_000 })
  await responseTab.click()
  await p
    .locator('[data-testid="base-request-tabs-response-tabpanel-response"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
}

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

async function pollForRequestByName(
  callMcpTool: (discovery: McpDiscovery, name: string, args?: Record<string, unknown>) => Promise<McpToolReply>,
  disco: McpDiscovery,
  name: string,
  timeoutMs = 20_000
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  let id: string | undefined
  while (Date.now() < deadline) {
    const reply = await callMcpTool(disco, 'list_requests', {})
    const reqs = parsedReply(reply) as { id: string; name: string }[]
    const match = reqs.find((r) => r.name === name)
    if (match) { id = match.id; break }
    await new Promise((r) => setTimeout(r, 250))
  }
  return id
}

Given(
  'I launch restorm with the MCP server enabled',
  async ({ launchAppWithMcp }) => {
    const launched = await launchAppWithMcp()
    discovery = launched.discovery
    page = launched.page
    requestsByName = new Map()
    currentRequestId = null
    lastImportReply = null
  }
)

Given('I open the JSON-RPC sample via MCP', async ({ callMcpTool, restormRoot, services }) => {
  if (discovery === null) throw new Error('launch first')
  const samplePath = materializeSample(
    join(restormRoot, 'tests/e2e/samples/jsonrpc-sample.restorm'),
    join(restormRoot, 'tests/e2e/.tmp/jsonrpc-execution/jsonrpc-sample.restorm'),
    services
  )
  const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
  expect(opened.isError ?? false).toBe(false)

  const deadline = Date.now() + 20_000
  let reqs: { id: string; name: string }[] = []
  while (Date.now() < deadline) {
    const reply = await callMcpTool(discovery, 'list_requests', {})
    reqs = parsedReply(reply) as { id: string; name: string }[]
    if (reqs.some((r) => r.name === 'JSON-RPC Echo')) break
    await new Promise((r) => setTimeout(r, 250))
  }
  requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
  expect(requestsByName.get('JSON-RPC Echo'), 'JSON-RPC sample requests not loaded').toBeTruthy()
})

When('I import the JSON-RPC mock\'s OpenRPC document via MCP', async ({ callMcpTool, services }) => {
  if (discovery === null || page === null) throw new Error('launch first')
  const disco = discovery
  const pg = page

  // `create_project` opens the empty file ASYNCHRONOUSLY in the renderer; an
  // import that races the still-in-flight empty-project load can land in the
  // main store and then get wiped by the late load. Same stabilise-across-
  // several-reads dance as `graphql-operation-name.steps.ts`'s fresh-project
  // helper: re-import from scratch if a read comes back empty. Unlike that
  // sibling, this flow DOES re-call `create_project` on a retry — and
  // `create_project` writes with the `wx` flag (fails on an existing file,
  // by design, to never clobber a real project), so retrying against the
  // same path is guaranteed EEXIST. Mint a fresh path per attempt.
  let attempt = 0
  const freshProject = async (): Promise<void> => {
    attempt++
    const projectPath = `/tmp/jsonrpc-import-e2e-${String(Date.now())}-${String(attempt)}.restorm`
    expect((await callMcpTool(disco, 'create_project', { filePath: projectPath })).isError ?? false).toBe(false)
  }
  await freshProject()

  const deadline = Date.now() + 20_000
  let stable = false
  while (Date.now() < deadline && !stable) {
    lastImportReply = await callMcpTool(disco, 'import_from_url', { url: `${services.url('jsonrpc')}/openrpc.json` })
    if (lastImportReply.isError ?? false) { await pg.waitForTimeout(500); continue }

    let consecutive = 0
    while (Date.now() < deadline && consecutive < 4) {
      const reqs = parsedReply(await callMcpTool(disco, 'list_requests', {})) as { id: string; name: string }[]
      if (reqs.some((r) => r.name === 'echo')) {
        consecutive++
      } else {
        consecutive = 0
        break // wiped — recreate the project and re-import from the top
      }
      await pg.waitForTimeout(250)
    }
    stable = consecutive >= 4
    if (!stable) await freshProject()
  }
  expect(stable, 'import never stabilised after create_project').toBe(true)
})

Then('the MCP reply reports a successful import', () => {
  expect(lastImportReply, 'no import was attempted').not.toBeNull()
  // `?? false`, not `?? true`: an absent `isError` field means the MCP call
  // returned cleanly (same convention as every other reply check in this
  // file, e.g. the `create_project`/`import_from_url` guards above) — the
  // inverted default here is what made this assertion fail even on a
  // genuinely successful, non-raced import.
  expect(lastImportReply?.isError ?? false).toBe(false)
})

When('I open the {string} request tab via MCP', async ({ callMcpTool }, name: string) => {
  if (discovery === null || page === null) throw new Error('open the project first')
  let id = requestsByName.get(name)
  if (id === undefined) {
    // Not pre-populated by an "open sample" step (the import suite has none)
    // — poll for it fresh, same wait-for-sync semantics.
    id = await pollForRequestByName(callMcpTool, discovery, name)
    if (id !== undefined) requestsByName.set(name, id)
  }
  expect(id, `request "${name}" not found`).toBeTruthy()
  if (id === undefined) throw new Error(`request "${name}" missing`)
  currentRequestId = id
  const tab = await callMcpTool(discovery, 'open_tab', { itemId: id })
  if (tab.isError ?? false) {
    // Under full-suite conditions open_tab has replied "No item with id …"
    // for an id that pollForRequestByName JUST resolved — capture both sides
    // of that contradiction (the reply and a fresh listing) when it recurs.
    const listing = await callMcpTool(discovery, 'list_requests', {})
    throw new Error(
      `open_tab(${id}) errored: ${JSON.stringify(tab.content)}; ` +
      `list_requests immediately after: ${JSON.stringify(listing.content).slice(0, 800)}`
    )
  }
  // Wait for either the single-call or the batch action button to appear.
  await page.locator(`${ACTION_BTN}, ${BATCH_ACTION_BTN}`).first().waitFor({ state: 'visible', timeout: 20_000 })
})

When('I click the JSON-RPC Send button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(ACTION_BTN).waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator(ACTION_BTN).click()
})

When('I click the JSON-RPC Cancel button', async () => {
  if (page === null) throw new Error('launch first')
  // While a request is in flight the button toggles to close/cancel.
  await page.locator(ACTION_BTN).waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator(ACTION_BTN).click()
})

When('I click the JSON-RPC Batch Send button', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(BATCH_ACTION_BTN).waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator(BATCH_ACTION_BTN).click()
})

Then('the JSON-RPC response status is {int}', async ({}, status: number) => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  const statusEl = page.locator('[data-testid="jsonrpc-response-status"]:visible').first()
  await expect(statusEl).toBeVisible({ timeout: 30_000 })
  await expect(statusEl).toHaveAttribute('data-status-code', String(status), { timeout: 10_000 })
})

Then('the JSON-RPC batch response status is {int}', async ({}, status: number) => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  const statusEl = page.locator('[data-testid="jsonrpc-batch-response-status"]:visible').first()
  await expect(statusEl).toBeVisible({ timeout: 30_000 })
  await expect(statusEl).toHaveAttribute('data-status-code', String(status), { timeout: 10_000 })
})

Then('the JSON-RPC response body contains {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  await openResponseTab(page)
  const editor = page.locator('[data-testid="jsonrpc-response-editor"]:visible').first()
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(async () => {
    const text = await editor.innerText()
    expect(text.replace(/ /g, ' ').replace(/\s+/g, ' ')).toContain(needle)
  }).toPass({ timeout: 20_000 })
})

Then('the JSON-RPC response body does not contain {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  await openResponseTab(page)
  const editor = page.locator('[data-testid="jsonrpc-response-editor"]:visible').first()
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  const text = await editor.innerText()
  expect(text).not.toContain(needle)
})

Then('the JSON-RPC response panel shows an error', async () => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  const errorBlock = page.locator('[data-testid="jsonrpc-response-error"]:visible').first()
  await expect(errorBlock).toBeVisible({ timeout: 30_000 })
})

Then('the JSON-RPC error message contains {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  const errorBlock = page.locator('[data-testid="jsonrpc-response-error"]:visible').first()
  await expect(errorBlock).toBeVisible({ timeout: 20_000 })
  await expect(errorBlock).toContainText(needle, { timeout: 10_000 })
})

Then('the JSON-RPC response panel shows {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  await openResponseTab(page)
  const notification = page.locator('[data-testid="jsonrpc-response-notification"]:visible').first()
  await expect(notification).toBeVisible({ timeout: 30_000 })
  await expect(notification).toContainText(needle, { timeout: 10_000 })
})

Then('the JSON-RPC Send button is visible again', async () => {
  if (page === null) throw new Error('launch first')
  const p = page
  await expect(async () => {
    await expect(p.locator(ACTION_BTN).first()).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 20_000 })
})

When('I type {int} characters into the JSON-RPC params editor within {int} ms', async ({}, count: number, windowMs: number) => {
  if (page === null) throw new Error('launch first')
  await page.evaluate(() => { (window as unknown as { __e2eResetDocUpdateCount?: () => void }).__e2eResetDocUpdateCount?.() })
  // The Monaco params editor fires onChange on every keystroke with no
  // built-in debounce (unlike the ECUI InputBox URL field), so this burst
  // directly exercises the 250 ms debounce in the updateFullRequestData effect.
  const editor = page.locator('[data-testid="jsonrpc-params-editor"]').first()
  await editor.click()
  const text = 'abcdefghijklmnopqrstuvwxyz'.slice(0, count)
  const delay = Math.max(0, Math.floor(windowMs / Math.max(1, count - 1)))
  await editor.pressSequentially(text, { delay })
})

Then('at most {int} JSON-RPC document-update events are emitted', async ({}, max: number) => {
  if (page === null) throw new Error('launch first')
  // Wait one debounce window (250 ms) plus a small buffer so the trailing
  // debounced event has time to fire before we read the counter.
  await page.waitForTimeout(400)
  const counted = await page.evaluate(() => (window as unknown as { __e2eDocUpdateCount?: number }).__e2eDocUpdateCount ?? 0)
  if (counted > max) throw new Error(`Debounce regression: expected <= ${max} document-update events, got ${counted}`)
})

Then('the JSON-RPC request has at least {int} history entries', async ({ callMcpTool }, n: number) => {
  if (discovery === null) throw new Error('launch first')
  if (currentRequestId === null) throw new Error('open a request first')
  const disco = discovery
  const reqId = currentRequestId
  await expect(async () => {
    const reply = await callMcpTool(disco, 'get_response_history', { requestId: reqId })
    const payload = parsedReply(reply) as { count?: number; entries?: { guid: string }[] }
    expect((payload.entries ?? []).length).toBeGreaterThanOrEqual(n)
  }).toPass({ timeout: 20_000 })
})

Then('the JSON-RPC batch response has {int} child result blocks', async ({}, n: number) => {
  if (page === null) throw new Error('launch first')
  await openResponseTab(page)
  const children = page.locator('[data-testid^="response-batch-child-"]:visible')
  await expect(async () => {
    expect(await children.count()).toBe(n)
  }).toPass({ timeout: 20_000 })
})

Then('JSON-RPC batch child {int} shows an error', async ({}, index: number) => {
  if (page === null) throw new Error('launch first')
  await openResponseTab(page)
  const child = page.locator(`[data-testid="response-batch-child-${index}"]:visible`).first()
  await expect(child).toBeVisible({ timeout: 20_000 })
  await expect(child).toContainText('failMethod always fails', { timeout: 10_000 })
})
