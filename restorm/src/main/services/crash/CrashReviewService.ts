/**
 * Holds a crash report while the user decides whether to send it.
 *
 * The SDK's `beforeSend` accepts a promise, so the user's answer IS the return
 * value: resolve with the event and it is sent, resolve with `null` and it is
 * discarded. No parallel queue, no re-capture path, and no window in which a
 * report exists in a "waiting to be sent" state the consent model does not
 * describe.
 *
 * Port-injected so the whole decision table is unit-testable without a window.
 */

import type { CrashReviewMode } from './crashReviewDecision'
import type { CrashReviewRequest } from '../../../shared/crash/crashTypes'

/** How the renderer is asked. */
export interface CrashReviewPort {
  /** True when there is a window able to show the question. */
  canAsk(): boolean
  /** Ask, resolving `true` to send. Rejects if the question cannot be put. */
  ask(request: CrashReviewRequest): Promise<boolean>
}

export interface CrashReviewServiceOptions {
  port: CrashReviewPort
  log?: ((message: string, fields?: Record<string, unknown>) => void) | undefined
}

export class CrashReviewService {
  /** The review currently on screen. At most one, ever — see `review`. */
  private pending = false

  constructor(private readonly options: CrashReviewServiceOptions) {}

  /** True while a report is waiting for the user. */
  isPending(): boolean {
    return this.pending
  }

  /**
   * Decide the fate of one scrubbed report.
   *
   * ONE dialog at a time. A crash rarely arrives alone — the app has just
   * broken, so the next failure is likely seconds away — and stacking a modal
   * per crash would bury the user under dialogs at the worst possible moment.
   *
   * The extras are DROPPED rather than queued or merged, and the reason is the
   * promise rather than the tidiness: the user was told they would see exactly
   * what is sent before each report. A batched "3 reports pending" would send
   * two payloads nobody looked at. Dropping sends strictly less than was agreed
   * to, which is the only safe direction — and it is the same drop-don't-queue
   * rule already applied to crashes observed while disarmed.
   */
  async review(mode: CrashReviewMode, request: CrashReviewRequest): Promise<boolean> {
    if (mode === 'direct') return true

    if (this.pending) {
      this.options.log?.('Crash report discarded: a report is already awaiting review', {
        fingerprint: request.fingerprint
      })
      return false
    }
    if (!this.options.port.canAsk()) {
      // Nothing on screen to ask with — during shutdown, or before any window
      // exists. Unasked means unsent.
      this.options.log?.('Crash report discarded: no window available to review it', {
        fingerprint: request.fingerprint
      })
      return false
    }

    this.pending = true
    try {
      return await this.options.port.ask(request)
    } catch (error) {
      // A review that cannot be completed is a review that did not say yes.
      this.options.log?.('Crash report discarded: review failed', {
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    } finally {
      this.pending = false
    }
  }
}
