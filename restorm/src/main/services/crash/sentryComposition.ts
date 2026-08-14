/**
 * Crash-reporting composition root — the ONE place that binds
 * `CrashReportingService` to the real `@sentry/electron` SDK, the app version
 * and the live consent decision.
 *
 * Everything below it is electron-free and unit-tested (the arm/disarm table,
 * the consent gate, the scrubbing hooks); this file is the thin untested seam,
 * the same shape as `services/auth/authComposition.ts` and
 * `services/privacy/consentComposition.ts`.
 *
 * Ordering matters at boot: consent is resolved BEFORE this runs, so the very
 * first `sync()` already knows the answer and an unconsented launch never arms
 * the SDK even briefly.
 */

import { app, BrowserWindow } from 'electron'
import { logger } from 'electron-core-ui/main'
import { crashDsn } from '../../../shared/config/observability'
import { CRASH_IPC, type CrashArmedState } from '../../../shared/crash/crashTypes'
import { CONSOLE_CAPTURE_LEVELS } from '../../../shared/crash/consoleCapture'
import { readCrashConsentState } from './crashConsentState'
import { getConsentService } from '../privacy/consentComposition'
import { CrashReportingService, type CrashSdkPort } from './CrashReportingService'
import { makeBeforeSend, makeBeforeBreadcrumb } from './sentryScrub'
import { withoutUnscrubbableIntegrations } from './sentryIntegrations'
import { observeWindowCrashes } from './windowCrashObserver'
import { reviewCrashReport } from './crashReviewComposition'
import { allowCrashReport } from './crashLimitComposition'
import { toReviewRequest } from './crashReviewRequest'
import { forwardErrorLogsToCrashReporting } from './errorLogForwarding'

let instance: CrashReportingService | null = null

/**
 * Push the armed state to every live window.
 *
 * Broadcast rather than targeted: a renderer that has just been created still
 * reads the state itself over `GET_ARMED_STATE`, so this only has to reach the
 * windows that already exist. Destroyed windows are skipped — a `webContents`
 * that has gone away throws, and the whole point of this subsystem is that it
 * cannot be the thing that breaks the app.
 */
function broadcastArmedState(state: CrashArmedState): void {
  broadcast(CRASH_IPC.ARMED_STATE_CHANGED, state)
}

/** Push the current consent state — whether the user still owes an answer. */
function broadcastConsentState(): void {
  broadcast(CRASH_IPC.CONSENT_STATE_CHANGED, readCrashConsentState())
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    try {
      window.webContents.send(channel, payload)
    } catch {
      // A window can be torn down between the check and the send.
    }
  }
}

/**
 * The real SDK, loaded LAZILY.
 *
 * A dynamic `import()` at arm time rather than a top-level import, so a build
 * with no DSN never pulls the SDK into the main process at all — no global
 * handlers, no transport, nothing to accidentally flush. It also keeps this
 * module importable from a unit test without stubbing Electron.
 */
function makeSentryPort(): CrashSdkPort {
  return {
    async init(options): Promise<void> {
      const Sentry = await import('@sentry/electron/main')
      Sentry.init({
        dsn: options.dsn,
        release: options.release,
        // Renderer↔main transport: Electron IPC ONLY, never the SDK's custom
        // protocol. This is a hard requirement, not a preference. The SDK's
        // default (`IPCMode.Both`) registers a privileged URL scheme, which
        // Electron only permits before the `ready` event — the SDK throws
        // outright if `init` runs later. But arming is gated on a consent answer
        // that is not resolved until after `ready`, so the default mode and the
        // privacy contract are mutually exclusive, and the contract wins.
        //
        // Classic mode registers `ipcMain` listeners instead, which have no
        // lifecycle constraint. The renderer reaches them through the bridge the
        // preload exposes; with the protocol scheme unregistered, the SDK's
        // fetch fallback has nowhere to go, so IPC is the only path — which is
        // also the path that keeps the renderer entirely off the network.
        ipcMode: Sentry.IPCMode.Classic,
        // Remove the two default integrations whose payload rides as an
        // ATTACHMENT — native minidumps and crash screenshots. `beforeSend`
        // never sees attachment bytes, so neither can be scrubbed nor dropped by
        // the gate every other payload passes. See `sentryIntegrations.ts`.
        //
        // Then ADD console capture: a main-process `console.error` becomes an
        // event (not just a breadcrumb), so a failure that was logged but never
        // crashed still reports. Error level only — see `consoleCapture.ts`.
        // The app's own `logger.error` entries do not pass through `console`
        // (winston writes to the streams); those reach the SDK through the
        // `forwardErrorLogsToCrashReporting` bridge below.
        integrations: (defaults) => [
          ...withoutUnscrubbableIntegrations(defaults),
          Sentry.captureConsoleIntegration({ levels: [...CONSOLE_CAPTURE_LEVELS] })
        ],
        // A transport that does NOT queue to disk. The SDK's default is an
        // offline store that writes undelivered envelopes to disk and flushes
        // them at the NEXT startup — so a crash captured before a revocation
        // would be sent after it, once the user re-granted. That is
        // drop-don't-queue inverted: a queue that outlives the decision turns a
        // withdrawal into a delay. The cost is a crash that happens while
        // offline, which is the cheaper half of the trade here.
        transport: Sentry.makeElectronTransport,
        // The scrubbing gate, then the user's own decision. Both can DROP.
        //
        // `beforeSend` may return a promise, so the user's answer IS the return
        // value: the event is held until they allow or refuse it. That keeps the
        // consent promise literal — nothing is sent that they were not shown —
        // without a parallel queue of reports in a state the consent model does
        // not describe. Review only asks when their consent was their own
        // choice; a plan-mandated account is not offered a refusal it does not
        // have, and both paths still pass the scrubber first.
        beforeSend: async (event) => {
          const scrubbed = options.beforeSend(event as unknown as Record<string, unknown>)
          if (scrubbed === null) return null
          const request = toReviewRequest(scrubbed)
          // Budget BEFORE review, deliberately. A report that will be held back
          // must never raise a dialog: asking someone to approve a send that is
          // then discarded wastes their attention and misdescribes what is
          // happening. It also means a crash loop cannot bury the user under
          // prompts for reports that were never going to leave.
          if (!allowCrashReport(request.fingerprint)) return null
          const allowed = await reviewCrashReport(request)
          return allowed ? (scrubbed as unknown as typeof event) : null
        },
        beforeBreadcrumb: (breadcrumb) =>
          options.beforeBreadcrumb(breadcrumb as unknown as Record<string, unknown>) as unknown as typeof breadcrumb,
        // No performance tracing: it samples ordinary requests, which is exactly
        // the traffic this app must not describe to a third party.
        tracesSampleRate: 0,
        // `sendDefaultPii` OFF is the SDK's own switch for attaching the user's
        // IP and similar. Belt AND braces with the scrubber.
        sendDefaultPii: false
      })
    },
    captureWindowCrash(report): void {
      // Synthesised main-side: the renderer that died cannot report itself.
      // The payload is a fixed set of process facts — no user content — so it
      // carries nothing the scrubber would have to strip.
      void import('@sentry/electron/main').then((Sentry) => {
        Sentry.captureMessage(`Renderer process gone: ${report.reason}`, {
          level: 'fatal',
          tags: {
            window: report.window,
            reason: report.reason,
            during_startup: String(report.duringStartup)
          },
          extra: { exitCode: report.exitCode }
        })
      })
    },
    async close(): Promise<void> {
      const Sentry = await import('@sentry/electron/main')
      // Bounded: a revocation must take effect now, not whenever a queued
      // envelope finishes negotiating with a host we are no longer allowed to
      // talk to.
      await Sentry.close(2000)
    }
  }
}

/**
 * Build the crash-reporting service and bring it in line with current consent.
 * Call ONCE after `initConsentService`. Idempotent.
 *
 * Returns `null` when crash reporting is unprovisioned (no DSN) — the common
 * case today, and the reason nothing can be sent by accident before the Sentry
 * org exists.
 */
export function initCrashReporting(): CrashReportingService | null {
  if (instance) return instance

  const dsn = crashDsn()
  const consentService = getConsentService()

  const service = new CrashReportingService({
    sdk: makeSentryPort(),
    dsn,
    release: `restorm@${app.getVersion()}`,
    beforeSend: makeBeforeSend({
      onDropped: (message, fields) => { logger.warn(message, fields) }
    }),
    beforeBreadcrumb: makeBeforeBreadcrumb({
      onDropped: (message, fields) => { logger.warn(message, fields) }
    }),
    readConsent: () => getConsentService()?.getDecision('crash') ?? null,
    onArmedChanged: broadcastArmedState,
    log: (message, fields) => { logger.info(message, fields) }
  })

  void service
    .sync()
    .then((decision) => {
      logger.info('Crash reporting resolved', { armed: decision.init, reason: decision.reason })
      // An unprovisioned build cannot report anything, yet the settings UI
      // still shows the consent toggle as on — the exact combination that let
      // every production crash pass unnoticed. Say it out loud once at
      // startup, at WARN, so a build shipped without a DSN is visible in the
      // log instead of being discovered months later by its silence.
      if (decision.reason === 'no-dsn') {
        logger.warn('Crash reporting is UNPROVISIONED (no DSN baked in and none in the environment): nothing will ever be reported')
      }
    })
    // Arming touches the SDK, and the SDK can throw for reasons that have
    // nothing to do with us (a malformed DSN, an Electron version it refuses).
    // Without this, such a failure would be an unhandled rejection: crash
    // reporting would silently never arm, and the one subsystem whose job is to
    // tell us something broke would be the one failing in silence.
    .catch((error: unknown) => {
      logger.error('Crash reporting failed to arm; it stays disarmed', {
        message: error instanceof Error ? error.message : String(error)
      })
    })

  // Re-evaluate whenever consent moves. Covers both halves of AC-level
  // behaviour: a hot opt-out disarms immediately, and a grant arms without a
  // restart. Plan changes reach here too — `consentComposition` re-syncs the
  // gate on every auth broadcast.
  consentService?.onChange(() => {
    // The consent ANSWER moved, so the renderer's prompt state moved with it.
    // This is also how the prompt re-appears on promotion: a Community account
    // becoming Pro loses the plan override, its gate reverts to unanswered, and
    // that arrives here as an ordinary consent change — no plan diffing anywhere.
    broadcastConsentState()
    void service.sync().catch((error: unknown) => {
      logger.error('Crash reporting failed to re-sync after a consent change', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  })

  // Bridge the app's own `logger.error` entries into reporting. Winston writes
  // to the streams, so the SDK's console instrumentation never sees them; this
  // is the only path by which a logged-but-survived failure reports. One
  // registration covers both processes — the renderer's logger proxies over IPC
  // into this same main-process logger. Armed is re-checked per entry (hot
  // opt-out stops the flow) and the message goes through `captureMessage`, i.e.
  // through the same scrub + budget + review gates as every other event.
  forwardErrorLogsToCrashReporting({
    onError: (listener) => logger.onError(listener),
    isArmed: () => service.isArmed(),
    capture: (message, meta) => {
      void import('@sentry/electron/main').then((Sentry) => {
        Sentry.captureMessage(message, {
          level: 'error',
          tags: { log_bridge: 'logger-error' },
          extra: meta ?? {}
        })
      })
    }
  })

  // Witness renderer deaths for EVERY window, including the splash — a
  // `data:text/html` document with no script context, so nothing inside it
  // could ever report its own death. The observer is installed unconditionally
  // and the service decides whether anything may be sent, so consent granted
  // later never retroactively ships an earlier crash.
  observeWindowCrashes({
    app,
    onCrash: (report) => { service.reportWindowCrash(report) },
    isStartingUp: () => !app.isReady(),
    log: (message, fields) => { logger.warn(message, fields) }
  })

  instance = service
  return service
}

/** The initialized service, or `null` when `initCrashReporting` hasn't run. */
export function getCrashReportingService(): CrashReportingService | null {
  return instance
}
