/**
 * IPC surface of the recording sessions: renderer → main commands
 * (start / stop / pause / list / detail / filters) and the live push of
 * the store's events to every window (a new capture, an update, removals,
 * run and status changes). The renderer's Captures view listens to the
 * pushes and asks for one detail at a time.
 */

import { BrowserWindow } from 'electron'
import { eventBusService, logger, validatedHandle } from 'electron-core-ui/main'
import { miniBrowserService } from '../MiniBrowserService'
import { collectionStore } from '../CollectionStore'
import { recordingCaptureStore, type RecordingStoreEvents } from './RecordingCaptureStore'
import { recordingCaptureEngine } from './RecordingCaptureEngine'
import { captureToHistoryDetail } from './captureHistory'
import { responseHistoryService } from '../ResponseHistoryService'
import { DocumentEvents, type DocumentDeletedPayload } from '../DocumentEvents'
import type { RecordingHistoryPlanEntry } from '../../../shared/types/recordingCapture'
import {
  recordingStartArgs,
  recordingStopArgs,
  recordingSetPausedArgs,
  recordingStatusArgs,
  recordingListArgs,
  recordingRunsArgs,
  recordingGetArgs,
  recordingClearRunArgs,
  recordingRemoveArgs,
  recordingSetFiltersArgs,
  recordingApplyFiltersArgs,
  recordingMaterializeHistoryArgs
} from '../../ipc/schemas'

export const RECORDING_PUSH_CHANNELS: Record<keyof RecordingStoreEvents, string> = {
  'capture-added': 'recording:capture-added',
  'capture-updated': 'recording:capture-updated',
  'captures-removed': 'recording:captures-removed',
  'run-changed': 'recording:run-changed',
  'run-removed': 'recording:run-removed',
  'status-changed': 'recording:status-changed'
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send(channel, payload)
  }
}

let registered = false

export function registerRecordingIpc(): void {
  if (registered) return
  registered = true

  for (const [event, channel] of Object.entries(RECORDING_PUSH_CHANNELS) as [keyof RecordingStoreEvents, string][]) {
    recordingCaptureStore.on(event, (payload) => { broadcast(channel, payload) })
  }

  // A deleted session takes its captures (and any live recording) with it.
  eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.RECORDING_DELETED, (payload) => {
    recordingCaptureEngine.stop(payload.id)
    recordingCaptureStore.clearSession(payload.id)
  })
  // A session deleted WITH its parent folder emits no recording event: after
  // any folder deletion, forget every session that is no longer in the tree.
  const forgetOrphans = (): void => {
    for (const sessionId of recordingCaptureStore.sessionIds()) {
      if (collectionStore.findById(sessionId) !== null) continue
      recordingCaptureEngine.stop(sessionId)
      recordingCaptureStore.clearSession(sessionId)
    }
  }
  eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.FOLDER_DELETED, forgetOrphans)

  validatedHandle('recording:start', recordingStartArgs, async (_event, [sessionId, tabId, url, config]) => {
    const webContents = miniBrowserService.getWebContents(tabId)
    if (webContents === null) {
      logger.warn('[recording] start: no mini-browser view for tab', { sessionId, tabId })
      return { ok: false as const, error: 'no-view' }
    }
    try {
      const status = await recordingCaptureEngine.start(sessionId, tabId, webContents, url, config)
      return { ok: true as const, status }
    } catch (error) {
      logger.warn('[recording] start failed', { sessionId, tabId, error: String(error) })
      return { ok: false as const, error: String(error) }
    }
  })

  validatedHandle('recording:stop', recordingStopArgs, (_event, [sessionId]) => {
    return recordingCaptureEngine.stop(sessionId)
  })

  validatedHandle('recording:set-paused', recordingSetPausedArgs, (_event, [sessionId, paused]) => {
    return paused ? recordingCaptureEngine.pause(sessionId) : recordingCaptureEngine.resume(sessionId)
  })

  validatedHandle('recording:status', recordingStatusArgs, (_event, [sessionId]) => {
    return recordingCaptureStore.status(sessionId)
  })

  validatedHandle('recording:list', recordingListArgs, (_event, [sessionId]) => {
    return recordingCaptureStore.list(sessionId)
  })

  validatedHandle('recording:runs', recordingRunsArgs, (_event, [sessionId]) => {
    return recordingCaptureStore.runs(sessionId)
  })

  validatedHandle('recording:get', recordingGetArgs, (_event, [sessionId, captureId]) => {
    return recordingCaptureStore.get(sessionId, captureId)
  })

  validatedHandle('recording:clear-run', recordingClearRunArgs, (_event, [sessionId, runId]) => {
    return { removed: recordingCaptureStore.clearRun(sessionId, runId) }
  })

  validatedHandle('recording:remove', recordingRemoveArgs, (_event, [sessionId, ids]) => {
    return { removed: recordingCaptureStore.removeCaptures(sessionId, ids) }
  })

  validatedHandle('recording:set-filters', recordingSetFiltersArgs, (_event, [sessionId, config]) => {
    recordingCaptureStore.setFilters(sessionId, config)
    return { ok: true }
  })

  validatedHandle('recording:apply-filters', recordingApplyFiltersArgs, (_event, [sessionId]) => {
    return { removed: recordingCaptureStore.applyFiltersToExisting(sessionId) }
  })

  // The history of the requests deduced from a session: every captured call
  // behind a route becomes a history entry of the new request (same sidecar,
  // same format, same cap), the reference call — the last 2xx — pinned so
  // it stands out and outlives the cap.
  validatedHandle('recording:materialize-history', recordingMaterializeHistoryArgs, async (_event, [sessionId, plan]) => {
    const stored = await materializeRecordingHistory(sessionId, plan)
    return { stored }
  })
}

/**
 * Write the captured calls behind freshly deduced requests into the response
 * history sidecar (normal format, retention cap applied). Shared by the
 * renderer's deduction (IPC) and the MCP `deduce_recording_routes` tool.
 * Returns the number of entries stored.
 */
export async function materializeRecordingHistory(sessionId: string, plan: readonly RecordingHistoryPlanEntry[]): Promise<number> {
  const details = plan.flatMap((entry) => entry.captureIds.flatMap((captureId) => {
    const call = recordingCaptureStore.get(sessionId, captureId)
    return call ? [captureToHistoryDetail(entry.requestId, call, captureId === entry.referenceCaptureId)] : []
  }))
  return responseHistoryService.storeCapturedCalls(details)
}
