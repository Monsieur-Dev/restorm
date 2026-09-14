/**
 * MCP surface of the recording sessions: create / update a session and its
 * filters, start / stop a recording, read the captured calls and deduce
 * the routes. Everything but the deduction is open to every plan (the
 * deduction is the paid step — see `mcpProGate.ts`).
 *
 * Starting a recording is the one call that needs the renderer: the capture
 * engine attaches to the mini-browser view, and that view only exists once
 * the workbench has mounted the session's browser tab. So `start_recording`
 * asks every window to run the same flow the record button runs, waits for
 * a window to accept, then watches the main-side status until the engine
 * reports `recording` — the reply never claims a recording that did not
 * actually attach.
 */

import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import { McpService } from 'electron-core-ui'
import { collectionStore } from '../../services/CollectionStore'
import { recordingCaptureStore } from '../../services/recording/RecordingCaptureStore'
import { recordingCaptureEngine } from '../../services/recording/RecordingCaptureEngine'
import { materializeRecordingHistory } from '../../services/recording/recordingIpc'
import { isAnyFolder, isRequest, isScenario, isRecordingSession, type RecordingSession } from '../../../shared/models'
import type { FolderItem } from '../../../shared/models'
import { RECORDING_PROTOCOLS, isRecordingProtocol, type RecordingProtocol } from '../../../shared/types/recordingSession'
import type { RecordedCallDetail, RecordingFilterConfig, RecordingStatus } from '../../../shared/types/recordingCapture'
import { isRecordableUrl } from '../../../shared/recording/recordingUrl'
import { deduceRoutes, flattenRoutes } from '../../../shared/recording/routeDeduction'
import { materializeDeducedTree } from '../../../shared/recording/deducedItems'
import { broadcastTreeReplace } from './import'

/** How long `start_recording` waits for the engine to attach (tab mount +
 * mini-browser view creation + CDP attach). */
export const START_RECORDING_TIMEOUT_MS = 15_000
const START_ACK_RETRY_DELAY_MS = 100
const STATUS_POLL_INTERVAL_MS = 100

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function triggerSave(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('file:autosave-trigger')
  }
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(resolve, ms) })
}

// ── tree helpers ────────────────────────────────────────────────────────────

function childItemsOf(item: FolderItem): readonly FolderItem[] {
  // Container children are typed with the base item shape; the walkers use
  // the same guards as the store does.
  if (isRecordingSession(item) || isScenario(item)) return (item.items ?? []) as unknown as FolderItem[]
  if (isAnyFolder(item)) return item.items as unknown as FolderItem[]
  return []
}

/** Every recording session in the tree, with the id of its container. */
function collectSessions(items: readonly FolderItem[], parentId: string | null, out: { session: RecordingSession; parentId: string | null }[]): void {
  for (const item of items) {
    if (isRecordingSession(item)) {
      out.push({ session: item, parentId })
      continue
    }
    const children = childItemsOf(item)
    if (children.length > 0) collectSessions(children, item.id, out)
  }
}

function countRequests(items: readonly FolderItem[]): number {
  let count = 0
  for (const item of items) {
    if (isRequest(item)) count += 1
    else count += countRequests(childItemsOf(item))
  }
  return count
}

function findSession(id: string): RecordingSession | null {
  const item = collectionStore.findById(id)
  return item && isRecordingSession(item) ? item : null
}

function filterConfigOf(session: RecordingSession): RecordingFilterConfig {
  return { protocols: [...session.protocols], whitelist: [...session.whitelist], blacklist: [...session.blacklist] }
}

function sessionSummary(session: RecordingSession, parentId: string | null): Record<string, unknown> {
  const status = recordingCaptureStore.status(session.id)
  return {
    id: session.id,
    name: session.name,
    parentId,
    url: session.url,
    protocols: session.protocols,
    whitelist: session.whitelist,
    blacklist: session.blacklist,
    ...(session.notes !== undefined ? { notes: session.notes } : {}),
    state: status.state,
    captureCount: status.captureCount,
    routeCount: countRequests((session.items ?? []) as unknown as FolderItem[])
  }
}

// ── argument coercion (the `batch` tool bypasses zod, so coerce defensively) ──

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function stringListArg(args: Record<string, unknown>, key: string): string[] | null | { error: string } {
  const value = args[key]
  if (value === undefined) return null
  if (!Array.isArray(value)) return { error: `${key} must be an array of strings` }
  const list = value.filter((v): v is string => typeof v === 'string')
  if (list.length !== value.length) return { error: `${key} must be an array of strings` }
  return list
}

/** Regex sources are compiled once here so a bad pattern is refused at the
 * tool boundary rather than throwing inside the capture pipeline. */
function invalidPattern(patterns: readonly string[]): string | null {
  for (const pattern of patterns) {
    try {
      new RegExp(pattern)
    } catch (error) {
      return `invalid regex "${pattern}": ${error instanceof Error ? error.message : String(error)}`
    }
  }
  return null
}

function protocolsArg(args: Record<string, unknown>): RecordingProtocol[] | null | { error: string } {
  const value = args['protocols']
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length === 0 || !value.every(isRecordingProtocol)) {
    return { error: `protocols must be a non-empty array drawn from ${RECORDING_PROTOCOLS.join(', ')}` }
  }
  return [...new Set(value)]
}

function isErrorResult(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value
}

// ── start_recording: renderer handshake ─────────────────────────────────────

/** Pending `start_recording` handshakes keyed by `requestId`; one listener
 * dispatches through the map (same shape as `open_tab`'s ack). */
const pendingStartAcks = new Map<string, (senderId: number, accepted: boolean) => void>()
let ackListenerInstalled = false

function installAckListener(): void {
  if (ackListenerInstalled) return
  ackListenerInstalled = true
  ipcMain.on('mcp:start-recording-result', (event: IpcMainEvent, payload: unknown) => {
    const p = payload as { requestId?: unknown; accepted?: unknown }
    if (typeof p.requestId !== 'string') return
    pendingStartAcks.get(p.requestId)?.(event.sender.id, p.accepted === true)
  })
}

type StartRound = 'accepted' | 'not-projected' | 'no-window' | 'timeout'

/** One attempt: ask every window to start the session; the first `accepted`
 * wins, every window declining means the tree has not caught up yet. */
function startRound(sessionId: string, roundTimeoutMs: number): Promise<StartRound> {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
  if (windows.length === 0) return Promise.resolve<StartRound>('no-window')
  const requestId = randomUUID()
  const awaited = new Set(windows.map((win) => win.webContents.id))
  return new Promise<StartRound>((resolve) => {
    let settled = false
    const finish = (outcome: StartRound): void => {
      if (settled) return
      settled = true
      pendingStartAcks.delete(requestId)
      clearTimeout(timer)
      resolve(outcome)
    }
    // Arm the timer first, register the ack second, broadcast last: an
    // already-loaded renderer can answer synchronously from the send loop.
    const timer = setTimeout(() => { finish('timeout') }, roundTimeoutMs)
    pendingStartAcks.set(requestId, (senderId, accepted) => {
      if (accepted) { finish('accepted'); return }
      awaited.delete(senderId)
      if (awaited.size === 0) finish('not-projected')
    })
    for (const win of windows) win.webContents.send('mcp:start-recording', { requestId, sessionId })
  })
}

/** Ask the renderer to start, then wait until the engine reports the run. */
export async function startRecordingViaRenderer(sessionId: string, timeoutMs = START_RECORDING_TIMEOUT_MS): Promise<{ ok: true; status: RecordingStatus } | { ok: false; error: string }> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { ok: false, error: 'no window accepted the start request in time — is the project open?' }
    const outcome = await startRound(sessionId, remaining)
    if (outcome === 'accepted') break
    if (outcome === 'no-window') return { ok: false, error: 'no window is open' }
    if (outcome === 'timeout') return { ok: false, error: 'the renderer did not answer the start request' }
    const left = deadline - Date.now()
    if (left <= 0) return { ok: false, error: 'no window accepted the start request in time — is the project open?' }
    await delay(Math.min(START_ACK_RETRY_DELAY_MS, left))
  }
  for (;;) {
    const status = recordingCaptureStore.status(sessionId)
    if (status.state !== 'idle') return { ok: true, status }
    if (Date.now() >= deadline) {
      return { ok: false, error: 'the browser tab opened but the capture engine did not attach in time (is the url reachable?)' }
    }
    await delay(STATUS_POLL_INTERVAL_MS)
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

// ── registration ────────────────────────────────────────────────────────────

export function registerRecordingTools(mcp: McpService): void {
  installAckListener()

  mcp.registerTool(
    'list_recording_sessions',
    {
      titleKey: 'mcpToolTitles.listRecordingSessions',
      title: 'List recording sessions',
      description:
        'List every recording session of the project. A recording session records the API calls a web ' +
        'page makes (through the built-in mini-browser) so they can be turned into replayable requests. ' +
        'Each entry carries `{ id, name, parentId, url, protocols, whitelist, blacklist, state, ' +
        'captureCount, routeCount }` — `state` is `idle` | `recording` | `paused`, `routeCount` counts the ' +
        'requests already deduced under the session.',
      inputSchema: {} as Record<string, unknown>
    },
    () => {
      const out: { session: RecordingSession; parentId: string | null }[] = []
      collectSessions(collectionStore.getCollections(), null, out)
      return jsonReply({ count: out.length, sessions: out.map(({ session, parentId }) => sessionSummary(session, parentId)) })
    }
  )

  mcp.registerTool(
    'create_recording_session',
    {
      titleKey: 'mcpToolTitles.createRecordingSession',
      title: 'Create a recording session',
      description:
        'Create a recording session — the sidebar item that records the API calls of a web page. Give it ' +
        'the page `url` (http, https or file) and optionally the `protocols` to capture (default: all of ' +
        'http, websocket, graphql, grpc-web) and regex `whitelist` / `blacklist` filters on the called ' +
        'urls (a call is kept when it matches at least one whitelist entry — or the list is empty — and ' +
        'no blacklist entry). `parentId` places it under a folder or env-folder (never a scenario); omit for the ' +
        'root. Then `start_recording`, drive the page, `stop_recording`, and `deduce_recording_routes`. ' +
        'Returns the session summary (see `list_recording_sessions`).',
      inputSchema: {
        parentId: z.string().min(1).optional().describe('Container id to create the session under. Omit for the root.'),
        name: z.string().min(1).describe('Session name as it appears in the sidebar.'),
        url: z.string().optional().describe('Page to browse and record (http://, https:// or file://). Can be set later.'),
        protocols: z.array(z.enum(['http', 'websocket', 'graphql', 'grpc-web'])).optional().describe('Protocols to capture. Default: all.'),
        whitelist: z.array(z.string()).optional().describe('Regex sources; a call must match one to be kept. Empty = keep all.'),
        blacklist: z.array(z.string()).optional().describe('Regex sources; a matching call is dropped (wins over the whitelist).'),
        notes: z.string().optional().describe('Free-text notes on the session.')
      } as Record<string, unknown>
    },
    (args) => {
      const name = stringArg(args, 'name')
      if (name === null) return errorReply('name is required')
      const parentId = stringArg(args, 'parentId')
      if (parentId !== null) {
        const parent = collectionStore.findById(parentId)
        // Same placement rule as the sidebar's Add menu: a session lives at
        // the root, in a folder or in an env folder — never inside a scenario.
        if (!parent || !isAnyFolder(parent)) {
          return errorReply(`parentId ${parentId} doesn't point at a folder or env-folder (a recording session cannot live inside a scenario)`)
        }
      }
      const url = typeof args['url'] === 'string' ? args['url'] : ''
      if (url.length > 0 && !isRecordableUrl(url)) return errorReply(`url must start with http://, https:// or file:// — got "${url}"`)
      const protocols = protocolsArg(args)
      if (isErrorResult(protocols)) return errorReply(protocols.error)
      const whitelist = stringListArg(args, 'whitelist')
      if (isErrorResult(whitelist)) return errorReply(whitelist.error)
      const blacklist = stringListArg(args, 'blacklist')
      if (isErrorResult(blacklist)) return errorReply(blacklist.error)
      const badPattern = invalidPattern([...(whitelist ?? []), ...(blacklist ?? [])])
      if (badPattern !== null) return errorReply(badPattern)
      const notes = typeof args['notes'] === 'string' ? args['notes'] : undefined
      const session = collectionStore.createRecording(parentId, {
        name,
        url,
        ...(protocols !== null ? { protocols } : {}),
        whitelist: whitelist ?? [],
        blacklist: blacklist ?? [],
        ...(notes !== undefined ? { notes } : {})
      })
      broadcastTreeReplace()
      triggerSave()
      return jsonReply(sessionSummary(session, parentId))
    }
  )

  mcp.registerTool(
    'update_recording_session',
    {
      titleKey: 'mcpToolTitles.updateRecordingSession',
      title: 'Update a recording session',
      description:
        'Patch a recording session\'s `name`, `url`, `notes` or captured `protocols`. Only the fields you ' +
        'pass change. Use `set_recording_filters` for the whitelist / blacklist. A protocol change applies ' +
        'to a recording in progress immediately. Returns the updated session summary.',
      inputSchema: {
        sessionId: z.string().min(1).describe('Recording session id.'),
        name: z.string().min(1).optional(),
        url: z.string().optional().describe('Page to record (http://, https:// or file://).'),
        notes: z.string().optional(),
        protocols: z.array(z.enum(['http', 'websocket', 'graphql', 'grpc-web'])).optional()
      } as Record<string, unknown>
    },
    (args) => {
      const sessionId = stringArg(args, 'sessionId')
      if (sessionId === null) return errorReply('sessionId is required')
      const session = findSession(sessionId)
      if (!session) return errorReply(`No recording session with id ${sessionId}`)
      const patch: Partial<RecordingSession> = {}
      const name = stringArg(args, 'name')
      if (name !== null) patch.name = name
      if (typeof args['url'] === 'string') {
        if (args['url'].length > 0 && !isRecordableUrl(args['url'])) return errorReply(`url must start with http://, https:// or file:// — got "${args['url']}"`)
        patch.url = args['url']
      }
      if (typeof args['notes'] === 'string') patch.notes = args['notes']
      const protocols = protocolsArg(args)
      if (isErrorResult(protocols)) return errorReply(protocols.error)
      if (protocols !== null) patch.protocols = protocols
      if (Object.keys(patch).length === 0) return errorReply('nothing to update — pass at least one of name, url, notes, protocols')
      const updated = collectionStore.updateRecording(sessionId, patch)
      if (!updated) return errorReply(`updateRecording failed for ${sessionId}`)
      if (protocols !== null) recordingCaptureStore.setFilters(sessionId, filterConfigOf(updated))
      broadcastTreeReplace()
      triggerSave()
      return jsonReply(sessionSummary(updated, collectionStore.findParentFolder(sessionId)?.id ?? null))
    }
  )

  mcp.registerTool(
    'set_recording_filters',
    {
      titleKey: 'mcpToolTitles.setRecordingFilters',
      title: 'Set the url filters of a recording session',
      description:
        'Replace the regex `whitelist` and/or `blacklist` of a recording session (pass a list to replace ' +
        'it, an empty list to clear it, omit it to keep it). A captured call is kept when its url matches ' +
        'at least one whitelist entry (or the whitelist is empty) AND no blacklist entry — the blacklist ' +
        'has the last word. The new filters apply to the calls captured from now on; pass ' +
        '`applyToExisting: true` to also DROP the already-captured calls that no longer pass (irreversible ' +
        '— the reply tells how many were removed).',
      inputSchema: {
        sessionId: z.string().min(1).describe('Recording session id.'),
        whitelist: z.array(z.string()).optional().describe('Regex sources. A call must match one to be kept; empty = keep all.'),
        blacklist: z.array(z.string()).optional().describe('Regex sources. A matching call is dropped.'),
        applyToExisting: z.boolean().optional().describe('Also remove the already-captured calls the new filters reject. Default false.')
      } as Record<string, unknown>
    },
    (args) => {
      const sessionId = stringArg(args, 'sessionId')
      if (sessionId === null) return errorReply('sessionId is required')
      const session = findSession(sessionId)
      if (!session) return errorReply(`No recording session with id ${sessionId}`)
      const whitelist = stringListArg(args, 'whitelist')
      if (isErrorResult(whitelist)) return errorReply(whitelist.error)
      const blacklist = stringListArg(args, 'blacklist')
      if (isErrorResult(blacklist)) return errorReply(blacklist.error)
      if (whitelist === null && blacklist === null) return errorReply('pass whitelist and/or blacklist')
      const badPattern = invalidPattern([...(whitelist ?? []), ...(blacklist ?? [])])
      if (badPattern !== null) return errorReply(badPattern)
      const patch: Partial<RecordingSession> = {}
      if (whitelist !== null) patch.whitelist = whitelist
      if (blacklist !== null) patch.blacklist = blacklist
      const updated = collectionStore.updateRecording(sessionId, patch)
      if (!updated) return errorReply(`updateRecording failed for ${sessionId}`)
      recordingCaptureStore.setFilters(sessionId, filterConfigOf(updated))
      const removed = args['applyToExisting'] === true ? recordingCaptureStore.applyFiltersToExisting(sessionId) : []
      broadcastTreeReplace()
      triggerSave()
      return jsonReply({
        sessionId,
        whitelist: updated.whitelist,
        blacklist: updated.blacklist,
        removedCaptures: removed.length,
        captureCount: recordingCaptureStore.status(sessionId).captureCount
      })
    }
  )

  mcp.registerTool(
    'start_recording',
    {
      titleKey: 'mcpToolTitles.startRecording',
      title: 'Start recording a session',
      description:
        'Start recording a session: opens the session\'s page in the built-in mini-browser (a workbench ' +
        'tab the user can see and drive) and captures the API calls the page makes, filtered by the ' +
        'session\'s protocols / whitelist / blacklist. The session needs a valid `url` first. Returns once ' +
        'the capture engine is attached (`{ started: true, status }`) or an explicit error — never a ' +
        'silent no-op. Calling it on a session already recording returns the current status. Then ' +
        'interact with the page (or let it load), poll `list_recording_captures`, and `stop_recording`.',
      inputSchema: {
        sessionId: z.string().min(1).describe('Recording session id.')
      } as Record<string, unknown>
    },
    async (args) => {
      const sessionId = stringArg(args, 'sessionId')
      if (sessionId === null) return errorReply('sessionId is required')
      const session = findSession(sessionId)
      if (!session) return errorReply(`No recording session with id ${sessionId}`)
      const current = recordingCaptureStore.status(sessionId)
      if (current.state !== 'idle') return jsonReply({ started: false, alreadyRecording: true, status: current })
      if (!isRecordableUrl(session.url)) {
        return errorReply(`the session has no recordable url ("${session.url}") — set one with update_recording_session first`)
      }
      const result = await startRecordingViaRenderer(sessionId)
      if (!result.ok) return errorReply(`start_recording failed: ${result.error}`)
      return jsonReply({ started: true, status: result.status })
    }
  )

  mcp.registerTool(
    'stop_recording',
    {
      titleKey: 'mcpToolTitles.stopRecording',
      title: 'Stop recording a session',
      description:
        'Stop the recording of a session: detaches the capture engine and closes the session\'s browser ' +
        'tab. The captured calls stay available (in memory, until the project is closed) for ' +
        '`list_recording_captures` / `get_recording_capture` / `deduce_recording_routes`. Idempotent.',
      inputSchema: {
        sessionId: z.string().min(1).describe('Recording session id.')
      } as Record<string, unknown>
    },
    (args) => {
      const sessionId = stringArg(args, 'sessionId')
      if (sessionId === null) return errorReply('sessionId is required')
      if (!findSession(sessionId)) return errorReply(`No recording session with id ${sessionId}`)
      const wasRecording = recordingCaptureStore.status(sessionId).state !== 'idle'
      const status = recordingCaptureEngine.stop(sessionId)
      // The renderer owns the browser tab + the staged start intent.
      broadcast('mcp:stop-recording', { sessionId })
      return jsonReply({ stopped: wasRecording, status })
    }
  )

  mcp.registerTool(
    'get_recording_status',
    {
      titleKey: 'mcpToolTitles.getRecordingStatus',
      title: 'Get the status of a recording session',
      description:
        'Live status of a recording session: `{ state, runId, captureCount }` (`state` is `idle` | ' +
        '`recording` | `paused`) plus its `runs` (one per start/stop, with `startedAt` / `endedAt`).',
      inputSchema: {
        sessionId: z.string().min(1).describe('Recording session id.')
      } as Record<string, unknown>
    },
    (args) => {
      const sessionId = stringArg(args, 'sessionId')
      if (sessionId === null) return errorReply('sessionId is required')
      if (!findSession(sessionId)) return errorReply(`No recording session with id ${sessionId}`)
      const status = recordingCaptureStore.status(sessionId)
      return jsonReply({
        sessionId,
        state: status.state,
        runId: status.runId,
        captureCount: status.captureCount,
        runs: recordingCaptureStore.runs(sessionId)
      })
    }
  )

  mcp.registerTool(
    'list_recording_captures',
    {
      titleKey: 'mcpToolTitles.listRecordingCaptures',
      title: 'List the captured calls of a recording session',
      description:
        'Lightweight list of the calls captured by a recording session, oldest first: `{ id, runId, ' +
        'protocol, method, url, status, timestamp, resourceType, ... }` — no headers or bodies. Pull one ' +
        'call in full with `get_recording_capture`. Filter by `runId` or `protocol`; `limit` keeps the ' +
        'MOST RECENT n calls.',
      inputSchema: {
        sessionId: z.string().min(1).describe('Recording session id.'),
        runId: z.string().min(1).optional().describe('Only the calls of this run (see get_recording_status).'),
        protocol: z.enum(['http', 'websocket', 'graphql', 'grpc-web']).optional().describe('Only the calls of this protocol.'),
        limit: z.coerce.number().int().min(1).max(1000).optional().describe('Keep the most recent n calls.')
      } as Record<string, unknown>
    },
    (args) => {
      const sessionId = stringArg(args, 'sessionId')
      if (sessionId === null) return errorReply('sessionId is required')
      if (!findSession(sessionId)) return errorReply(`No recording session with id ${sessionId}`)
      const runId = stringArg(args, 'runId')
      const protocol = stringArg(args, 'protocol')
      if (protocol !== null && !isRecordingProtocol(protocol)) return errorReply(`protocol must be one of ${RECORDING_PROTOCOLS.join(', ')}`)
      const all = recordingCaptureStore.list(sessionId)
        .filter((c) => (runId === null || c.runId === runId) && (protocol === null || c.protocol === protocol))
      const limit = typeof args['limit'] === 'number' && Number.isFinite(args['limit']) ? Math.max(1, Math.floor(args['limit'])) : null
      const captures = limit !== null && all.length > limit ? all.slice(all.length - limit) : all
      return jsonReply({ sessionId, count: captures.length, totalAvailable: all.length, captures })
    }
  )

  mcp.registerTool(
    'get_recording_capture',
    {
      titleKey: 'mcpToolTitles.getRecordingCapture',
      title: 'Get one captured call in full',
      description:
        'Full detail of one captured call: request (method, url, headers, body) and response (status, ' +
        'headers, body, timing), plus the protocol-specific parts (GraphQL operation, gRPC-web method, ' +
        'WebSocket frames). Bodies are returned as captured (utf8 text or base64).',
      inputSchema: {
        sessionId: z.string().min(1).describe('Recording session id.'),
        captureId: z.string().min(1).describe('Capture id from list_recording_captures.')
      } as Record<string, unknown>
    },
    (args) => {
      const sessionId = stringArg(args, 'sessionId')
      if (sessionId === null) return errorReply('sessionId is required')
      const captureId = stringArg(args, 'captureId')
      if (captureId === null) return errorReply('captureId is required')
      if (!findSession(sessionId)) return errorReply(`No recording session with id ${sessionId}`)
      const detail = recordingCaptureStore.get(sessionId, captureId)
      if (!detail) return errorReply(`No capture ${captureId} in session ${sessionId} (captures live in memory — was the project reopened?)`)
      return jsonReply(detail)
    }
  )

  mcp.registerTool(
    'deduce_recording_routes',
    {
      titleKey: 'mcpToolTitles.deduceRecordingRoutes',
      title: 'Deduce the routes of a recording session',
      description:
        'Turn the captured calls of a recording session into replayable requests: groups the calls by ' +
        'route (path segments that vary across calls become `{{param}}` path parameters), builds a ' +
        'folder tree by static path prefix under the session\'s Routes node, and creates one ordinary ' +
        'Restorm request per route (HTTP, GraphQL, gRPC-web or WebSocket) prefilled from the last ' +
        'successful call. The captured calls are written to each request\'s response history. Deducing ' +
        'again MERGES: only new routes are added, existing (possibly edited) requests are untouched. ' +
        'Returns `{ routes, newRoutes, folders, created: [{ id, name, kind }], historyEntries }`. Use ' +
        '`list_requests` with `parentId` = the session id (or `restorm://tree`) to browse the result.',
      inputSchema: {
        sessionId: z.string().min(1).describe('Recording session id.')
      } as Record<string, unknown>
    },
    async (args) => {
      const sessionId = stringArg(args, 'sessionId')
      if (sessionId === null) return errorReply('sessionId is required')
      const session = findSession(sessionId)
      if (!session) return errorReply(`No recording session with id ${sessionId}`)
      const captures = recordingCaptureStore.list(sessionId)
      if (captures.length === 0) return errorReply('the session has no captured call — start_recording, drive the page, stop_recording first')
      const tree = deduceRoutes(captures)
      const references = new Map<string, RecordedCallDetail>()
      for (const route of flattenRoutes(tree)) {
        if (route.lastSuccessCaptureId === null) continue
        const detail = recordingCaptureStore.get(sessionId, route.lastSuccessCaptureId)
        if (detail) references.set(route.lastSuccessCaptureId, detail)
      }
      const result = materializeDeducedTree(tree, references, session.items, () => randomUUID())
      let historyEntries = 0
      if (result.created.length > 0) {
        collectionStore.bumpModelVersion()
        session.items = result.items
        collectionStore.notifyRecordingUpdated(session)
        broadcastTreeReplace()
        triggerSave()
        historyEntries = await materializeRecordingHistory(sessionId, result.history)
      }
      return jsonReply({
        sessionId,
        routes: result.summary.routes,
        newRoutes: result.summary.newRoutes,
        folders: result.summary.folders,
        created: result.created.map(({ item, parentId }) => ({
          id: item.id,
          name: item.name,
          kind: isRequest(item as unknown as FolderItem) ? 'request' : 'folder',
          parentId: parentId ?? sessionId
        })),
        historyEntries
      })
    }
  )
}
