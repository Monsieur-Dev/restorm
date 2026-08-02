/**
 * Privacy composition root — the ONE place that wires ECUI's generic
 * `ConsentService` to Restorm's real dependencies: the settings store behind the
 * Preferences → Privacy toggles, the consent file under `userData`, the account
 * plan, and the firewall.
 *
 * The invariant it establishes: a declared phone-home host is exempted from the
 * user firewall IF AND ONLY IF its consent gate currently answers yes. Not "the
 * SDK checks before sending" — the firewall itself refuses, so a queued event
 * retried after a revocation is blocked like any unknown destination would be.
 *
 * Crash reporting is plan-modulated rather than a plain boolean. Community (free)
 * accounts fund the product with the diagnostics that make it maintainable, so
 * the gate is forced on for them; Pro and Enterprise can opt out. Telemetry is
 * opt-in for everyone, always. Both halves of that rule live here and in
 * `resources/settings.yaml` (which locks the matching control for Community via
 * the `crash.optOut` capability) so the toggle a user sees can never disagree
 * with what `canSend` actually permits.
 *
 * Everything below the composition root is electron-free and unit-tested in
 * ECUI; this file is the thin, untested seam — same shape as
 * `services/auth/authComposition.ts`.
 */

import { app } from 'electron'
import { join } from 'node:path'
import {
  logger,
  permissionService,
  ConsentService,
  ConsentFirewallExemption,
  makeConsentFileStore,
  getSettingsService,
  type ConsentSettingsPort,
  type ConsentDecision,
  type ConsentOverride
} from 'electron-core-ui/main'
import type { PlanTier } from '../../../shared/auth/authState'
import {
  CONSENT_SETTING_KEYS,
  resolveObservabilityEndpoints,
  PRIVACY_POLICY_VERSION,
  type ConsentGateId
} from '../../../shared/config/observability'

/** Path of the consent audit trail, beside the firewall's own `state.json`. */
const CONSENT_FILE = join('privacy', 'consent.json')

/**
 * The plan as this module sees it. `'unknown'` is the boot window before the
 * entitlement service has restored its cached session — distinct from
 * `'community'` on purpose, see {@link crashOverrideFor}.
 */
export type ResolvedPlan = PlanTier | 'unknown'

/**
 * The plan-modulation rule for crash reporting, extracted so it can be tested
 * without an entitlement service or an Electron app.
 *
 * Community (free) accounts cannot opt out — that is the deal that funds the
 * diagnostics. Every paid plan can, so no override applies and the stored
 * boolean wins. Telemetry is never forced in either direction.
 *
 * `'unknown'` deliberately does NOT force anything. Treating the boot window as
 * `community` would force crash reporting on for a Pro user who had explicitly
 * opted out, for as long as it takes the cached session to load — turning a
 * transient ignorance into a real send the user had refused. Falling through to
 * their stored choice is the fail-closed reading.
 */
export function crashOverrideFor(gateId: string, plan: ResolvedPlan): ConsentOverride {
  if (gateId !== 'crash') return null
  return plan === 'community' ? 'forced-on' : null
}

let instance: ConsentService | null = null
let exemption: ConsentFirewallExemption | null = null

/** Adapter over the app's SettingsService — the user-editable half of consent. */
function makeSettingsPort(): ConsentSettingsPort {
  const settings = getSettingsService()
  return {
    getBoolean(key: string): boolean | undefined {
      const value = settings.get(key)
      return typeof value === 'boolean' ? value : undefined
    },
    setBoolean(key: string, value: boolean): void {
      settings.set(key, value)
    },
    subscribe(key: string, listener: () => void): () => void {
      return settings.onSettingChanged(key, () => { listener() })
    }
  }
}

/**
 * Build the ConsentService, declare every phone-home endpoint to the firewall
 * panel, and bring the firewall exemptions in line with the current answers.
 *
 * Call ONCE after `app.whenReady` (userData must be resolvable and the settings
 * service loaded). Idempotent: a second call returns the existing instance.
 *
 * `getPlan` is injected rather than imported so this module does not depend on
 * the auth composition root — and so the plan-modulation rule is testable
 * without an entitlement service.
 */
export function initConsentService(getPlan: () => ResolvedPlan): ConsentService {
  if (instance) return instance

  const service = new ConsentService({
    gates: [
      { id: 'crash', settingKey: CONSENT_SETTING_KEYS.crash, defaultGranted: true },
      { id: 'telemetry', settingKey: CONSENT_SETTING_KEYS.telemetry, defaultGranted: false }
    ],
    settings: makeSettingsPort(),
    store: makeConsentFileStore(
      join(app.getPath('userData'), CONSENT_FILE),
      (message, fields) => { logger.warn(message, fields) }
    ),
    policyVersion: PRIVACY_POLICY_VERSION,
    resolveOverride: (gateId) => crashOverrideFor(gateId, getPlan()),
    log: (message, fields) => { logger.warn(message, fields) }
  })

  // Resolved once at init: the crash host is derived from the configured DSN, so
  // the firewall exemption always names the host the SDK will actually reach.
  const endpoints = resolveObservabilityEndpoints()

  // Declare the endpoints BEFORE the first sync so each one is accounted for
  // whatever the consent answer — including the ones that will report "not
  // exempted, no consent". A destination that is never declared is one nobody
  // can audit.
  for (const endpoint of endpoints) {
    permissionService.declareSystemEndpoint({
      id: endpoint.id,
      host: endpoint.host,
      purposeKey: endpoint.purposeKey,
      consentGate: endpoint.consentGate,
      exemption: 'system-allowlist'
    })
  }

  exemption = new ConsentFirewallExemption(
    permissionService,
    endpoints.map((e) => ({ host: e.host, consentGate: e.consentGate })),
    (gate) => service.canSend(gate)
  )
  service.onChange((decisions: ConsentDecision[]) => {
    const hosts = exemption?.sync() ?? []
    logger.info('Consent changed; firewall exemptions reconciled', {
      decisions: decisions.map((d) => `${d.gate}=${String(d.granted)}(${d.source})`).join(','),
      exemptedHosts: hosts.join(',')
    })
  })
  exemption.sync()

  instance = service
  logger.info('ConsentService initialized', {
    policyVersion: PRIVACY_POLICY_VERSION,
    decisions: service.listDecisions().map((d) => `${d.gate}=${String(d.granted)}(${d.source})`).join(',')
  })
  return service
}

/**
 * Re-evaluate consent after something OTHER than the toggles changed the answer
 * — in practice a plan transition (login, logout, subscription upgrade or
 * expiry), which flips `canSend('crash')` without touching a setting. Safe to
 * call before init (no-op) and as often as needed (idempotent).
 *
 * Announcing the change matters as much as reconciling the firewall. A
 * Community account has crash reporting forced ON; the moment it becomes Pro the
 * override lifts and the gate reverts to UNANSWERED, which must disarm the
 * reporter until the user is asked. Syncing only the exemption would leave every
 * subscriber — the crash reporter among them — still acting on the answer the
 * previous plan imposed, so an upgrade would keep sending reports the user has
 * not yet consented to. That is the exact inversion of the promotion prompt.
 */
export function syncConsentAfterPlanChange(): void {
  exemption?.sync()
  // Notifies subscribers; the listener registered at init reconciles the
  // exemption again, which is idempotent.
  instance?.revalidate()
}

/**
 * The consent answer for a gate. `false` before initialization — nothing may be
 * sent by a subsystem that started before consent was resolved, which is the
 * correct default for the window between app boot and `whenReady`.
 */
export function canSend(gate: ConsentGateId): boolean {
  return instance?.canSend(gate) ?? false
}

/** The initialized service, or `null` when `initConsentService` hasn't run. */
export function getConsentService(): ConsentService | null {
  return instance
}
