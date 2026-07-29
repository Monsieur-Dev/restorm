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
export async function initRendererSentry(): Promise<() => Promise<void>> {
  const Sentry = await import('@sentry/electron/renderer')

  Sentry.init({
    // No performance tracing: it samples ordinary requests, which is exactly
    // the traffic this app must not describe to a third party.
    tracesSampleRate: 0,
    sendDefaultPii: false
  })

  return async () => {
    // Closing stops the client processing and forwarding events. The main
    // process is torn down independently on the same revocation, so this is the
    // near half of a gate that is closed at both ends.
    await Sentry.getClient()?.close()
  }
}
