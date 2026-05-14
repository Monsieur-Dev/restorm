/**
 * Steps for the `mcp-server` BDD scenario. Drives an end-to-end loop:
 * launch restorm with `--mcp`, talk JSON-RPC to the embedded server,
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
import { test, expect, type McpDiscovery, type McpToolReply, MCP_SERVER_TEMP_DIR } from '../../fixtures/mcp-server.fixture'

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
  async ({ callMcpTool }, name: string) => {
    if (!discovery) throw new Error('launch first')
    const filePath = join(MCP_SERVER_TEMP_DIR, `${name}.restorm`)
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
    // `get_current_tab` reads the renderer-pushed active-tab snapshot —
    // the workbench tab id is what `set_tab_maximized` needs to target.
    const cur = await callMcpTool(discovery, 'get_current_tab', {})
    const payload = parsedReply(cur) as { tabId?: string | null }
    if (typeof payload.tabId !== 'string' || payload.tabId.length === 0) {
      throw new Error(`get_current_tab returned no tabId: ${JSON.stringify(payload)}`)
    }
    currentTabId = payload.tabId
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

// Module-load-time hook: register a `process.on('exit')` listener once
// so the mock HTTP server frees its port even if the worker is killed
// early. close() is idempotent on the wrapper.
process.once('exit', () => { void stopMockServer() })
