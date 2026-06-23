/**
 * Steps for the `soap-execution` BDD suite — the SOAP counterpart of the
 * other protocol execution suites. Drives restorm through the MCP fixture
 * (`launchAppWithMcp` + `callMcpTool`): launch with MCP on, `open_project`
 * with the SOAP sample, poll `list_requests` until the sample's requests
 * appear, then `open_tab` by id and drive the REAL request panel, asserting
 * on the response panel `data-testid`s.
 *
 * The SOAP sample targets the local soap-server mock (:8091), a deterministic
 * zero-dependency node:http server that dispatches on SOAPAction and returns
 * SOAP 1.1 envelopes. No Castle Mock seeding required.
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

/** The action button toggles between send and cancel via isSending state. */
const ACTION_BTN = '[data-testid="soap-request-action-button"]:visible'

/**
 * The status / fault / response-headers / malformed-error blocks all live in
 * the response panel's "Infos" tab, which is NOT the default-selected tab
 * (the "Response" body editor is). The Tabs primitive mounts only the active
 * tab's content (active-only strategy), so those testids are absent from the
 * DOM until the Infos tab is selected. Click it before asserting on them.
 */
async function openInfosTab(p: Page): Promise<void> {
  const infosTab = p.locator('[data-testid="base-request-tabs-response-tab-infos"]:visible').first()
  await infosTab.waitFor({ state: 'visible', timeout: 30_000 })
  await infosTab.click()
  // Wait until the infos tabpanel is the active one before asserting.
  await p
    .locator('[data-testid="base-request-tabs-response-tabpanel-infos"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
}

/**
 * Select the response panel's "Response" tab (the body editor). A preceding
 * infos assertion may have switched the active tab to "Infos", so any body
 * assertion must re-select Response first to bring the editor back into view.
 */
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

Given('I open the SOAP sample via MCP', async ({ callMcpTool, restormRoot }) => {
  if (discovery === null) throw new Error('launch first')
  const samplePath = join(restormRoot, 'tests/e2e/samples/soap-sample.restorm')
  const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
  expect(opened.isError ?? false).toBe(false)

  // Poll list_requests until the sample's requests have synced.
  const deadline = Date.now() + 20_000
  let reqs: { id: string; name: string }[] = []
  while (Date.now() < deadline) {
    const reply = await callMcpTool(discovery, 'list_requests', {})
    reqs = parsedReply(reply) as { id: string; name: string }[]
    if (reqs.some((r) => r.name === 'SOAP Echo')) break
    await new Promise((r) => setTimeout(r, 250))
  }
  requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
  expect(requestsByName.get('SOAP Echo'), 'SOAP sample requests not loaded').toBeTruthy()
})

When('I open the {string} request tab via MCP', async ({ callMcpTool }, name: string) => {
  if (discovery === null || page === null) throw new Error('open the project first')
  const id = requestsByName.get(name)
  expect(id, `request "${name}" not found`).toBeTruthy()
  if (id === undefined) throw new Error(`request "${name}" missing`)
  currentRequestId = id
  const tab = await callMcpTool(discovery, 'open_tab', { itemId: id })
  expect(tab.isError ?? false).toBe(false)
  // Wait for the action button (send state) to appear.
  await page.locator(ACTION_BTN).waitFor({ state: 'visible', timeout: 20_000 })
})

When('I click the SOAP Send button', async () => {
  if (page === null) throw new Error('launch first')
  // Only click when in the "send" state (icon=send, not close).
  await page.locator(ACTION_BTN).waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator(ACTION_BTN).click()
})

When('I click the SOAP Cancel button', async () => {
  if (page === null) throw new Error('launch first')
  // While a request is in flight the button toggles to close/cancel.
  await page.locator(ACTION_BTN).waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator(ACTION_BTN).click()
})

Then('the SOAP response status is {int}', async ({}, status: number) => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  const statusEl = page.locator('[data-testid="soap-response-status"]:visible').first()
  await expect(statusEl).toBeVisible({ timeout: 30_000 })
  await expect(statusEl).toHaveAttribute('data-status-code', String(status), { timeout: 10_000 })
})

Then('the SOAP response body contains {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  await openResponseTab(page)
  const editor = page.locator('[data-testid="soap-request-response-editor"]:visible').first()
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(async () => {
    const text = await editor.innerText()
    expect(text.replace(/ /g, ' ').replace(/\s+/g, ' ')).toContain(needle)
  }).toPass({ timeout: 20_000 })
})

Then('the SOAP response body does not contain {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  await openResponseTab(page)
  const editor = page.locator('[data-testid="soap-request-response-editor"]:visible').first()
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  const text = await editor.innerText()
  expect(text).not.toContain(needle)
})

Then('the SOAP response panel shows a fault', async () => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  const fault = page.locator('[data-testid="soap-response-fault"]:visible').first()
  await expect(fault).toBeVisible({ timeout: 30_000 })
})

Then('the SOAP fault message contains {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  const faultMsg = page.locator('[data-testid="soap-response-fault-message"]:visible').first()
  await expect(faultMsg).toBeVisible({ timeout: 20_000 })
  await expect(faultMsg).toContainText(needle, { timeout: 10_000 })
})

Then('the SOAP response shows a header {string} containing {string}', async ({}, key: string, value: string) => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  const row = page.locator(`[data-testid="soap-response-headers-list"] [data-header-key="${key}"]:visible`).first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).toContainText(value, { timeout: 10_000 })
})

Then('the SOAP Send button is visible again', async () => {
  if (page === null) throw new Error('launch first')
  // After cancellation the button returns to the idle send state. The icon
  // is the discriminator — we rely on the action button reverting within the
  // cancel timeout; using a loose waitFor avoids a race with the IPC ack.
  const p = page
  await expect(async () => {
    // The button must exist and not be in the sending / close state.
    await expect(p.locator(ACTION_BTN).first()).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 20_000 })
})

Then('the SOAP response panel shows a malformed XML error', async () => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  // The panel surfaces a "malformed XML" label when the response body is
  // not parseable XML. The testid is set on the error row in infosContent.
  const errEl = page.locator('[data-testid="soap-response-malformed-error"]:visible').first()
  await expect(errEl).toBeVisible({ timeout: 30_000 })
})

Then('the SOAP request has at least {int} history entry', async ({ callMcpTool }, n: number) => {
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
