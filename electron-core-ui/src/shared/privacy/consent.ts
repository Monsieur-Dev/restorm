/**
 * Consent model — the shared vocabulary for "may this app send X?".
 *
 * Lives in `shared/` so the main process (which owns the decision), a preload
 * bridge and the renderer all reference the identical shapes. Deliberately
 * gate-agnostic: ECUI knows there are named gates whose boolean is backed by a
 * settings key, and nothing about what `crash` or `telemetry` mean — the host
 * app declares its own gates.
 *
 * Two layers, on purpose:
 *   - the BOOLEAN lives in the settings store, so the Preferences toggle is the
 *     single editable source of truth (and inherits its persistence, workspace
 *     overlay and change broadcast for free);
 *   - the AUDIT TRAIL (when it was decided, against which privacy-policy
 *     version) lives beside it in a small consent file, because a regulator's
 *     question is "when did they agree, and to what?", which a bare boolean
 *     cannot answer.
 */

/**
 * A host-app-imposed override of the stored boolean, e.g. a plan whose terms
 * make a gate mandatory or forbidden regardless of the user's toggle. `null`
 * means "no override — use the stored value".
 */
export type ConsentOverride = 'forced-on' | 'forced-off' | null

/** Where a gate's effective value came from. Surfaced so a UI can explain a
 * value the user did not choose (a locked, plan-mandated gate). */
export type ConsentSource = 'user' | 'default' | 'forced-on' | 'forced-off'

/** One consent gate the host app declares. */
export interface ConsentGateDefinition {
  /** Stable, host-defined id (`'crash'`, `'telemetry'`, …). Referenced by
   * `canSend(id)` and by a firewall endpoint's `consentGate`. */
  id: string
  /** Settings storage key holding the user-editable boolean, e.g.
   * `'privacy:telemetry'`. */
  settingKey: string
  /** Value in force before the user ever touched the toggle. */
  defaultGranted: boolean
}

/** The resolved state of one gate. Pure JSON — safe over IPC. */
export interface ConsentDecision {
  /** The gate's id. */
  gate: string
  /** The effective answer to "may we send this?" — override applied. */
  granted: boolean
  /** ISO timestamp of the moment the current stored value was recorded, or
   * `null` when the user never expressed a choice (still on the default). */
  consentedAt: string | null
  /** Privacy-policy version in force when the value was recorded, or `null`
   * when never recorded. A bumped policy makes a stale version visible so the
   * host can re-ask. */
  policyVersion: string | null
  /** How `granted` was arrived at. */
  source: ConsentSource
}

/** Shape of the persisted consent file. Versioned so the format can move. */
export interface PersistedConsentFile {
  version: 1
  gates: Record<string, PersistedConsentEntry>
}

/** One gate's persisted audit entry. */
export interface PersistedConsentEntry {
  granted: boolean
  consentedAt: string
  policyVersion: string
}
