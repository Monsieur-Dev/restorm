/**
 * Renderer-side crash reporting — initialised LAZILY, and only once the main
 * process has said reporting is armed.
 *
 * The renderer cannot decide this for itself. The privacy contract
 * (DSN present? plan? consent answered?) is one pure function in the main
 * process, and the answer arrives here asynchronously over IPC. So this waits
 * for the answer rather than initialising optimistically and suppressing later:
 * an SDK that is never initialised is a state we can point at, whereas one that
 * is initialised and trusted to stay quiet is a promise we would have to keep.
 *
 * The cost of waiting is a window — errors thrown before the first IPC reply
 * lands are not seen by this SDK. That window is affordable *because* it is
 * already covered from the other side: the main process watches every window
 * for `render-process-gone`, so the catastrophic early failure (the renderer
 * dying during mount) is witnessed regardless of what this SDK is doing. What
 * is left for this SDK is survivable JS errors, which tolerate a few
 * milliseconds of delay.
 *
 * Nothing here reaches the network. The renderer SDK's transport is an IPC pipe
 * to the main process, which owns the only real transport and the only
 * firewall-exempted host — so the renderer adds no outbound surface at all.
 */

import type { CrashArmedState } from '../../../shared/crash/crashTypes'

/** The slice of `window.api.crash` this needs. Narrowed to an interface so the
 * gate is unit-testable without a preload or an Electron window. */
export interface CrashArmedStatePort {
  getArmedState: () => Promise<CrashArmedState>
  onArmedStateChanged: (callback: (state: CrashArmedState) => void) => () => void
}

export interface InitRendererCrashReportingOptions {
  api: CrashArmedStatePort
  /**
   * Loads and initialises the renderer SDK. Injected rather than imported so a
   * test can drive the whole arm/disarm table without pulling the real SDK into
   * the process — the same discipline as `CrashSdkPort` in the main process.
   *
   * Resolves with a teardown for the client it created.
   */
  initSdk: () => Promise<() => Promise<void>>
  log?: ((message: string, fields?: Record<string, unknown>) => void) | undefined
}

/**
 * Arm the renderer SDK in step with the main process, and keep it in step.
 *
 * Returns a teardown that detaches the subscription. Idempotent and safe to
 * call once at module load.
 *
 * The SDK is initialised **at most once per window**. On disarm the client is
 * closed, and a later re-grant within the SAME window does not resurrect it —
 * the SDK's own `init` is guarded against running twice, and reimplementing its
 * internals to work around that would break on the next upgrade. The failure
 * mode of that choice is under-reporting until the next launch, which is the
 * correct direction for a privacy control to fail; main-side process-death
 * observation is unaffected either way.
 */
export function initRendererCrashReporting(
  options: InitRendererCrashReportingOptions
): () => void {
  let closeSdk: (() => Promise<void>) | null = null
  let everInitialised = false
  // Serialises against a burst of state changes, so an `initSdk` still in
  // flight cannot interleave with the close that an immediately-following
  // revocation triggers.
  let pending: Promise<void> = Promise.resolve()

  const apply = (state: CrashArmedState): void => {
    pending = pending
      .then(async () => {
        if (state.armed) {
          if (everInitialised) return
          everInitialised = true
          closeSdk = await options.initSdk()
          options.log?.('Renderer crash reporting armed', { reason: state.reason })
        } else {
          const close = closeSdk
          if (close === null) return
          closeSdk = null
          await close()
          options.log?.('Renderer crash reporting disarmed', { reason: state.reason })
        }
      })
      .catch((error: unknown) => {
        // A crash reporter that throws must never be the thing that breaks the
        // app it exists to observe.
        options.log?.('Renderer crash reporting failed to apply armed state', {
          error: error instanceof Error ? error.message : String(error)
        })
      })
  }

  // Subscribe BEFORE the initial read. The other order has a hole: a transition
  // landing between the read resolving and the listener attaching would be lost,
  // leaving the renderer permanently out of step with a main process that has
  // already moved on.
  const unsubscribe = options.api.onArmedStateChanged(apply)

  options.api.getArmedState().then(apply).catch((error: unknown) => {
    options.log?.('Renderer crash reporting could not read the armed state', {
      error: error instanceof Error ? error.message : String(error)
    })
  })

  return unsubscribe
}
