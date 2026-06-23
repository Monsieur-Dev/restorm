/**
 * Steps for the `quick-settings` BDD scenarios — the exhaustive save/load
 * regression lock for the request quick-config popover across EVERY protocol.
 *
 * Each scenario:
 *   1. launches restorm (MCP on by default) and creates a fresh request,
 *   2. POPULATES every editable field with distinctive saved values (via MCP
 *      `update_request` — the same data-layer mutation the editor performs),
 *   3. opens the tab, opens the quick-settings popover and SAVES a named config,
 *   4. CHANGES every field to a different value,
 *   5. opens the popover and LOADS the saved config,
 *   6. asserts the RENDERED EDITOR (KeyValueTable rows, MQTT inputs, gRPC
 *      metadata table, Auth produced-headers table, url containers, Monaco
 *      editors) shows the originally-saved values — NOT the data model.
 *
 * Asserting the editor DOM (not the model) is the whole point: this is the half
 * that exposed the gRPC-metadata, WebSocket-headers + MQTT-panel, and
 * Auth-produced-headers re-sync gaps. A failed transport-replaced re-sync leaves
 * the editor showing the CHANGED values, which these assertions catch.
 */

import { createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let folderId = ''
let requestId = ''

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

// `:visible` → the active tab (inactive tabs stay mounted at 0×0).
const vis = (testid: string): string => `[data-testid="${testid}"]:visible`

// ---------------------------------------------------------------------------
// Per-protocol field matrix: a SAVED patch (distinctive values), a CHANGED
// patch (a different value for every editable field), and the editor-DOM
// assertions to run after Load. Keys are env-template-free so the URL's
// `data-resolved-url` equals the raw url.
// ---------------------------------------------------------------------------

interface ProtocolMatrix {
  /** MCP create_request protocol. */
  protocol: 'http' | 'graphql' | 'soap' | 'grpc' | 'odata' | 'websocket' | 'auth'
  /** Patch applied to populate the SAVED state. */
  saved: Record<string, unknown>
  /** Patch applied to CHANGE every field after the save. */
  changed: Record<string, unknown>
  /** Editor-DOM assertions: each names a surface + the saved value that must
   * be visible after Load, and (where applicable) the changed value that must
   * be gone. */
  assert: (p: Page) => Promise<void>
}

const kv = (key: string, value: string): { key: string; value: string; enabled: boolean } => ({ key, value, enabled: true })

const MATRIX: Record<string, ProtocolMatrix> = {
  http: {
    protocol: 'http',
    saved: {
      url: 'https://saved.example.com/widgets',
      method: 'PATCH',
      headers: [kv('X-Saved-Header', 'saved-hval')],
      params: [kv('savedParam', 'saved-pval')],
      body: { type: 'text', content: 'SAVED-BODY' }
    },
    changed: {
      url: 'https://changed.example.com/gizmos',
      method: 'DELETE',
      headers: [kv('X-Changed-Header', 'changed-hval')],
      params: [kv('changedParam', 'changed-pval')],
      body: { type: 'text', content: 'CHANGED-BODY' }
    },
    assert: async (p) => {
      await expect(p.locator(`${vis('http-request-url-section')} [data-testid="url-container"]`))
        .toHaveAttribute('data-resolved-url', 'https://saved.example.com/widgets', { timeout: 10_000 })
      const headers = p.locator(vis('http-request-headers-table'))
      await expect(headers).toContainText('X-Saved-Header', { timeout: 10_000 })
      await expect(headers).toContainText('saved-hval')
      await expect(headers).not.toContainText('X-Changed-Header')
      const params = p.locator(vis('http-request-query-params-table'))
      await expect(params).toContainText('savedParam')
      await expect(params).not.toContainText('changedParam')
    }
  },

  graphql: {
    protocol: 'graphql',
    saved: {
      url: 'https://saved.example.com/graphql',
      query: 'query SavedOp { savedField }',
      variables: '{"savedVar": 1}',
      headers: [kv('X-Saved-GQL', 'saved-gql')]
    },
    changed: {
      url: 'https://changed.example.com/graphql',
      query: 'query ChangedOp { changedField }',
      variables: '{"changedVar": 2}',
      headers: [kv('X-Changed-GQL', 'changed-gql')]
    },
    assert: async (p) => {
      await expect(p.locator(`${vis('graphql-url-section')} [data-testid="url-container"]`))
        .toHaveAttribute('data-resolved-url', 'https://saved.example.com/graphql', { timeout: 10_000 })
      await expect(p.locator(vis('graphql-query-editor'))).toContainText('SavedOp', { timeout: 10_000 })
      await expect(p.locator(vis('graphql-query-editor'))).not.toContainText('ChangedOp')
      await expect(p.locator(vis('graphql-variables-editor'))).toContainText('savedVar')
    }
  },

  soap: {
    protocol: 'soap',
    saved: {
      url: 'https://saved.example.com/svc',
      body: '<Envelope><Body><SavedOp/></Body></Envelope>',
      headers: [kv('X-Saved-Soap', 'saved-soap')]
    },
    changed: {
      url: 'https://changed.example.com/svc',
      body: '<Envelope><Body><ChangedOp/></Body></Envelope>',
      headers: [kv('X-Changed-Soap', 'changed-soap')]
    },
    assert: async (p) => {
      await expect(p.locator(`${vis('soap-url-section')} [data-testid="url-container"]`))
        .toHaveAttribute('data-resolved-url', 'https://saved.example.com/svc', { timeout: 10_000 })
      await expect(p.locator(vis('soap-request-body-editor'))).toContainText('SavedOp', { timeout: 10_000 })
      await expect(p.locator(vis('soap-request-body-editor'))).not.toContainText('ChangedOp')
    }
  },

  grpc: {
    protocol: 'grpc',
    saved: {
      url: 'localhost:50051',
      requestMessage: '{"savedMsg": true}',
      callType: 'unary',
      metadata: [kv('x-saved-meta', 'saved-meta-val')]
    },
    changed: {
      url: 'localhost:60061',
      requestMessage: '{"changedMsg": true}',
      callType: 'server-stream',
      metadata: [kv('x-changed-meta', 'changed-meta-val')]
    },
    // GAP A surface: the metadata table must remount on Load.
    assert: async (p) => {
      await expect(p.locator(vis('grpc-request-message-editor'))).toContainText('savedMsg', { timeout: 10_000 })
      await expect(p.locator(vis('grpc-request-message-editor'))).not.toContainText('changedMsg')
      const meta = p.locator(vis('grpc-metadata-table'))
      await expect(meta).toContainText('x-saved-meta', { timeout: 10_000 })
      await expect(meta).toContainText('saved-meta-val')
      await expect(meta).not.toContainText('x-changed-meta')
    }
  },

  odata: {
    protocol: 'odata',
    saved: {
      url: 'https://saved.example.com/odata/People',
      queryOptions: {
        filter: "Name eq 'saved'",
        top: '11',
        skip: '3',
        orderby: 'SavedField asc',
        search: 'saved-search'
      }
    },
    changed: {
      url: 'https://changed.example.com/odata/Pets',
      queryOptions: {
        filter: "Name eq 'changed'",
        top: '99',
        skip: '7',
        orderby: 'ChangedField desc',
        search: 'changed-search'
      }
    },
    assert: async (p) => {
      await expect(p.locator(`${vis('odata-request-url-section')} [data-testid="url-container"]`))
        .toHaveAttribute('data-resolved-url', 'https://saved.example.com/odata/People', { timeout: 10_000 })
      // $filter / $search are ECUI InputBoxes → the value lives on the inner <input>.
      await expect(p.locator(vis('odata-request-filter-input'))).toHaveValue("Name eq 'saved'", { timeout: 10_000 })
      await expect(p.locator(vis('odata-request-search-input'))).toHaveValue('saved-search')
    }
  },

  websocket: {
    protocol: 'websocket',
    saved: {
      url: 'wss://saved.example.com/socket',
      protocol: 'websocket',
      event: 'saved-event',
      message: '{"savedFrame": 1}',
      headers: [kv('X-Saved-WS', 'saved-ws')]
    },
    changed: {
      url: 'wss://changed.example.com/socket',
      protocol: 'websocket',
      event: 'changed-event',
      message: '{"changedFrame": 2}',
      headers: [kv('X-Changed-WS', 'changed-ws')]
    },
    // GAP B surface: the headers table must remount on Load.
    assert: async (p) => {
      await expect(p.locator(`${vis('websocket-url-section')} [data-testid="url-container"]`))
        .toHaveAttribute('data-resolved-url', 'wss://saved.example.com/socket', { timeout: 10_000 })
      // event input is a Monaco-backed VariableInputBox → assert its text.
      await expect(p.locator(vis('websocket-event-input'))).toContainText('saved-event', { timeout: 10_000 })
      await expect(p.locator(vis('websocket-message-editor'))).toContainText('savedFrame')
      const headers = p.locator(vis('websocket-headers-table'))
      await expect(headers).toContainText('X-Saved-WS', { timeout: 10_000 })
      await expect(headers).not.toContainText('X-Changed-WS')
    }
  },

  mqtt: {
    protocol: 'websocket',
    saved: {
      url: 'mqtt://saved.example.com:1883',
      protocol: 'mqtt',
      event: 'sensors/saved',
      message: 'saved-payload',
      clientId: 'saved-client',
      username: 'saved-user',
      password: 'saved-pass',
      keepalive: 33,
      lwtTopic: 'sensors/saved-status',
      lwtPayload: 'saved-offline'
    },
    changed: {
      url: 'mqtt://changed.example.com:1883',
      protocol: 'mqtt',
      event: 'sensors/changed',
      message: 'changed-payload',
      clientId: 'changed-client',
      username: 'changed-user',
      password: 'changed-pass',
      keepalive: 77,
      lwtTopic: 'sensors/changed-status',
      lwtPayload: 'changed-offline'
    },
    // GAP B (worst) surface: the MqttOptionsPanel's 11 local-useState fields
    // must reset on Load (the panel remounts via its epoch key). clientId /
    // username / password / lwt-topic / lwt-payload are Monaco-backed
    // VariableInputBoxes (assert text); keepalive is a plain InputBox (the
    // value lives on its inner <input>).
    assert: async (p) => {
      await expect(p.locator(vis('mqtt-clientid-input'))).toContainText('saved-client', { timeout: 10_000 })
      await expect(p.locator(vis('mqtt-clientid-input'))).not.toContainText('changed-client')
      await expect(p.locator(vis('mqtt-username-input'))).toContainText('saved-user')
      await expect(p.locator(vis('mqtt-password-input'))).toContainText('saved-pass')
      await expect(p.locator(vis('mqtt-keepalive-input-input'))).toHaveValue('33')
      await expect(p.locator(vis('mqtt-lwt-topic-input'))).toContainText('sensors/saved-status')
      await expect(p.locator(vis('mqtt-lwt-payload-input'))).toContainText('saved-offline')
      // event = MQTT topic; message = publish payload.
      await expect(p.locator(vis('websocket-event-input'))).toContainText('sensors/saved')
      await expect(p.locator(vis('websocket-message-editor'))).toContainText('saved-payload')
    }
  },

  auth: {
    protocol: 'auth',
    saved: {
      method: 'POST',
      url: 'https://saved.example.com/token',
      headers: [kv('X-Saved-Auth', 'saved-auth')],
      body: { type: 'text', content: '{"saved":"creds"}' },
      producedHeaders: [kv('Authorization', 'Saved {{access_token}}')],
      expirationExpression: '{{saved_expires}}',
      authErrorCodes: [401, 403, 419]
    },
    changed: {
      method: 'PUT',
      url: 'https://changed.example.com/token',
      headers: [kv('X-Changed-Auth', 'changed-auth')],
      body: { type: 'text', content: '{"changed":"creds"}' },
      producedHeaders: [kv('Authorization', 'Changed {{access_token}}')],
      expirationExpression: '{{changed_expires}}',
      authErrorCodes: [500, 502]
    },
    // An auth request reuses HTTPRequestTabView for url/method/headers/body
    // (default request tab), and surfaces producedHeaders / expiration /
    // error-codes in an injected "Configuration" sub-tab
    // (AuthenticationConfigurationTab). GAP C surface = the produced-headers
    // table in that sub-tab, which must remount on Load.
    assert: async (p) => {
      // HTTP-shared fields on the default request tab (InputBox → inner input).
      await expect(p.locator(vis('http-request-url-input-input'))).toHaveValue('https://saved.example.com/token', { timeout: 10_000 })
      const headers = p.locator(vis('http-request-headers-table'))
      await expect(headers).toContainText('X-Saved-Auth', { timeout: 10_000 })
      await expect(headers).not.toContainText('X-Changed-Auth')

      // Switch to the Configuration sub-tab and assert the auth-specific fields.
      await p.locator(vis('base-request-tabs-request-tab-configuration')).click()
      await p.locator(vis('auth-request-configuration')).waitFor({ state: 'visible', timeout: 10_000 })
      const produced = p.locator(vis('auth-request-produced-headers'))
      await expect(produced).toContainText('Saved {{access_token}}', { timeout: 10_000 })
      await expect(produced).not.toContainText('Changed {{access_token}}')
      // expiration + error-codes read request.* live → re-sync on re-render.
      await expect(p.locator(vis('auth-request-expiration'))).toContainText('{{saved_expires}}')
      await expect(p.locator(vis('auth-request-error-codes-input'))).toHaveValue('401, 403, 419')
    }
  }
}

/** Look up a protocol matrix by key, throwing (and narrowing the type) when
 * the feature references a key with no matrix. */
function getMatrix(matrixKey: string): ProtocolMatrix {
  const matrix = MATRIX[matrixKey]
  if (!matrix) throw new Error(`no matrix for "${matrixKey}"`)
  return matrix
}

// ---------------------------------------------------------------------------
// MCP helpers
// ---------------------------------------------------------------------------

async function ensureFolder(callMcpTool: (d: McpDiscovery, n: string, a?: Record<string, unknown>) => Promise<McpToolReply>): Promise<string> {
  if (discovery === null) throw new Error('launch first')
  const folders = parsedReply(await callMcpTool(discovery, 'list_folders', {})) as { id: string; kind: string }[]
  const envFolder = folders.find((f) => f.kind === 'env-folder')
  if (envFolder) return envFolder.id
  const created = parsedReply(await callMcpTool(discovery, 'create_folder', { name: 'env' })) as { id: string }
  return created.id
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

Given('I launch restorm with the MCP server enabled', async ({ launchAppWithMcp }) => {
  const launched = await launchAppWithMcp()
  discovery = launched.discovery
  page = launched.page
  folderId = ''
  requestId = ''
})

Given(
  'I have a fresh {string} request named {string} populated with its field matrix',
  async ({ callMcpTool }, matrixKey: string, name: string) => {
    if (discovery === null) throw new Error('launch first')
    const matrix = getMatrix(matrixKey)

    // Fresh project so the request id / config list start clean.
    const projectPath = `/tmp/qs-e2e-${matrixKey}-${String(Date.now())}.restorm`
    expect((await callMcpTool(discovery, 'create_project', { filePath: projectPath })).isError ?? false).toBe(false)

    folderId = await ensureFolder(callMcpTool)
    const created = parsedReply(await callMcpTool(discovery, 'create_request', {
      parentFolderId: folderId,
      name,
      protocol: matrix.protocol
    })) as { id: string }
    requestId = created.id
    expect(requestId, 'request id missing').toBeTruthy()

    // Populate the SAVED field values.
    expect((await callMcpTool(discovery, 'update_request', { id: requestId, patch: matrix.saved })).isError ?? false).toBe(false)
  }
)

When(
  'I open its tab and save a quick config named {string}',
  async ({ callMcpTool }, configName: string) => {
    if (discovery === null || page === null) throw new Error('launch first')
    expect((await callMcpTool(discovery, 'open_tab', { itemId: requestId })).isError ?? false).toBe(false)

    // Wait for the smartbar quick-settings button to render in the active tab.
    await page.locator(vis('quick-settings-open-button')).waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator(vis('quick-settings-open-button')).click()

    // ECUI InputBox exposes its <input> under the `-input` testid suffix.
    const nameInput = page.locator(vis('quick-settings-name-input-input'))
    await nameInput.waitFor({ state: 'visible', timeout: 10_000 })
    await nameInput.fill(configName)
    await page.locator(vis('quick-settings-save-button')).click()

    // The saved config appears as a load row in the popover list.
    await expect(page.locator('[data-testid^="quick-settings-load-"]:visible').first())
      .toBeVisible({ timeout: 10_000 })
    // Dismiss the popover before mutating the editor. The popover closes on an
    // outside `mousedown` (not Escape), so click a stable element well clear of
    // it — the top-left page corner is always outside the smartbar popover.
    await page.mouse.click(8, 8)
    await expect(page.locator('[data-testid^="quick-settings-load-"]:visible'))
      .toHaveCount(0, { timeout: 5_000 })
  }
)

When(
  'I change every editable field of the {string} request',
  async ({ callMcpTool }, matrixKey: string) => {
    if (discovery === null) throw new Error('launch first')
    const matrix = getMatrix(matrixKey)
    expect((await callMcpTool(discovery, 'update_request', { id: requestId, patch: matrix.changed })).isError ?? false).toBe(false)
  }
)

When(
  'I load the quick config named {string}',
  async ({}, _configName: string) => {
    if (page === null) throw new Error('launch first')
    await page.locator(vis('quick-settings-open-button')).click()
    const loadRow = page.locator('[data-testid^="quick-settings-load-"]:visible').first()
    await loadRow.waitFor({ state: 'visible', timeout: 10_000 })
    await loadRow.click()
    // A confirmation modal precedes the apply; confirm it.
    const confirmOk = page.locator(vis('quick-settings-confirm-ok'))
    await confirmOk.waitFor({ state: 'visible', timeout: 10_000 })
    await confirmOk.click()
  }
)

Then(
  'the {string} editor shows the originally-saved values',
  async ({}, matrixKey: string) => {
    if (page === null) throw new Error('launch first')
    const matrix = getMatrix(matrixKey)
    await matrix.assert(page)
  }
)
