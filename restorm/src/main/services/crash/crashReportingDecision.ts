/**
 * The one place that decides whether crash reporting may run at all.
 *
 * Kept separate from the SDK wiring because it is the whole privacy contract in
 * one function: a pure mapping from (DSN configured?, plan, consent decision) to
 * "arm the SDK / don't". Nothing else in the app is allowed to reach its own
 * conclusion — if the SDK is initialised, it is because this said so.
 *
 * The plan tiering itself lives in the consent layer (`consentComposition`'s
 * plan override), so this reads the RESOLVED decision rather than re-deriving
 * the policy. That keeps one rule in one place: `ConsentDecision.source` already
 * distinguishes plan-mandated from user-chosen from nobody-has-decided.
 */

import type { ConsentDecision } from 'electron-core-ui/main'
import type { CrashReportingReason } from '../../../shared/crash/crashTypes'

// The reason vocabulary lives in `shared/` because the renderer is told it too
// (see `shared/crash/crashTypes.ts`). Re-exported here so main-side callers keep
// importing it from the module that produces it.
export type { CrashReportingReason }

export interface CrashReportingDecision {
  /** `true` ⇒ the SDK may be initialised and events may be sent. */
  init: boolean
  reason: CrashReportingReason
}

export interface CrashReportingInput {
  /** The configured DSN, or `undefined` when crash reporting is unprovisioned. */
  dsn: string | undefined
  /** The resolved consent decision for the `crash` gate, or `null` when the
   * consent service has not been built yet. */
  consent: ConsentDecision | null
}

/**
 * Decide whether to arm crash reporting.
 *
 * The interesting case is **unanswered consent**, and it resolves to NO SEND.
 * The tier model calls the paid plans "opt-out", which taken literally would
 * mean sending until the user objects; but nothing may leave the machine before
 * the user has actually been asked, so an unanswered gate is treated as a
 * refusal and the consent prompt (pre-checked, one click) does the asking.
 *
 * The asymmetry is what settles it: "we didn't send, then started" is a
 * one-line change, while "we sent data we shouldn't have" cannot be undone.
 * Flipping to literal opt-out is exactly the `'default'` branch below.
 *
 * Community accounts are unaffected — their gate resolves `forced-on` from the
 * plan, never `default`, so they never sit in the unanswered state.
 */
export function shouldInitCrashReporting(input: CrashReportingInput): CrashReportingDecision {
  if (input.dsn === undefined) return { init: false, reason: 'no-dsn' }
  // No consent service ⇒ no decision ⇒ nothing may be sent. Fail closed rather
  // than assume the default.
  if (input.consent === null) return { init: false, reason: 'no-gate' }

  switch (input.consent.source) {
    case 'forced-on':
      return { init: true, reason: 'plan-mandatory' }
    case 'forced-off':
      return { init: false, reason: 'plan-forbidden' }
    case 'default':
      // Nobody has answered. NOT the stored default — see the doc comment.
      return { init: false, reason: 'consent-unanswered' }
    case 'user':
      return input.consent.granted
        ? { init: true, reason: 'consent-granted' }
        : { init: false, reason: 'consent-declined' }
  }
}

/**
 * True when the consent prompt should be shown: the user has a real choice to
 * make (their plan doesn't decide for them) and hasn't made it yet.
 *
 * Community never qualifies — their gate is plan-mandated, so there is nothing
 * to ask and the settings row explains the tier instead.
 */
export function shouldPromptForCrashConsent(consent: ConsentDecision | null): boolean {
  return consent !== null && consent.source === 'default'
}
