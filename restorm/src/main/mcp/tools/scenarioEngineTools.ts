/**
 * MCP tools that drive the Phase 2 full-scenario engine — `run_scenario`,
 * `get_scenario_run_status`, `stop_scenario_run`.
 *
 * Two modes for the run tool:
 *  - **Blocking**: awaits the run's completion, capped by
 *    `blockingTimeoutMs` (default 60s). Returns `{ status: 'done',
 *    output, log }`. When the cap hits, degrades into a handle and
 *    returns `{ status: 'running', runId }` — the agent then polls
 *    `get_scenario_run_status` instead of being stuck forever.
 *  - **Non-blocking**: returns the `runId` immediately. The agent
 *    polls `get_scenario_run_status` to see when the run lands.
 *
 * Same `runId` shared across both modes, so a blocking call that
 * degraded into a handle can still be polled / stopped exactly like
 * a non-blocking one.
 *
 * Logs returned by `get_scenario_run_status` include BOTH engine
 * entries (node lifecycle) AND user-pushed entries from `log` action
 * nodes — that's the only knob the agent has to introspect what the
 * graph "said" during the run.
 */

import { z } from 'zod'
import type { McpService } from 'electron-core-ui'
import type { TFunction } from 'i18next'
import { scenarioEngine, type RunHandle } from '../../scenarioEngine/engine'
import type { EngineEvent, RunLogEntry, RuntimeId } from '../../scenarioEngine/types'
import { collectionStore } from '../../services/CollectionStore'
import { scenarioUsageService } from '../../services'
import { validateScenarioModel } from '../../../shared/scenarioValidation'
import type { Scenario } from '../../../shared/models/Scenario'

/** Minimal interpolating translator so the model validator yields readable
 * English messages without pulling i18next into the main process. */
const validationT = ((_key: string, def: string, opts?: Record<string, unknown>): string => {
  let out = def
  if (opts) for (const [k, v] of Object.entries(opts)) out = out.replace(`{{${k}}}`, String(v))
  return out
}) as unknown as TFunction

function findScenarioModel(id: string): Scenario | null {
  const item = collectionStore.findById(id)
  if (!item || (item as { type?: string }).type !== 'scenario') return null
  return item as unknown as Scenario
}

/** A scenario carrying editor-level validation errors must not run — mirror the
 * disabled Play button. Returns a human-readable summary, or null when clean. */
function blockingValidationSummary(scenarioId: string): string | null {
  const scenario = findScenarioModel(scenarioId)
  if (!scenario) return null
  const byNode = validateScenarioModel(scenario, validationT)
  if (byNode.size === 0) return null
  const lines: string[] = []
  for (const [nodeId, errs] of byNode) {
    for (const e of errs) lines.push(`  • [${nodeId}${e.field ? `/${e.field}` : ''}] ${e.message}`)
  }
  return `Cannot run "${scenario.name || scenarioId}": ${lines.length} validation error(s) must be fixed first:\n${lines.join('\n')}`
}

/** Default cap on a blocking run before degrading to a handle. */
const DEFAULT_BLOCKING_TIMEOUT_MS = 60_000

interface ActiveRun {
  handle: RunHandle
  output: Record<string, unknown> | null
  /** Last terminal state observed (engine emits one of these). */
  state: 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
  error?: string
}

// Keep a record of every started run so `get_scenario_run_status` can
// answer even after the scheduler is gone from the engine's
// `activeRuns` map (which clears on completion).
const recentRuns = new Map<RuntimeId, ActiveRun>()
let captureInstalled = false

/** Cap on the run history kept here (mirrors the engine archive's bound). Past
 * this, the oldest FINISHED runs are evicted in insertion order; in-flight runs
 * are never evicted, so a status poll always finds a live run. */
const MAX_RECENT_RUNS = 100

/** Evict the oldest finished runs once `recentRuns` grows past the cap. */
function pruneRecentRuns(): void {
  if (recentRuns.size <= MAX_RECENT_RUNS) return
  for (const [id, entry] of recentRuns) {
    if (recentRuns.size <= MAX_RECENT_RUNS) break
    if (entry.state === 'running' || entry.state === 'paused') continue
    recentRuns.delete(id)
  }
}

/** Install the fan-out listener once — keeps `recentRuns` updated as
 * engine events stream past. */
function ensureCapture(): void {
  if (captureInstalled) return
  captureInstalled = true
  scenarioEngine.onAnyEvent((event: EngineEvent) => {
    const entry = recentRuns.get(event.runId)
    if (!entry) return
    switch (event.type) {
      case 'run-paused': entry.state = 'paused'; break
      case 'run-resumed': entry.state = 'running'; break
      case 'run-completed': entry.state = 'completed'; break
      case 'run-cancelled': entry.state = 'cancelled'; break
      case 'run-failed':
        entry.state = 'failed'
        entry.error = event.error
        break
      default: break
    }
  })
}

export function registerScenarioEngineTools(mcp: McpService): void {
  ensureCapture()

  mcp.registerTool(
    'run_scenario',
    {
      title: 'Run a scenario through the engine',
      description:
        'Execute a scenario end-to-end via the main-process engine. Blocking mode awaits the result up to ' +
        '`blockingTimeoutMs` (default 60 000 ms) and returns `{ status: "done", output, log }`. When the ' +
        'cap hits, the call degrades into a handle and returns `{ status: "running", runId }` — the agent ' +
        'polls `get_scenario_run_status` from there. Non-blocking mode returns the runId immediately.',
      inputSchema: {
        scenarioId: z.string().min(1).describe('Scenario id to run.'),
        params: z.record(z.unknown()).optional().describe('Param map for the scenario\'s predecessor-less `input` nodes, keyed by param name. Supplied params skip their prompt.'),
        interactive: z.boolean().optional().describe('When true, the run PROMPTS for inputs (entry params not supplied via `params`, AND mid-flow inputs) instead of using their defaults. The run then pauses waiting for answers: poll `get_scenario_run_status` to read the pending questions (`pendingInputs`) and answer them with `answer_scenario_input`. Default false (inputs take their configured defaults).'),
        blocking: z.boolean().optional().describe('When true (default), awaits completion within blockingTimeoutMs. When false, returns runId immediately.'),
        blockingTimeoutMs: z.number().int().positive().optional().describe('Cap for blocking mode in ms (default 60 000). When the cap hits, the call degrades into a non-blocking handle.')
      } as Record<string, unknown>
    },
    async (args) => {
      try {
        const scenarioId = String(args['scenarioId'])
        // Refuse a scenario with editor-level validation errors — same gate as
        // the disabled Play button, so MCP can't bypass it.
        const invalid = blockingValidationSummary(scenarioId)
        if (invalid !== null) return errorReply(invalid)
        const params = (args['params'] as Record<string, unknown> | undefined) ?? {}
        const interactive = args['interactive'] === true
        const blocking = args['blocking'] !== false
        const timeoutMs = typeof args['blockingTimeoutMs'] === 'number' && args['blockingTimeoutMs'] > 0
          ? args['blockingTimeoutMs']
          : DEFAULT_BLOCKING_TIMEOUT_MS
        // Count this top-level run for the EmptyBench recent-activity lists,
        // mirroring the UI's `scenario:engine:start` path.
        scenarioUsageService.recordRun(scenarioId)
        const handle = scenarioEngine.start(scenarioId, { params, interactive })
        const runId = handle.scheduler.runId
        const entry: ActiveRun = { handle, output: null, state: 'running' }
        recentRuns.set(runId, entry)
        pruneRecentRuns()
        // Wire completion → entry so a later `get_scenario_run_status`
        // can return the output even after the engine's own activeRuns map has
        // cleared the run (kept here until evicted past MAX_RECENT_RUNS).
        void handle.done.then((output) => { entry.output = output }).catch(() => { /* failure already captured via events */ })
        if (!blocking) {
          return jsonReply({ status: 'running', runId })
        }
        const winner = await Promise.race([
          handle.done.then((output) => ({ kind: 'done' as const, output })),
          delay(timeoutMs).then(() => ({ kind: 'timeout' as const }))
        ])
        if (winner.kind === 'done') {
          return jsonReply({ status: terminalStatus(entry), runId, output: winner.output, log: snapshotLog(runId) })
        }
        // Cap exceeded — degrade into a handle.
        return jsonReply({ status: 'running', runId, note: `Blocking timeout (${timeoutMs} ms) exceeded — degraded into handle.` })
      } catch (err) {
        return errorReply(err instanceof Error ? err.message : String(err))
      }
    }
  )

  mcp.registerTool(
    'get_scenario_run_status',
    {
      title: 'Get a scenario run\'s status',
      description:
        'Returns a run\'s state + chronological log, DURING and AFTER execution (logs are archived per runId, not lost on completion). ' +
        'Log entries include engine events (node start/done, forEach batching) + user-pushed `log` action entries, each with a timestamp, nodeId and scope. ' +
        'When the run launched sub-scenarios, their logs are returned under `subRuns` (each tagged with its own runId, scenarioId and parentRunId) so a whole run tree is recoverable from one top-level runId. ' +
        'Works for any runId in the bounded archive (default: last 50 runs, 2000 entries/run, 30 min TTL).',
      inputSchema: {
        runId: z.string().min(1).describe('Run id returned by `run_scenario` (or any sub-run id seen under `subRuns`).')
      } as Record<string, unknown>
    },
    (args) => {
      const runId = String(args['runId'])
      const tree = scenarioEngine.runTree(runId)
      const [root] = tree
      if (!root) return errorReply(`unknown runId ${runId}`)
      const entry = recentRuns.get(runId)
      // Input prompts the run is waiting on (interactive runs). Answer each with
      // `answer_scenario_input(runId, requestId, value)` — note the per-prompt
      // `runId` (a mid-flow input inside a sub-scenario carries the sub's runId).
      const pendingInputs = scenarioEngine.pendingUserInputs(runId)
      return jsonReply({
        status: entry?.state ?? root.status,
        runId,
        scenarioId: root.scenarioId,
        launcherScenarioId: root.launcherScenarioId,
        ...(pendingInputs.length > 0 ? { pendingInputs } : {}),
        ...(entry?.output != null ? { output: entry.output } : {}),
        ...(entry?.error !== undefined ? { error: entry.error } : {}),
        log: root.log,
        ...(tree.length > 1
          ? {
              subRuns: tree.slice(1).map((r) => ({
                runId: r.runId,
                scenarioId: r.scenarioId,
                ...(r.parentRunId !== undefined ? { parentRunId: r.parentRunId } : {}),
                status: r.status,
                startedAt: r.startedAt,
                ...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {}),
                log: r.log
              }))
            }
          : {})
      })
    }
  )

  mcp.registerTool(
    'list_scenario_runs',
    {
      title: 'List recent scenario runs',
      description:
        'List the engine\'s retained runs (most recent first) — top-level AND sub-scenario runs — so you can discover the runId of a run you did NOT start yourself (e.g. one launched from the UI Play button), then pass it to `get_scenario_run_status` / `stop_scenario_run`. Each item: `{ runId, scenarioId, launcherScenarioId, parentRunId?, status, live, startedAt, endedAt? }`. Bounded by the same archive limits as the logs.',
      inputSchema: {
        scenarioId: z.string().optional().describe('Only runs whose own scenarioId matches.'),
        activeOnly: z.boolean().optional().describe('When true, only currently-running (live) runs.')
      } as Record<string, unknown>
    },
    (args) => {
      const scenarioId = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : undefined
      const activeOnly = args['activeOnly'] === true
      const runs = scenarioEngine.listRuns()
        .filter((r) => (scenarioId === undefined || r.scenarioId === scenarioId))
        .filter((r) => (!activeOnly || r.live))
        .map((r) => ({
          runId: r.runId,
          scenarioId: r.scenarioId,
          launcherScenarioId: r.launcherScenarioId,
          ...(r.parentRunId !== undefined ? { parentRunId: r.parentRunId } : {}),
          status: r.status,
          live: r.live,
          startedAt: r.startedAt,
          ...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {})
        }))
      return jsonReply({ count: runs.length, runs })
    }
  )

  mcp.registerTool(
    'stop_scenario_run',
    {
      title: 'Stop a scenario run',
      description: 'Abort a running scenario. Returns the new state.',
      inputSchema: {
        runId: z.string().min(1).describe('Run id returned by `run_scenario`.'),
        reason: z.string().optional().describe('Free-form reason recorded in the engine log.')
      } as Record<string, unknown>
    },
    (args) => {
      const runId = String(args['runId'])
      const reason = typeof args['reason'] === 'string' ? args['reason'] : 'mcp-stop'
      scenarioEngine.abort(runId, reason)
      const entry = recentRuns.get(runId)
      return jsonReply({ runId, state: entry?.state ?? 'unknown' })
    }
  )

  mcp.registerTool(
    'answer_scenario_input',
    {
      title: 'Answer a scenario input prompt',
      description:
        'Answer (or cancel) an input prompt an interactive run is waiting on. Discover pending prompts via `get_scenario_run_status` → `pendingInputs[]` (each has `runId`, `requestId`, `name`, `defaultValue`, `hint`, `valueType?`). ' +
        'Pass the prompt\'s OWN `runId` (a mid-flow input inside a sub-scenario carries the sub-run\'s id, NOT the top-level one). On answer the input emits the value and the flow continues; on cancel the input routes to its `error` output (or fails the run if `error` is unwired).',
      inputSchema: {
        runId: z.string().min(1).describe('The runId that raised the prompt (from `pendingInputs[].runId`).'),
        requestId: z.string().min(1).describe('The prompt\'s requestId (from `pendingInputs[].requestId`).'),
        value: z.unknown().optional().describe('The value to emit for this input. Required unless `cancel` is true. Match the param\'s type (string / number / boolean / object).'),
        cancel: z.boolean().optional().describe('When true, cancel the prompt (route the input to its `error` output) instead of answering.')
      } as Record<string, unknown>
    },
    (args) => {
      const runId = String(args['runId'])
      const requestId = String(args['requestId'])
      if (args['cancel'] === true) {
        scenarioEngine.cancelUserInput(runId, requestId)
        return jsonReply({ runId, requestId, cancelled: true })
      }
      scenarioEngine.resolveUserInput(runId, requestId, args['value'])
      return jsonReply({ runId, requestId, answered: true })
    }
  )
}

/** Map the engine state into the user-facing terminal label. */
function terminalStatus(entry: ActiveRun): 'done' | 'failed' | 'cancelled' | 'running' {
  switch (entry.state) {
    case 'completed': return 'done'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    default: return 'running'
  }
}

function snapshotLog(runId: RuntimeId): RunLogEntry[] {
  return [...scenarioEngine.readLog(runId)]
}

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
