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

import { McpService } from 'electron-core-ui'
import { z } from 'zod'
import { collectionStore } from '../../services/CollectionStore'
import { httpExecutionService, type HTTPExecutionInput } from '../../services/HTTPExecutionService'
import { responseHistoryService, requestUsageService } from '../../services'
import { isHTTPRequest, isAuthenticationRequest } from '../../../shared/types/collections'
import type { Scenario } from '../../../shared/models/Scenario'
import type { ScenarioNode } from '../../../shared/types/scenario'
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

interface RunningRun { startedAt: string; requestId?: string }
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
async function executeRequest(node: ScenarioNode): Promise<ScenarioNodeRunSummary> {
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

/** Run a scenario box by id. Generic by kind; only `request` runs for now.
 * Tracks the run so `get_scenario_node_status` / `cancel_scenario_node` work. */
export async function runScenarioNode(scenarioId: string, nodeId: string): Promise<ScenarioNodeRunSummary> {
  const { node } = locateNode(scenarioId, nodeId)
  if (node.kind !== 'request') {
    throw new Error(`Running a '${node.kind}' box isn't implemented yet (only 'request' so far)`)
  }
  const key = runKey(scenarioId, nodeId)
  if (running.has(key)) throw new Error(`node ${nodeId} is already running`)
  running.set(key, { startedAt: new Date().toISOString(), requestId: boundRequestId(node) })
  try {
    return await executeRequest(node)
  } finally {
    running.delete(key)
  }
}

/** Whether a box is currently running (+ since when). */
export function getScenarioNodeStatus(scenarioId: string, nodeId: string): { nodeId: string; status: 'running' | 'idle'; startedAt?: string } {
  const entry = running.get(runKey(scenarioId, nodeId))
  return entry ? { nodeId, status: 'running', startedAt: entry.startedAt } : { nodeId, status: 'idle' }
}

/** Cancel a box's in-flight run. For a `request` box this aborts the live
 * HTTP dispatch (the awaiting run then settles + clears the registry). */
export function cancelScenarioNode(scenarioId: string, nodeId: string): { cancelled: boolean; reason?: string } {
  const entry = running.get(runKey(scenarioId, nodeId))
  if (!entry) return { cancelled: false, reason: 'not running' }
  if (entry.requestId) httpExecutionService.cancel(entry.requestId)
  return { cancelled: true }
}

/** A box's last run result as its output context. For a `request` box that's
 * the request's history: { resolved request, raw restorm request, response }.
 * Null if it hasn't run (no history) yet. */
export async function getScenarioNodeResult(scenarioId: string, nodeId: string): Promise<Record<string, unknown> | null> {
  const { node } = locateNode(scenarioId, nodeId)
  if (node.kind !== 'request') return null
  const requestId = boundRequestId(node)
  if (!requestId) return null
  const entries = await responseHistoryService.list(requestId)
  if (entries.length === 0) return null
  const detail = await responseHistoryService.getDetail(entries[0].guid)
  if (detail?.response.type !== 'http') return null
  const r = detail.response
  const raw = collectionStore.findById(requestId)
  return {
    nodeId,
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
      ...(r.error ? { error: r.error } : {})
    }
  }
}

export function registerScenarioRunTools(mcp: McpService): void {
  const ids = {
    scenarioId: z.string().min(1).describe('Scenario id.'),
    nodeId: z.string().min(1).describe('Node (box) id.')
  }

  mcp.registerTool(
    'run_scenario_node',
    {
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
