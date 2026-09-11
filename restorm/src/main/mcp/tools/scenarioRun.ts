/**
 * Run a scenario box, read its result, watch its status, cancel it — MCP
 * surface + the main-process engine the MCP tools and (later) the editor's play
 * button both call.
 *
 * Running a box always goes through a main-process method. A box bound to a
 * sidebar `request` executes through the SAME path as the classic Send
 * (`HTTPExecutionService.execute` + `storeExecutionResult`), so the response
 * lands in the request's history exactly as if the user had clicked Send — and
 * the result is read back FROM that history. A request already played by normal
 * means therefore has a result without re-running.
 *
 * Only the `request` kind runs for now; the generic dispatch + the renderer
 * play→stop / running feedback land in a later slice (this file already tracks
 * in-flight runs so status + cancel work).
 */

import { ipcMain } from 'electron'
import { McpService } from 'electron-core-ui'
import { z } from 'zod'
import { collectionStore } from '../../services/CollectionStore'
import { httpExecutionService, type HTTPExecutionInput } from '../../services/HTTPExecutionService'
import { soapExecutionService } from '../../services/SOAPExecutionService'
import { responseHistoryService, requestUsageService } from '../../services'
import type { ResponseHistoryOutcome } from '../../../shared/types/responseHistory'
import { isHTTPRequest, isAuthenticationRequest, isSoapRequest } from '../../../shared/types/collections'
import type { Scenario } from '../../../shared/models/Scenario'
import type { ScenarioNode } from '../../../shared/types/scenario'
import { readSocketioEvents } from '../../../shared/scenarioNodePorts'
import { socketioPreviewFromMessages } from '../../../shared/utils/socketioPreview'
import { flushRequestStateToContext } from './execute'

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}
function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function findScenario(id: string): Scenario | null {
  const item = collectionStore.findById(id)
  if (!item || (item as { type?: string }).type !== 'scenario') return null
  return item as unknown as Scenario
}

function locateNode(scenarioId: string, nodeId: string): { scenario: Scenario; node: ScenarioNode } {
  const scenario = findScenario(scenarioId)
  if (!scenario) throw new Error(`No scenario with id ${scenarioId}`)
  const node = scenario.nodes.find((n) => n.id === nodeId)
  if (!node) throw new Error(`No node ${nodeId} in scenario ${scenarioId}`)
  return { scenario, node }
}

function boundRequestId(node: ScenarioNode): string {
  const cfg = node.config as Record<string, unknown> | undefined
  return typeof cfg?.['requestId'] === 'string' ? cfg['requestId'] : ''
}

// --- In-flight run registry (drives status + cancel) -----------------------

interface RunningRun { startedAt: string; cancel: () => void }
const running = new Map<string, RunningRun>()
const runKey = (scenarioId: string, nodeId: string): string => `${scenarioId}::${nodeId}`

export interface ScenarioNodeRunSummary {
  nodeId: string
  kind: string
  requestId: string
  success: boolean
  status: number
  durationMs: number
}

/** Execute a `request` box exactly like the classic Send (main exec + history). */
async function executeRequest(node: ScenarioNode, key: string): Promise<ScenarioNodeRunSummary> {
  const requestId = boundRequestId(node)
  if (!requestId) throw new Error(`request node ${node.id} has no bound request (config.requestId)`)
  const req = collectionStore.findById(requestId)
  if (!req) throw new Error(`bound request ${requestId} not found`)
  if (!isHTTPRequest(req)) throw new Error(`bound request ${requestId} is not an HTTP request (${(req as { type?: string }).type})`)

  // Make the executor authoritative whether or not the request's tab is open
  // in the renderer (same fix the MCP run_request uses).
  flushRequestStateToContext(req)

  const authId = req.authenticationRequestId
  const auth = authId ? collectionStore.findById(authId) : null
  const input: HTTPExecutionInput = {
    requestId: req.id,
    method: req.method,
    ...(auth && isAuthenticationRequest(auth) ? { authRequest: auth } : {})
  }
  running.set(key, { startedAt: new Date().toISOString(), cancel: () => { httpExecutionService.cancel(req.id) } })
  const result = await httpExecutionService.execute(input)
  await responseHistoryService.storeExecutionResult(req.id, 'http', result)
  requestUsageService.recordSend(req.id)
  return {
    nodeId: node.id,
    kind: node.kind,
    requestId: req.id,
    success: result.success,
    status: result.statusCode ?? 0,
    durationMs: result.timings.durationMs
  }
}

/** Execute a `soapRequest` box exactly like the classic SOAP Send (main exec +
 * history) — the unary analogue of `executeRequest`, so the inspector's
 * play-from-here button populates the same SOAP history the preview reads. */
async function executeSoapRequest(node: ScenarioNode, key: string): Promise<ScenarioNodeRunSummary> {
  const requestId = boundRequestId(node)
  if (!requestId) throw new Error(`soapRequest node ${node.id} has no bound request (config.requestId)`)
  const req = collectionStore.findById(requestId)
  if (!req) throw new Error(`bound request ${requestId} not found`)
  if (!isSoapRequest(req)) throw new Error(`bound request ${requestId} is not a SOAP request (${(req as { type?: string }).type})`)

  // Make the executor authoritative whether or not the request's tab is open.
  flushRequestStateToContext(req)

  running.set(key, { startedAt: new Date().toISOString(), cancel: () => { soapExecutionService.cancel(req.id) } })
  const result = await soapExecutionService.execute({ requestId: req.id })
  await responseHistoryService.storeExecutionResult(req.id, 'soap', result)
  requestUsageService.recordSend(req.id)
  return {
    nodeId: node.id,
    kind: node.kind,
    requestId: req.id,
    success: result.success,
    status: result.statusCode ?? 0,
    durationMs: result.timings.durationMs
  }
}

/** Duration (ms) for a `wait` box, read from the node's PERSISTED config —
 * `durationMs` / `duration` (already in ms), falling back to 1000ms. Mirrors
 * the scenario engine's wait executor (timeAndFlowExecutors) so the inspector's
 * single-node run waits the same amount as a full run, rather than a divergent
 * 5000ms demo default. (Single-node runs have no wired `duration` input, so the
 * unit toggle that the engine applies to a wired value doesn't apply here.)
 * Exported for unit-test coverage. */
export function waitMs(node: ScenarioNode): number {
  const cfg = node.config as { durationMs?: number; duration?: number } | undefined
  if (typeof cfg?.durationMs === 'number' && cfg.durationMs > 0) return cfg.durationMs
  if (typeof cfg?.duration === 'number' && cfg.duration > 0) return cfg.duration
  return 1000
}

/** Delay for the box's duration; cancelable (the cancel rejects the run). */
async function executeWait(node: ScenarioNode, key: string): Promise<ScenarioNodeRunSummary> {
  const ms = waitMs(node)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { running.delete(key); resolve() }, ms)
    running.set(key, {
      startedAt: new Date().toISOString(),
      cancel: () => { clearTimeout(timer); running.delete(key); reject(new Error('cancelled')) }
    })
  })
  return { nodeId: node.id, kind: node.kind, requestId: '', success: true, status: 0, durationMs: ms }
}

/** Run a scenario box by id. Generic by kind (`request`, `wait` so far). Tracks
 * the run so `get_scenario_node_status` / `cancel_scenario_node` work. */
export async function runScenarioNode(scenarioId: string, nodeId: string): Promise<ScenarioNodeRunSummary> {
  const { node } = locateNode(scenarioId, nodeId)
  const key = runKey(scenarioId, nodeId)
  if (running.has(key)) throw new Error(`node ${nodeId} is already running`)
  try {
    switch (node.kind) {
      // Renderer persists request boxes as `httpRequest`; the older
      // `request` kind is still accepted so any in-flight scenario file
      // pre-rename keeps working.
      case 'httpRequest':
      case 'request':
        return await executeRequest(node, key)
      case 'soapRequest':
        return await executeSoapRequest(node, key)
      case 'wait':
        return await executeWait(node, key)
      default:
        throw new Error(`Running a '${node.kind}' box isn't implemented yet (httpRequest, wait so far)`)
    }
  } finally {
    running.delete(key)
  }
}

/** Whether a box is currently running (+ since when). */
export function getScenarioNodeStatus(scenarioId: string, nodeId: string): { nodeId: string; status: 'running' | 'idle'; startedAt?: string } {
  const entry = running.get(runKey(scenarioId, nodeId))
  return entry ? { nodeId, status: 'running', startedAt: entry.startedAt } : { nodeId, status: 'idle' }
}

/** Cancel a box's in-flight run: a `request` aborts the live HTTP dispatch, a
 * `wait` clears its timer (the awaiting run then settles + clears the registry). */
export function cancelScenarioNode(scenarioId: string, nodeId: string): { cancelled: boolean; reason?: string } {
  const entry = running.get(runKey(scenarioId, nodeId))
  if (!entry) return { cancelled: false, reason: 'not running' }
  entry.cancel()
  return { cancelled: true }
}

/** Per-kind preview-data resolver: each node kind defines how its inspector
 * preview value is fetched. Option A — a strategy registry keyed by kind, so
 * each box has one implementation, without forcing a class hierarchy onto the
 * serialized node model. A kind with no resolver has no preview yet. */
type PreviewResolver = (scenarioId: string, node: ScenarioNode) => Promise<Record<string, unknown> | null>

/** The freshest history entry that did NOT fail — so a preview shows a real
 * successful result (an HTTP 2xx, a connected socket) instead of the latest
 * error. Entries arrive newest-first, so the first non-failure is the freshest.
 * Falls back to the latest entry when every one failed (better a stale error
 * than an empty preview). Shared by every protocol's preview resolver. */
function freshestSuccessfulEntry<T extends { outcome?: ResponseHistoryOutcome }>(entries: readonly T[]): T | undefined {
  return entries.find((e) => e.outcome !== undefined && e.outcome !== 'failure') ?? entries[0]
}

/** `httpRequest` (and legacy `request`): the bound request's last SUCCESSFUL
 * send result — resolved request, raw restorm model, and response — from history. */
const resolveRequestPreview: PreviewResolver = async (_scenarioId, node) => {
  const requestId = boundRequestId(node)
  if (!requestId) return null
  const entries = await responseHistoryService.list(requestId)
  const entry = freshestSuccessfulEntry(entries)
  if (!entry) return null
  const detail = await responseHistoryService.getDetail(entry.guid)
  if (detail?.response.type !== 'http') return null
  const r = detail.response
  const raw = collectionStore.findById(requestId)
  return {
    nodeId: node.id,
    requestId,
    historyGuid: detail.guid,
    timestamp: detail.timestamp,
    request: {
      url: r.requestUrl,
      method: r.requestMethod,
      headers: r.requestHeaders,
      params: r.requestParams,
      pathParams: r.requestPathParams,
      ...(r.requestBody ? { body: r.requestBody } : {})
    },
    restormRequest: raw ?? null,
    response: {
      status: r.statusCode,
      statusText: r.statusText,
      headers: r.responseHeaders,
      body: r.responseBody,
      ...(r.contentType ? { contentType: r.contentType } : {}),
      ...(r.contentLength != null ? { contentLength: r.contentLength } : {}),
      durationMs: r.timings.durationMs,
      ...(r.sentCookies?.length ? { sentCookies: r.sentCookies.map((c) => ({ name: c.key, value: c.value })) } : {}),
      ...(r.receivedCookies?.length ? { receivedCookies: r.receivedCookies.map((c) => ({ name: c.key, value: c.value })) } : {}),
      ...(r.error ? { error: r.error } : {})
    }
  }
}

/** `socketioConnect` / `websocketConnect`: the bound streaming request's latest
 * received message, read from its history — the analogue of the httpRequest
 * preview, so an edge leaving an `event:<name>` / `message` port gets a JSON-path
 * picker over a real frame. Prefers the most recent received frame on a listened
 * event (Socket.IO); a raw WebSocket has no events so it always takes the latest
 * received frame. Null until the connection has run at least once. */
const resolveStreamConnectPreview: PreviewResolver = async (_scenarioId, node) => {
  const requestId = boundRequestId(node)
  if (!requestId) return null
  const entries = await responseHistoryService.list(requestId)
  // Freshest CONNECTED session (a failed/refused connection has no useful
  // received frames) — falls back to the latest if none succeeded.
  const entry = freshestSuccessfulEntry(entries)
  if (!entry) return null
  const detail = await responseHistoryService.getDetail(entry.guid)
  const resp = detail?.response
  if (resp?.type === 'websocket') {
    return socketioPreviewFromMessages(resp.messages, readSocketioEvents(node.config))
  }
  // gRPC streaming: no event names, so the latest received frame wins (like raw WS).
  if (resp?.type === 'grpc') {
    return socketioPreviewFromMessages(resp.messages ?? [], [])
  }
  // SSE: receive-only, no `direction` field on its frames (unlike WS/gRPC) — every
  // stored frame IS a received one, so wrap them before reusing the same helper.
  if (resp?.type === 'sse') {
    return socketioPreviewFromMessages(resp.frames.map((f) => ({ direction: 'received', data: f.data, event: f.event })), [])
  }
  // Kafka consume: messages carry `value` (not `data`) and no `event` — every
  // consumed record is a plain received frame, so the latest one wins.
  if (resp?.type === 'kafka') {
    return socketioPreviewFromMessages((resp.messages ?? []).map((m) => ({ direction: m.direction, data: m.value })), [])
  }
  // STOMP: frames carry `body` (not `data`) and no `event` (destinations are not
  // listenable event names here) — same no-event-names shape as gRPC/Kafka.
  if (resp?.type === 'stomp') {
    return socketioPreviewFromMessages(resp.messages.map((m) => ({ direction: m.direction, data: m.body })), [])
  }
  return null
}

/** `soapRequest`: the bound SOAP request's last SUCCESSFUL send result — resolved
 * request, raw restorm model, and parsed response — from history. The unary
 * analogue of `resolveRequestPreview`, so an edge leaving the `response` port
 * gets a JSON-path picker over real SOAP response data. */
const resolveSoapPreview: PreviewResolver = async (_scenarioId, node) => {
  const requestId = boundRequestId(node)
  if (!requestId) return null
  const entries = await responseHistoryService.list(requestId)
  const entry = freshestSuccessfulEntry(entries)
  if (!entry) return null
  const detail = await responseHistoryService.getDetail(entry.guid)
  if (detail?.response.type !== 'soap') return null
  const r = detail.response
  const raw = collectionStore.findById(requestId)
  return {
    nodeId: node.id,
    requestId,
    historyGuid: detail.guid,
    timestamp: detail.timestamp,
    request: {
      url: r.requestUrl,
      method: 'POST',
      soapAction: r.requestSoapAction,
      headers: r.requestHeaders,
      ...(r.requestBody ? { body: r.requestBody } : {})
    },
    restormRequest: raw ?? null,
    response: {
      status: r.statusCode,
      headers: r.responseHeaders,
      body: r.responseBody,
      durationMs: r.timings.durationMs,
      ...(r.sentCookies?.length ? { sentCookies: r.sentCookies.map((c) => ({ name: c.key, value: c.value })) } : {}),
      ...(r.receivedCookies?.length ? { receivedCookies: r.receivedCookies.map((c) => ({ name: c.key, value: c.value })) } : {}),
      ...(r.fault ? { fault: r.fault } : {}),
      ...(r.error ? { error: r.error } : {})
    }
  }
}

/** `kafkaProduce`: the bound Kafka request's last SUCCESSFUL one-shot produce —
 * resolved request, raw restorm model, and the RecordMetadata (partition/offset)
 * kafkajs returned — from history. The one-shot analogue of `resolveRequestPreview`
 * for a response shape that isn't `type: 'http'`. */
const resolveKafkaProducePreview: PreviewResolver = async (_scenarioId, node) => {
  const requestId = boundRequestId(node)
  if (!requestId) return null
  const entries = await responseHistoryService.list(requestId)
  const entry = freshestSuccessfulEntry(entries)
  if (!entry) return null
  const detail = await responseHistoryService.getDetail(entry.guid)
  if (detail?.response.type !== 'kafka' || detail.response.kafkaMode !== 'produce') return null
  const r = detail.response
  const raw = collectionStore.findById(requestId)
  return {
    nodeId: node.id,
    requestId,
    historyGuid: detail.guid,
    timestamp: detail.timestamp,
    request: { url: r.requestUrl, topic: r.requestTopic },
    restormRequest: raw ?? null,
    response: {
      topic: r.requestTopic,
      ...(r.producedPartition !== undefined ? { partition: r.producedPartition } : {}),
      ...(r.producedOffset !== undefined ? { offset: r.producedOffset } : {}),
      durationMs: r.timings.durationMs,
      ...(r.error ? { error: r.error } : {})
    }
  }
}

/** `code`: the box's last run output (result + captured logs). Unlike a request
 * there's no on-disk history, so the executor caches each run in memory and we
 * read the freshest record back here. Null until the box has actually run. */
const resolveCodePreview: PreviewResolver = async (_scenarioId, node) => {
  const { getCodeRun } = await import('../../scenarioEngine/codeRunCache')
  const run = getCodeRun(node.id)
  if (!run) return null
  return { nodeId: node.id, timestamp: run.timestamp, result: run.result, logs: run.logs }
}

/** Inspector-preview resolvers by node kind. Add a kind's resolver here to give
 * its preview real data as the runner gains the ability to execute that kind. */
const previewResolvers: Partial<Record<ScenarioNode['kind'], PreviewResolver>> = {
  httpRequest: resolveRequestPreview,
  request: resolveRequestPreview,
  soapRequest: resolveSoapPreview,
  socketioConnect: resolveStreamConnectPreview,
  websocketConnect: resolveStreamConnectPreview,
  sseConnect: resolveStreamConnectPreview,
  stompConnect: resolveStreamConnectPreview,
  mqttConnect: resolveStreamConnectPreview,
  amqpConnect: resolveStreamConnectPreview,
  grpcConnect: resolveStreamConnectPreview,
  kafkaProduce: resolveKafkaProducePreview,
  kafkaConsume: resolveStreamConnectPreview,
  code: resolveCodePreview
}

/** A box's last run result as its output context, resolved per kind. Null when
 * the kind has no preview resolver, or it hasn't produced a result yet. */
export async function getScenarioNodeResult(scenarioId: string, nodeId: string): Promise<Record<string, unknown> | null> {
  // A stale upstream reference — the JSON-path picker asks for the result of a
  // node that was since deleted or rewired — must resolve to `null`, NOT throw.
  // The throw would surface as an Electron `console.error` from the
  // `scenario:node-result` ipcMain handler and get captured as crash-report
  // noise, even though the renderer already treats null as "no result yet".
  // (The shared `locateNode` still throws, so the explicit MCP run/cancel tools
  // keep reporting a genuinely bad id.)
  const scenario = findScenario(scenarioId)
  const node = scenario?.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const resolver = previewResolvers[node.kind]
  return resolver ? resolver(scenarioId, node) : null
}

export function registerScenarioRunTools(mcp: McpService): void {
  // Renderer play→stop button plumbing. Guard against a re-register during dev
  // HMR / restart (re-adding a handler on a live channel throws).
  ipcMain.removeHandler('scenario:run-node')
  ipcMain.handle('scenario:run-node', (_e, scenarioId, nodeId) => runScenarioNode(String(scenarioId), String(nodeId)))
  ipcMain.removeHandler('scenario:cancel-node')
  ipcMain.handle('scenario:cancel-node', (_e, scenarioId, nodeId) => cancelScenarioNode(String(scenarioId), String(nodeId)))
  // Read a box's last run result as its output context — the JSON-path selector
  // popover reads the upstream box's result to let the user pick a property.
  ipcMain.removeHandler('scenario:node-result')
  ipcMain.handle('scenario:node-result', (_e, scenarioId, nodeId) => getScenarioNodeResult(String(scenarioId), String(nodeId)))

  const ids = {
    scenarioId: z.string().min(1).describe('Scenario id.'),
    nodeId: z.string().min(1).describe('Node (box) id.')
  }

  mcp.registerTool(
    'run_scenario_node',
    {
      titleKey: 'mcpToolTitles.runScenarioNode',
      title: 'Run a scenario box',
      description:
        'Execute one box of a scenario by node id. A box bound to a sidebar request runs through the same ' +
        'path as the classic Send (main-process execution, response stored in the request history). Only the ' +
        '`request` kind runs for now. Returns a run summary; read the full output context with ' +
        '`get_scenario_node_result`.',
      inputSchema: ids as Record<string, unknown>
    },
    async (args) => {
      try {
        return jsonReply(await runScenarioNode(String(args['scenarioId']), String(args['nodeId'])))
      } catch (err) {
        return errorReply(err instanceof Error ? err.message : String(err))
      }
    }
  )

  mcp.registerTool(
    'get_scenario_node_result',
    {
      titleKey: 'mcpToolTitles.getScenarioNodeResult',
      title: 'Get a scenario box result',
      description:
        'Read a box\'s last run result as its output context. For a `request` box this comes from the bound ' +
        'request history (so a request already played normally has a result without re-running): ' +
        '`{ request (resolved values sent), restormRequest (raw request: unresolved + notes + env), response ' +
        '(status, headers, durationMs, body) }`. Null if the box has no result yet.',
      inputSchema: ids as Record<string, unknown>
    },
    async (args) => {
      try {
        const result = await getScenarioNodeResult(String(args['scenarioId']), String(args['nodeId']))
        return result === null ? errorReply('No result for this node yet (not run, or not a request box).') : jsonReply(result)
      } catch (err) {
        return errorReply(err instanceof Error ? err.message : String(err))
      }
    }
  )

  mcp.registerTool(
    'get_scenario_node_status',
    {
      titleKey: 'mcpToolTitles.getScenarioNodeStatus',
      title: 'Scenario box run status',
      description: 'Whether a box is currently running (`running` / `idle`), and since when.',
      inputSchema: ids as Record<string, unknown>
    },
    (args) => {
      try {
        return jsonReply(getScenarioNodeStatus(String(args['scenarioId']), String(args['nodeId'])))
      } catch (err) {
        return errorReply(err instanceof Error ? err.message : String(err))
      }
    }
  )

  mcp.registerTool(
    'cancel_scenario_node',
    {
      titleKey: 'mcpToolTitles.cancelScenarioNode',
      title: 'Cancel a scenario box run',
      description: 'Cancel a box\'s in-flight run. For a `request` box this aborts the live HTTP dispatch.',
      inputSchema: ids as Record<string, unknown>
    },
    (args) => {
      try {
        return jsonReply(cancelScenarioNode(String(args['scenarioId']), String(args['nodeId'])))
      } catch (err) {
        return errorReply(err instanceof Error ? err.message : String(err))
      }
    }
  )
}
