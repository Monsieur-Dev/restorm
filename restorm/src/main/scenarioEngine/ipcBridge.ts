/**
 * IPC bridge between the main-process `ScenarioEngine` and the
 * renderer. Forwards every `EngineEvent` to whichever window is
 * focused, exposes start/pause/resume/step/abort handlers, and
 * surfaces the run log on demand.
 *
 * Two distinct channels:
 *  - `scenario:engine:event` — every engine event (node-started,
 *    -completed, -failed, data-flow-emitted, run-paused/resumed/…).
 *    Drives node animations + edge beams.
 *  - `scenario:engine:user-log` — buffered user-facing log messages
 *    (from the Log action node + any executor that pushes
 *    `source: 'user'`). The UI can render these in a console panel
 *    when one ships; until then we keep them in main memory for the
 *    next consumer.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { scenarioEngine } from './engine'
import { scenarioRunHistoryService } from '../services/ScenarioRunHistoryService'
import { scenarioUsageService } from '../services'
import type { EngineEvent, RuntimeId } from './types'

let installed = false

export function installScenarioEngineIPC(): void {
  if (installed) return
  installed = true

  // Forward every event from every active scheduler to every focused
  // window. Each window subscribes once via preload — the renderer
  // dispatches on `runId` if multiple runs are observed.
  scenarioEngine.onAnyEvent((event) => {
    broadcast(event)
  })

  ipcMain.handle('scenario:engine:start', (_e, scenarioId: string, params: Record<string, unknown> | undefined, startPaused?: boolean, breakpoints?: string[], debug?: boolean) => {
    // From the editor (UI) → interactive: no-predecessor input nodes prompt
    // the user (grouped "run parameters" modal) instead of using their default.
    // `startPaused` arms the run at the start (step-by-step launched from idle).
    // `breakpoints` are always armed (so the Debug button can later honor them
    // mid-run, see `set-debug`), but only HONORED when `debug` is true — the
    // plain Play button passes `debug:false` and runs straight through.
    const debugOpts = breakpoints && breakpoints.length > 0 ? { breakpoints, debug: debug === true } : {}
    // Record the run for the EmptyBench recent-activity lists. Only this
    // top-level interactive entry counts — sub-scenarios start via the
    // scheduler, not this IPC, so the fan-out isn't double-counted.
    scenarioUsageService.recordRun(scenarioId)
    const handle = scenarioEngine.start(scenarioId, { ...(params ? { params } : {}), interactive: true, ...(startPaused === true ? { startPaused: true } : {}), ...debugOpts })
    // `done` is intentionally NOT awaited — the renderer observes
    // the run via events, not the IPC return value. We return the
    // runId so a caller can pause / abort it later.
    void handle.done.catch(() => { /* swallow — errors surface via events */ })
    return { runId: handle.scheduler.runId }
  })

  ipcMain.handle('scenario:engine:pause', (_e, runId: string) => {
    scenarioEngine.pause(runId)
    return { ok: true }
  })
  ipcMain.handle('scenario:engine:resume', (_e, runId: string) => {
    scenarioEngine.resume(runId)
    return { ok: true }
  })
  ipcMain.handle('scenario:engine:step', (_e, runId: string) => {
    scenarioEngine.step(runId)
    return { ok: true }
  })
  // Turn a live run into a debug run (Debug pressed mid-run): the scheduler
  // starts honoring breakpoints from the next node.
  ipcMain.handle('scenario:engine:set-debug', (_e, runId: string, enabled: boolean) => {
    scenarioEngine.setDebug(runId, enabled)
    return { ok: true }
  })
  // Push the current breakpoint set onto a live run (the user toggled one
  // during execution).
  ipcMain.handle('scenario:engine:set-breakpoints', (_e, runId: string, ids: string[]) => {
    scenarioEngine.setBreakpoints(runId, Array.isArray(ids) ? ids : [])
    return { ok: true }
  })
  ipcMain.handle('scenario:engine:abort', (_e, runId: string, reason?: string) => {
    scenarioEngine.abort(runId, reason)
    return { ok: true }
  })

  ipcMain.handle('scenario:engine:read-log', (_e, runId: string) => {
    return scenarioEngine.readLog(runId)
  })

  // The whole run tree (the run + every sub-scenario run it launched),
  // each with its metadata + current log — so the inspector can show a
  // run's logs incl. its sub-scenarios' actions.
  ipcMain.handle('scenario:engine:run-tree', (_e, runId: string) => {
    return scenarioEngine.runTree(runId)
  })

  ipcMain.handle('scenario:engine:resolve-user-input', (_e, runId: string, requestId: string, value: unknown) => {
    scenarioEngine.resolveUserInput(runId, requestId, value)
    return { ok: true }
  })

  ipcMain.handle('scenario:engine:cancel-user-input', (_e, runId: string, requestId: string) => {
    scenarioEngine.cancelUserInput(runId, requestId)
    return { ok: true }
  })

  ipcMain.handle('scenario:engine:active-statuses', () => {
    return scenarioEngine.activeStatuses()
  })

  // Persisted run history (disk archive, survives restart) — distinct from
  // the in-memory `run-tree` archive above. Powers the scenario tab's
  // run-history modal.
  ipcMain.handle('scenario:history:list', (_e, scenarioId: string) => {
    return scenarioRunHistoryService.list(scenarioId)
  })
  ipcMain.handle('scenario:history:detail', (_e, guid: string) => {
    return scenarioRunHistoryService.getDetail(guid)
  })
  ipcMain.handle('scenario:history:toggle-pin', (_e, guid: string, pinned: boolean) => {
    return scenarioRunHistoryService.togglePin(guid, pinned)
  })
}

function broadcast(event: EngineEvent): void {
  // Engine events stream on `scenario:engine:event`; run-log entries are NOT in
  // this stream — they're pulled on demand via `readLog()` so the event stream
  // stays compact.
  for (const win of BrowserWindow.getAllWindows()) {
    try { win.webContents.send('scenario:engine:event', event) } catch { /* swallow */ }
  }
}

/** Useful in tests to clear the singleton's `installed` latch so a
 * fresh subscription can be re-installed without a process restart. */
export function _resetForTests(): void {
  installed = false
}

export type { EngineEvent, RuntimeId }
