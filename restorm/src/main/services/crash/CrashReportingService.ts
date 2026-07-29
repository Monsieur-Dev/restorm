/**
 * Arms and disarms crash reporting in step with consent.
 *
 * The SDK is not merely *told* not to send when consent is absent — it is not
 * initialised at all, and it is torn down the moment consent is withdrawn. That
 * distinction is the point: an initialised-but-suppressed SDK still installs
 * global handlers, still buffers breadcrumbs, and still has a transport that a
 * future code path could flush. "Not armed" is a state we can point at; "armed
 * but promising not to send" is a claim we would have to keep.
 *
 * Port-injected (the SDK is a `CrashSdkPort`) so the whole arm/disarm decision
 * table is unit-testable without booting Electron or opening a socket. The real
 * SDK is bound in `sentryComposition.ts`.
 */

import type { ConsentDecision } from 'electron-core-ui/main'
import {
  shouldInitCrashReporting,
  type CrashReportingDecision
} from './crashReportingDecision'

/** Options handed to the SDK at init. Structural, so the port stays testable. */
export interface CrashSdkInitOptions {
  dsn: string
  /** App version, so events group by release. */
  release: string
  /** `beforeSend` — scrub-then-assert, returns `null` to drop. */
  beforeSend: (event: Record<string, unknown>) => Record<string, unknown> | null
  /** `beforeBreadcrumb` — same gate. */
  beforeBreadcrumb: (breadcrumb: Record<string, unknown>) => Record<string, unknown> | null
}

/** The slice of the crash SDK this service drives. */
export interface CrashSdkPort {
  /** Async so a binding can load the SDK lazily — a build with no DSN then
   * never pulls it into the process at all. */
  init(options: CrashSdkInitOptions): Promise<void>
  /** Tear the client down. Resolves when the transport has finished flushing —
   * or, on revocation, when it has been discarded. */
  close(): Promise<void>
}

export interface CrashReportingServiceOptions {
  sdk: CrashSdkPort
  /** The configured DSN, or `undefined` when unprovisioned. */
  dsn: string | undefined
  release: string
  beforeSend: CrashSdkInitOptions['beforeSend']
  beforeBreadcrumb: CrashSdkInitOptions['beforeBreadcrumb']
  /** Reads the live consent decision. Called on every re-evaluation, so it must
   * reflect the CURRENT state rather than a snapshot. */
  readConsent: () => ConsentDecision | null
  log?: ((message: string, fields?: Record<string, unknown>) => void) | undefined
}

export class CrashReportingService {
  private armed = false
  /** Serialises teardown so a burst of consent changes can't interleave an
   * `init` with an in-flight `close`. */
  private closing: Promise<void> | null = null

  constructor(private readonly options: CrashReportingServiceOptions) {}

  /** True when the SDK is currently initialised. */
  isArmed(): boolean {
    return this.armed
  }

  /**
   * Bring the SDK in line with the current consent answer. Idempotent — safe to
   * call at boot, on every consent change, and on every plan change.
   *
   * Returns the decision that was acted on, so callers can log WHY rather than
   * just what happened.
   */
  async sync(): Promise<CrashReportingDecision> {
    const decision = shouldInitCrashReporting({
      dsn: this.options.dsn,
      consent: this.options.readConsent()
    })

    if (decision.init && !this.armed) {
      // `dsn` is non-undefined whenever `init` is true — `shouldInitCrashReporting`
      // returns `no-dsn` otherwise — but narrow explicitly rather than assert.
      const dsn = this.options.dsn
      if (dsn === undefined) return decision
      await this.closing
      await this.options.sdk.init({
        dsn,
        release: this.options.release,
        beforeSend: this.options.beforeSend,
        beforeBreadcrumb: this.options.beforeBreadcrumb
      })
      this.armed = true
      this.options.log?.('Crash reporting armed', { reason: decision.reason })
    } else if (!decision.init && this.armed) {
      // Withdrawal is immediate: tear the client down rather than leave it
      // installed and trusted to stay quiet.
      this.armed = false
      this.closing = this.options.sdk.close().catch(() => undefined)
      await this.closing
      this.closing = null
      this.options.log?.('Crash reporting disarmed', { reason: decision.reason })
    }
    return decision
  }
}
