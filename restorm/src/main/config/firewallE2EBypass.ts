/**
 * Resolves whether the firewall's blanket test bypass is armed.
 *
 * This lives in its own module for one reason: the decision used to be
 * inferred from `RESTORM_USER_DATA_OVERRIDE`, the variable that redirects
 * `userData` to a per-launch temp dir. Those are unrelated concerns —
 * every automated launch wants an isolated profile, and none of them
 * implicitly asked for the firewall to stop classifying traffic. Sharing
 * one variable made the neutralisation invisible (nothing names it at the
 * call site) and all-or-nothing (no launch could take the isolation
 * without also disarming the firewall).
 *
 * The bypass now has its own explicitly-named variable, so arming it is a
 * deliberate act that reads as what it is, and a harness can opt a single
 * launch back into real classification by overriding just this one.
 */

/** Env var that arms the blanket bypass. Absent / any other value → off. */
export const FIREWALL_E2E_BYPASS_ENV = 'RESTORM_FIREWALL_E2E_BYPASS'

/**
 * `true` only for the exact opt-in values. A conservative match matters
 * here: the safe direction is a firewall that stays armed, so anything
 * ambiguous (empty string, a stray path, `0`, `false`) means OFF rather
 * than silently disabling a security control.
 */
export function isFirewallE2EBypassArmed(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[FIREWALL_E2E_BYPASS_ENV]
  if (typeof raw !== 'string') return false
  const normalised = raw.trim().toLowerCase()
  return normalised === '1' || normalised === 'true'
}
