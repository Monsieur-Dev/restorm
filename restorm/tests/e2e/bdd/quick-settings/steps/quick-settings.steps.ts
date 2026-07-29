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
let envFolderId = ''

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

// A RestormKeyValueTable renders each cell as an ECUI InputBox, so the row's
// key/value live in `<input>` VALUES — not as table text. `toContainText`
// never sees them; assert against the inputs' values instead. The key cell
// carries `<table-testid>-key-input`; the value cell is a TypedValueField whose
// inner input has no per-cell testid, so match any input under the table.
async function expectKvTableKey(p: Page, tableTestid: string, key: string): Promise<void> {
  const inputs = p.locator(`${vis(tableTestid)} input`)
  await expect.poll(async () => {
    const values = await inputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
    return values.includes(key)
  }, { timeout: 20_000, message: `${tableTestid} should have a row whose input value is "${key}"` }).toBe(true)
}

async function expectKvTableLacksKey(p: Page, tableTestid: string, key: string): Promise<void> {
  const inputs = p.locator(`${vis(tableTestid)} input`)
  await expect.poll(async () => {
    const values = await inputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
    return values.includes(key)
  }, { timeout: 20_000, message: `${tableTestid} should NOT have a row whose input value is "${key}"` }).toBe(false)
}

// A surface's value can live in three places depending on the widget: plain
// text (rendered labels), an `<input>`/`<textarea>` value (ECUI InputBox), or a
// Monaco editor (its text is split across `.view-line` spans AND mirrored in a
// hidden textarea). `toContainText` only sees the first. This reads all three
// and asserts the substring is present (or absent) in their union.
async function surfaceContains(p: Page, testid: string, needle: string): Promise<boolean> {
  // Resolve inside a single page.evaluate (not a Playwright element handle):
  // surfaces that remount on Load (Monaco editors keyed by a transport epoch)
  // detach mid-poll, which makes a handle-based `.evaluate` throw and the poll
  // read a spurious false. Re-querying the DOM each tick avoids the stale handle.
  return p.evaluate(({ tid, n }) => {
    const els = Array.from(document.querySelectorAll(`[data-testid="${tid}"]`))
      .filter((el) => (el as HTMLElement).offsetParent !== null)
    for (const el of els) {
      const texts: string[] = [el.textContent]
      el.querySelectorAll('input, textarea').forEach((i) => texts.push((i as HTMLInputElement).value))
      if (texts.some((t) => t.includes(n))) return true
    }
    return false
  }, { tid: testid, n: needle }).catch(() => false)
}

async function expectSurfaceContains(p: Page, testid: string, needle: string): Promise<void> {
  await expect.poll(() => surfaceContains(p, testid, needle), {
    timeout: 20_000, message: `${testid} should surface "${needle}" (text / input / monaco)`
  }).toBe(true)
}

async function expectSurfaceLacks(p: Page, testid: string, needle: string): Promise<void> {
  await expect.poll(() => surfaceContains(p, testid, needle), {
    timeout: 20_000, message: `${testid} should NOT surface "${needle}"`
  }).toBe(false)
}

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
      // `data-resolved-url` carries the fully-resolved URL — the base plus any
      // resolved query params appended (`?savedParam=…`) — so match the base as
      // a prefix rather than an exact string.
      await expect(p.locator(`${vis('http-request-url-section')} [data-testid="url-container"]`))
        .toHaveAttribute('data-resolved-url', /^https:\/\/saved\.example\.com\/widgets(\?|$)/, { timeout: 10_000 })
      await expectKvTableKey(p, 'http-request-headers-table', 'X-Saved-Header')
      await expectKvTableKey(p, 'http-request-headers-table', 'saved-hval')
      await expectKvTableLacksKey(p, 'http-request-headers-table', 'X-Changed-Header')
      await expectKvTableKey(p, 'http-request-query-params-table', 'savedParam')
      await expectKvTableLacksKey(p, 'http-request-query-params-table', 'changedParam')
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
      await expectSurfaceContains(p, 'graphql-query-editor', 'SavedOp')
      await expectSurfaceLacks(p, 'graphql-query-editor', 'ChangedOp')
      await expectSurfaceContains(p, 'graphql-variables-editor', 'savedVar')
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
      await expectSurfaceContains(p, 'soap-request-body-editor', 'SavedOp')
      await expectSurfaceLacks(p, 'soap-request-body-editor', 'ChangedOp')
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
      await expectSurfaceContains(p, 'grpc-request-message-editor', 'savedMsg')
      await expectSurfaceLacks(p, 'grpc-request-message-editor', 'changedMsg')
      await expectKvTableKey(p, 'grpc-metadata-table', 'x-saved-meta')
      await expectKvTableKey(p, 'grpc-metadata-table', 'saved-meta-val')
      await expectKvTableLacksKey(p, 'grpc-metadata-table', 'x-changed-meta')
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
      // OData's URL is a Monaco-backed VariableInputBox (`odata-request-url`)
      // with no `url-container`; $filter is a Monaco ODataFilterEditor. Both are
      // mounted by default for an entity-set request and prove the queryOptions
      // round-trip through the editor on Load. ($top / $skip / $search sit in a
      // section not mounted by default, so they are not visible to assert here —
      // their round-trip is locked at the data layer by the
      // requestQuickConfigStore.roundtrip unit test.)
      await expectSurfaceContains(p, 'odata-request-url', 'https://saved.example.com/odata/People')
      // Monaco tokenises the filter into separate spans (identifier / operator /
      // string-literal), so the concatenated textContent isn't guaranteed to
      // preserve the inter-token spaces — match the distinctive literal token.
      await expectSurfaceContains(p, 'odata-request-filter', "'saved'")
      await expectSurfaceLacks(p, 'odata-request-filter', "'changed'")
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
        .toHaveAttribute('data-resolved-url', /^wss:\/\/saved\.example\.com\/socket(\?|$)/, { timeout: 10_000 })
      // A plain `websocket` request has no event/topic field (only socketio /
      // mqtt render one), so `event` is not asserted here — it is covered by
      // the MQTT scenario, which drives the topic field.
      await expectSurfaceContains(p, 'websocket-message-editor', 'savedFrame')
      await expectKvTableKey(p, 'websocket-headers-table', 'X-Saved-WS')
      await expectKvTableLacksKey(p, 'websocket-headers-table', 'X-Changed-WS')
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
      await expectSurfaceContains(p, 'mqtt-clientid-input', 'saved-client')
      await expectSurfaceLacks(p, 'mqtt-clientid-input', 'changed-client')
      await expectSurfaceContains(p, 'mqtt-username-input', 'saved-user')
      await expectSurfaceContains(p, 'mqtt-password-input', 'saved-pass')
      await expect(p.locator(vis('mqtt-keepalive-input-input'))).toHaveValue('33')
      await expectSurfaceContains(p, 'mqtt-lwt-topic-input', 'sensors/saved-status')
      await expectSurfaceContains(p, 'mqtt-lwt-payload-input', 'saved-offline')
      // event = MQTT topic; message = publish payload.
      await expectSurfaceContains(p, 'websocket-event-input', 'sensors/saved')
      await expectSurfaceContains(p, 'websocket-message-editor', 'saved-payload')
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
      // HTTP-shared fields on the default request tab. The URL is a Monaco-
      // backed VariableInputBox, so its value lives in `url-container`'s
      // `data-resolved-url` (no plain inner <input>).
      await expect(p.locator(`${vis('http-request-url-section')} [data-testid="url-container"]`))
        .toHaveAttribute('data-resolved-url', /^https:\/\/saved\.example\.com\/token(\?|$)/, { timeout: 10_000 })
      await expectKvTableKey(p, 'http-request-headers-table', 'X-Saved-Auth')
      await expectKvTableLacksKey(p, 'http-request-headers-table', 'X-Changed-Auth')

      // Switch to the Configuration sub-tab and assert the auth-specific fields.
      await p.locator(vis('base-request-tabs-request-tab-configuration')).click()
      await p.locator(vis('auth-request-configuration')).waitFor({ state: 'visible', timeout: 10_000 })
      await expectKvTableKey(p, 'auth-request-produced-headers', 'Saved {{access_token}}')
      await expectKvTableLacksKey(p, 'auth-request-produced-headers', 'Changed {{access_token}}')
      // expiration + error-codes read request.* live → re-sync on re-render.
      await expectSurfaceContains(p, 'auth-request-expiration', '{{saved_expires}}')
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
    if (discovery === null || page === null) throw new Error('launch first')
    const disco = discovery
    const pg = page
    const matrix = getMatrix(matrixKey)

    // Fresh project so the request id / config list start clean.
    const projectPath = `/tmp/qs-e2e-${matrixKey}-${String(Date.now())}.restorm`
    expect((await callMcpTool(disco, 'create_project', { filePath: projectPath })).isError ?? false).toBe(false)

    // create_project opens the empty file ASYNCHRONOUSLY in the renderer (its
    // React tree is the save source of truth). A create_request that races the
    // still-in-flight empty-project load lands in the main store, then the late
    // load flushes the renderer's empty tree back and WIPES it. There is no
    // settle event to await, so create + populate, then poll `list_requests`
    // until the request stays present across several consecutive reads — only
    // then has the late load passed. Re-create if an early attempt was wiped.
    const listHasRequest = async (id: string): Promise<boolean> => {
      const lr = parsedReply(await callMcpTool(disco, 'list_requests', {})) as { id: string }[] | { requests?: { id: string }[] }
      const arr = Array.isArray(lr) ? lr : (lr.requests ?? [])
      return arr.some((r) => r.id === id)
    }
    const deadline = Date.now() + 20_000
    let stable = false
    while (Date.now() < deadline && !stable) {
      folderId = await ensureFolder(callMcpTool)
      const created = parsedReply(await callMcpTool(disco, 'create_request', {
        parentFolderId: folderId,
        name,
        protocol: matrix.protocol
      })) as { id: string }
      requestId = created.id
      expect(requestId, 'request id missing').toBeTruthy()
      expect((await callMcpTool(disco, 'update_request', { id: requestId, patch: matrix.saved })).isError ?? false).toBe(false)
      // Confirm it survives the late empty-project load: 4 consecutive present reads.
      let consecutive = 0
      while (Date.now() < deadline && consecutive < 4) {
        if (await listHasRequest(requestId)) {
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
  }
)

When(
  'I open its tab and save a quick config named {string}',
  async ({ callMcpTool }, configName: string) => {
    if (discovery === null || page === null) throw new Error('launch first')
    // `open_tab` itself guarantees the tab is genuinely open (or reports an
    // explicit error) before it replies — it awaits the renderer's ack of
    // the item actually appearing in the workbench, bounded internally, so
    // a single call replaces what used to be a retry loop here tolerating
    // transient errors/no-ops on the request just created via MCP.
    const openReply = await callMcpTool(discovery, 'open_tab', { itemId: requestId })
    expect(openReply.isError ?? false).toBe(false)
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

// ---------------------------------------------------------------------------
// Anchored-popover exclusivity: opening ANY participating click-popover must
// dismiss whichever other one is open — application-wide, not just the request
// header — and an outside click must still close the open one (no regression).
// The set spans four different owners, deliberately, because a single missing
// one is exactly the gap that let two popovers stack in the first place:
//   - request-header application popovers  → quick-config, auth-key, environment
//   - the request tab's scenario-usage badge popover
//   - the bookmark/tag add popover (a library popover that owns its open state)
//   - the title icon picker (`IconSelect`) — a library popover that renders on a
//     CONTAINER tab (folder / env-folder / scenario). A request leaf carries no
//     icon (`findItemWithBreadcrumbs` sets the request crumb's icon to null), so
//     `RestormWorkbenchTab` mounts the title `IconSelect` only for containers;
//     it is exercised here on the env-folder tab, not the request header.
//   - statusbar click popovers (`StatusbarElement` `tooltipTrigger="click"`) →
//     the MCP-status indicator, a full window's-length away from the header yet
//     in the same set. (The statusbar env selector is not mounted anywhere in
//     the app, so the MCP indicator is the statusbar member that actually
//     renders; the auth-key selector is itself a click `StatusbarElement`, so
//     that primitive's enrolment is also covered on the request tab.)
// They only form one set because every side announces on the one shared
// exclusivity channel (`useExclusivePopover`). Because they do not all render on
// one surface, the "all present" precondition is asserted per-surface (the
// request-tab subset vs the env-folder subset); the "only X open / none open"
// assertions stay global — a member absent from the current surface has no
// visible popover, so it reads as closed, which is exactly the invariant.
// ---------------------------------------------------------------------------

type ExclusivePopoverKey =
  | 'quick-config'
  | 'auth-key'
  | 'environment'
  | 'tags'
  | 'icon'
  | 'scenarios'
  | 'statusbar-mcp'

/** Selector (not bare testid) because the workbench-tab popovers are keyed by
 * the runtime tab id (`tab-<tabId>-…`); matching on the stable suffix avoids
 * having to thread that id through every step. */
const EXCLUSIVE_POPOVER_BUTTON: Record<ExclusivePopoverKey, string> = {
  'quick-config': vis('quick-settings-open-button'),
  'auth-key': vis('request-header-auth-selector'),
  environment: vis('request-header-env-selector'),
  tags: '[data-testid$="-bookmarks-add"]:visible',
  icon: '[data-testid$="-title-icon-button"]:visible',
  scenarios: vis('request-scenario-usage-button'),
  'statusbar-mcp': vis('statusbar-mcp-indicator')
}

const EXCLUSIVE_POPOVER_CONTENT: Record<ExclusivePopoverKey, string> = {
  'quick-config': vis('quick-settings-popover'),
  'auth-key': vis('request-header-auth-popover'),
  environment: vis('request-header-env-popover'),
  tags: '[data-testid$="-bookmarks-add-tooltip"]:visible',
  icon: '[data-testid$="-title-icon-picker"]:visible',
  scenarios: vis('request-scenario-usage-popover'),
  'statusbar-mcp': vis('statusbar-mcp-popover')
}

const ALL_EXCLUSIVE_POPOVER_KEYS = Object.keys(EXCLUSIVE_POPOVER_CONTENT) as ExclusivePopoverKey[]

// Which triggers actually render on which tab surface — the "all present"
// precondition waits only for the subset its scenario drives. The statusbar MCP
// indicator is global chrome (present on every surface), so it needs no subset
// entry of its own; a scenario that drives it opens a request tab first for a
// second member to be mutually exclusive against.
const REQUEST_TAB_POPOVER_KEYS: ExclusivePopoverKey[] = [
  'quick-config', 'auth-key', 'environment', 'tags', 'scenarios'
]
const ENV_FOLDER_TAB_POPOVER_KEYS: ExclusivePopoverKey[] = ['icon', 'tags']

function asExclusivePopoverKey(value: string): ExclusivePopoverKey {
  if ((ALL_EXCLUSIVE_POPOVER_KEYS as string[]).includes(value)) return value as ExclusivePopoverKey
  throw new Error(`unknown exclusive popover "${value}"`)
}

Given(
  'I have a request with an environment, an in-scope auth route, and a scenario using it',
  async ({ callMcpTool }) => {
    if (discovery === null || page === null) throw new Error('launch first')
    const disco = discovery
    const pg = page

    // Fresh project so the request id starts clean (same late-empty-project-load
    // race as the field-matrix fixture above — see its comment for the full
    // explanation of why the created items must be re-verified stable).
    const projectPath = `/tmp/header-popover-exclusivity-e2e-${String(Date.now())}.restorm`
    expect((await callMcpTool(disco, 'create_project', { filePath: projectPath })).isError ?? false).toBe(false)

    const listHasRequest = async (id: string): Promise<boolean> => {
      const lr = parsedReply(await callMcpTool(disco, 'list_requests', {})) as { id: string }[] | { requests?: { id: string }[] }
      const arr = Array.isArray(lr) ? lr : (lr.requests ?? [])
      return arr.some((r) => r.id === id)
    }

    const deadline = Date.now() + 20_000
    let stable = false
    envFolderId = ''
    while (Date.now() < deadline && !stable) {
      // Env-folder + an environment in it (so the header env selector renders)
      // and an auth request in it (so the header auth-key selector renders,
      // in scope for every request in the same folder) — all recreated
      // together on every retry so a wipe never leaves them out of sync with
      // the http request below.
      const envFolder = parsedReply(await callMcpTool(disco, 'create_folder', { name: 'env' })) as { id: string }
      expect(envFolder.id, 'env-folder id missing').toBeTruthy()
      envFolderId = envFolder.id
      expect((await callMcpTool(disco, 'create_environment', { envFolderId: envFolder.id, name: 'local' })).isError ?? false).toBe(false)
      const authRequest = parsedReply(await callMcpTool(disco, 'create_request', {
        parentFolderId: envFolder.id,
        name: 'login',
        protocol: 'auth'
      })) as { id: string }
      expect(authRequest.id, 'auth request id missing').toBeTruthy()

      const created = parsedReply(await callMcpTool(disco, 'create_request', {
        parentFolderId: envFolder.id,
        name: 'exclusivity-target',
        protocol: 'http'
      })) as { id: string }
      requestId = created.id
      expect(requestId, 'request id missing').toBeTruthy()

      // Confirm it survives the late empty-project load: 4 consecutive present reads.
      let consecutive = 0
      while (Date.now() < deadline && consecutive < 4) {
        if (await listHasRequest(requestId)) {
          consecutive++
        } else {
          consecutive = 0
          break // wiped — recreate everything from the top
        }
        await pg.waitForTimeout(250)
      }
      stable = consecutive >= 4
    }
    expect(stable, 'request never stabilised after create_project').toBe(true)

    // Seed a scenario that binds the request via an `httpRequest` node, so the
    // scenario-usage badge popover mounts in the tab header (it renders only
    // when the request is used by at least one scenario). The badge is one of
    // the popovers Yoann's rejection named, so it must be in the set — and its
    // presence is a setup precondition, not something the exclusivity code can
    // conjure on its own.
    const scenario = parsedReply(await callMcpTool(disco, 'create_scenario', {
      parentId: envFolderId,
      name: 'uses-the-request'
    })) as { id: string }
    expect(scenario.id, 'scenario id missing').toBeTruthy()
    expect((await callMcpTool(disco, 'create_scenario_node', {
      scenarioId: scenario.id,
      kind: 'httpRequest',
      config: { requestId, label: 'call it' }
    })).isError ?? false).toBe(false)
  }
)

/** Open `itemId` in a workbench tab, then wait for every exclusivity trigger
 * that renders on that surface to be mounted. A trigger that never mounts
 * would otherwise surface as a confusing click timeout mid-scenario rather
 * than a clear setup failure. */
async function openTabAndAwaitTriggers(
  callMcpTool: (d: McpDiscovery, n: string, a?: Record<string, unknown>) => Promise<McpToolReply>,
  itemId: string,
  keys: ExclusivePopoverKey[]
): Promise<void> {
  if (discovery === null || page === null) throw new Error('launch first')
  const pg = page
  // `open_tab` itself guarantees the tab is genuinely open (or reports an
  // explicit error) before it replies — the request was already confirmed
  // stable by the setup step's own settle loop, so a single call here
  // replaces what used to be a retry-and-tolerate-transient-errors loop.
  const openReply = await callMcpTool(discovery, 'open_tab', { itemId })
  expect(openReply.isError ?? false).toBe(false)
  for (const key of keys) {
    await pg.locator(EXCLUSIVE_POPOVER_BUTTON[key])
      .waitFor({ state: 'visible', timeout: 15_000 })
  }
}

When('I open its tab', async ({ callMcpTool }) => {
  await openTabAndAwaitTriggers(callMcpTool, requestId, REQUEST_TAB_POPOVER_KEYS)
})

When('I open the env-folder tab', async ({ callMcpTool }) => {
  // The title icon picker renders on a CONTAINER tab, not the request header, so
  // the icon-picker exclusivity is driven here — against the tag ribbon, which
  // renders on this surface too.
  await openTabAndAwaitTriggers(callMcpTool, envFolderId, ENV_FOLDER_TAB_POPOVER_KEYS)
})

When('I open the {string} popover', async ({}, key: string) => {
  if (page === null) throw new Error('launch first')
  const popoverKey = asExclusivePopoverKey(key)
  await page.locator(EXCLUSIVE_POPOVER_BUTTON[popoverKey]).click()
})

When('I click outside every popover', async ({}) => {
  if (page === null) throw new Error('launch first')
  // The popovers close on an outside `mousedown` (not Escape), so click a
  // stable element well clear of every trigger — the top-left page corner is
  // always outside every popover in the set.
  await page.mouse.click(8, 8)
})

Then('only the {string} popover is open', async ({}, key: string) => {
  if (page === null) throw new Error('launch first')
  const openKey = asExclusivePopoverKey(key)
  const pg = page
  await expect(pg.locator(EXCLUSIVE_POPOVER_CONTENT[openKey]), `${openKey} popover should be open`)
    .toBeVisible({ timeout: 10_000 })
  for (const otherKey of ALL_EXCLUSIVE_POPOVER_KEYS) {
    if (otherKey === openKey) continue
    await expect(pg.locator(EXCLUSIVE_POPOVER_CONTENT[otherKey]), `${otherKey} popover should be closed`)
      .toHaveCount(0, { timeout: 10_000 })
  }
})

Then('no popover is open', async ({}) => {
  if (page === null) throw new Error('launch first')
  const pg = page
  for (const key of ALL_EXCLUSIVE_POPOVER_KEYS) {
    await expect(pg.locator(EXCLUSIVE_POPOVER_CONTENT[key]), `${key} popover should be closed`)
      .toHaveCount(0, { timeout: 10_000 })
  }
})
