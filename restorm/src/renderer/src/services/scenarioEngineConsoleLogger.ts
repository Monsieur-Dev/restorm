/**
 * Temporary debug aid: log EVERY scenario-engine event to the
 * application's console (via the ECUI `logger`, which writes to the
 * DevTools console) — run start/stop, each action's start/end, the
 * caller (launcher) scenario id, and the timestamp — so runs (incl.
 * sub-scenarios) can be analysed end-to-end while the proper in-app
 * logs panel is built.
 *
 * Installed ONCE at app startup (a single global subscription, so it
 * doesn't duplicate per open scenario tab the way the per-editor
 * `useScenarioEngine` subscriptions would).
 */

import { logger } from 'electron-core-ui/renderer'

interface EngineEventLike {
  type: string
  at?: string
  runId?: string
  /** The top-level scenario that launched the run (the "callerId"). */
  launcherScenarioId?: string
  scenarioId?: string
  nodeId?: string
  scope?: { scopeNodeId?: string; index?: number }[]
  edgeId?: string
  error?: string
  reason?: string
}

interface Runtime {
  onScenarioEngineEvent?: (cb: (event: EngineEventLike) => void) => () => void
}

function runtime(): Runtime | undefined {
  return (window as unknown as { restorm?: { runtime?: Runtime } }).restorm?.runtime
}

function fmtScope(scope: EngineEventLike['scope']): string {
  if (!Array.isArray(scope) || scope.length === 0) return '-'
  return scope.map((f) => `${f.scopeNodeId ?? '?'}#${f.index ?? '?'}`).join('/')
}

let installed = false

/** Wire the one-time global console logger. No-op on a second call. */
export function installScenarioEngineConsoleLogger(): void {
  if (installed) return
  const rt = runtime()
  if (!rt?.onScenarioEngineEvent) return
  installed = true
  rt.onScenarioEngineEvent((event) => {
    const data: Record<string, unknown> = {
      ts: event.at ?? new Date().toISOString(),
      caller: event.launcherScenarioId ?? '-',
      run: event.runId ?? '-'
    }
    if (event.scenarioId !== undefined) data['scenario'] = event.scenarioId
    if (event.nodeId !== undefined) { data['node'] = event.nodeId; data['scope'] = fmtScope(event.scope) }
    if (event.edgeId !== undefined) data['edge'] = event.edgeId
    if (event.error !== undefined) data['error'] = event.error
    if (event.reason !== undefined) data['reason'] = event.reason
    logger.info(`[scenario] ${event.type}`, data)
  })
}
