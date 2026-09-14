import type { RecordingSession } from '../../../../shared/types/collections'
import type { RecordingFilterConfig } from '../../../../shared/types/recordingCapture'

/**
 * Every edit of a recording session's config REASSIGNS a top-level field
 * through the reactive proxy — the set trap is what emits RECORDING_UPDATED
 * into the dirty / autosave / search pipeline. Never mutate a list in place.
 */
export function assignRecordingField<K extends keyof RecordingSession>(session: RecordingSession, key: K, value: RecordingSession[K]): void {
  session[key] = value
}

/** The gate the capture engine applies, as the session currently configures it. */
export function recordingFilterConfigOf(session: RecordingSession): RecordingFilterConfig {
  return { protocols: [...session.protocols], whitelist: [...session.whitelist], blacklist: [...session.blacklist] }
}
