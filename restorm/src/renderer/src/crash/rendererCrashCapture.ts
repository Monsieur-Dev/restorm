/**
 * The renderer's one way to report an error it caught rather than died of.
 *
 * A slot rather than a direct SDK call, and that is the point: the slot is
 * filled by `initRendererSentry` when the SDK arms and emptied when it closes,
 * so reporting exists exactly while consent says it may. A build whose user
 * never consented never fills it, which means an error boundary firing in that
 * build cannot pull the SDK into the process on its way past — the property the
 * rest of this subsystem is built to hold.
 *
 * Everything the boundary sends still goes through the main process's
 * `beforeSend`: scrubbed, gated, and shown to the user if their plan gives them
 * that choice. There is no second send path here, only a second entry point
 * into the only one.
 */

/** Reports one caught error. Installed by the renderer SDK when it arms. */
export type RendererCrashCapture = (error: unknown) => void

let capture: RendererCrashCapture | null = null

/** Fill the slot on arm, empty it on close. `null` disables reporting. */
export function setRendererCrashCapture(next: RendererCrashCapture | null): void {
  capture = next
}

/**
 * Report a caught error, if reporting is armed.
 *
 * A no-op when it is not — deliberately silent, because "the user declined" is
 * not an error condition. Never throws: this is called from an error boundary,
 * and a reporter that could throw there would turn a recoverable crash into an
 * unrecoverable one.
 */
export function captureRendererCrash(error: unknown): void {
  const send = capture
  if (send === null) return
  try {
    send(error)
  } catch {
    // Nothing useful is left to do — the thing that reports failures is the
    // thing that just failed.
  }
}
