/**
 * Workbench-layout cache + get/set MCP tools.
 *
 * The renderer owns the live workbench tree (groups, splits, sashes,
 * tabs) — there's no synchronous way for the main process to read React
 * state — so we reuse the same push-to-cache pattern as the active-tab
 * snapshot (`./activeState.ts`): the renderer serializes its layout to a
 * flat, JSON-safe `WorkbenchLayout` (ECUI's `serializeWorkbenchLayout`)
 * and pushes it on every change; `get_workbench_layout` reads the cache
 * in O(1).
 *
 * `set_workbench_layout` is the write side: it broadcasts the requested
 * layout spec on an IPC channel the renderer turns into a full
 * `applyWorkbenchLayout` + `setWorkbenchTree` (opening any not-yet-open
 * tab by its `itemId` / special `tabType` along the way). The flow is
 * one-way, like the navigation tools — main doesn't wait for a renderer
 * ack; the renderer is forgiving about ids it can't resolve.
 *
 * Channels:
 *   renderer → main: `mcp:workbench-layout-changed` → `WorkbenchLayout`
 *   main → renderer: `mcp:set-workbench-layout` → `WorkbenchLayout`
 */

import { z } from 'zod'
import { ipcMain, BrowserWindow } from 'electron'
import { McpService } from 'electron-core-ui'
import type { WorkbenchLayout } from 'electron-core-ui/renderer'

export const WORKBENCH_LAYOUT_CHANGED_CHANNEL = 'mcp:workbench-layout-changed'
export const SET_WORKBENCH_LAYOUT_CHANNEL = 'mcp:set-workbench-layout'

/** Empty layout reported before the renderer has pushed anything. */
const EMPTY_LAYOUT: WorkbenchLayout = { orientation: 'vertical', groups: [] }

let layoutSnapshot: WorkbenchLayout = EMPTY_LAYOUT
let registered = false

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/**
 * Wire the renderer → main push listener. Idempotent: safe to call once
 * during boot or repeatedly in tests (the second call no-ops).
 */
export function registerWorkbenchLayoutBridge(): void {
  if (registered) return
  registered = true
  ipcMain.on(WORKBENCH_LAYOUT_CHANGED_CHANNEL, (_event, payload: unknown) => {
    if (payload && typeof payload === 'object' && Array.isArray((payload as WorkbenchLayout).groups)) {
      layoutSnapshot = payload as WorkbenchLayout
    }
  })
}

export function getWorkbenchLayoutSnapshot(): WorkbenchLayout {
  return layoutSnapshot
}

/** Test-only reset. */
export function _resetWorkbenchLayoutForTests(): void {
  layoutSnapshot = EMPTY_LAYOUT
  registered = false
}

// Zod schema for the set payload. The split tree is recursive, so the
// node schema is declared lazily. We validate the SHAPE here (the
// renderer does the real reconstruction + pruning via
// `applyWorkbenchLayout`), so unknown `tabType` strings / ids pass
// through to the renderer, which drops what it can't rebuild.
const layoutTabSchema = z.object({
  id: z.string().min(1),
  tabType: z.string().optional(),
  title: z.string().optional(),
  itemId: z.string().nullable().optional(),
  data: z.unknown().optional()
})

const layoutNodeSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('tabs'),
      id: z.string().min(1),
      activeTabId: z.string().optional(),
      tabs: z.array(layoutTabSchema)
    }),
    z.object({
      kind: z.literal('container'),
      id: z.string().min(1),
      orientation: z.enum(['vertical', 'horizontal']),
      sizes: z.array(z.number()).optional(),
      groups: z.array(layoutNodeSchema)
    })
  ])
)

const workbenchLayoutSchema = z.object({
  orientation: z.enum(['vertical', 'horizontal']),
  sizes: z.array(z.number()).optional(),
  focusedGroupId: z.string().nullable().optional(),
  maximizedTabId: z.string().nullable().optional(),
  groups: z.array(layoutNodeSchema)
})

export function registerWorkbenchLayoutTools(mcp: McpService): void {
  registerWorkbenchLayoutBridge()

  mcp.registerTool(
    'get_workbench_layout',
    {
      title: 'Get the workbench tab layout',
      description:
        'Return the full editor layout as JSON: the group / split tree (each container has an ' +
        '`orientation` — `vertical` = side-by-side, `horizontal` = stacked — and `sizes` = sash ratios ' +
        '0-1), and for each leaf group its ordered `tabs` (`{ id, tabType, title, itemId }`, `itemId` is ' +
        'the tree-item id for requests / folders / scenarios and `null` for singleton specials like ' +
        'console / mini-browser / firewall / settings) plus its `activeTabId`. Also reports the ' +
        '`focusedGroupId` and the `maximizedTabId` (the tab currently shown fullscreen, or null). ' +
        'Driven by a renderer push (like `get_current_tab`), so it reads fresh without a round-trip; ' +
        'returns an empty `{ orientation, groups: [] }` before any project / tab is open. Pair with ' +
        '`set_workbench_layout` to reconstruct a layout without drag & drop.',
      inputSchema: {} as Record<string, unknown>
    },
    () => jsonReply(getWorkbenchLayoutSnapshot())
  )

  mcp.registerTool(
    'set_workbench_layout',
    {
      title: 'Set the workbench tab layout',
      description:
        'Reconstruct an arbitrary editor layout from a spec — groups + the split tree + per-split ' +
        'orientation (`vertical` = side-by-side, `horizontal` = stacked) + sash `sizes` (ratios 0-1) + ' +
        'tab placement + each group\'s `activeTabId` + the `focusedGroupId`. Tabs that aren\'t open yet ' +
        'are opened: tree-backed tabs by `itemId` (request / folder / env-folder / scenario), singleton ' +
        'specials by `tabType` (console / mini-browser / firewall / settings). Optionally pass ' +
        '`maximizedTabId` to also show one tab fullscreen. A tab whose `itemId` can\'t be resolved is ' +
        'dropped (and any group it would have emptied is pruned). `activeTabId` may be the spec tab\'s ' +
        '`id` field — for singleton tabs the reconstructor resolves it to the singleton\'s canonical id ' +
        '(e.g. `firewall:singleton`) so the singleton becomes the active tab even if the spec id differs. ' +
        'Use this to set up split layouts deterministically — e.g. a 2-group layout for testing — ' +
        'instead of unreliable drag & drop. Read the current shape first with `get_workbench_layout`.',
      inputSchema: {
        layout: workbenchLayoutSchema.describe(
          'The layout to apply. Shape mirrors `get_workbench_layout`: ' +
          '{ orientation, sizes?, focusedGroupId?, maximizedTabId?, groups: (TabGroup | Container)[] } ' +
          'where TabGroup = { kind:"tabs", id, activeTabId?, tabs: { id, tabType?, title?, itemId?, data? }[] } ' +
          'and Container = { kind:"container", id, orientation, sizes?, groups: [...] }.'
        )
      } as Record<string, unknown>
    },
    (args) => {
      // `batch` / `invokeTool` bypass the SDK's Zod validation, so re-parse here.
      const parsed = workbenchLayoutSchema.safeParse((args as { layout?: unknown }).layout)
      if (!parsed.success) {
        return errorReply(`Invalid layout: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
      }
      broadcast(SET_WORKBENCH_LAYOUT_CHANNEL, parsed.data)
      return jsonReply({ applied: true })
    }
  )
}
