/**
 * Forwards error-level LOG entries into crash reporting.
 *
 * The app's own code reports failures through `logger.error`, not
 * `console.error` — winston writes straight to the streams, so the SDK's
 * console instrumentation never sees those entries. This is the bridge: the
 * logger's `onError` seam on one side, `captureMessage` on the other. Because
 * the renderer's logger proxies over IPC into the SAME main-process logger, one
 * registration here covers error logs from both processes.
 *
 * The armed check happens PER ENTRY, not at registration: consent can move
 * while the app runs, and an entry logged while disarmed must be dropped even
 * though the listener was registered long before. Nothing is queued — the same
 * drop-don't-queue rule as the rest of the crash pipeline.
 *
 * Pure and port-based so the whole decision table is unit-testable without
 * winston, Electron or the SDK.
 */

export interface ErrorLogForwardingOptions {
  /** `logger.onError` — subscribe to error-level entries. Returns unsubscribe. */
  onError: (listener: (message: string, meta?: Record<string, unknown>) => void) => () => void
  /** Whether crash reporting may send RIGHT NOW (consent resolved, SDK up). */
  isArmed: () => boolean
  /** Hand one entry to the SDK. Called only while armed. */
  capture: (message: string, meta?: Record<string, unknown>) => void
}

/**
 * Register the bridge. Returns the unsubscribe.
 *
 * A `capture` that throws is swallowed: the crash reporter must never be the
 * thing that breaks the app it observes — the same rule the logger applies to
 * its own listeners, kept here too so the guarantee does not depend on which
 * layer catches first.
 */
export function forwardErrorLogsToCrashReporting(options: ErrorLogForwardingOptions): () => void {
  return options.onError((message, meta) => {
    if (!options.isArmed()) return
    try {
      options.capture(message, meta)
    } catch {
      // Dropping the forwarded copy loses nothing durable — the entry itself
      // already reached the log transports.
    }
  })
}
