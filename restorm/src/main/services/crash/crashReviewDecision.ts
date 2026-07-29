/**
 * Whether a crash report is shown to the user before it is sent.
 *
 * Pure, so the whole table is testable without a dialog, a consent service or
 * an Electron app.
 */

import type { ConsentDecision } from 'electron-core-ui/main'

/** What to do with an event that has already passed the scrubbing gate. */
export type CrashReviewMode =
  /** Send it without asking. */
  | 'direct'
  /** Show the user what would be sent and let them decide. */
  | 'ask'

export interface CrashReviewInput {
  /** The resolved consent decision, or `null` when consent is unreadable. */
  consent: ConsentDecision | null
  /** The user's "show me each report" preference. */
  reviewEnabled: boolean
}

/**
 * Decide whether to ask.
 *
 * Only two states can reach this at all, and that is worth stating because it
 * is what makes the tiering fall out rather than being re-implemented: the
 * scrubbing hooks only run when the SDK is armed, and the SDK is only armed
 * when consent resolved to plan-mandated or user-granted. Declined and
 * unanswered never arm, so they never produce an event to review.
 *
 * Of the two that remain, only a user who CHOSE to send is asked. An account
 * whose plan mandates reporting is not offered a per-report choice it does not
 * have — showing a dialog whose "don't send" button cannot be honoured would be
 * worse than not showing one.
 *
 * The user may also waive the per-report step. That is a real waiver of the
 * promise made when they consented, so it is off by default and reversible from
 * the privacy settings; here it simply collapses `ask` to `direct`.
 */
export function crashReviewMode(input: CrashReviewInput): CrashReviewMode {
  if (input.consent === null) return 'direct'
  if (input.consent.source !== 'user') return 'direct'
  return input.reviewEnabled ? 'ask' : 'direct'
}
