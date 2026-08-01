/**
 * Navigation tools — they have side-effects on the UI (opening a tab,
 * scrolling the sidebar) but never mutate the model. They exist so the
 * AI can SHOW the user what it's looking at: "I'm reading this
 * request", "I just opened this folder". Pairs naturally with the read
 * tools in `./read.ts`.
 *
 * `close_tab` / `reveal_in_tree` stay one-way: main validates the target
 * id against the CollectionStore, then fires an IPC the renderer's
 * listeners pick up and turn into a sidebar reveal / tab close. We don't
 * wait for a renderer ack there — no-op-on-miss is an acceptable outcome
 * for those two (closing something already closed, or revealing
 * something the tree hasn't projected yet, are both harmless).
 *
 * `open_tab` is different: a client that just created the item it's
 * opening can race the renderer's tree projection (which lags the
 * `mcp:tree-replace` broadcast by a beat), so `open_tab` AWAITS a bounded
 * ack from the renderer confirming it resolved the item and opened its
 * tab — see `openTabAndAwaitAck`. A silent no-op is worse than a slower
 * reply: the caller must be able to trust that a non-error response means
 * the workbench really did act on the request.
 */

import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import { McpService } from 'electron-core-ui'
import { collectionStore } from '../../services/CollectionStore'
import { isAnyFolder, isEnvironmentFolder, isRequest, isScenario } from '../../../shared/models'
import { SINGLETON_TAB_IDS, isSingletonTabId } from '../../../shared/types/editor'

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

/** Overall budget an `open_tab` call spends waiting for the workbench. */
const OPEN_TAB_ACK_TIMEOUT_MS = 5000
/** Pause between two attempts once every window has said "not in my tree". */
const OPEN_TAB_RETRY_DELAY_MS = 100

/**
 * Pending `open_tab` attempts, keyed by their `requestId`. A SINGLE
 * `mcp:open-tab-result` listener (installed once, see `installAckListener`)
 * dispatches through this map rather than one `ipcMain.on` per in-flight
 * call — concurrent calls (a `batch`, several clients) would otherwise pile
 * listeners on the channel and trip Node's max-listeners warning.
 */
const pendingOpenTabAcks = new Map<string, (senderId: number, opened: boolean) => void>()
let ackListenerInstalled = false

function installAckListener(): void {
  if (ackListenerInstalled) return
  ackListenerInstalled = true
  ipcMain.on('mcp:open-tab-result', (event: IpcMainEvent, payload: unknown) => {
    const p = payload as { requestId?: unknown; opened?: unknown }
    if (typeof p.requestId !== 'string') return
    pendingOpenTabAcks.get(p.requestId)?.(event.sender.id, p.opened === true)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(resolve, ms) })
}

type OpenTabRound = 'opened' | 'not-projected' | 'no-window' | 'timeout'

/**
 * One attempt: broadcast `mcp:open-tab` to every live window and wait for
 * their `mcp:open-tab-result` acks (correlated by `requestId`).
 *
 * - the first window to ack `opened: true` wins → `'opened'`;
 * - once EVERY window has acked `opened: false`, the item simply isn't in
 *   any renderer's tree yet → `'not-projected'`, and the caller can retry.
 *   A negative ack from one window can't settle the attempt on its own: a
 *   multi-window setup legitimately has windows that don't hold the item;
 * - a window that never answers at all (dead / mid-navigation) is capped by
 *   `roundTimeoutMs` → `'timeout'`, so the MCP call can't hang.
 */
function openTabRound(
  itemId: string,
  kind: 'request' | 'folder' | 'env-folder' | 'scenario',
  roundTimeoutMs: number
): Promise<OpenTabRound> {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
  if (windows.length === 0) return Promise.resolve<OpenTabRound>('no-window')
  const requestId = randomUUID()
  const awaited = new Set(windows.map((win) => win.webContents.id))
  return new Promise<OpenTabRound>((resolve) => {
    let settled = false
    const finish = (outcome: OpenTabRound): void => {
      if (settled) return
      settled = true
      pendingOpenTabAcks.delete(requestId)
      clearTimeout(timer)
      resolve(outcome)
    }
    // ORDER MATTERS below: `finish` reads `timer`, and an ack can arrive
    // SYNCHRONOUSLY from the `send` loop (an already-loaded renderer replies
    // on the same turn). So the timer must exist before anything can call
    // `finish` — arm it first, register the ack second, broadcast last.
    const timer = setTimeout(() => { finish('timeout') }, roundTimeoutMs)
    pendingOpenTabAcks.set(requestId, (senderId, opened) => {
      if (opened) { finish('opened'); return }
      awaited.delete(senderId)
      if (awaited.size === 0) finish('not-projected')
    })
    for (const win of windows) win.webContents.send('mcp:open-tab', { requestId, itemId, kind })
  })
}

/**
 * Open `itemId`'s tab and resolve only once the workbench has confirmed it
 * — retrying, within one bounded budget, for as long as the renderers keep
 * answering "not in my tree yet".
 *
 * IPC delivery is FIFO per `webContents` and a create's `mcp:tree-replace`
 * broadcast is always sent before this one can be reached (the client has
 * to await the create's MCP response first), so the very first attempt
 * normally wins. The retry covers the cases that ordering alone can't: a
 * project load still in flight, a window that hasn't mounted its listeners
 * yet. Retrying HERE, in the product, is the whole point — every MCP client
 * would otherwise have to re-implement the same loop, and the ones that
 * didn't got a silent no-op.
 */
async function openTabAndAwaitAck(
  itemId: string,
  kind: 'request' | 'folder' | 'env-folder' | 'scenario',
  timeoutMs = OPEN_TAB_ACK_TIMEOUT_MS
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    const outcome = await openTabRound(itemId, kind, remaining)
    if (outcome === 'opened') return true
    // A dead/silent window or an empty desktop is terminal — only
    // "the tree hasn't caught up" is worth another attempt.
    if (outcome !== 'not-projected') return false
    const left = deadline - Date.now()
    if (left <= 0) return false
    await delay(Math.min(OPEN_TAB_RETRY_DELAY_MS, left))
  }
}

function describeKind(itemId: string): 'request' | 'folder' | 'env-folder' | 'scenario' | null {
  const target = collectionStore.findById(itemId)
  if (!target) return null
  // A scenario carries `configuration`, so it passes `isAnyFolder` — test it
  // FIRST, else a scenario is mislabelled `folder` and open/reveal/close route
  // it down the folder path (which can't find or open it).
  if (isScenario(target)) return 'scenario'
  if (isRequest(target)) return 'request'
  if (isEnvironmentFolder(target)) return 'env-folder'
  if (isAnyFolder(target)) return 'folder'
  return null
}

export function registerNavigationTools(mcp: McpService): void {
  installAckListener()
  mcp.registerTool(
    'open_tab',
    {
      titleKey: 'mcpToolTitles.openTab',
      title: 'Open item in workbench tab',
      description:
        'Open a folder, env-folder, request or scenario in a new workbench tab — focuses the ' +
        'existing tab if one already shows the item. Validates the id against the open project; ' +
        'returns a clean error when unknown so the AI knows it picked the wrong reference. Waits ' +
        '(bounded, retrying internally) until the workbench confirms it resolved the item and ' +
        'opened its tab — safe to call immediately after creating the item, and it reports an ' +
        'explicit error rather than silently doing nothing. The tab opens in the user\'s active ' +
        'window; multi-window setups receive the broadcast in every window and the renderer picks ' +
        'the focused one.',
      inputSchema: {
        itemId: z.string().min(1).describe('Folder / env-folder / request / scenario id to open.')
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const itemId = typeof argRecord['itemId'] === 'string' ? argRecord['itemId'] : ''
      if (!itemId) return errorReply('itemId is required')
      const kind = describeKind(itemId)
      if (!kind) return errorReply(`No item with id ${itemId}`)
      const opened = await openTabAndAwaitAck(itemId, kind)
      if (!opened) {
        return errorReply(`Could not open a tab for ${itemId} — the workbench never confirmed the tab opened`)
      }
      return jsonReply({ itemId, kind, opened: true })
    }
  )

  mcp.registerTool(
    'close_tab',
    {
      titleKey: 'mcpToolTitles.closeTab',
      title: 'Close a workbench tab',
      description:
        'Close the workbench tab showing the given item. Accepts a project-tree id (folder / ' +
        'env-folder / request / scenario) or one of the singleton tab ids — ' +
        `${SINGLETON_TAB_IDS.join(', ')}. Returns a clean error for an id that is neither, so the ` +
        'AI knows it picked the wrong reference. No-op when the tab isn\'t currently open — the ' +
        'renderer\'s close handler is forgiving on misses.',
      inputSchema: {
        itemId: z.string().min(1).describe(
          'Folder / env-folder / request / scenario id whose tab to close, or a singleton tab id ' +
          `(${SINGLETON_TAB_IDS.join(' | ')}).`
        )
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const itemId = typeof argRecord['itemId'] === 'string' ? argRecord['itemId'] : ''
      if (!itemId) return errorReply('itemId is required')
      // The singleton tabs (Console, Settings, Firewall, Mini browser, MCP
      // logs) have no project-tree entry, so the tree lookup can't be the only
      // gate — it used to reject them outright, leaving no MCP route to close
      // them at all.
      const kind = isSingletonTabId(itemId) ? 'singleton' : describeKind(itemId)
      if (!kind) return errorReply(`No item with id ${itemId}`)
      broadcast('mcp:close-tab', { itemId, kind })
      return jsonReply({ itemId, kind, queued: true })
    }
  )

  mcp.registerTool(
    'reveal_in_tree',
    {
      titleKey: 'mcpToolTitles.revealInTree',
      title: 'Reveal item in sidebar tree',
      description:
        'Expand the sidebar ancestors of the item, scroll the tree to the node, and select it. ' +
        'Useful so the user can see what the AI is referring to without opening a tab. Validates ' +
        'the id against the open project.',
      inputSchema: {
        itemId: z.string().min(1).describe('Folder / env-folder / request / scenario id to reveal.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const itemId = typeof argRecord['itemId'] === 'string' ? argRecord['itemId'] : ''
      if (!itemId) return errorReply('itemId is required')
      const kind = describeKind(itemId)
      if (!kind) return errorReply(`No item with id ${itemId}`)
      broadcast('mcp:reveal-in-tree', { itemId, kind })
      return jsonReply({ itemId, kind, queued: true })
    }
  )
}
