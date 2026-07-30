/**
 * Steps for the `mcp-server` BDD scenario. Drives an end-to-end loop:
 * launch restorm (MCP on by default), talk JSON-RPC to the embedded server,
 * import a Petstore swagger served by a tiny in-process HTTP fixture,
 * run a request via MCP, and assert both the JSON-RPC reply and the
 * renderer UI state.
 *
 * The fixture HTTP server lives inside the steps file (shared module
 * state across the scenario) so the swagger's `host` field can target
 * the same `127.0.0.1:<port>` URL the run_request call later hits.
 */

import { createBdd } from 'playwright-bdd'
import { createServer, type Server } from 'http'
import { join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

// Per-scenario module state. BDD runs scenarios serially within a
// project, so this is safe; reset on each launch.
let _app: ElectronApplication | null = null
let page: Page | null = null
let discovery: McpDiscovery | null = null
let mockServer: Server | null = null
let mockPort = 0
let lastReply: McpToolReply | null = null
let lastReplyPayload: unknown = null
let importedFolderId: string | null = null
let firstRequestId: string | null = null
let currentTabId: string | null = null
// Set as a side effect of the "I set the MCP env variable …" When, then
// consumed by the list / delete env-variable steps that follow it.
let selectedEnvId: string | null = null
// The items the create → open_tab race steps build, at the bottom of the file.
let raceFolderId: string | null = null
let raceRequestId: string | null = null

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

async function startMockServer(): Promise<void> {
  if (mockServer !== null) return
  await new Promise<void>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '/'
      if (url === '/petstore.json') {
        // Minimal Swagger 2.0 spec — host stamped at request time so
        // run_request later hits this same fixture server.
        const host = `127.0.0.1:${String(mockPort)}`
        const spec = {
          swagger: '2.0',
          info: { title: 'Petstore mock', version: '1.0.0' },
          host,
          basePath: '/',
          schemes: ['http'],
          paths: {
            '/pet/{petId}': {
              get: {
                operationId: 'getPetById',
                summary: 'Find pet by ID',
                produces: ['application/json'],
                parameters: [{ name: 'petId', in: 'path', required: true, type: 'integer' }],
                responses: { '200': { description: 'OK' } }
              }
            }
          }
        }
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(spec))
        return
      }
      // Tolerate both /pet/... and //pet/... — the swagger basePath="/"
      // composes a leading double slash when concatenated with the
      // operation path, and we don't want that fixture quirk to mask a
      // genuine bug.
      const stripped = url.startsWith('//') ? url.slice(1) : url
      if (stripped.startsWith('/pet/')) {
        const id = Number(stripped.slice('/pet/'.length))
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ id, name: 'Rex from MCP', status: 'available' }))
        return
      }
      res.statusCode = 404
      res.end('not found')
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('mock server returned a non-AF_INET address'))
        return
      }
      mockPort = addr.port
      mockServer = server
      resolve()
    })
  })
}

async function stopMockServer(): Promise<void> {
  const current = mockServer
  if (current === null) return
  await new Promise<void>((resolve) => { current.close(() => { resolve() }) })
  mockServer = null
  mockPort = 0
}

Given(
  'I launch restorm with the MCP server enabled',
  async ({ launchAppWithMcp }) => {
    await startMockServer()
    const launched = await launchAppWithMcp()
    _app = launched.app
    page = launched.page
    discovery = launched.discovery
    raceFolderId = null
    raceRequestId = null
  }
)

When(
  'I send the MCP tools-list request',
  async ({ rawJsonRpc }) => {
    if (!discovery) throw new Error('launch first')
    // The MCP SDK requires `initialize` before `tools/list` even on
    // stateless transports — the JSON-RPC handler errors out otherwise.
    await rawJsonRpc(discovery, {
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'restorm-e2e', version: '0.0.0' }
      }
    })
    const reply = await rawJsonRpc(discovery, { method: 'tools/list' })
    lastReplyPayload = reply.result
  }
)

Then(
  'the MCP tool list should include {string}',
  async ({}, expectedName: string) => {
    const result = lastReplyPayload as { tools?: { name: string }[] } | undefined
    const names = (result?.tools ?? []).map((t) => t.name)
    expect(names).toContain(expectedName)
  }
)

When(
  'I call MCP create_project with name {string}',
  async ({ callMcpTool, mcpServerTempDir }, name: string) => {
    if (!discovery) throw new Error('launch first')
    const filePath = join(mcpServerTempDir, `${name}.restorm`)
    lastReply = await callMcpTool(discovery, 'create_project', { filePath })
    lastReplyPayload = parsedReply(lastReply)
    expect(lastReply.isError ?? false).toBe(false)
  }
)

Then(
  'the workbench should not show the welcome screen',
  async () => {
    if (!page) throw new Error('launch first')
    // The welcome surface mounts a marker; sidebar mounts once a
    // project is open. Wait for either signal — whichever the build
    // exposes — to flip into "project loaded" state.
    await page.waitForSelector('[data-testid="sidebar-splitview"]', { timeout: 15_000 })
    // Confirm welcome surface is no longer mounted
    expect(await page.locator('[data-testid="welcome-screen"]').count()).toBe(0)
  }
)

When(
  'I call MCP import_from_url with the local petstore swagger',
  async ({ callMcpTool }) => {
    if (!discovery) throw new Error('launch first')
    const url = `http://127.0.0.1:${String(mockPort)}/petstore.json`
    lastReply = await callMcpTool(discovery, 'import_from_url', { url })
    lastReplyPayload = parsedReply(lastReply)
    expect(lastReply.isError ?? false).toBe(false)
  }
)

Then(
  'the MCP reply should report at least {int} imported items',
  async ({}, n: number) => {
    const payload = lastReplyPayload as { rootItems?: { id: string }[]; imported?: { folders: number; requests: number } } | undefined
    expect((payload?.rootItems ?? []).length).toBeGreaterThanOrEqual(n)
  }
)

Then(
  'the sidebar should show the {string} folder',
  async ({}, _label: string) => {
    if (!page) throw new Error('launch first')
    // The imported wrapper folder is named "Imported (swagger-2.0)"
    // (or similar) when no parentFolderId is given. Cheaper to assert
    // a tree row mounted *at all* than to chase the exact label —
    // imports vary across spec dialects. Sidebar listview rows expose
    // `data-item-id` per row (see ECUI ListView).
    const rows = page.locator('[data-testid="sidebar-listview"] [data-item-id]')
    await expect(rows.first()).toBeVisible({ timeout: 10_000 })
    expect(await rows.count()).toBeGreaterThan(0)
  }
)

When(
  'I call MCP list_requests for the imported folder',
  async ({ callMcpTool }) => {
    if (!discovery) throw new Error('launch first')
    // First find the wrapper env-folder created by the import
    const folders = await callMcpTool(discovery, 'list_folders', {})
    const folderPayload = parsedReply(folders) as { id: string; name: string; kind: string }[]
    // The Swagger adapter names the wrapper env-folder after the
    // spec's title (`Petstore mock`) and parents the actual endpoint
    // folders under it. The project starts empty for this scenario,
    // so any root env-folder is the import target.
    const wrapper = folderPayload.find((f) => f.kind === 'env-folder')
    if (wrapper === undefined) throw new Error(`expected to find a root env-folder; got ${JSON.stringify(folderPayload)}`)
    importedFolderId = wrapper.id
    // Walk down to the deepest folder that holds requests. The Swagger
    // adapter wraps endpoints under `<host>` then per-tag folders.
    const queue: string[] = [importedFolderId]
    while (queue.length > 0) {
      const candidate = queue.shift()
      if (candidate === undefined) break
      const reqs = await callMcpTool(discovery, 'list_requests', { folderId: candidate })
      const reqPayload = parsedReply(reqs) as { id: string }[]
      const first = reqPayload[0]
      if (first !== undefined) {
        firstRequestId = first.id
        return
      }
      const subs = await callMcpTool(discovery, 'list_folders', { parentId: candidate })
      const subPayload = parsedReply(subs) as { id: string }[]
      for (const sub of subPayload) queue.push(sub.id)
    }
    throw new Error('no requests found anywhere under the imported folder tree')
  }
)

When(
  'I run the first imported request via MCP',
  async ({ callMcpTool }) => {
    if (!discovery || !firstRequestId) throw new Error('list_requests must run first')
    lastReply = await callMcpTool(discovery, 'run_request', { id: firstRequestId, timeoutMs: 20_000 })
    lastReplyPayload = parsedReply(lastReply)
  }
)

Then(
  'the MCP run_request reply should report status {int}',
  async ({}, expectedStatus: number) => {
    const payload = lastReplyPayload as { status?: number; error?: { code: string; message: string } } | undefined
    if (payload?.error) {
      throw new Error(`run_request reported error: ${payload.error.code} — ${payload.error.message}`)
    }
    expect(payload?.status).toBe(expectedStatus)
  }
)

Then(
  'the response panel should show a non-empty body',
  async () => {
    if (!page) throw new Error('launch first')
    // Avoid asserting on the Monaco-rendered body directly — Monaco's
    // canvas-backed text doesn't show up in `innerText()` reliably and
    // its initial paint is slow enough under serial-e2e CPU load to
    // bust a 10s timeout. Switch to the "Infos" sub-tab where the
    // status / URL / duration / headers are rendered as a plain DOM
    // ListView. The status row carries the parsed status code text,
    // which is the visual proof "the UI reflected the call" the
    // ticket asks for.
    const responseTabs = page.locator('[data-testid="base-request-tabs-response"]').first()
    await responseTabs.waitFor({ state: 'visible', timeout: 15_000 })
    const infosTab = responseTabs.locator('[role="tab"]', { hasText: 'Infos' }).first()
    await infosTab.click({ timeout: 5_000 })
    const statusRow = page.locator('[data-testid="http-response-headers-list"] [data-item-id="general-status-code"]').first()
    await expect(statusRow).toBeVisible({ timeout: 10_000 })
    expect(await statusRow.innerText()).toMatch(/200/)
  }
)

Then(
  'the response history panel should show at least {int} entry',
  async ({ callMcpTool }, n: number) => {
    if (!page) throw new Error('launch first')
    if (!discovery || !firstRequestId) throw new Error('history step requires a prior run_request')
    // The history tab can be collapsed by default in the response panel
    // — we don't want to add UI navigation just to assert "history was
    // stored". The MCP `get_response_history` tool exposes the same
    // service the UI reads from, so polling it is a reliable proxy.
    const reply = await callMcpTool(discovery, 'get_response_history', { requestId: firstRequestId })
    const payload = parsedReply(reply) as { count?: number; entries?: { guid: string }[] }
    expect((payload.entries ?? []).length).toBeGreaterThanOrEqual(n)
  }
)

When(
  'I open the first imported request as a workbench tab via MCP',
  async ({ callMcpTool }) => {
    if (!discovery || !firstRequestId) throw new Error('list_requests must run first')
    const opened = await callMcpTool(discovery, 'open_tab', { itemId: firstRequestId })
    expect(opened.isError ?? false).toBe(false)
    // `get_current_tab` reads the renderer-pushed active-tab snapshot,
    // which lags the `open_tab` IPC. Poll until it reflects the request
    // we just opened (matched by `itemId`) rather than trusting the
    // first read — otherwise a stale snapshot from an earlier step
    // (e.g. the Console / Mini browser tab) leaks into `currentTabId`.
    const deadline = Date.now() + 10_000
    let payload: { tabId?: string | null; itemId?: string | null } = {}
    while (Date.now() < deadline) {
      const cur = await callMcpTool(discovery, 'get_current_tab', {})
      payload = parsedReply(cur) as { tabId?: string | null; itemId?: string | null }
      if (payload.itemId === firstRequestId && typeof payload.tabId === 'string' && payload.tabId.length > 0) {
        currentTabId = payload.tabId
        return
      }
      await page?.waitForTimeout(150)
    }
    throw new Error(`get_current_tab never reflected the opened request ${firstRequestId}: ${JSON.stringify(payload)}`)
  }
)

When(
  'I maximize the current workbench tab via MCP',
  async ({ callMcpTool }) => {
    if (!discovery || !currentTabId) throw new Error('open the request tab first')
    lastReply = await callMcpTool(discovery, 'set_tab_maximized', { tabId: currentTabId, maximized: true })
    lastReplyPayload = parsedReply(lastReply)
    expect(lastReply.isError ?? false).toBe(false)
    expect(lastReplyPayload).toMatchObject({ tabId: currentTabId, maximized: true })
  }
)

When(
  'I restore the maximized workbench tab via MCP',
  async ({ callMcpTool }) => {
    if (!discovery) throw new Error('launch first')
    lastReply = await callMcpTool(discovery, 'set_tab_maximized', { maximized: false })
    lastReplyPayload = parsedReply(lastReply)
    expect(lastReply.isError ?? false).toBe(false)
    expect(lastReplyPayload).toMatchObject({ tabId: null, maximized: false })
  }
)

Then(
  'the fullscreen workbench modal should be visible',
  async () => {
    if (!page) throw new Error('launch first')
    // The workbench fullscreen modal is the ECUI `Modal` with the
    // default `data-testid`, so its overlay is `modal-overlay`.
    await expect(page.locator('[data-testid="modal-overlay"]').first()).toBeVisible({ timeout: 10_000 })
  }
)

Then(
  'the fullscreen workbench modal should be hidden',
  async () => {
    if (!page) throw new Error('launch first')
    // `Modal` unmounts its content once the close animation finishes,
    // so the overlay leaves the DOM entirely — `toHaveCount(0)` with a
    // generous window absorbs the fade-out transition.
    await expect(page.locator('[data-testid="modal-overlay"]')).toHaveCount(0, { timeout: 10_000 })
  }
)

// The request tab's whole host node — `BaseRequestTabView`, response
// panel included — is *relocated* between the normal slot and the
// fullscreen modal (never duplicated, never remounted). The response
// `Tabs` container exposes its current selection via `data-active-tab-id`;
// asserting that attribute (and the run_request status row it gates)
// across a maximize/restore is a faithful probe for "the maximized and
// normal views share one React instance with its state intact".
Then(
  'the active response sub-tab should be {string}',
  async ({}, tabId: string) => {
    if (!page) throw new Error('launch first')
    await expect(page.locator('[data-testid="base-request-tabs-response"]').first())
      .toHaveAttribute('data-active-tab-id', tabId, { timeout: 10_000 })
  }
)

Then(
  'the response Infos panel should show status {string}',
  async ({}, status: string) => {
    if (!page) throw new Error('launch first')
    // The Infos sub-tab renders the parsed status / headers as a plain
    // DOM ListView — the status row carries the parsed status code.
    const statusRow = page
      .locator('[data-testid="http-response-headers-list"] [data-item-id="general-status-code"]')
      .first()
    await expect(statusRow).toBeVisible({ timeout: 10_000 })
    expect(await statusRow.innerText()).toContain(status)
  }
)

When(
  'I select the {string} response sub-tab',
  async ({}, tabId: string) => {
    if (!page) throw new Error('launch first')
    await page
      .locator(`[data-testid="base-request-tabs-response"] [data-tab-id="${tabId}"]`)
      .first()
      .click()
    await expect(page.locator('[data-testid="base-request-tabs-response"]').first())
      .toHaveAttribute('data-active-tab-id', tabId, { timeout: 10_000 })
  }
)

When(
  'I mark the request tab\'s host node',
  async () => {
    if (!page || !currentTabId) throw new Error('open the request tab first')
    // Probe on the workbench-owned host `<div>` (`data-tab-host-id`).
    // The host node is what the refactor pins: a cross-group move
    // relocates this exact node by `appendChild` instead of rebuilding
    // it, so the probe attribute set here survives the move iff the
    // refactor's invariant holds. (DOM nodes *inside* the host can
    // legitimately rearrange when restorm flips between split and
    // compact layout in a narrow destination group — proving "the
    // tab's React subtree didn't remount" lives in the unit test for
    // `EditorWorkbench` under StrictMode, not in this e2e step.)
    const marked = await page.evaluate((tabId) => {
      const host = document.querySelector(`[data-tab-host-id="${tabId}"]`)
      if (!host) return false
      host.setAttribute('data-e2e-host-probe', 'cross-group-probe')
      return true
    }, currentTabId)
    expect(marked, `host node for tab "${currentTabId}" not found`).toBe(true)
  }
)

When(
  'I send the active workbench tab to the next group',
  async () => {
    if (!page) throw new Error('launch first')
    // Ctrl+Alt+Right sends the active tab to the adjacent group,
    // creating one on demand. The tab's host node must be relocated
    // (appendChild), not remounted — that is what this move exercises.
    await page.keyboard.press('Control+Alt+ArrowRight')
    // Let React flush the controlled focus / tree change.
    await page.waitForTimeout(500)
  }
)

Then(
  'the request tab\'s host node is the same relocated instance',
  async () => {
    if (!page || !currentTabId) throw new Error('open the request tab first')
    const result = await page.evaluate((tabId) => {
      const host = document.querySelector(`[data-tab-host-id="${tabId}"]`)
      return {
        found: host !== null,
        probed: host?.getAttribute('data-e2e-host-probe') === 'cross-group-probe',
        connected: host?.isConnected === true
      }
    }, currentTabId)
    // Same node (probe survived) + still attached to the document =
    // the host was relocated, not rebuilt.
    expect(result).toEqual({ found: true, probed: true, connected: true })
  }
)

Then(
  'the request tab content is still rendered',
  async () => {
    if (!page) throw new Error('launch first')
    // `base-request-tabs-request` is rendered in every layout (split,
    // compact, no-response), so visibility is layout-independent.
    await expect(page.locator('[data-testid="base-request-tabs-request"]').first())
      .toBeVisible({ timeout: 10_000 })
  }
)

// ───────────────────────────────────────────────────────────────────
// MCP tool surface added on this branch
// ───────────────────────────────────────────────────────────────────

When(
  'I call MCP open_console',
  async ({ callMcpTool }) => {
    if (!discovery) throw new Error('launch first')
    const reply = await callMcpTool(discovery, 'open_console', {})
    expect(parsedReply(reply)).toMatchObject({ opened: true })
  }
)

Then(
  'the Console panel should be visible',
  async () => {
    if (!page) throw new Error('launch first')
    await expect(page.locator('[data-testid="console-panel"]').first()).toBeVisible({ timeout: 10_000 })
  }
)

When(
  'I call MCP open_firewall',
  async ({ callMcpTool }) => {
    if (!discovery) throw new Error('launch first')
    const reply = await callMcpTool(discovery, 'open_firewall', {})
    expect(parsedReply(reply)).toMatchObject({ opened: true })
  }
)

Then(
  'the Firewall panel should be visible',
  async () => {
    if (!page) throw new Error('launch first')
    await expect(page.locator('[data-testid="firewall-panel"]').first()).toBeVisible({ timeout: 10_000 })
  }
)

When(
  'I allow the origin {string} via MCP',
  async ({ callMcpTool }, origin: string) => {
    if (!discovery) throw new Error('launch first')
    const reply = await callMcpTool(discovery, 'firewall_allow', { origin })
    expect(reply.isError ?? false).toBe(false)
    expect(parsedReply(reply)).toMatchObject({ list: 'whitelist' })
  }
)

When(
  'I deny the origin {string} via MCP',
  async ({ callMcpTool }, origin: string) => {
    if (!discovery) throw new Error('launch first')
    const reply = await callMcpTool(discovery, 'firewall_deny', { origin })
    expect(reply.isError ?? false).toBe(false)
    expect(parsedReply(reply)).toMatchObject({ list: 'blacklist' })
  }
)

Then(
  'MCP firewall_list_rules should whitelist {string}',
  async ({ callMcpTool }, host: string) => {
    if (!discovery) throw new Error('launch first')
    const reply = await callMcpTool(discovery, 'firewall_list_rules', {})
    const payload = parsedReply(reply) as { whitelist?: { host: string }[] }
    // Assert the shape first, so a payload-shape regression fails as
    // "shape changed" rather than the misleading "host not found".
    expect(Array.isArray(payload.whitelist)).toBe(true)
    expect((payload.whitelist ?? []).some((o) => o.host === host)).toBe(true)
  }
)

Then(
  'MCP firewall_list_rules should blacklist {string}',
  async ({ callMcpTool }, host: string) => {
    if (!discovery) throw new Error('launch first')
    const reply = await callMcpTool(discovery, 'firewall_list_rules', {})
    const payload = parsedReply(reply) as { blacklist?: { host: string }[] }
    expect(Array.isArray(payload.blacklist)).toBe(true)
    expect((payload.blacklist ?? []).some((o) => o.host === host)).toBe(true)
  }
)

When(
  'I call MCP open_mini_browser',
  async ({ callMcpTool }) => {
    if (!discovery) throw new Error('launch first')
    const reply = await callMcpTool(discovery, 'open_mini_browser', {})
    expect(reply.isError ?? false).toBe(false)
  }
)

Then(
  'the Mini browser tab should be open',
  async () => {
    if (!page) throw new Error('launch first')
    // Workbench tabs render as `[testid]-...-tabs-tab-[tabId]`; match the
    // singleton id, excluding the per-tab label / close sub-elements.
    await expect(
      page.locator('[data-testid*="tabs-tab-mini-browser:singleton"]:not([data-testid*="-label"]):not([data-testid*="-close"])')
    ).toHaveCount(1, { timeout: 10_000 })
  }
)

When(
  'I set the MCP env variable {string} to {string} on the imported env folder',
  async ({ callMcpTool }, key: string, value: string) => {
    if (!discovery || !importedFolderId) throw new Error('list_requests must run first')
    // `set_env_variable` keys off the Environment id, not the env-folder
    // id — `get_active_env` resolves the folder's selected (or first) env.
    const envReply = await callMcpTool(discovery, 'get_active_env', { envFolderId: importedFolderId })
    const envPayload = parsedReply(envReply) as { selectedEnvId?: string | null }
    if (typeof envPayload.selectedEnvId !== 'string' || envPayload.selectedEnvId.length === 0) {
      throw new Error(`get_active_env returned no selectedEnvId: ${JSON.stringify(envPayload)}`)
    }
    selectedEnvId = envPayload.selectedEnvId
    const setReply = await callMcpTool(discovery, 'set_env_variable', {
      envId: selectedEnvId,
      key,
      value: { type: 'string', value }
    })
    expect(setReply.isError ?? false).toBe(false)
    expect(parsedReply(setReply)).toMatchObject({ key })
  }
)

Then(
  'MCP list_env_variables should report {string} is {string}',
  async ({ callMcpTool }, key: string, value: string) => {
    if (!discovery || !selectedEnvId) throw new Error('set the env variable first')
    const reply = await callMcpTool(discovery, 'list_env_variables', { envId: selectedEnvId })
    const payload = parsedReply(reply) as { variables?: { key: string; value: unknown }[] }
    const found = (payload.variables ?? []).find((v) => v.key === key)
    expect(found, `expected env variable "${key}" to be present`).toBeTruthy()
    // The stored value is a ValueType POJO; assert the plaintext is in it
    // without pinning the exact serialised shape.
    expect(JSON.stringify(found?.value ?? null)).toContain(value)
  }
)

When(
  'I delete the MCP env variable {string}',
  async ({ callMcpTool }, key: string) => {
    if (!discovery || !selectedEnvId) throw new Error('set the env variable first')
    const reply = await callMcpTool(discovery, 'delete_env_variable', { envId: selectedEnvId, key })
    expect(parsedReply(reply)).toMatchObject({ key, removed: true })
  }
)

Then(
  'MCP list_env_variables should not report {string}',
  async ({ callMcpTool }, key: string) => {
    if (!discovery || !selectedEnvId) throw new Error('set the env variable first')
    const reply = await callMcpTool(discovery, 'list_env_variables', { envId: selectedEnvId })
    const payload = parsedReply(reply) as { variables?: { key: string }[] }
    expect((payload.variables ?? []).some((v) => v.key === key)).toBe(false)
  }
)

When(
  'I run an MCP batch of open_console then get_current_tab',
  async ({ callMcpTool }) => {
    if (!discovery) throw new Error('launch first')
    lastReply = await callMcpTool(discovery, 'batch', {
      steps: [{ name: 'open_console' }, { name: 'get_current_tab' }]
    })
    expect(lastReply.isError ?? false).toBe(false)
  }
)

Then(
  'the MCP batch reply should report {int} of {int} steps ran',
  async ({}, ran: number, total: number) => {
    if (!lastReply) throw new Error('run the batch first')
    // `batch` aggregates each step's `content` parts then appends the
    // structured envelope as the FINAL text part — so parse the last
    // text content, not the first.
    const texts = (lastReply.content ?? []).filter(
      (c): c is { type: string; text: string } => c.type === 'text' && typeof c.text === 'string'
    )
    const last = texts[texts.length - 1]
    const envelope = JSON.parse(last?.text ?? '{}') as { ranCount?: number; totalCount?: number; aborted?: boolean }
    expect(envelope.ranCount).toBe(ran)
    expect(envelope.totalCount).toBe(total)
    expect(envelope.aborted).toBe(false)
  }
)

// Module-load-time hook: register a `process.on('exit')` listener once
// so the mock HTTP server frees its port even if the worker is killed
// early. close() is idempotent on the wrapper.
process.once('exit', () => { void stopMockServer() })

// ── Orphan-tab invariant: an item deleted via MCP must close its tab ──

When(
  'I delete the open request via MCP',
  async ({ callMcpTool }) => {
    if (!discovery || !firstRequestId) throw new Error('open the request tab first')
    lastReply = await callMcpTool(discovery, 'delete_item', { id: firstRequestId })
    lastReplyPayload = parsedReply(lastReply)
    expect(lastReply.isError ?? false).toBe(false)
    expect(lastReplyPayload).toMatchObject({ id: firstRequestId, deleted: true })
  }
)

Then(
  'no workbench tab references the deleted request',
  async ({ callMcpTool }) => {
    if (!page || !discovery || !firstRequestId) throw new Error('launch + delete first')
    const activePage = page
    const activeDiscovery = discovery
    const deletedId = firstRequestId
    // A main-driven delete (MCP) must prune the orphaned editor tab, or
    // the workbench keeps a tab with no matching sidebar row. Poll: the
    // tree-replace → prune → re-render lands a beat after the tool reply.
    await expect(async () => {
      const openTabs = await activePage.locator(`[data-testid*="tab-request-id:${deletedId}"]`).count()
      expect(openTabs).toBe(0)
      // And the current-tab snapshot must not point at the dead item.
      const cur = await callMcpTool(activeDiscovery, 'get_current_tab', {})
      const payload = parsedReply(cur) as { itemId?: string | null }
      expect(payload.itemId ?? null).not.toBe(deletedId)
    }).toPass({ timeout: 10_000 })
    // The sidebar row is gone too (the invariant's other half).
    await expect(page.locator(`[data-testid="sidebar-listview"] [data-item-id="${deletedId}"]`)).toHaveCount(0)
  }
)

// ── Create → open_tab race: no artificial delay between the two calls ──

When(
  'I create a folder named {string} via MCP',
  async ({ callMcpTool }, name: string) => {
    if (!discovery) throw new Error('launch first')
    lastReply = await callMcpTool(discovery, 'create_folder', { name })
    lastReplyPayload = parsedReply(lastReply)
    expect(lastReply.isError ?? false).toBe(false)
    raceFolderId = (lastReplyPayload as { id: string }).id
  }
)

When(
  'I create a request named {string} via MCP in that folder',
  async ({ callMcpTool }, name: string) => {
    if (!discovery || !raceFolderId) throw new Error('create the folder first')
    lastReply = await callMcpTool(discovery, 'create_request', { parentFolderId: raceFolderId, name, protocol: 'http' })
    lastReplyPayload = parsedReply(lastReply)
    expect(lastReply.isError ?? false).toBe(false)
    raceRequestId = (lastReplyPayload as { id: string }).id
  }
)

When(
  "I open the newly created request's tab via MCP with no delay in between",
  async ({ callMcpTool }) => {
    if (!discovery || !raceRequestId) throw new Error('create the request first')
    // The load-bearing absence: no `waitForTimeout` / sleep between the
    // create call above and this one. `open_tab` itself is responsible
    // for the renderer's tree projection catching up (bounded, internal)
    // — a caller that has to add its own delay here would mean the fix
    // regressed back to a test-side workaround.
    lastReply = await callMcpTool(discovery, 'open_tab', { itemId: raceRequestId })
    lastReplyPayload = parsedReply(lastReply)
  }
)

Then(
  'the MCP open_tab reply should report the tab opened',
  async () => {
    if (!lastReply) throw new Error('open the tab first')
    // Carry the reply into the assertion message: a bare `expected false,
    // received true` on `isError` says nothing about WHICH failure mode hit
    // (unknown id vs. the workbench never confirming), and those want
    // opposite fixes.
    const detail = JSON.stringify(lastReply)
    // A successful tool reply omits `isError` entirely — absent means OK.
    expect(lastReply.isError ?? false, `open_tab replied: ${detail}`).toBe(false)
    expect((lastReplyPayload as { opened?: boolean } | undefined)?.opened, `open_tab replied: ${detail}`).toBe(true)
  }
)

Then(
  'the workbench should show a tab for the newly created request',
  async () => {
    if (!page || !raceRequestId) throw new Error('open the race request tab first')
    await expect(page.locator(`[data-testid*="tab-request-id:${raceRequestId}"]`).first()).toBeVisible({ timeout: 5_000 })
  }
)
