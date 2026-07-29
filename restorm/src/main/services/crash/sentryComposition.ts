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

import { app } from 'electron'
import { logger } from 'electron-core-ui/main'
import { crashDsn } from '../../../shared/config/observability'
import { getConsentService } from '../privacy/consentComposition'
import { CrashReportingService, type CrashSdkPort } from './CrashReportingService'
import { makeBeforeSend, makeBeforeBreadcrumb } from './sentryScrub'

let instance: CrashReportingService | null = null

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
        // The scrubbing gate. Both hooks return `null` to DROP, so an event that
        // cannot be proven clean is discarded rather than sent.
        beforeSend: (event) =>
          options.beforeSend(event as unknown as Record<string, unknown>) as unknown as typeof event,
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
    log: (message, fields) => { logger.info(message, fields) }
  })

  void service.sync().then((decision) => {
    logger.info('Crash reporting resolved', { armed: decision.init, reason: decision.reason })
  })

  // Re-evaluate whenever consent moves. Covers both halves of AC-level
  // behaviour: a hot opt-out disarms immediately, and a grant arms without a
  // restart. Plan changes reach here too — `consentComposition` re-syncs the
  // gate on every auth broadcast.
  consentService?.onChange(() => { void service.sync() })

  instance = service
  return service
}

/** The initialized service, or `null` when `initCrashReporting` hasn't run. */
export function getCrashReportingService(): CrashReportingService | null {
  return instance
}
