/**
 * The consent state as the renderer sees it: does the user still owe an answer
 * about crash reporting, and what is the answer in force right now.
 *
 * Its own module because both the IPC handlers (which serve it on request) and
 * the composition root (which pushes it when consent moves) need it, and having
 * either import the other would make the two mutually dependent.
 */

import { getConsentService } from '../privacy/consentComposition'
import { shouldPromptForCrashConsent } from './crashReportingDecision'
import type { CrashConsentState } from '../../../shared/crash/crashTypes'

/**
 * Consent state before the consent service exists. Never prompt against an
 * answer we could not read: a prompt shown on an unknown state could record a
 * decision for a question the user was never in a position to be asked.
 */
const CONSENT_UNKNOWN: CrashConsentState = { shouldPrompt: false, granted: false }

/**
 * The live consent state, derived from the same rule the main process uses to
 * decide whether to arm — never re-derived from the plan, which is what keeps
 * "who may be asked" a single rule in a single place.
 */
export function readCrashConsentState(): CrashConsentState {
  const decision = getConsentService()?.getDecision('crash') ?? null
  if (decision === null) return CONSENT_UNKNOWN
  return { shouldPrompt: shouldPromptForCrashConsent(decision), granted: decision.granted }
}
