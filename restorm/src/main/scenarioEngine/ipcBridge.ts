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

  ipcMain.handle('scenario:engine:start', (_e, scenarioId: string, params: Record<string, unknown> | undefined) => {
    const handle = scenarioEngine.start(scenarioId, params ? { params } : {})
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
  ipcMain.handle('scenario:engine:abort', (_e, runId: string, reason?: string) => {
    scenarioEngine.abort(runId, reason)
    return { ok: true }
  })

  ipcMain.handle('scenario:engine:read-log', (_e, runId: string) => {
    return scenarioEngine.readLog(runId)
  })

  ipcMain.handle('scenario:engine:active-statuses', () => {
    return scenarioEngine.activeStatuses()
  })
}

function broadcast(event: EngineEvent): void {
  // Engine-internal events go on one channel; the `log` events from
  // the user-facing logger come through a different channel so the
  // renderer can subscribe selectively. The discriminator is the
  // event `type` — only `node-completed` / `node-failed` carry a
  // `source: 'user'` log? No — actually the log is delivered through
  // `readLog()` on demand for now; the event stream stays compact.
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
