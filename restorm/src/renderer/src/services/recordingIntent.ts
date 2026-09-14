/**
 * Hand-off between the record button and the browser tab it opens: the
 * config page stages "start recording <session>", the browser tab consumes
 * the intent once its mini-browser view exists and starts the engine on
 * it. A restored browser tab (app relaunch) finds no intent and records
 * nothing — recording is always an explicit act.
 */

const pending = new Set<string>()

export function requestRecordingStart(sessionId: string): void {
  pending.add(sessionId)
}

/** `true` once per staged intent — the caller starts the engine. */
export function takePendingRecordingStart(sessionId: string): boolean {
  return pending.delete(sessionId)
}

export function clearPendingRecordingStart(sessionId: string): void {
  pending.delete(sessionId)
}
