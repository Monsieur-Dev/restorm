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
import { copyFileSync, mkdirSync } from 'node:fs'
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
    // Open a COPY of the sample: several scenarios mutate the project (the
    // method combo matrix rewrites the request's method) and the renderer
    // autosaves — pointing the app at the repo file would dirty the checkout
    // on every run.
    const samplePath = join(restormRoot, 'tests/e2e/samples/http-sample.restorm')
    const tmpDir = join(restormRoot, 'tests/e2e/.tmp')
    mkdirSync(tmpDir, { recursive: true })
    const workingCopy = join(tmpDir, 'http-sample.working.restorm')
    copyFileSync(samplePath, workingCopy)
    const opened = await callMcpTool(discovery, 'open_project', { filePath: workingCopy })
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
    // `list_environments` is scoped to an env folder, so resolve the
    // sample's top-level env folder first.
    const foldersReply = await callMcpTool(discovery, 'list_folders', {})
    const folders = parsedReply(foldersReply) as { id: string; kind: string }[]
    const envFolderId = folders.find((f) => f.kind === 'env-folder')?.id
    expect(envFolderId, 'sample env folder not found').toBeTruthy()
    const envReply = await callMcpTool(discovery, 'list_environments', { envFolderId })
    const envs = parsedReply(envReply) as { environments: { id: string; name: string }[] }
    environmentId = envs.environments[0]?.id ?? null
    expect(environmentId, 'sample environment not found').toBeTruthy()

    // The multipart upload field and the standalone file body both point
    // at `{{uploadPath}}`; bind it to the committed fixture's absolute
    // path so the executor streams a real file.
    const uploadPath = join(restormRoot, 'tests/e2e/samples/fixtures/upload.txt')
    await callMcpTool(discovery, 'set_env_variable', {
      envId: environmentId,
      key: 'uploadPath',
      value: { type: 'string', value: uploadPath }
    })
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

const METHOD_TRIGGER = '[data-testid="http-request-method-select-trigger"]'
const METHOD_DROPDOWN = '[data-testid="http-request-method-select-dropdown"]'

/** Resolved background color of a badge-registry entry, computed by probing
 * the entry's CSS token inside the live page (theme-proof: whatever theme the
 * app runs, the badge must resolve to the SAME color as its declared token). */
async function registryColor(p: Page, badgeId: string): Promise<string> {
  return await p.evaluate((id) => {
    const probe = document.createElement('div')
    const tokens: Record<string, string> = {
      http_get: 'var(--badge-get-background)',
      http_post: 'var(--badge-post-background)',
      http_put: 'var(--badge-put-background)',
      http_patch: 'var(--badge-patch-background)',
      http_delete: 'var(--badge-delete-background)',
      http_head: 'var(--badge-head-background)',
      http_options: 'var(--badge-options-background)',
      http_query: 'var(--badge-gql-background)',
      http_other: 'var(--badge-other-background)'
    }
    probe.style.backgroundColor = tokens[id] ?? ''
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()
    return color
  }, badgeId)
}

async function expectRegistryBadge(badge: ReturnType<Page['locator']>, text: string, badgeId: string, expectedColor: string): Promise<void> {
  await expect(badge).toBeVisible({ timeout: 10_000 })
  await expect(badge).toHaveText(text, { timeout: 10_000 })
  await expect(badge).toHaveAttribute('data-badge-id', badgeId)
  const bg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg, `badge background for ${badgeId}`).toBe(expectedColor)
}

/** Snapshot-assert a registry badge inside the OPEN context menu: the menu can
 * close under async re-renders while a polling locator waits, so the whole
 * check runs in ONE page.evaluate the instant the submenu is open. */
async function expectMenuRegistryBadge(p: Page, text: string, badgeId: string, expectedColor: string, where = ''): Promise<void> {
  const result = await p.evaluate(([wantText, wantId]) => {
    const badge = document.querySelector(`[role="menuitem"] .registry-badge[data-badge-id="${wantId}"]`)
    if (!badge) {
      const open = document.querySelectorAll('[role="menuitem"]').length
      return { ok: false, why: `no badge ${wantId} in the open menu (${String(open)} menuitems visible)` }
    }
    const bg = getComputedStyle(badge).backgroundColor
    const txt = badge.textContent.trim()
    if (txt !== wantText) return { ok: false, why: `text ${txt} != ${wantText}` }
    return { ok: true, bg }
  }, [text, badgeId])
  expect(result.ok, result.ok ? undefined : `${where}: ${result.why ?? ''}`).toBe(true)
  expect(result.bg, `menu badge background for ${badgeId}`).toBe(expectedColor)
}

When('I favorite the {string} request via MCP', async ({ callMcpTool }, name: string) => {
  if (discovery === null) throw new Error('launch first')
  const id = requestsByName.get(name)
  expect(id, `request ${name} not found`).toBeTruthy()
  const reply = await callMcpTool(discovery, 'set_favorite', { itemId: id, favorite: true })
  expect(reply.isError ?? false).toBe(false)
})

When('I open the {string} scenario tab via MCP', async ({ callMcpTool }, name: string) => {
  if (discovery === null) throw new Error('launch first')
  const reply = await callMcpTool(discovery, 'list_scenarios', {})
  const scenarios = parsedReply(reply) as { id: string; name: string }[]
  const scn = scenarios.find((sc) => sc.name === name)
  expect(scn, `scenario ${name} not found`).toBeTruthy()
  const opened = await callMcpTool(discovery, 'open_tab', { itemId: scn?.id })
  expect(opened.isError ?? false).toBe(false)
  if (page === null) throw new Error('launch first')
  await page.waitForTimeout(1_000)
})

When('I activate the {string} request tab', async ({}, name: string) => {
  if (page === null) throw new Error('launch first')
  const tab = page.locator('[role="tab"]', { hasText: name }).first()
  await tab.click({ timeout: 10_000 })
  await expect(page.locator(METHOD_TRIGGER).first()).toBeVisible({ timeout: 10_000 })
})

When('I pick {string} from the method combo', async ({}, verb: string) => {
  if (page === null) throw new Error('launch first')
  await page.locator(METHOD_TRIGGER).first().click()
  const option = page
    .locator(`${METHOD_DROPDOWN} .select-option`)
    .filter({ has: page.locator('.registry-badge', { hasText: new RegExp(`^${verb}$`) }) })
    .first()
  await option.click({ timeout: 10_000 })
})

When('I type {string} into the method combo', async ({}, text: string) => {
  if (page === null) throw new Error('launch first')
  await page.locator(METHOD_TRIGGER).first().click()
  const entry = page.locator(`${METHOD_DROPDOWN} .dropdown-filter-row input`).first()
  await entry.waitFor({ state: 'visible', timeout: 10_000 })
  await entry.fill(text)
  // Commit is Enter (or focus loss); Enter keeps the typed text VERBATIM even
  // when it visually matches a known verb ("Post" must not become "POST").
  await entry.press('Enter')
})

Then('all method badge surfaces show {string} as {string}', async ({}, text: string, badgeId: string) => {
  if (page === null) throw new Error('launch first')
  const color = await registryColor(page, badgeId)

  // 1. Method combo trigger (request tab must be active).
  await expectRegistryBadge(page.locator(`${METHOD_TRIGGER} .registry-badge`).first(), text, badgeId, color)
  // The other surfaces follow through the reactive REQUEST_UPDATED emission
  // (50ms trailing debounce) — give the propagation a beat under load before
  // polling them.
  await page.waitForTimeout(500)
  // 2. Workbench tab-strip badge of the request tab.
  const tab = page.locator('[role="tab"]', { hasText: 'GET echo' }).first()
  await expectRegistryBadge(tab.locator('.registry-badge').first(), text, badgeId, color)
  // 3. Sidebar workspace tree row (rows are ARIA treeitems).
  const treeRow = page.locator('[data-testid="sidebar-listview"]').getByRole('treeitem', { name: /GET echo/ }).first()
  await expectRegistryBadge(treeRow.locator('.registry-badge').first(), text, badgeId, color)
  // 4. Favorites pane row (ARIA listitems).
  const favRow = page.locator('[data-testid="sidebar-favorites-listview"]').getByRole('listitem').filter({ hasText: 'GET echo' }).first()
  await expectRegistryBadge(favRow.locator('.registry-badge').first(), text, badgeId, color)
  // 5. Open-documents pane row.
  const openRow = page.locator('[data-testid="sidebar-open-documents-listview"]').getByRole('listitem').filter({ hasText: 'GET echo' }).first()
  await expectRegistryBadge(openRow.locator('.registry-badge').first(), text, badgeId, color)
  // 6. Scenario request-node header — switch to the scenario tab, assert, and
  // come back so the combo stays reachable for the next mutation.
  await page.locator('[role="tab"]', { hasText: 'Badge scenario' }).first().click()
  const node = page.locator('.react-flow__node', { hasText: 'GET echo' }).first()
  await expectRegistryBadge(node.locator('.registry-badge').first(), text, badgeId, color)
  await page.locator('[role="tab"]', { hasText: 'GET echo' }).first().click()
  await expect(page.locator(METHOD_TRIGGER).first()).toBeVisible({ timeout: 10_000 })
})

Then('the sidebar add menu shows the {string} method badge as {string}', async ({}, text: string, badgeId: string) => {
  if (page === null) throw new Error('launch first')
  const color = await registryColor(page, badgeId)
  // The add entries live in the sidebar context menu's "Add" submenu —
  // right-click the workspace root folder and hover the submenu parent.
  const folderRow = page.locator('[data-testid="sidebar-listview"]').getByRole('treeitem', { name: /HTTP Execution Playground/ }).first()
  // Let the debounced sidebar rebuild triggered by the previous tab
  // activations land BEFORE opening the menu — a rebuild remounts the rows
  // and takes the context menu's anchor (and the menu) down with it.
  await page.waitForTimeout(1_000)
  await folderRow.click({ button: 'right' })
  const addParent = page.getByRole('menuitem', { name: /^(Add|Ajouter)/ }).first()
  await addParent.waitFor({ state: 'visible', timeout: 10_000 })
  // Pointer-based submenu opening is unreliable here (the context menu
  // anchors under the pointer, so hover can produce no mouseenter). Use the
  // keyboard path instead: focus the parent and ArrowRight opens the submenu
  // synchronously.
  await addParent.focus()
  await addParent.press('ArrowRight')
  await page.waitForTimeout(500)
  await expectMenuRegistryBadge(page, text, badgeId, color, 'sidebar-add-menu')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
})

Then('the scenario add palette shows the {string} method badge as {string}', async ({}, text: string, badgeId: string) => {
  if (page === null) throw new Error('launch first')
  const color = await registryColor(page, badgeId)
  // The palette is the scenario editor's add-child context menu — open the
  // scenario tab and right-click the canvas.
  await page.locator('[role="tab"]', { hasText: 'Badge scenario' }).first().click()
  const canvas = page.locator('.react-flow__pane').first()
  await canvas.waitFor({ state: 'visible', timeout: 10_000 })
  // Dispatch the contextmenu at an EMPTY spot (top-right of the pane):
  // bottom-left hosts the React Flow controls (they intercept pointer
  // events) and the request node sits in the left half.
  const paneBox = await canvas.boundingBox()
  if (paneBox === null) throw new Error('scenario pane has no bounding box')
  await canvas.dispatchEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: Math.round(paneBox.x + paneBox.width - 80),
    clientY: Math.round(paneBox.y + 80)
  })
  await page.waitForTimeout(600)
  // The request entries (and their badges) sit under the palette's "Add"
  // submenu — open it with the keyboard, like the sidebar menu.
  const paletteAdd = page.getByRole('menuitem', { name: /^(Add|Ajouter)/ }).first()
  await paletteAdd.waitFor({ state: 'visible', timeout: 10_000 })
  await paletteAdd.focus()
  await paletteAdd.press('ArrowRight')
  await page.waitForTimeout(400)
  await expectMenuRegistryBadge(page, text, badgeId, color, 'scenario-palette')
  await page.keyboard.press('Escape')
  // Back to the request tab for the rest of the scenario.
  await page.locator('[role="tab"]', { hasText: 'GET echo' }).first().click()
  await expect(page.locator(METHOD_TRIGGER).first()).toBeVisible({ timeout: 10_000 })
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
