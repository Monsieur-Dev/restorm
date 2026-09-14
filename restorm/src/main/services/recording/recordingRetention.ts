/**
 * The "captured calls kept per session" cap of recording sessions, read
 * from the app settings (`recording:maxCaptures`) and pushed into the
 * capture store. Mirrors `historyRetention.ts` in shape: safe to call
 * before the settings service exists (falls back to the default), and the
 * store is updated live when the user changes the setting.
 */

import { getSettingsService, isSettingsServiceInitialized, logger } from 'electron-core-ui/main'
import { recordingCaptureStore, DEFAULT_CAPTURE_CAP } from './RecordingCaptureStore'

export const RECORDING_MAX_CAPTURES_KEY = 'recording:maxCaptures'

/** Bounds mirrored from `resources/settings.yaml` (min / max of the setting). */
const MIN_CAPTURES = 10
const MAX_CAPTURES = 100000

export function normalizeCaptureCap(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN
  if (!Number.isFinite(value)) return DEFAULT_CAPTURE_CAP
  return Math.min(MAX_CAPTURES, Math.max(MIN_CAPTURES, Math.floor(value)))
}

export function getCaptureCap(): number {
  if (!isSettingsServiceInitialized()) return DEFAULT_CAPTURE_CAP
  return normalizeCaptureCap(getSettingsService().get(RECORDING_MAX_CAPTURES_KEY))
}

let activated = false

/** Push the current cap into the store and follow the setting from now on. */
export function activateRecordingRetention(): void {
  if (activated) return
  if (!isSettingsServiceInitialized()) {
    logger.warn('[recordingRetention] Activated before the settings service exists; the default cap stays')
    return
  }
  activated = true
  recordingCaptureStore.setCap(getCaptureCap())
  getSettingsService().onSettingChanged(RECORDING_MAX_CAPTURES_KEY, (value) => {
    recordingCaptureStore.setCap(normalizeCaptureCap(value))
  })
}
