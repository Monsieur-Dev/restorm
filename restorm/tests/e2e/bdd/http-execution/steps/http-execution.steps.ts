/**
 * Steps for the `http-execution` BDD suite — the HTTP/REST counterpart of the
 * streaming-protocol suites. Drives restorm entirely through the MCP fixture
 * (`launchAppWithMcp` + `callMcpTool`): launch with `--mcp`, `open_project`,
 * poll `list_requests` until the sample's requests appear, then `open_tab` by
 * id and drive the REAL request panel (Send / Cancel buttons), asserting on the
 * response panel `data-testid`s.
 *
 * The HTTP sample targets the Docker Petstore (`:8080`, CRUD + multipart upload)
 * and the local `http-util` mock (`:8082`, the deterministic edge cases the
 * Petstore can't do — redirects, cookies, arbitrary statuses, echo, binary).
 *
 * Status / headers live on the response "Infos" sub-tab (a plain DOM ListView);
 * the body editor lives on the "Response" sub-tab (Monaco). Assertions switch to
 * whichever tab carries the data, mirroring the mcp-server suite's precedent.
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
let environmentId: string | null = null

const SEND_BTN = '[data-testid="http-request-send-button"]:visible'
const CANCEL_BTN = '[data-testid="http-request-cancel-button"]:visible'

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

/** Switch the response panel to the "Infos" sub-tab (status / headers DOM). */
async function openInfosTab(p: Page): Promise<void> {
  const responseTabs = p.locator('[data-testid="base-request-tabs-response"]').first()
  await responseTabs.waitFor({ state: 'visible', timeout: 20_000 })
  const infosTab = responseTabs.locator('[role="tab"]', { hasText: 'Infos' }).first()
  await infosTab.click({ timeout: 10_000 })
}

/** Switch the response panel to the "Response" sub-tab (body editor). */
async function openResponseTab(p: Page): Promise<void> {
  const responseTabs = p.locator('[data-testid="base-request-tabs-response"]').first()
  await responseTabs.waitFor({ state: 'visible', timeout: 20_000 })
  const respTab = responseTabs.locator('[role="tab"]', { hasText: 'Response' }).first()
  await respTab.click({ timeout: 10_000 })
}

Given(
  'I launch restorm with the MCP server enabled',
  async ({ launchAppWithMcp }) => {
    const launched = await launchAppWithMcp()
    discovery = launched.discovery
    page = launched.page
    requestsByName = new Map()
    currentRequestId = null
    environmentId = null
  }
)

Given(
  'I open the HTTP sample via MCP',
  async ({ callMcpTool, restormRoot }) => {
    if (discovery === null) throw new Error('launch first')
    const samplePath = join(restormRoot, 'tests/e2e/samples/http-sample.restorm')
    const opened = await callMcpTool(discovery, 'open_project', { filePath: samplePath })
    expect(opened.isError ?? false).toBe(false)

    const deadline = Date.now() + 20_000
    let reqs: { id: string; name: string }[] = []
    while (Date.now() < deadline) {
      const reply = await callMcpTool(discovery, 'list_requests', {})
      reqs = parsedReply(reply) as { id: string; name: string }[]
      if (reqs.some((r) => r.name === 'GET echo')) break
      await new Promise((r) => setTimeout(r, 250))
    }
    requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
    expect(requestsByName.get('GET echo'), 'sample requests not loaded').toBeTruthy()

    // Resolve the sample's environment id so steps that need a runtime
    // env value (e.g. the upload file path) can set it via MCP.
    const envReply = await callMcpTool(discovery, 'list_environments', {})
    const envs = parsedReply(envReply) as { id: string; name: string }[]
    environmentId = envs[0]?.id ?? null

    // The multipart upload field points at `{{uploadPath}}`; bind it to
    // the committed fixture's absolute path so the executor streams a
    // real file part.
    if (environmentId) {
      const uploadPath = join(restormRoot, 'tests/e2e/samples/fixtures/upload.txt')
      await callMcpTool(discovery, 'set_env_variable', {
        envId: environmentId,
        key: 'uploadPath',
        value: { type: 'string', value: uploadPath }
      })
    }
  }
)

When(
  'I open the {string} request tab via MCP',
  async ({ callMcpTool }, name: string) => {
    if (discovery === null || page === null) throw new Error('open the project first')
    const id = requestsByName.get(name)
    expect(id, `request "${name}" not found`).toBeTruthy()
    if (id === undefined) throw new Error(`request "${name}" missing`)
    currentRequestId = id
    const tab = await callMcpTool(discovery, 'open_tab', { itemId: id })
    expect(tab.isError ?? false).toBe(false)
    await page.locator(SEND_BTN).waitFor({ state: 'visible', timeout: 20_000 })
  }
)

When('I click Send', async () => {
  if (page === null) throw new Error('launch first')
  await page.locator(SEND_BTN).click()
})

When('I click Cancel', async () => {
  if (page === null) throw new Error('launch first')
  // The cancel button replaces the send button while a request is in flight.
  await page.locator(CANCEL_BTN).waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator(CANCEL_BTN).click()
})

Then('the response status is {string}', async ({}, status: string) => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  const statusEl = page.locator('[data-testid="http-response-status"]:visible').first()
  await expect(statusEl).toBeVisible({ timeout: 20_000 })
  await expect(statusEl).toHaveAttribute('data-status-code', status, { timeout: 10_000 })
})

Then('the response body contains {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  await openResponseTab(page)
  // The echo / status bodies are short enough to be fully rendered by
  // Monaco, so the editor root's innerText carries the whole body (the
  // ECUI codeEditor step uses the same approach). Poll to absorb Monaco's
  // async first paint.
  const editor = page.locator('[data-testid="http-response-body-editor"]:visible').first()
  await editor.waitFor({ state: 'visible', timeout: 20_000 })
  await expect(async () => {
    const text = await editor.innerText()
    // Monaco can insert non-breaking spaces / soft-wraps; normalise
    // whitespace before substring matching.
    const normalised = text.replace(/ /g, ' ').replace(/\s+/g, ' ')
    expect(normalised).toContain(needle.replace(/\s+/g, ' '))
  }).toPass({ timeout: 20_000 })
})

Then('the response shows a header {string} containing {string}', async ({}, key: string, value: string) => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  const row = page.locator(`[data-testid="http-response-headers-list"] [data-header-key="${key}"]:visible`).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row).toContainText(value, { timeout: 10_000 })
})

Then('the response shows an error', async () => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  // A transport failure / timeout / cancellation surfaces an Error row in
  // the General group of the Infos list, and the status renders as 0.
  const errorRow = page.locator('[data-testid="http-response-headers-list"] [data-item-id="general-error"]:visible').first()
  await expect(errorRow).toBeVisible({ timeout: 30_000 })
})

Then('the response error contains {string}', async ({}, needle: string) => {
  if (page === null) throw new Error('launch first')
  await openInfosTab(page)
  // The Error row in the General group renders `response.error` as its text,
  // so the explicit message (e.g. a too-many-redirects loop guard) is
  // assertable here.
  const errorRow = page.locator('[data-testid="http-response-headers-list"] [data-item-id="general-error"]:visible').first()
  await expect(errorRow).toBeVisible({ timeout: 30_000 })
  await expect(errorRow).toContainText(needle, { timeout: 10_000 })
})

Then('the response offers a binary download', async () => {
  if (page === null) throw new Error('launch first')
  await openResponseTab(page)
  const download = page.locator('[data-testid="http-response-download-button"]:visible').first()
  await expect(download).toBeVisible({ timeout: 20_000 })
})

Then('the response body matches a handlebars uuid for header {string}', async ({}, key: string) => {
  if (page === null) throw new Error('launch first')
  await openResponseTab(page)
  const editor = page.locator('[data-testid="http-response-body-editor"]:visible').first()
  await editor.waitFor({ state: 'visible', timeout: 20_000 })
  await expect(async () => {
    const text = await editor.innerText()
    // The echo reflects the resolved header. A literal "{{uuid}}" would
    // mean substitution never ran; assert the echoed header line carries
    // a real UUID AND no leftover template braces.
    const normalised = text.replace(/ /g, ' ')
    expect(normalised).toMatch(new RegExp(`"${key}"\\s*:\\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"`))
    expect(normalised).not.toContain('{{uuid}}')
  }).toPass({ timeout: 20_000 })
})

Then('the request has at least {int} history entry', async ({ callMcpTool }, n: number) => {
  if (discovery === null) throw new Error('launch first')
  if (currentRequestId === null) throw new Error('open a request first')
  const disco = discovery
  const reqId = currentRequestId
  await expect(async () => {
    const reply = await callMcpTool(disco, 'get_response_history', { requestId: reqId })
    const payload = parsedReply(reply) as { count?: number; entries?: { guid: string }[] }
    expect((payload.entries ?? []).length).toBeGreaterThanOrEqual(n)
  }).toPass({ timeout: 15_000 })
})
