/**
 * Binds the renderer crash gate to the real `@sentry/electron/renderer` SDK.
 *
 * The thin untested seam, deliberately: everything that decides WHETHER to
 * initialise lives in `initRendererCrashReporting` and is unit-tested against
 * an injected port. This file only knows HOW.
 *
 * The SDK is loaded by a dynamic `import()` at arm time, mirroring the main
 * process — a build whose user never consents never pulls the SDK into the
 * renderer at all.
 */

/**
 * Load and initialise the renderer SDK. Resolves with a teardown that closes
 * the client it created.
 *
 * No DSN, no release, no environment: the renderer SDK deliberately takes none
 * of them. It captures events locally and hands them to the main process over
 * IPC, which owns the only real transport, the only DSN, and the only
 * firewall-exempted host. That is also why the scrubbing hooks are not
 * duplicated here — every event this SDK produces passes through the main
 * process's `beforeSend` / `beforeBreadcrumb` gate before anything is sent, so
 * there is exactly one place where a payload is proven clean.
 */

import { CONSOLE_CAPTURE_LEVELS } from '../../../shared/crash/consoleCapture'
import { setRendererCrashCapture } from './rendererCrashCapture'

export async function initRendererSentry(): Promise<() => Promise<void>> {
  const Sentry = await import('@sentry/electron/renderer')

  Sentry.init({
    // ADDED to the SDK defaults (the array form appends, it does not replace):
    // a renderer `console.error` — React's error reporting, a library's own
    // failure path, anything visible in the DevTools console — becomes an
    // event, not just a breadcrumb, so a failure the app survived still
    // reports. Error level only; see `consoleCapture.ts`. Like every renderer
    // event it rides IPC to the main process and through its scrubbing gate.
    integrations: [Sentry.captureConsoleIntegration({ levels: [...CONSOLE_CAPTURE_LEVELS] })],
    // No performance tracing: it samples ordinary requests, which is exactly
    // the traffic this app must not describe to a third party.
    tracesSampleRate: 0,
    sendDefaultPii: false
  })

  // Give the error boundary a way in. An error a boundary CATCHES never reaches
  // the SDK's global handlers — React handles it and the process lives on — so
  // without this the white-screen case would be the one crash that goes
  // unreported, which is the opposite of what a user seeing a white screen
  // needs. Only the error is sent: React's component stack carries source file
  // paths, and the scrubbing gate is fail-closed, so attaching it would trade a
  // little context for whole reports being silently dropped.
  setRendererCrashCapture((error) => {
    Sentry.captureException(error, { tags: { crash_boundary: 'renderer-root' } })
  })

  return async () => {
    // Emptied FIRST: after this returns the SDK may no longer send, and a
    // boundary firing mid-teardown must not find a live capture path.
    setRendererCrashCapture(null)
    // Closing stops the client processing and forwarding events. The main
    // process is torn down independently on the same revocation, so this is the
    // near half of a gate that is closed at both ends.
    await Sentry.getClient()?.close()
  }
}
