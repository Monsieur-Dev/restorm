/**
 * Steps for the `graphql-operation-name` BDD scenarios — drives the real
 * GraphQL request panel (no live server needed) to prove the multi-operation
 * `operationName` selector: it appears with one entry per parsed operation,
 * the user's pick persists on the request (read back via `get_request`), and a
 * single-operation document shows no selector. Reuses the MCP fixture to launch
 * restorm and to create/patch the request entirely through MCP tools.
 */

import { createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import {
  selectBoxTriggerSelector,
  selectBoxDropdownSelector,
  selectBoxOptionSelector,
  selectBoxOptionLabelSelector
} from 'electron-core-ui/testing'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestId = ''

const SELECT_TESTID = 'graphql-operation-name-select'
const SELECT_HOST = '[data-testid="graphql-operation-name-host"]'
const URL_INPUT = '[data-testid="graphql-url-input"]'

// The operation names declared by MULTI_OP_DOCUMENT, in source order. The
// SelectBox option testid index mirrors this order, so name → index lets us
// target a dropdown option by its testid instead of by visible text (the op
// names also appear in the Monaco query editor, so a text match would be
// ambiguous).
const MULTI_OP_NAMES = ['GetUser', 'ListUsers', 'CreateUser'] as const

const MULTI_OP_DOCUMENT = [
  'query GetUser($id: ID!) { user(id: $id) { id name } }',
  'query ListUsers { users { id } }',
  'mutation CreateUser($name: String!) { createUser(name: $name) { id } }'
].join('\n\n')

const SINGLE_OP_DOCUMENT = 'query OnlyUser { user { id } }'

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

/**
 * True when a request with `id` is currently present in the renderer's
 * collection (read via `list_requests`). Used to confirm a freshly-created
 * request survived the late empty-project load.
 */
async function listHasRequest(
  callMcpTool: (d: McpDiscovery, n: string, a?: Record<string, unknown>) => Promise<McpToolReply>,
  id: string
): Promise<boolean> {
  if (discovery === null) throw new Error('launch first')
  const lr = parsedReply(await callMcpTool(discovery, 'list_requests', {})) as
    | { id: string }[]
    | { requests?: { id: string }[] }
  const arr = Array.isArray(lr) ? lr : (lr.requests ?? [])
  return arr.some((r) => r.id === id)
}

Given('I launch restorm with the MCP server enabled', async ({ launchAppWithMcp }) => {
  const launched = await launchAppWithMcp()
  discovery = launched.discovery
  page = launched.page
  requestId = ''
})

Given('I create a GraphQL request with a multi-operation document via MCP', async ({ callMcpTool }) => {
  if (discovery === null || page === null) throw new Error('launch first')
  const disco = discovery
  const pg = page

  // Fresh project so the request lands in a real, open collection. `create_project`
  // opens the empty file ASYNCHRONOUSLY in the renderer (its React tree is the save
  // source of truth). A `create_request` that races the still-in-flight empty-project
  // load lands in the main store, then the late load flushes the renderer's empty tree
  // back and WIPES it — so `open_tab` would target an item the renderer can't resolve
  // and the panel never renders. There is no settle event to await: create + populate,
  // then poll `list_requests` until the request stays present across several
  // consecutive reads (the late load has passed), re-creating if an early attempt was
  // wiped.
  const projectPath = `/tmp/gql-opname-e2e-${String(Date.now())}.restorm`
  expect((await callMcpTool(disco, 'create_project', { filePath: projectPath })).isError ?? false).toBe(false)

  const deadline = Date.now() + 20_000
  let stable = false
  while (Date.now() < deadline && !stable) {
    const folder = parsedReply(await callMcpTool(disco, 'create_folder', { name: 'GraphQL Ops' })) as { id: string }
    expect(folder.id).toBeTruthy()
    const created = parsedReply(await callMcpTool(disco, 'create_request', {
      parentFolderId: folder.id,
      name: 'Multi-op GraphQL',
      protocol: 'graphql'
    })) as { id: string }
    expect(created.id, 'request id missing').toBeTruthy()
    requestId = created.id
    expect((await callMcpTool(disco, 'update_request', {
      id: requestId,
      patch: { query: MULTI_OP_DOCUMENT }
    })).isError ?? false).toBe(false)

    // Confirm it survives the late empty-project load: 4 consecutive present reads.
    let consecutive = 0
    while (Date.now() < deadline && consecutive < 4) {
      if (await listHasRequest(callMcpTool, requestId)) {
        consecutive++
      } else {
        consecutive = 0
        break // wiped — recreate from the top
      }
      await pg.waitForTimeout(250)
    }
    stable = consecutive >= 4
  }
  expect(stable, 'request never stabilised after create_project').toBe(true)
})

When('I replace the GraphQL document with a single operation via MCP', async ({ callMcpTool }) => {
  if (discovery === null) throw new Error('create the request first')
  const updated = await callMcpTool(discovery, 'update_request', {
    id: requestId,
    patch: { query: SINGLE_OP_DOCUMENT }
  })
  expect(updated.isError ?? false).toBe(false)
})

When('I open the GraphQL request tab via MCP', async ({ callMcpTool }) => {
  if (discovery === null || page === null) throw new Error('create the request first')
  const tab = await callMcpTool(discovery, 'open_tab', { itemId: requestId })
  expect(tab.isError ?? false).toBe(false)
  // The panel is up once the URL input is rendered.
  await page.locator(URL_INPUT).first().waitFor({ state: 'visible', timeout: 20_000 })
})

When('I select the GraphQL operation {string}', async ({}, name: string) => {
  if (page === null) throw new Error('open the tab first')
  const index = MULTI_OP_NAMES.indexOf(name as typeof MULTI_OP_NAMES[number])
  expect(index, `"${name}" is not one of the multi-op names`).toBeGreaterThanOrEqual(0)
  // Open the dropdown, then click the option BY TESTID scoped to the dropdown
  // container — never by visible text, since the op names also render in the
  // Monaco query editor and would be ambiguous.
  await page.locator(selectBoxTriggerSelector(SELECT_TESTID)).first().click()
  const dropdown = page.locator(selectBoxDropdownSelector(SELECT_TESTID))
  await expect(dropdown).toBeVisible({ timeout: 5_000 })
  await dropdown.locator(selectBoxOptionSelector(SELECT_TESTID, index)).click()
})

Then(
  'the GraphQL operation selector lists {string}, {string} and {string}',
  async ({}, a: string, b: string, c: string) => {
    if (page === null) throw new Error('open the tab first')
    const trigger = page.locator(selectBoxTriggerSelector(SELECT_TESTID)).first()
    await expect(trigger).toBeVisible({ timeout: 15_000 })
    await trigger.click()
    const dropdown = page.locator(selectBoxDropdownSelector(SELECT_TESTID))
    await expect(dropdown).toBeVisible({ timeout: 5_000 })
    // Assert each option's label BY TESTID inside the dropdown — the option
    // index mirrors MULTI_OP_NAMES, so this can't match the Monaco editor text.
    for (const name of [a, b, c]) {
      const index = MULTI_OP_NAMES.indexOf(name as typeof MULTI_OP_NAMES[number])
      expect(index, `"${name}" is not one of the multi-op names`).toBeGreaterThanOrEqual(0)
      await expect(
        dropdown.locator(selectBoxOptionLabelSelector(SELECT_TESTID, index))
      ).toHaveText(name, { timeout: 5_000 })
    }
    // Close the dropdown so it doesn't bleed into the next step.
    await page.keyboard.press('Escape')
  }
)

Then('the GraphQL operation selector is not shown', async () => {
  if (page === null) throw new Error('open the tab first')
  await expect(page.locator(SELECT_HOST)).toHaveCount(0)
})

Then('the persisted GraphQL request operationName is {string}', async ({ callMcpTool }, expected: string) => {
  if (discovery === null) throw new Error('create the request first')
  const disco = discovery
  await expect.poll(async () => {
    const req = parsedReply(await callMcpTool(disco, 'get_request', { id: requestId })) as { operationName?: string }
    return req.operationName ?? null
  }, { timeout: 10_000 }).toBe(expected)
})

Then('the persisted GraphQL request operationName is cleared', async ({ callMcpTool }) => {
  if (discovery === null) throw new Error('create the request first')
  const disco = discovery
  await expect.poll(async () => {
    const req = parsedReply(await callMcpTool(disco, 'get_request', { id: requestId })) as { operationName?: string }
    return req.operationName ?? null
  }, { timeout: 10_000 }).toBeNull()
})
