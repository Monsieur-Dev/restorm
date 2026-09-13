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
import { recordingCaptureStore, type RecordingStoreEvents } from './RecordingCaptureStore'
import { recordingCaptureEngine } from './RecordingCaptureEngine'
import { DocumentEvents, type DocumentDeletedPayload } from '../DocumentEvents'
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
  recordingApplyFiltersArgs
} from '../../ipc/schemas'

export const RECORDING_PUSH_CHANNELS: Record<keyof RecordingStoreEvents, string> = {
  'capture-added': 'recording:capture-added',
  'capture-updated': 'recording:capture-updated',
  'captures-removed': 'recording:captures-removed',
  'run-changed': 'recording:run-changed',
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
}
