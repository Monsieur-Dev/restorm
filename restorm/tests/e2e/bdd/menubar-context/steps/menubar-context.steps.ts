import { createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import { join } from 'path'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const bdd = createBdd(test)
const { Given, When, Then } = bdd

/** Per-scenario state — reset by each Given (playwright-bdd runs scenarios
 * sequentially within the worker, and every Given launches a fresh app). */
let page: Page | null = null
let discovery: McpDiscovery | null = null
let requestId: string | null = null
let serverId: string | null = null
let scenarioId: string | null = null
let folderId: string | null = null

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

async function callOk(
  callMcpTool: (d: McpDiscovery, name: string, args?: Record<string, unknown>) => Promise<McpToolReply>,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (!discovery) throw new Error('launch the app first')
  const reply = await callMcpTool(discovery, name, args)
  expect(reply.isError ?? false, `${name} replied: ${JSON.stringify(reply)}`).toBe(false)
  return parsedReply(reply)
}

/** A plain MCP write. The artificial 500 ms pacing that used to follow each
 * write is gone: it worked around the main↔renderer mirror clobber where a
 * stale renderer echo (stamped the same model version as the pre-mutation tree)
 * overwrote a fresh mutation. That is now fixed at the root — every scenario
 * mutation bumps the model version immediately, so an in-flight stale echo is
 * strictly older and refused. Writes no longer need to be spaced out. */
async function pacedWrite(
  callMcpTool: (d: McpDiscovery, name: string, args?: Record<string, unknown>) => Promise<McpToolReply>,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return callOk(callMcpTool, name, args)
}

/** Poll until the listing tool reports the ids — the renderer→main mirror is
 * still asynchronous, so a same-tick follow-up read can briefly precede it. The
 * former double-read-with-settle (which guarded against a stale echo WIPING the
 * item after it appeared) is gone: that clobber is fixed at the root, so once an
 * item is listed it stays listed. */
async function waitForItemsVisible(
  callMcpTool: (d: McpDiscovery, name: string, args?: Record<string, unknown>) => Promise<McpToolReply>,
  listTool: 'list_requests' | 'list_scenarios' | 'list_folders',
  ids: string[]
): Promise<void> {
  await expect(async () => {
    const listed = await callOk(callMcpTool, listTool, {}) as { id: string }[] | { scenarios?: { id: string }[] }
    const rows = Array.isArray(listed) ? listed : (listed.scenarios ?? [])
    expect(ids.every((id) => rows.some((r) => r.id === id)), `${listTool} should list ${ids.join(', ')}`).toBe(true)
  }).toPass({ timeout: 15_000 })
}

/** Widen the window so the menu bar sits in `full` mode — the contextual
 * menus then assert directly on their in-bar testids, with the `-overflow`
 * twins double-checked to cover a squeezed layout. */
async function launchWide(launchAppWithMcp: () => Promise<{ app: { evaluate: (fn: never) => Promise<unknown> }; page: Page; discovery: McpDiscovery }>): Promise<void> {
  const launched = await launchAppWithMcp()
  page = launched.page
  discovery = launched.discovery
  await (launched.app as unknown as { evaluate: (fn: (electron: { BrowserWindow: { getAllWindows: () => { setBounds: (b: { x: number; y: number; width: number; height: number }) => void }[] } }) => void) => Promise<void> }).evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1880, height: 1000 })
  })
  await page.waitForTimeout(500)
}

/** A contextual menu exists iff its in-bar item OR its overflow twin does. */
async function contextualMenuCount(kind: 'request' | 'server' | 'scenario'): Promise<number> {
  if (!page) throw new Error('app not launched')
  const inBar = await page.locator(`[data-testid="titlebar-menubar-item-${kind}"]`).count()
  const overflowed = await page.locator(`[data-testid="titlebar-menubar-item-${kind}-overflow"]`).count()
  return inBar + overflowed
}

async function expectOnlyContextualMenu(shown: 'request' | 'server' | 'scenario' | null): Promise<void> {
  for (const kind of ['request', 'server', 'scenario'] as const) {
    const expected = kind === shown ? 1 : 0
    await expect(async () => {
      expect(await contextualMenuCount(kind), `menu "${kind}" presence`).toBe(expected)
    }).toPass({ timeout: 10_000 })
  }
}

Given(
  'a project holding a request, a server and a scenario is open',
  async ({ launchAppWithMcp, callMcpTool, mcpServerTempDir }) => {
    await launchWide(launchAppWithMcp)
    await pacedWrite(callMcpTool, 'create_project', { filePath: join(mcpServerTempDir, 'menubar-context.restorm') })
    requestId = (await pacedWrite(callMcpTool, 'create_request', { name: 'Client request', protocol: 'http' }) as { id: string }).id
    serverId = (await pacedWrite(callMcpTool, 'create_request', { name: 'Mock server', protocol: 'http' }) as { id: string }).id
    await pacedWrite(callMcpTool, 'update_request', { id: serverId, patch: { server: true } })
    scenarioId = (await pacedWrite(callMcpTool, 'create_scenario', { name: 'Context scenario' }) as { id: string }).id
    await waitForItemsVisible(callMcpTool, 'list_requests', [requestId, serverId])
    await waitForItemsVisible(callMcpTool, 'list_scenarios', [scenarioId])
  }
)

Then('no contextual menu is shown', async () => {
  await expectOnlyContextualMenu(null)
})

When('the request tab is activated', async ({ callMcpTool }) => {
  if (!requestId) throw new Error('create the request first')
  // The item lands in the tab-opening path only after the renderer echo —
  // retry the open until the id resolves.
  await expect(async () => {
    await callOk(callMcpTool, 'open_tab', { itemId: requestId })
  }).toPass({ timeout: 10_000 })
})

Then('only the request contextual menu is shown', async () => {
  await expectOnlyContextualMenu('request')
})

When('the server tab is activated', async ({ callMcpTool }) => {
  if (!serverId) throw new Error('create the server first')
  // The item lands in the tab-opening path only after the renderer echo —
  // retry the open until the id resolves.
  await expect(async () => {
    await callOk(callMcpTool, 'open_tab', { itemId: serverId })
  }).toPass({ timeout: 10_000 })
})

Then('only the server contextual menu is shown', async () => {
  await expectOnlyContextualMenu('server')
})

When('the scenario tab is activated', async ({ callMcpTool }) => {
  if (!scenarioId) throw new Error('create the scenario first')
  // The item lands in the tab-opening path only after the renderer echo —
  // retry the open until the id resolves.
  await expect(async () => {
    await callOk(callMcpTool, 'open_tab', { itemId: scenarioId })
  }).toPass({ timeout: 10_000 })
})

Then('only the scenario contextual menu is shown', async () => {
  await expectOnlyContextualMenu('scenario')
})

// ───────────────────────────────────────────────────────────────────
// Container deletion guard
// ───────────────────────────────────────────────────────────────────

Given(
  'a project where a folder holds a request bound by an outside scenario',
  async ({ launchAppWithMcp, callMcpTool, mcpServerTempDir }) => {
    await launchWide(launchAppWithMcp)
    await pacedWrite(callMcpTool, 'create_project', { filePath: join(mcpServerTempDir, 'container-delete.restorm') })
    folderId = (await pacedWrite(callMcpTool, 'create_folder', { name: 'Doomed folder', kind: 'folder' }) as { id: string }).id
    requestId = (await pacedWrite(callMcpTool, 'create_request', { name: 'Bound request', protocol: 'http', parentFolderId: folderId }) as { id: string }).id
    scenarioId = (await pacedWrite(callMcpTool, 'create_scenario', { name: 'Outside scenario' }) as { id: string }).id
    await waitForItemsVisible(callMcpTool, 'list_scenarios', [scenarioId])
    await pacedWrite(callMcpTool, 'create_scenario_node', { scenarioId, kind: 'httpRequest', config: { requestId } })
    // The deletion guard reads the RENDERER tree — wait until the binding
    // box has echoed through before driving the UI.
    await expect(async () => {
      const nodes = (await callOk(callMcpTool, 'list_scenario_nodes', { scenarioId }) as { nodes?: { kind?: string }[] }).nodes ?? []
      expect(nodes.some((n) => n.kind === 'httpRequest')).toBe(true)
    }).toPass({ timeout: 10_000 })
    await page?.waitForTimeout(800)
  }
)

Given(
  'a project where a folder holds both a request and the scenario binding it',
  async ({ launchAppWithMcp, callMcpTool, mcpServerTempDir }) => {
    await launchWide(launchAppWithMcp)
    await pacedWrite(callMcpTool, 'create_project', { filePath: join(mcpServerTempDir, 'container-delete-self.restorm') })
    folderId = (await pacedWrite(callMcpTool, 'create_folder', { name: 'Self-contained folder', kind: 'folder' }) as { id: string }).id
    requestId = (await pacedWrite(callMcpTool, 'create_request', { name: 'Inner request', protocol: 'http', parentFolderId: folderId }) as { id: string }).id
    scenarioId = (await pacedWrite(callMcpTool, 'create_scenario', { name: 'Inner scenario', parentId: folderId }) as { id: string }).id
    await waitForItemsVisible(callMcpTool, 'list_scenarios', [scenarioId])
    await pacedWrite(callMcpTool, 'create_scenario_node', { scenarioId, kind: 'httpRequest', config: { requestId } })
    await expect(async () => {
      const nodes = (await callOk(callMcpTool, 'list_scenario_nodes', { scenarioId }) as { nodes?: { kind?: string }[] }).nodes ?? []
      expect(nodes.some((n) => n.kind === 'httpRequest')).toBe(true)
    }).toPass({ timeout: 10_000 })
    await page?.waitForTimeout(800)
  }
)

When('the folder is deleted from the Edition menu', async () => {
  if (!page || !folderId) throw new Error('create the folder first')
  await page.locator(`[data-item-id="${folderId}"] .list-view-title`).click()
  await page.locator('[data-testid="titlebar-menubar-item-edit"]').click({ force: true })
  const deleteEntry = page.locator('[data-testid="titlebar-menu-item-delete"]')
  await deleteEntry.waitFor({ state: 'visible', timeout: 5000 })
  await deleteEntry.click()
})

When('the folder deletion is confirmed', async () => {
  if (!page) throw new Error('app not launched')
  const confirmBtn = page.locator('[data-testid="delete-confirmation-confirm-button"]')
  await confirmBtn.waitFor({ state: 'visible', timeout: 5000 })
  await confirmBtn.click()
})

Then('the used-by-scenarios dialog shows up for the bound request', async () => {
  if (!page) throw new Error('app not launched')
  await expect(page.locator('[data-testid="request-scenario-delete-modal"]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-testid="request-scenario-delete-modal"]')).toContainText('Bound request')
})

When('the request deletion is confirmed anyway', async () => {
  if (!page) throw new Error('app not launched')
  await page.locator('[data-testid="request-scenario-delete-confirm-button"]').click()
})

Then('the folder is gone and the scenario box was stripped', async ({ callMcpTool }) => {
  if (!page || !folderId || !scenarioId) throw new Error('set the fixture up first')
  await expect(page.locator(`[data-item-id="${folderId}"]`)).toHaveCount(0, { timeout: 5000 })
  const nodes = (await callOk(callMcpTool, 'list_scenario_nodes', { scenarioId }) as { nodes?: { kind?: string }[] }).nodes ?? []
  expect(nodes.some((n) => n.kind === 'httpRequest'), 'the binding box should have been stripped').toBe(false)
})

Then('the folder is gone without any used-by-scenarios dialog', async () => {
  if (!page || !folderId) throw new Error('set the fixture up first')
  await expect(page.locator(`[data-item-id="${folderId}"]`)).toHaveCount(0, { timeout: 5000 })
  await expect(page.locator('[data-testid="request-scenario-delete-modal"]')).toHaveCount(0)
})
