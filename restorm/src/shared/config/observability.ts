/**
 * Declared "phone-home" destinations — every host Restorm may contact on its
 * OWN initiative, as opposed to the user's API traffic.
 *
 * This file is the single place that answers "what can this app send, where,
 * and under whose permission". Two things read it:
 *   - the firewall, which exempts a host EXACTLY (never a wildcard) and only
 *     while the matching consent is active;
 *   - the firewall panel, which renders one read-only row per entry so the
 *     inventory is something a user can verify rather than take on trust.
 *
 * Adding an endpoint anywhere else in the codebase is the bug this file exists
 * to make obvious: an undeclared destination is invisible in the panel, and an
 * un-gated one sends without asking.
 *
 * Pure data + pure predicates (no electron, no app state) so the eligibility
 * rules are trivially unit-testable — the same discipline as `backend.ts`.
 */

/** Consent gates Restorm declares. `crash` is plan-modulated (see
 * `main/services/privacy/consentComposition.ts`); `telemetry` is opt-in for
 * everyone. */
export type ConsentGateId = 'crash' | 'telemetry'

/** Settings storage keys backing each gate — the toggles in
 * Preferences → Privacy. */
export const CONSENT_SETTING_KEYS: Record<ConsentGateId, string> = {
  crash: 'privacy:crashReports',
  telemetry: 'privacy:telemetry'
}

/**
 * Version of the privacy policy the consent UI presents. Stamped into every
 * recorded decision so a later policy change is detectable ("consented to an
 * older version") instead of being retroactively applied to a choice the user
 * made under different terms. Bump it whenever https://restorm.app/privacy
 * changes materially.
 */
export const PRIVACY_POLICY_VERSION = '2026-07-29'

/**
 * Where the consent surface sends the user to read what they are agreeing to.
 * Also spelled out at the end of both `privacy.*Description` strings in every
 * locale (settings descriptions are plain text, so the URL is written there
 * rather than linked) — `observability.test.ts` keeps the two in step.
 */
export const PRIVACY_POLICY_URL = 'https://restorm.app/privacy'

/** One declared outbound destination. */
export interface ObservabilityEndpoint {
  /** Stable id — also the firewall declaration id. */
  id: string
  /** EXACT host. Never a wildcard: a `*.ingest.example.com` exemption would
   * cover every other tenant of a shared provider. */
  host: string
  /** i18n key describing why the host is contacted, rendered in the firewall
   * panel. */
  purposeKey: string
  /** Consent gate that must be granted before the host is exempted. */
  consentGate: ConsentGateId
}

/**
 * Crash ingest — Sentry's EU region. The `oXXXXXXX` segment is the Sentry
 * ORGANISATION id and comes out of the DSN, which is not provisioned yet, so the
 * value below is a deliberate placeholder: `o0` is not a valid organisation, so
 * the exemption currently points at a host that resolves to nothing.
 *
 * PROVISIONAL — replace the org id once the Sentry account exists. Because the
 * exemption is host-EXACT, a stale value fails CLOSED (the real ingest would be
 * prompted like any unknown destination), never open.
 */
const CRASH_INGEST_HOST = 'o0.ingest.de.sentry.io'

/**
 * Telemetry ingest — PostHog's EU cloud. Unlike Sentry's, this host carries no
 * project or organisation identifier, so it stays valid whatever account gets
 * provisioned. PROVISIONAL only in that self-hosting is still on the table.
 */
const TELEMETRY_INGEST_HOST = 'eu.i.posthog.com'

/**
 * The declared endpoints.
 *
 * Hosts are provider-level and identical across the preview and release
 * channels — the channel is expressed by the project/DSN the SDK is configured
 * with, not by a different hostname — so unlike `backend.ts` there is no
 * per-channel switch here.
 *
 * Neither SDK is wired yet; the entries exist so the consent gate, the firewall
 * exemption and the panel row are all connected and testable end to end before
 * anything can actually send.
 */
export const OBSERVABILITY_ENDPOINTS: readonly ObservabilityEndpoint[] = [
  {
    id: 'crash',
    host: CRASH_INGEST_HOST,
    purposeKey: 'privacy.outbound.purpose.crash',
    consentGate: 'crash'
  },
  {
    id: 'telemetry',
    host: TELEMETRY_INGEST_HOST,
    purposeKey: 'privacy.outbound.purpose.telemetry',
    consentGate: 'telemetry'
  }
]

/** The declared endpoint for a gate, or `undefined` when none is declared. */
export function endpointForGate(gate: ConsentGateId): ObservabilityEndpoint | undefined {
  return OBSERVABILITY_ENDPOINTS.find((e) => e.consentGate === gate)
}

/**
 * Eligibility predicate for a firewall bypass / exemption: `rawUrl` targets a
 * declared endpoint over HTTPS with an EXACT host match.
 *
 * Four deliberate refusals, each one a real leak in a naive implementation:
 * plaintext http (a downgrade would send a scrubbed-but-still-diagnostic
 * payload in the clear), a host that merely ENDS WITH or EXTENDS the declared
 * one (`evil-o0.ingest.de.sentry.io`, `o0.ingest.de.sentry.io.attacker.net`),
 * an explicit non-443 port (it compares `url.host`, not `url.hostname`), and any
 * host whose gate is not the one being checked.
 *
 * Scope note: this predicate governs a CALL-SCOPED bypass — hand it to
 * `makeGuardedFetch`, the way `authComposition` hands over `isBackendFunctionsUrl`.
 * The firewall's system allowlist, which is what currently exempts these hosts,
 * matches on `{scheme, host}` alone and is therefore port-agnostic. The port
 * refusal is a property of THIS predicate, not of that allowlist.
 */
export function isObservabilityUrl(rawUrl: string, gate: ConsentGateId): boolean {
  const endpoint = endpointForGate(gate)
  if (endpoint === undefined) return false
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return url.host.toLowerCase() === endpoint.host.toLowerCase()
}

/** Sugar for the crash-ingest gate. */
export function isCrashUrl(rawUrl: string): boolean {
  return isObservabilityUrl(rawUrl, 'crash')
}

/** Sugar for the telemetry gate. */
export function isTelemetryUrl(rawUrl: string): boolean {
  return isObservabilityUrl(rawUrl, 'telemetry')
}
