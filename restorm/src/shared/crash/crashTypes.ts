/**
 * Shared crash-reporting contract — the vocabulary crossing main ↔ preload ↔
 * renderer. Kept free of Electron/Node imports so all three layers can import it
 * (mirrors `shared/update/updateTypes.ts` and `shared/auth/authState.ts`).
 *
 * The renderer is told only the RESOLVED answer, never the inputs it was
 * derived from. The privacy policy is decided once, main-side, by
 * `shouldInitCrashReporting`; shipping the plan and the consent record to the
 * renderer so it could reach its own conclusion would create a second place for
 * the rule to live, and two copies of a rule are one copy plus a future
 * disagreement.
 */

/** IPC channel names for the crash-reporting surface. */
export const CRASH_IPC = {
  GET_ARMED_STATE: 'crash:get-armed-state',
  /** main → renderer broadcast, fired on every arm/disarm transition. */
  ARMED_STATE_CHANGED: 'crash:armed-state-changed',
  GET_CONSENT_STATE: 'crash:get-consent-state',
  /** main → renderer broadcast, fired whenever the consent answer moves. */
  CONSENT_STATE_CHANGED: 'crash:consent-state-changed',
  /** The ONLY write on this surface. Records the user's own answer. */
  SET_CONSENT: 'crash:set-consent'
} as const

/**
 * Why crash reporting is or isn't armed. Surfaced in logs so an operator can
 * tell "the user said no" from "nobody configured a DSN" without guessing.
 */
export type CrashReportingReason =
  /** No DSN is configured — crash reporting is not provisioned in this build. */
  | 'no-dsn'
  /** The consent gate isn't declared (service not initialised). Fails closed. */
  | 'no-gate'
  /** The account's plan mandates reporting; the stored value cannot override it. */
  | 'plan-mandatory'
  /** The plan forbids reporting outright. */
  | 'plan-forbidden'
  /** The user has not answered yet — treated as a refusal. */
  | 'consent-unanswered'
  /** The user explicitly said yes. */
  | 'consent-granted'
  /** The user explicitly said no. */
  | 'consent-declined'

/**
 * What the renderer is allowed to know: whether reporting is on, and why.
 *
 * `armed` is the ONLY input to the renderer's decision to initialise its SDK.
 * `reason` is diagnostic — it explains a state in a log line, it never gates
 * behaviour, so a future reason value cannot silently change what the renderer
 * does.
 */
export interface CrashArmedState {
  armed: boolean
  reason: CrashReportingReason
}

/**
 * Whether the user still owes an answer about crash reporting.
 *
 * `shouldPrompt` is plan-gated BY CONSTRUCTION rather than by a second rule
 * here. A Community account's gate resolves plan-mandated, never "nobody has
 * decided", so it can never be true for them — which is exactly the requirement
 * that the consent prompt is shown to paid plans only. Re-checking the plan in
 * the renderer would add a second place for that to be decided, and a second
 * place is a future disagreement.
 *
 * It follows that this also drives the re-prompt on promotion: a Community
 * account becoming Pro loses the override, its gate reverts to unanswered, and
 * `shouldPrompt` flips to true on its own. The renderer does not diff plans.
 */
export interface CrashConsentState {
  /** True when the user has a real choice to make and has not made it yet. */
  shouldPrompt: boolean
  /** The answer in force right now — the pre-checked value for the prompt. */
  granted: boolean
}
