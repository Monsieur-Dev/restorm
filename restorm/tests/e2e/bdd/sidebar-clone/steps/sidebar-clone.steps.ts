/**
 * Steps for the `sidebar-clone` BDD suite: drives the sidebar "Clone" /
 * rename actions through the real UI (Playwright), and reads back the exact
 * ids/references a clone produced via MCP (`get_scenario`,
 * `list_quick_configs`, …) — the UI alone can assert "it looks different"
 * but not "this specific cross-reference now points at the clone's own
 * node, not the original's".
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { Page, Locator } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/sidebar-clone.fixture'

const { Given, When, Then } = createBdd(test)

// Per-scenario module state — BDD runs scenarios serially within a project.
let page: Page | null = null
let discovery: McpDiscovery | null = null
let rootFolderId: string | null = null

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

interface FolderEntry { id: string; name: string; kind: 'folder' | 'env-folder'; parentId: string | null }
interface RequestEntry { id: string; name: string; protocol: string; parentId: string }
interface ScenarioEntry { id: string; name: string; path: string; parentId: string | null }
interface ScenarioGraph {
  id: string
  name: string
  nodes: { id: string; kind: string; config: Record<string, unknown> }[]
  edges: { id: string; from: { nodeId: string; portId: string }; to: { nodeId: string; portId: string } }[]
}

async function mcpCall(currentDiscovery: McpDiscovery, callMcpTool: McpServerTestFixtures['callMcpTool'], name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const reply = await callMcpTool(currentDiscovery, name, args)
  expect(reply.isError ?? false).toBe(false)
  return parsedReply(reply)
}

// Only used for the type of `callMcpTool` above — avoids re-declaring the
// fixture's function signature by hand.
interface McpServerTestFixtures { callMcpTool: (d: McpDiscovery, n: string, a?: Record<string, unknown>) => Promise<McpToolReply> }

Given('I launch restorm with the MCP server enabled', async ({ launchAppWithMcp }) => {
  const launched = await launchAppWithMcp()
  page = launched.page
  discovery = launched.discovery
  rootFolderId = null
})

Given('I create a fresh project via MCP', async ({ callMcpTool, sidebarCloneTempDir }) => {
  if (!discovery) throw new Error('launch first')
  const filePath = join(sidebarCloneTempDir, 'sidebar-clone-e2e.restorm')
  await mcpCall(discovery, callMcpTool, 'create_project', { filePath })
  if (!page) throw new Error('launch first')
  await page.waitForSelector('[data-testid="sidebar-splitview"]', { timeout: 15_000 })
})

/** The shared root env-folder scenario 1/2 hang their fixtures off — created
 * lazily so scenarios that never need it (none currently do independently
 * of scenario 3's own root) don't pay for it. */
async function ensureRootFolder(callMcpTool: McpServerTestFixtures['callMcpTool']): Promise<string> {
  if (rootFolderId) return rootFolderId
  if (!discovery) throw new Error('launch first')
  const created = await mcpCall(discovery, callMcpTool, 'create_folder', { name: 'Root', kind: 'env-folder' }) as { id: string }
  rootFolderId = created.id
  return rootFolderId
}

Given('I build a request {string} via MCP', async ({ callMcpTool }, requestName: string) => {
  if (!discovery) throw new Error('launch first')
  const parentFolderId = await ensureRootFolder(callMcpTool)
  await mcpCall(discovery, callMcpTool, 'create_request', { parentFolderId, name: requestName, protocol: 'http' })
  // The sidebar reflects MCP writes without a reload, but give the reactive
  // store + tree a beat before the next UI step reads from it.
  if (!page) throw new Error('launch first')
  await page.waitForTimeout(300)
})

Given(
  'I save a quick config named {string} on the request {string} via MCP',
  async ({ callMcpTool }, configName: string, requestName: string) => {
    if (!discovery) throw new Error('launch first')
    const parentFolderId = await ensureRootFolder(callMcpTool)
    const requests = await mcpCall(discovery, callMcpTool, 'list_requests', { folderId: parentFolderId }) as RequestEntry[]
    const request = requests.find((r) => r.name === requestName)
    if (!request) throw new Error(`request "${requestName}" not found under root folder`)
    await mcpCall(discovery, callMcpTool, 'add_quick_config', {
      requestId: request.id,
      name: configName,
      storageTarget: 'project',
      fields: { url: 'https://example.com' }
    })
  }
)

Then(
  'the cloned request {string} should have its own quick config {string}, with a fresh id owned by the clone',
  async ({ callMcpTool }, clonedRequestName: string, configName: string) => {
    if (!discovery) throw new Error('launch first')
    const parentFolderId = await ensureRootFolder(callMcpTool)
    const originalName = clonedRequestName.replace(/ \(copy\)$/, '')
    const requests = await mcpCall(discovery, callMcpTool, 'list_requests', { folderId: parentFolderId }) as RequestEntry[]
    const original = requests.find((r) => r.name === originalName)
    const clone = requests.find((r) => r.name === clonedRequestName)
    if (!clone) throw new Error(`cloned request "${clonedRequestName}" not found`)
    if (!original) throw new Error(`original request "${originalName}" not found`)
    const cloneResult = await mcpCall(discovery, callMcpTool, 'list_quick_configs', { requestId: clone.id }) as { configs: { id: string, name: string, requestId: string }[] }
    const originalResult = await mcpCall(discovery, callMcpTool, 'list_quick_configs', { requestId: original.id }) as { configs: { id: string, name: string, requestId: string }[] }
    expect(cloneResult.configs.map((c) => c.name)).toContain(configName)
    const cloneConfig = cloneResult.configs.find((c) => c.name === configName)
    const originalConfig = originalResult.configs.find((c) => c.name === configName)
    if (!cloneConfig || !originalConfig) throw new Error('quick config missing on clone or original')
    expect(cloneConfig.id).not.toBe(originalConfig.id)
    expect(cloneConfig.requestId).toBe(clone.id)
    expect(cloneConfig.requestId).not.toBe(original.id)
  }
)

Then(
  'the request {string} should still have its quick config {string}',
  async ({ callMcpTool }, requestName: string, configName: string) => {
    if (!discovery) throw new Error('launch first')
    const parentFolderId = await ensureRootFolder(callMcpTool)
    const requests = await mcpCall(discovery, callMcpTool, 'list_requests', { folderId: parentFolderId }) as RequestEntry[]
    const request = requests.find((r) => r.name === requestName)
    if (!request) throw new Error(`request "${requestName}" not found`)
    const result = await mcpCall(discovery, callMcpTool, 'list_quick_configs', { requestId: request.id }) as { configs: { name: string }[] }
    expect(result.configs.map((c) => c.name)).toContain(configName)
  }
)

Given('I build the recursive-clone fixture env-folder {string} via MCP', async ({ callMcpTool }, envFolderName: string) => {
  if (!discovery) throw new Error('launch first')
  const envFolder = await mcpCall(discovery, callMcpTool, 'create_folder', { name: envFolderName, kind: 'env-folder' }) as { id: string }
  await mcpCall(discovery, callMcpTool, 'create_environment', { envFolderId: envFolder.id, name: 'Local' })
  await mcpCall(discovery, callMcpTool, 'create_custom_value_list', {
    folderId: envFolder.id, name: 'Couleur', entries: [{ label: 'Rouge', value: 'FF0000' }]
  })
  // No dedicated MCP tool creates an EnumDefinition (they normally arrive
  // via a Swagger/OpenAPI import); `update_folder` whitelists
  // `enumDefinitions` as a directly-patchable field, so seed one the same
  // way the app itself would end up storing it after an import.
  await mcpCall(discovery, callMcpTool, 'update_folder', {
    id: envFolder.id,
    patch: { enumDefinitions: [{ id: 'enum-seed-status', name: 'Status', values: ['available', 'pending', 'sold'], matchingRules: [] }] }
  })
  const subFolder = await mcpCall(discovery, callMcpTool, 'create_folder', { name: 'Pets', parentId: envFolder.id }) as { id: string }
  await mcpCall(discovery, callMcpTool, 'create_request', { parentFolderId: subFolder.id, name: 'Find pet', protocol: 'http' })

  // Sibling scenarios: "Target" (empty) and "Caller" (one runScenario node
  // pointing at Target) — the config.scenarioId cross-reference path.
  const target = await mcpCall(discovery, callMcpTool, 'create_scenario', { parentId: envFolder.id, name: 'Target' }) as { id: string }
  const caller = await mcpCall(discovery, callMcpTool, 'create_scenario', { parentId: envFolder.id, name: 'Caller' }) as { id: string }
  await mcpCall(discovery, callMcpTool, 'create_scenario_node', {
    scenarioId: caller.id, kind: 'runScenario', config: { scenarioId: target.id }
  })

  // A third scenario with a socketioConnect/socketioClose pair — the
  // config.connectionNodeId cross-reference path (23 node kinds share this
  // shape; socketio is the representative case).
  const socketScenario = await mcpCall(discovery, callMcpTool, 'create_scenario', { parentId: envFolder.id, name: 'SocketScenario' }) as { id: string }
  const connectNode = await mcpCall(discovery, callMcpTool, 'create_scenario_node', {
    scenarioId: socketScenario.id, kind: 'socketioConnect'
  }) as { nodeId: string }
  await mcpCall(discovery, callMcpTool, 'create_scenario_node', {
    scenarioId: socketScenario.id, kind: 'socketioClose', config: { connectionNodeId: connectNode.nodeId }
  })

  if (!page) throw new Error('launch first')
  await page.waitForTimeout(300)
})

// ---------------------------------------------------------------------------
// UI: generic sidebar Clone / rename / content assertions
// (mirrors full-workflow.steps.ts's conventions — see that file for the
// selectors this is modelled on; duplicated here because each BDD suite's
// steps are self-contained, not shared across projects)
// ---------------------------------------------------------------------------

async function clickContextMenuItem(currentPage: Page, pattern: RegExp): Promise<void> {
  const item = currentPage.locator('[role="menuitem"]').filter({ hasText: pattern }).first()
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.click()
}

/** Find a sidebar row by the *exact* title of its `.list-view-title` span. */
function sidebarRowByTitle(currentPage: Page, title: string): Locator {
  return currentPage
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: currentPage.getByText(title, { exact: true }) })
    .first()
}

async function clearAndType(currentPage: Page, locator: Locator, text: string): Promise<void> {
  await locator.click()
  await currentPage.keyboard.press('Control+a')
  await currentPage.keyboard.press('Backspace')
  await currentPage.keyboard.type(text)
}

When('I clone the sidebar item {string}', async ({}, itemName: string) => {
  if (!page) throw new Error('app must be launched')
  const row = sidebarRowByTitle(page, itemName)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click({ button: 'right' })
  await page.waitForTimeout(200)
  await clickContextMenuItem(page, /Clone|Cloner/)
  await page.waitForTimeout(300)
})

When(
  'I rename {string} to {string} in the sidebar',
  async ({}, oldName: string, newName: string) => {
    if (!page) throw new Error('app must be launched')
    const row = sidebarRowByTitle(page, oldName)
    await expect(row).toBeVisible({ timeout: 5000 })
    await row.click()
    await page.keyboard.press('F2')
    const input = page.locator('[data-testid="sidebar-listview"] input[type="text"]').first()
    await expect(input).toBeVisible({ timeout: 5000 })
    await clearAndType(page, input, newName)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
  }
)

Then(
  'the sidebar should contain the request {string}',
  async ({}, requestName: string) => {
    if (!page) throw new Error('app must be launched')
    const row = page.locator('[data-testid="sidebar-listview"] .list-view-title', { hasText: requestName }).first()
    await expect(row).toBeVisible({ timeout: 10000 })
  }
)

Then(
  'the sidebar should contain the folder {string}',
  async ({}, folderName: string) => {
    if (!page) throw new Error('app must be launched')
    const row = page.locator('[data-testid="sidebar-listview"] .list-view-title', { hasText: folderName }).first()
    await expect(row).toBeVisible({ timeout: 10000 })
  }
)

When('I save the file with Ctrl+S', async () => {
  if (!page) throw new Error('app must be launched')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(500)
})

When('I open the search bar', async () => {
  if (!page) throw new Error('app must be launched')
  const closed = page.locator('[data-testid="main-titlebar-searchbar-closed"]').first()
  await expect(closed).toBeVisible({ timeout: 5000 })
  await closed.click({ force: true })
  await expect(page.locator('[data-testid="main-titlebar-searchbar-open"]').first()).toBeVisible({ timeout: 5000 })
})

When('I close the search bar', async () => {
  if (!page) throw new Error('app must be launched')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-testid="main-titlebar-searchbar-closed"]').first()).toBeVisible({ timeout: 5000 })
})

When('I search for {string}', async ({}, query: string) => {
  if (!page) throw new Error('app must be launched')
  const input = page.locator('[data-testid="main-titlebar-searchbar-inputbox-input"]').first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(query)
  await page.waitForSelector('[data-testid="main-titlebar-searchbar"][data-results-count]', { timeout: 5000 })
})

Then(
  'the title-bar search results should contain hits mentioning {string} and {string} as distinct entries',
  async ({}, needleA: string, needleB: string) => {
    if (!page) throw new Error('app must be launched')
    const results = page.locator(
      '[data-testid="main-titlebar-searchbar-results"] [data-testid^="main-titlebar-searchbar-result-"]'
    )
    const hitA = results.filter({ hasText: needleA })
    const hitB = results.filter({ hasText: needleB })
    await expect(hitA.first()).toBeVisible({ timeout: 10000 })
    await expect(hitB.first()).toBeVisible({ timeout: 10000 })
    // Two DISTINCT rows, not one row matching both needles (a merged /
    // duplicate entry) and not the same row counted twice.
    const hitAHandle = await hitA.first().elementHandle()
    const hitBHandle = await hitB.first().elementHandle()
    const sameElement = await hitAHandle.evaluate((a, b) => a === b, hitBHandle)
    expect(sameElement).toBe(false)
  }
)

// ---------------------------------------------------------------------------
// Deep MCP verification of the recursive-clone fixture
// ---------------------------------------------------------------------------

/** All root folders currently in the project, by name. Used to resolve the
 * clone's + the renamed original's ids without any UI-side id tracking. */
async function folderIdByName(discoveryArg: McpDiscovery, callMcpTool: McpServerTestFixtures['callMcpTool'], name: string): Promise<string> {
  const folders = await mcpCall(discoveryArg, callMcpTool, 'list_folders', {}) as FolderEntry[]
  const found = folders.find((f) => f.name === name)
  if (!found) throw new Error(`folder "${name}" not found (have: ${folders.map((f) => f.name).join(', ')})`)
  return found.id
}

async function scenarioByPath(discoveryArg: McpDiscovery, callMcpTool: McpServerTestFixtures['callMcpTool'], envFolderName: string, scenarioName: string): Promise<ScenarioEntry> {
  const scenarios = await mcpCall(discoveryArg, callMcpTool, 'list_scenarios', {}) as ScenarioEntry[]
  const found = scenarios.find((s) => s.path.startsWith(`${envFolderName} / `) && s.name === scenarioName)
  if (!found) throw new Error(`scenario "${scenarioName}" under "${envFolderName}" not found (have: ${scenarios.map((s) => s.path).join(', ')})`)
  return found
}

Then(
  'the cloned env-folder {string} should be a fully independent, correctly cross-referenced copy of {string}',
  async ({ callMcpTool }, cloneName: string, originalName: string) => {
    if (!discovery) throw new Error('launch first')

    // 1. The top-level folder ids differ (already proven by the sidebar +
    // search steps, re-confirmed here as the anchor for everything below).
    const originalId = await folderIdByName(discovery, callMcpTool, originalName)
    const cloneId = await folderIdByName(discovery, callMcpTool, cloneName)
    expect(cloneId).not.toBe(originalId)

    // 2. Nested request: the clone's "Pets" sub-folder holds an independent
    // request, not a reference back to the original's.
    const originalSubFolders = await mcpCall(discovery, callMcpTool, 'list_folders', { parentId: originalId }) as FolderEntry[]
    const cloneSubFolders = await mcpCall(discovery, callMcpTool, 'list_folders', { parentId: cloneId }) as FolderEntry[]
    const originalPets = originalSubFolders.find((f) => f.name === 'Pets')
    const clonePets = cloneSubFolders.find((f) => f.name === 'Pets')
    if (!originalPets || !clonePets) throw new Error('expected a "Pets" sub-folder on both sides')
    expect(clonePets.id).not.toBe(originalPets.id)
    const originalRequests = await mcpCall(discovery, callMcpTool, 'list_requests', { folderId: originalPets.id }) as RequestEntry[]
    const cloneRequests = await mcpCall(discovery, callMcpTool, 'list_requests', { folderId: clonePets.id }) as RequestEntry[]
    expect(cloneRequests).toHaveLength(originalRequests.length)
    expect(cloneRequests[0]?.id).not.toBe(originalRequests[0]?.id)

    // 3. config.scenarioId: the CLONE's "Caller" runScenario node must
    // point at the CLONE's "Target" scenario — never the original's.
    const cloneTarget = await scenarioByPath(discovery, callMcpTool, cloneName, 'Target')
    const cloneCaller = await scenarioByPath(discovery, callMcpTool, cloneName, 'Caller')
    const originalTarget = await scenarioByPath(discovery, callMcpTool, originalName, 'Target')
    const callerGraph = await mcpCall(discovery, callMcpTool, 'get_scenario', { scenarioId: cloneCaller.id }) as ScenarioGraph
    const runNode = callerGraph.nodes.find((n) => n.kind === 'runScenario')
    if (!runNode) throw new Error('expected a runScenario node in the cloned "Caller" scenario')
    expect(runNode.config['scenarioId']).toBe(cloneTarget.id)
    expect(runNode.config['scenarioId']).not.toBe(originalTarget.id)

    // 4. config.connectionNodeId: the CLONE's socketioClose node must point
    // at the CLONE's socketioConnect node — never the original's.
    const cloneSocket = await scenarioByPath(discovery, callMcpTool, cloneName, 'SocketScenario')
    const originalSocket = await scenarioByPath(discovery, callMcpTool, originalName, 'SocketScenario')
    const cloneSocketGraph = await mcpCall(discovery, callMcpTool, 'get_scenario', { scenarioId: cloneSocket.id }) as ScenarioGraph
    const originalSocketGraph = await mcpCall(discovery, callMcpTool, 'get_scenario', { scenarioId: originalSocket.id }) as ScenarioGraph
    const cloneConnect = cloneSocketGraph.nodes.find((n) => n.kind === 'socketioConnect')
    const cloneClose = cloneSocketGraph.nodes.find((n) => n.kind === 'socketioClose')
    const originalConnect = originalSocketGraph.nodes.find((n) => n.kind === 'socketioConnect')
    if (!cloneConnect || !cloneClose || !originalConnect) throw new Error('expected a connect/close pair on both sides')
    expect(cloneClose.config['connectionNodeId']).toBe(cloneConnect.id)
    expect(cloneClose.config['connectionNodeId']).not.toBe(originalConnect.id)
  }
)

When('I alter the original\'s socketioConnect node via MCP', async ({ callMcpTool }) => {
  if (!discovery) throw new Error('launch first')
  const originalSocket = await scenarioByPath(discovery, callMcpTool, 'PetshopRenamed', 'SocketScenario')
  const graph = await mcpCall(discovery, callMcpTool, 'get_scenario', { scenarioId: originalSocket.id }) as ScenarioGraph
  const connectNode = graph.nodes.find((n) => n.kind === 'socketioConnect')
  if (!connectNode) throw new Error('expected a socketioConnect node on the original')
  await mcpCall(discovery, callMcpTool, 'update_scenario_node', {
    scenarioId: originalSocket.id, nodeId: connectNode.id, note: 'altered after clone'
  })
})

Then(
  "the cloned scenario's socketioClose node should still resolve to the CLONE's own connect node, unaffected by that change",
  async ({ callMcpTool }) => {
    if (!discovery) throw new Error('launch first')
    const cloneSocket = await scenarioByPath(discovery, callMcpTool, 'Petshop (copy)', 'SocketScenario')
    const graph = await mcpCall(discovery, callMcpTool, 'get_scenario', { scenarioId: cloneSocket.id }) as ScenarioGraph
    const connectNode = graph.nodes.find((n) => n.kind === 'socketioConnect')
    const closeNode = graph.nodes.find((n) => n.kind === 'socketioClose')
    if (!connectNode || !closeNode) throw new Error('expected a connect/close pair on the clone')
    // The clone's connect node was never touched by the "alter the
    // original" step above — its own connectionNodeId reference still
    // resolves, and (checked for completeness) it carries no trace of the
    // note we wrote onto the ORIGINAL's connect node.
    expect(closeNode.config['connectionNodeId']).toBe(connectNode.id)
    expect(connectNode.config['note']).not.toBe('altered after clone')
  }
)
