import { createBdd } from 'playwright-bdd'
import { copyFileSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import type { Page, Locator } from '@playwright/test'
import { callMcpToolOverJsonRpc, type McpDiscovery, type McpToolReply } from 'electron-core-ui/testing'
import { test, expect, type LaunchOptions } from '../../fixtures/recording-shell.fixture'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
let projectPath = ''
/** Set when the scenario launched with the MCP server exposed. */
let mcpDiscovery: McpDiscovery | null = null
/** The session an MCP scenario created — `sessionId()` prefers it over the
 * default-named UI session. */
let mcpSessionId: string | null = null
let lastMcpReply: Record<string, unknown> | null = null

/** The committed creation sample: an env folder + a scenario at the root. */
const SAMPLE = join(__dirname, '../../../samples/api-design-creation-sample.restorm')
const ENV_FOLDER_ID = 'env-design-sample'
/** The env folder the current scenario adds sessions to (the harness sample has its own). */
let envFolderId = ENV_FOLDER_ID
const DEFAULT_SESSION_NAME = 'New recording session'

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

function sidebarRow(p: Page, itemId: string): Locator {
  return p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${itemId}"]`)
}

function sidebarRowByTitle(p: Page, title: string): Locator {
  return p.locator('[data-testid="sidebar-listview"] .list-view-row').filter({ has: p.getByText(title, { exact: true }) }).first()
}

/** The tree item id behind the session row (a UUID minted at creation). */
async function sessionId(p: Page): Promise<string> {
  if (mcpSessionId !== null) return mcpSessionId
  const row = sidebarRowByTitle(p, DEFAULT_SESSION_NAME)
  await expect(row).toBeVisible({ timeout: 5000 })
  const id = await row.getAttribute('data-item-id')
  if (id === null || id === '') throw new Error('the session row carries no item id')
  return id
}

function nodeRowId(id: string, kind: string): string {
  return `recording-node:${id}:${kind}`
}

async function openProject(rowId: string = ENV_FOLDER_ID): Promise<void> {
  const p = requirePage()
  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (p: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)
  await expect(sidebarRow(p, rowId)).toBeVisible({ timeout: 10000 })
  await p.waitForTimeout(800)
}

async function openAddSubmenu(p: Page, row: Locator): Promise<void> {
  // Let any debounced sidebar rebuild land before anchoring a menu on a row.
  await p.waitForTimeout(500)
  await row.click({ button: 'right' })
  // Exact match: a favouritable row also carries "Add to favorites" ahead of "Add".
  const addParent = p.getByRole('menuitem', { name: /^(Add|Ajouter)$/ }).first()
  await addParent.waitFor({ state: 'visible', timeout: 10_000 })
  // Pointer-based submenu opening is unreliable (the menu anchors under the
  // pointer); the keyboard path opens the submenu synchronously.
  await addParent.focus()
  await addParent.press('ArrowRight')
  await p.waitForTimeout(500)
}

async function launchWithProject(launchApp: (opts?: LaunchOptions) => Promise<{ page: Page; tempDir: string; discovery?: McpDiscovery }>, plan?: 'pro', mcp = false, geolocation?: string): Promise<void> {
  mcpDiscovery = null
  mcpSessionId = null
  lastMcpReply = null
  envFolderId = ENV_FOLDER_ID
  const launched = await launchApp({ ...(plan !== undefined ? { plan } : {}), ...(mcp ? { mcp: true } : {}), ...(geolocation !== undefined ? { geolocation } : {}) })
  page = launched.page
  mcpDiscovery = launched.discovery ?? null
  projectPath = join(launched.tempDir, `recording-shell-${plan ?? 'community'}${mcp ? '-mcp' : ''}.restorm`)
  copyFileSync(SAMPLE, projectPath)
  await openProject()
  if (plan === 'pro') {
    await expect(requirePage().locator('[data-testid="app-statusbar-version-plan"]')).toContainText('Pro', { timeout: 10000 })
  }
}

Given('a project with an env folder is open', async ({ launchApp }) => {
  await launchWithProject(launchApp)
})

Given('a Pro project with an env folder is open', async ({ launchApp }) => {
  await launchWithProject(launchApp, 'pro')
})

Given('a Pro project with an env folder is open with the MCP server enabled', async ({ launchApp }) => {
  await launchWithProject(launchApp, 'pro', true)
})

Given('a project with an env folder is open with the MCP server enabled', async ({ launchApp }) => {
  await launchWithProject(launchApp, undefined, true)
})

When("I add a recording session from the env folder's context menu", async () => {
  const p = requirePage()
  await openAddSubmenu(p, sidebarRow(p, envFolderId))
  const entry = p.locator('[data-testid="sidebar-context-menu-add-recording"]')
  await expect(entry).toBeVisible({ timeout: 5000 })
  await entry.click()
  // The new row lands in inline rename; keep the default name.
  await p.waitForTimeout(400)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
})

Then('the sidebar carries a recording session named {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowByTitle(p, name)).toBeVisible({ timeout: 5000 })
})

Then('the session row is expanded with a {string} row and a {string} row', async ({}, first: string, second: string) => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(sidebarRow(p, nodeRowId(id, first))).toBeVisible({ timeout: 5000 })
  await expect(sidebarRow(p, nodeRowId(id, second))).toBeVisible({ timeout: 5000 })
})

Then('the session has no {string} row', async ({}, kind: string) => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(sidebarRow(p, nodeRowId(id, kind))).toHaveCount(0)
})

Then('the recording {string} tab is open', async ({}, node: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="recording-tab-${node}"]`)).toBeVisible({ timeout: 10000 })
})

When('I click the session {string} row', async ({}, kind: string) => {
  const p = requirePage()
  const id = await sessionId(p)
  await sidebarRow(p, nodeRowId(id, kind)).click()
  await p.waitForTimeout(400)
})

When('I click the session row', async () => {
  const p = requirePage()
  await sidebarRowByTitle(p, DEFAULT_SESSION_NAME).click()
  await p.waitForTimeout(400)
})

When("I add a scenario from the env folder's context menu", async () => {
  const p = requirePage()
  await openAddSubmenu(p, sidebarRow(p, ENV_FOLDER_ID))
  const entry = p.locator('[data-testid="sidebar-context-menu-add-scenario"]')
  await expect(entry).toBeVisible({ timeout: 5000 })
  await entry.click()
  await p.waitForTimeout(400)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  await expect(sidebarRowByTitle(p, 'New scenario')).toBeVisible({ timeout: 5000 })
})

When('I open the Add submenu of the new scenario row', async () => {
  const p = requirePage()
  await openAddSubmenu(p, sidebarRowByTitle(p, 'New scenario'))
})

Then('the Add submenu offers no recording session entry', async () => {
  const p = requirePage()
  // The design entry is there (the submenu is open) — the recording one is not.
  await expect(p.locator('[data-testid="sidebar-context-menu-add-design"]')).toBeVisible({ timeout: 5000 })
  await expect(p.locator('[data-testid="sidebar-context-menu-add-recording"]')).toHaveCount(0)
  await p.keyboard.press('Escape')
})

When('I save the project', async () => {
  const p = requirePage()
  await p.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', code: 'KeyS', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
    }))
  })
  await p.waitForTimeout(1500)
})

Then('the saved file carries a recording session named {string}', async ({}, name: string) => {
  const saved = readFileSync(projectPath, 'utf-8')
  expect(saved).toContain(`name: ${name}`)
  expect(saved).toContain('type: recording')
  // Only the configuration persists — never any captured call.
  expect(saved).not.toContain('captures:')
})

Then('the saved file declares file format version {string}', async ({}, version: string) => {
  const saved = readFileSync(projectPath, 'utf-8')
  expect(saved.startsWith(`fileFormatVersion: ${version}\n`)).toBe(true)
})

// ── Config page + record button ───────────────────────────────────────

const LOCAL_PAGE = `file://${resolve(__dirname, '../../../samples/fixtures/recording-page.html')}`

/** A tiny API the local test page calls (CORS open — the page is a file://
 * origin): every call is a real 200 with a JSON body, so the recording sees
 * genuine API traffic without any docker mock. */
let apiServer: Server | null = null
let apiBase = ''

async function ensureApiServer(): Promise<string> {
  if (apiServer !== null) return apiBase
  apiServer = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if ((req.url ?? '').startsWith('/api/ping')) {
      res.statusCode = 200
      res.end(JSON.stringify({ pong: true, url: req.url }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise<void>((resolveListen) => { apiServer?.listen(0, '127.0.0.1', () => { resolveListen() }) })
  // Steps files cannot register Playwright hooks; an unref'd server never
  // keeps the worker alive, so it simply dies with the process.
  apiServer.unref()
  const address = apiServer.address() as AddressInfo
  apiBase = `http://127.0.0.1:${address.port}`
  return apiBase
}

function recordButton(p: Page): Locator {
  return p.locator('[data-testid="recording-config-record"]')
}

Then('the record button is disabled', async () => {
  const p = requirePage()
  await expect(recordButton(p)).toBeVisible({ timeout: 10000 })
  // The ECUI Button carries its disabled state as a class (see design-server).
  await expect(recordButton(p)).toHaveClass(/disabled/, { timeout: 5000 })
})

Then('the record button is enabled', async () => {
  const p = requirePage()
  await expect(recordButton(p)).not.toHaveClass(/disabled/, { timeout: 5000 })
})

When('I set the session url to the local test page', async () => {
  const p = requirePage()
  // The ECUI InputBox suffixes its own test id on the native input.
  const input = p.locator('[data-testid="recording-config-url-input"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  const api = await ensureApiServer()
  await input.click()
  await input.fill(`${LOCAL_PAGE}?api=${encodeURIComponent(api)}`)
  // The InputBox debounces its onChange; let the value land on the session.
  await p.waitForTimeout(700)
})

When('I click the record button', async () => {
  const p = requirePage()
  await recordButton(p).click()
  await p.waitForTimeout(800)
})

Then('the session has a {string} row', async ({}, kind: string) => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(sidebarRow(p, nodeRowId(id, kind))).toBeVisible({ timeout: 10000 })
})

Then('the session is on air', async () => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(p.locator(`[data-testid="recording-on-air-${id}"]`).first()).toHaveAttribute('data-recording-state', 'recording', { timeout: 10000 })
})

Then('the session is idle', async () => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(p.locator(`[data-testid="recording-on-air-${id}"]`).first()).toHaveAttribute('data-recording-state', 'idle', { timeout: 10000 })
})

When('I click the browser pause button', async () => {
  const p = requirePage()
  await p.locator('[data-testid="recording-browser-pause"]').click()
  await p.waitForTimeout(400)
})

When('I click the browser stop button', async () => {
  const p = requirePage()
  await p.locator('[data-testid="recording-browser-stop"]').click()
  await p.waitForTimeout(600)
})

Then('the session is paused', async () => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(p.locator(`[data-testid="recording-on-air-${id}"]`).first()).toHaveAttribute('data-recording-state', 'paused', { timeout: 10000 })
})

Then('the recording {string} tab is closed', async ({}, node: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="recording-tab-${node}"]`)).toHaveCount(0, { timeout: 5000 })
})

// ── Captures tab ─────────────────────────────────────────────────────

Then('the captures list shows a call to {string}', async ({}, route: string) => {
  const p = requirePage()
  const rows = p.locator('[data-testid^="recording-capture-row-"]').filter({ hasText: route })
  await expect(rows.first()).toBeVisible({ timeout: 15000 })
})

Then('the captures list shows a live run row', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid^="recording-run-row-"]').first()).toBeVisible({ timeout: 5000 })
})

When('I filter the captures with {string}', async ({}, pattern: string) => {
  const p = requirePage()
  const input = p.locator('[data-testid="recording-captures-filter-input"]')
  await input.click()
  await input.fill(pattern)
  await p.waitForTimeout(600)
})

Then('the captures list shows no call', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid^="recording-capture-row-"]')).toHaveCount(0, { timeout: 5000 })
})

When('I click the first captured call', async () => {
  const p = requirePage()
  await p.locator('[data-testid^="recording-capture-row-"]').first().click()
  await p.waitForTimeout(500)
})

Then('the capture detail shows the response tabs', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="recording-capture-detail"]')).toBeVisible({ timeout: 10000 })
  await expect(p.locator('[data-testid="recording-capture-detail-tabs"]')).toBeVisible({ timeout: 5000 })
})

// ── Route deduction (Pro+) ────────────────────────────────────────────

Then('the deduce routes button is locked', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="recording-captures-deduce"]')).toHaveClass(/disabled/, { timeout: 5000 })
  await expect(p.locator('[data-testid="recording-captures-deduce-gate-upsell"]').or(p.locator('[data-testid="recording-captures-deduce-gate"] .ecu-gated, [data-testid="recording-captures-deduce-gate"]')).first()).toBeVisible({ timeout: 5000 })
})

Then('the recording routes tab shows the Pro callout', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="recording-routes-pro-callout"]')).toBeVisible({ timeout: 10000 })
})

When('I click the deduce routes button', async () => {
  const p = requirePage()
  const button = p.locator('[data-testid="recording-captures-deduce"]')
  await expect(button).not.toHaveClass(/disabled/, { timeout: 5000 })
  await button.click()
  await p.waitForTimeout(1200)
})

Then('the recording routes tab lists {int} deduced request', async ({}, count: number) => {
  const p = requirePage()
  await expect(p.locator('[data-testid="recording-routes-list"]')).toBeVisible({ timeout: 10000 })
  await expect(p.locator('[data-testid="recording-routes-summary"]')).toContainText(String(count), { timeout: 5000 })
})

Then('the Routes row of the session lists the request {string} in the folder {string}', async ({}, name: string, folders: string) => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect(sidebarRow(p, nodeRowId(id, 'routes'))).toBeVisible({ timeout: 5000 })
  // The UI flow expands the Routes node itself; an MCP deduction does not.
  await expandRowIfCollapsed(sidebarRow(p, nodeRowId(id, 'routes')))
  // The deduction groups the routes by static path prefix, so the request
  // lives in (collapsed) folders under the Routes node — `folders` is the
  // path from the Routes node, `>`-separated.
  const rows = p.locator('[data-testid="sidebar-listview"] .list-view-row')
  for (const folder of folders.split('>').map((f) => f.trim()).filter((f) => f.length > 0)) {
    const folderRow = rows.filter({ has: p.getByText(folder, { exact: true }) }).first()
    await expect(folderRow).toBeVisible({ timeout: 10000 })
    await expandRowIfCollapsed(folderRow)
  }
  const row = rows.filter({ has: p.getByText(name, { exact: true }) }).first()
  await expect(row).toBeVisible({ timeout: 10000 })
})

Then('the Routes row of the session lists no request {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(p.locator('[data-testid="sidebar-listview"] .list-view-row').filter({ has: p.getByText(name, { exact: true }) })).toHaveCount(0)
})

/** Click a sidebar row's Expand chevron when the row is collapsed. */
async function expandRowIfCollapsed(row: Locator): Promise<void> {
  const expand = row.getByRole('button', { name: /^(Expand|Développer)$/ })
  if (await expand.isVisible({ timeout: 1000 }).catch(() => false)) {
    await expand.click()
    await row.page().waitForTimeout(300)
  }
}

// ── MCP-driven flow ───────────────────────────────────────────────────

function requireMcp(): McpDiscovery {
  if (mcpDiscovery === null) throw new Error('the app was not launched with the MCP server exposed')
  return mcpDiscovery
}

async function mcpCall(name: string, args: Record<string, unknown> = {}): Promise<{ reply: McpToolReply; json: Record<string, unknown> | null }> {
  const reply = await callMcpToolOverJsonRpc(requireMcp(), name, args)
  const text = reply.content?.[0]?.text ?? ''
  let json: Record<string, unknown> | null = null
  try { json = JSON.parse(text) as Record<string, unknown> } catch { json = null }
  lastMcpReply = json
  return { reply, json }
}

When('I create a recording session over MCP pointing at the local page', async () => {
  const api = await ensureApiServer()
  const { reply, json } = await mcpCall('create_recording_session', {
    parentId: ENV_FOLDER_ID,
    name: 'MCP recording',
    url: `${LOCAL_PAGE}?api=${encodeURIComponent(api)}`,
    protocols: ['http'],
    blacklist: ['\\.png$']
  })
  expect(reply.isError, reply.content?.[0]?.text).toBeFalsy()
  const id = json?.['id']
  if (typeof id !== 'string' || id.length === 0) throw new Error(`create_recording_session returned no id: ${JSON.stringify(json)}`)
  mcpSessionId = id
})

Then('the sidebar shows the session created over MCP', async () => {
  const p = requirePage()
  await expect(sidebarRow(p, await sessionId(p))).toBeVisible({ timeout: 10000 })
  await expect(sidebarRowByTitle(p, 'MCP recording')).toBeVisible({ timeout: 5000 })
})

Then('MCP lists {int} recording session named {string}', async ({}, count: number, name: string) => {
  const { json } = await mcpCall('list_recording_sessions')
  expect(json?.['count']).toBe(count)
  const sessions = json?.['sessions'] as { name: string; parentId: string | null }[]
  expect(sessions[0]).toMatchObject({ name, parentId: ENV_FOLDER_ID })
})

When('I start the recording over MCP', async () => {
  const p = requirePage()
  const { reply, json } = await mcpCall('start_recording', { sessionId: await sessionId(p) })
  expect(reply.isError, reply.content?.[0]?.text).toBeFalsy()
  expect(json?.['started']).toBe(true)
})

Then('the MCP recording status reports at least {int} captures', async ({}, min: number) => {
  const p = requirePage()
  const id = await sessionId(p)
  await expect.poll(async () => {
    const { json } = await mcpCall('get_recording_status', { sessionId: id })
    return typeof json?.['captureCount'] === 'number' ? json['captureCount'] : -1
  }, { timeout: 15000, intervals: [500] }).toBeGreaterThanOrEqual(min)
  const { json } = await mcpCall('list_recording_captures', { sessionId: id, protocol: 'http' })
  const captures = json?.['captures'] as { id: string; url: string; status?: number }[]
  const ping = captures.find((c) => c.url.includes('/api/ping'))
  if (!ping) throw new Error(`no /api/ping capture in ${JSON.stringify(captures)}`)
  const detail = await mcpCall('get_recording_capture', { sessionId: id, captureId: ping.id })
  expect(detail.json?.['id']).toBe(ping.id)
  expect((detail.json?.['response'] as { body: { data: string } }).body.data).toContain('pong')
})

When('I stop the recording over MCP', async () => {
  const p = requirePage()
  const { reply, json } = await mcpCall('stop_recording', { sessionId: await sessionId(p) })
  expect(reply.isError, reply.content?.[0]?.text).toBeFalsy()
  expect(json?.['stopped']).toBe(true)
})

When('I deduce the routes over MCP', async () => {
  const p = requirePage()
  const { reply } = await mcpCall('deduce_recording_routes', { sessionId: await sessionId(p) })
  expect(reply.isError, reply.content?.[0]?.text).toBeFalsy()
})

Then('the MCP deduction reports {int} new route', async ({}, count: number) => {
  expect(lastMcpReply?.['newRoutes']).toBe(count)
})

Then('MCP lists the folder {string} under the session and the request {string} inside it', async ({}, folderName: string, requestName: string) => {
  const p = requirePage()
  const folders = await mcpCall('list_folders', { parentId: await sessionId(p) })
  const listedFolders = JSON.parse(folders.reply.content?.[0]?.text ?? '[]') as { id: string; name: string }[]
  const folder = listedFolders.find((f) => f.name === folderName)
  if (!folder) throw new Error(`no folder "${folderName}" under the session: ${JSON.stringify(listedFolders)}`)
  const requests = await mcpCall('list_requests', { folderId: folder.id })
  const listed = JSON.parse(requests.reply.content?.[0]?.text ?? '[]') as { name: string }[]
  expect(listed.map((r) => r.name)).toContain(requestName)
})

When('I open the session tab over MCP', async () => {
  const p = requirePage()
  const { reply } = await mcpCall('open_tab', { itemId: await sessionId(p) })
  expect(reply.isError, reply.content?.[0]?.text).toBeFalsy()
  await expect(p.locator('[data-testid="recording-tab-config"]')).toBeVisible({ timeout: 10000 })
})

When('I expand the session row', async () => {
  const p = requirePage()
  await expandRowIfCollapsed(sidebarRow(p, await sessionId(p)))
})

Then('deducing the routes over MCP is refused as a Pro feature', async () => {
  const p = requirePage()
  const { reply } = await mcpCall('deduce_recording_routes', { sessionId: await sessionId(p) })
  expect(reply.isError).toBe(true)
  expect(reply.content?.[0]?.text ?? '').toContain('Restorm Pro')
})

// ── Reference harness: mock servers in a scenario + the page they serve ──

const HARNESS_SAMPLE = join(__dirname, '../../../samples/recording-harness-sample.restorm')
const HARNESS_ENV_FOLDER_ID = 'rec-harness-env'
const HARNESS_SCENARIO_ID = 'rec-harness-scenario'
const HARNESS_PAGE_URL = 'http://localhost:8123/'
/** Server requests of the harness whose listening state the test polls. */
const HARNESS_SERVERS: { ns: 'http' | 'graphql'; id: string }[] = [
  { ns: 'http', id: 'rec-srv-page' },
  { ns: 'http', id: 'rec-srv-pets' },
  { ns: 'http', id: 'rec-srv-pet-3' },
  { ns: 'http', id: 'rec-srv-grpcweb' },
  { ns: 'graphql', id: 'rec-srv-graphql' }
]

Given('the recording harness project is open on Pro', async ({ launchApp }) => {
  await launchWithProject(launchApp, 'pro')
  await openHarnessProject()
})

/** Same harness, with a fixed position seeded for the geolocation service. */
Given('the recording harness project is open with a seeded position', async ({ launchApp }) => {
  await launchWithProject(launchApp, 'pro', false, '48.85,2.35,120')
  await openHarnessProject()
})

async function openHarnessProject(): Promise<void> {
  // Swap the creation sample for the harness: every mock the page calls
  // lives in one scenario, on one port (same origin as the page: no CORS).
  projectPath = join(dirname(projectPath), 'recording-harness.restorm')
  copyFileSync(HARNESS_SAMPLE, projectPath)
  envFolderId = HARNESS_ENV_FOLDER_ID
  await openProject(HARNESS_ENV_FOLDER_ID)
}

/** The privacy toggle's consent dialog: turning the setting on through the
 * settings page asks first; accepting writes the setting, which is what the
 * main process follows. */
When('I turn on the shared-location privacy setting and accept the consent', async () => {
  const p = requirePage()
  await p.evaluate(async () => {
    const w = window as unknown as { api?: { settings?: { set?: (key: string, value: unknown) => Promise<unknown> } } }
    const fn = w.api?.settings?.set
    if (typeof fn !== 'function') throw new Error('window.api.settings.set is not available')
    await fn('privacy:geolocation', true)
  })
  await p.waitForTimeout(500)
})

async function harnessListening(p: Page): Promise<boolean> {
  return p.evaluate(async (servers: { ns: string; id: string }[]) => {
    const w = window as unknown as { restorm?: Record<string, { isListening?: (id: string) => Promise<boolean> }> }
    for (const { ns, id } of servers) {
      const fn = w.restorm?.[ns]?.isListening
      if (typeof fn !== 'function') return false
      if (!(await fn(id))) return false
    }
    return true
  }, HARNESS_SERVERS)
}

async function openHarnessScenario(p: Page): Promise<void> {
  await expandRowIfCollapsed(sidebarRow(p, HARNESS_ENV_FOLDER_ID))
  await sidebarRow(p, HARNESS_SCENARIO_ID).click()
  await expect(p.locator('[data-testid="scenario-editor"]')).toBeVisible({ timeout: 15000 })
  await expect(p.locator('[data-testid="scenario-inspector-toolbar"]')).toBeVisible({ timeout: 15000 })
}

When('I run the recording servers scenario', async () => {
  const p = requirePage()
  await openHarnessScenario(p)
  // No node selected → the whole scenario: every listen node starts at once
  // and the run stays in progress while the servers are up.
  await p.locator('[data-testid="scenario-inspector-run"]').click()
  await expect.poll(() => harnessListening(p), { timeout: 30000, intervals: [500] }).toBe(true)
  // The page itself answers over plain HTTP from the test process too.
  const response = await fetch(HARNESS_PAGE_URL)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type') ?? '').toContain('text/html')
  expect(await response.text()).toContain('Recording harness')
})

When('I stop the recording servers scenario', async () => {
  const p = requirePage()
  await openHarnessScenario(p)
  await p.locator('[data-testid="scenario-inspector-stop"]').click()
  await expect.poll(() => harnessListening(p), { timeout: 30000, intervals: [500] }).toBe(false)
})

When('I set the session url to the harness page', async () => {
  const p = requirePage()
  const input = p.locator('[data-testid="recording-config-url-input"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.click()
  await input.fill(HARNESS_PAGE_URL)
  await p.waitForTimeout(700)
})

When('I add the blacklist pattern {string} in the session config', async ({}, pattern: string) => {
  const p = requirePage()
  await p.locator('[data-testid="recording-config-blacklist-add"]').click()
  const input = p.locator('[data-testid="recording-config-blacklist-input-0-input"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.click()
  await input.fill(pattern)
  // The InputBox debounces its onChange; let the value land on the session.
  await p.waitForTimeout(700)
})

Then('the captures list shows no call to {string}', async ({}, route: string) => {
  const p = requirePage()
  await expect(p.locator('[data-testid^="recording-capture-row-"]').filter({ hasText: route })).toHaveCount(0, { timeout: 5000 })
})

When('I add the capture {string} to the black list and apply it', async ({}, route: string) => {
  const p = requirePage()
  const row = p.locator('[data-testid^="recording-capture-row-"]').filter({ hasText: route }).first()
  await expect(row).toBeVisible({ timeout: 15000 })
  await row.click({ button: 'right' })
  const entry = p.getByRole('menuitem', { name: /black list|liste noire/i }).first()
  await expect(entry).toBeVisible({ timeout: 5000 })
  await entry.click()
  const modal = p.locator('[data-testid="recording-filter-modal"]')
  await expect(modal).toBeVisible({ timeout: 5000 })
  // The pattern is prefilled with the captured url, escaped for a regex.
  await expect(modal.locator('[data-testid="recording-filter-modal-pattern-input"]')).toHaveValue(new RegExp(route.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')))
  await modal.locator('[data-testid="recording-filter-modal-add-apply"]').click()
  await expect(modal.locator('[data-testid="recording-filter-modal-confirm-message"]')).toBeVisible({ timeout: 5000 })
  await modal.locator('[data-testid="recording-filter-modal-confirm-ok"]').click()
  await expect(modal).not.toBeVisible({ timeout: 5000 })
})

Then('the session config black list contains {int} patterns', async ({}, count: number) => {
  const p = requirePage()
  await expect(p.locator('[data-testid^="recording-config-blacklist-row-"]')).toHaveCount(count, { timeout: 5000 })
})

When('I click the capture {string}', async ({}, route: string) => {
  const p = requirePage()
  const row = p.locator('[data-testid^="recording-capture-row-"]').filter({ hasText: route }).first()
  await expect(row).toBeVisible({ timeout: 15000 })
  await row.click()
  await p.waitForTimeout(300)
})
