/**
 * Turns a scrubbed crash event into the thing the user is shown.
 *
 * Pure, and deliberately dumb: it re-serialises the event and derives an
 * identity for it. It does NOT summarise, filter or prettify the content — the
 * user was promised exactly what is sent, so anything this dropped would make
 * the dialog a description of the payload rather than the payload.
 */

import type { CrashReviewRequest } from '../../../shared/crash/crashTypes'

let counter = 0

/**
 * A short, stable-ish identity for a failure, used only for logging and for
 * recognising a repeat. Built from the exception type and the top frame rather
 * than the message, so the same fault reported twice matches even when the
 * message carries a varying detail.
 *
 * Never shown to the user and never sent; if the shape is unfamiliar it
 * degrades to `unknown` rather than guessing.
 */
export function fingerprintOf(event: Record<string, unknown>): string {
  const exception = event['exception']
  if (typeof exception === 'object' && exception !== null) {
    const values = (exception as { values?: unknown }).values
    if (Array.isArray(values) && values.length > 0) {
      const first = values[0] as { type?: unknown; stacktrace?: unknown } | undefined
      const type = typeof first?.type === 'string' ? first.type : 'error'
      const frames = (first?.stacktrace as { frames?: unknown } | undefined)?.frames
      const top = Array.isArray(frames) && frames.length > 0
        ? (frames[frames.length - 1] as { function?: unknown }).function
        : undefined
      return `${type}@${typeof top === 'string' ? top : 'unknown'}`
    }
  }
  const message = event['message']
  return typeof message === 'string' ? `message@${message.slice(0, 60)}` : 'unknown'
}

/** Wrap a scrubbed event as a review request. */
export function toReviewRequest(event: Record<string, unknown>): CrashReviewRequest {
  counter += 1
  return {
    id: `crash-review-${String(counter)}`,
    fingerprint: fingerprintOf(event),
    payload: safeSerialise(event)
  }
}

/** The event is already plain JSON after scrubbing, but a payload that cannot
 * be serialised must not take the crash reporter down with it. */
function safeSerialise(event: Record<string, unknown>): string {
  try {
    return JSON.stringify(event, null, 2)
  } catch {
    return '{}'
  }
}
