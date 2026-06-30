/**
 * Headless entitlement check for CI / non-interactive scenario runs.
 *
 * In a CI runner there is no browser → the interactive loopback login never
 * completes. Instead the user sets RESTORM_TOKEN to an org-scoped PAT
 * (rstk_… prefix) minted on their account dashboard, and this module:
 *   1. reads the env var;
 *   2. calls the shared `entitlement` Edge Function with the PAT as a Bearer
 *      token (same HTTP shape as the interactive session-JWT path; the backend
 *      detects the opaque token and resolves it against the `cli_tokens` table);
 *   3. verifies the returned signed entitlement JWT OFFLINE (same trust model
 *      as the interactive path: EdDSA, audience-pinned, exp-enforced);
 *   4. reports whether `scenario.headless` is granted.
 *
 * Security: we still go through the full offline JWT verify after the backend
 * responds, so a compromised or spoofed backend cannot grant capabilities — the
 * signed JWT from the REAL backend key is the only authority (same as
 * interactive). CI is assumed always-online; no offline grace is applied here.
 *
 * All Electron-coupled concerns (app.getVersion, userData, safeStorage, …) are
 * injected via `HeadlessEntitlementDeps`, so this module is pure Node + crypto —
 * fully unit-testable without an Electron runtime.
 */

import {
  fetchEntitlement,
  verifyEntitlementToken
} from 'electron-core-ui/main'

/** The capability string that authorises a headless CLI scenario run. Must equal
 * the backend `capabilitiesFor(plan)` output (cloud `_shared/providers/capabilities.ts`). */
const HEADLESS_CAPABILITY = 'scenario.headless'

/** Audience pinned to the restorm entitlement JWT. Must equal the backend
 * `AUD_ENTITLEMENT` constant in `cloud/supabase/functions/_shared/entitlement.ts`. */
const ENTITLEMENT_AUDIENCE = 'restorm-entitlement'

export type HeadlessEntitlementReason =
  /** RESTORM_TOKEN env var is absent or blank. */
  | 'token-missing'
  /** The backend returned a JWT that failed verification (wrong key / expired /
   * wrong audience / malformed), OR publicKeyConfigured is false (pre-launch). */
  | 'token-invalid'
  /** Network error or non-2xx response from the entitlement endpoint (includes
   * 401 Unauthorized for a revoked / unknown token). */
  | 'fetch-error'
  /** The JWT is valid but the org's plan does not include scenario.headless. */
  | 'plan-insufficient'

export type HeadlessEntitlementResult =
  | { granted: true }
  | { granted: false; reason: HeadlessEntitlementReason }

export interface HeadlessEntitlementDeps {
  /** Full URL of the backend `entitlement` Edge Function. */
  entitlementUrl: string
  /** Ed25519 SPKI PEM public key for offline signature verification. Must be the
   * channel-specific key from `services/entitlement/keys.ts`. */
  publicKeyPem: string
  /** False when publicKeyPem is a placeholder (PROD pre-launch) → fail closed to
   * community; never attempt a verify with a non-key. */
  publicKeyConfigured: boolean
  /** Injected fetch implementation. Must be the channel-scoped guarded fetch from
   * the composition root (wraps the backend URL in `withFirewallBypass`) so the
   * main-process firewall never prompts in headless mode — there is no window to
   * receive the prompt. */
  fetchImpl: typeof fetch
  /** Injectable clock (epoch ms, like `Date.now`). Default: `Date.now`. */
  now?: () => number
}

/**
 * Check whether `RESTORM_TOKEN` grants the `scenario.headless` capability.
 *
 * Returns `{ granted: false, reason: 'token-missing' }` SILENTLY when the env
 * var is absent or blank — the caller prints the user-facing message so it can
 * embed the upgrade URL and any other context. All other failure reasons should
 * be logged by the caller.
 */
export async function checkHeadlessEntitlement(
  deps: HeadlessEntitlementDeps
): Promise<HeadlessEntitlementResult> {
  const raw = process.env['RESTORM_TOKEN']
  if (raw === undefined || raw.trim() === '') {
    return { granted: false, reason: 'token-missing' }
  }
  const token = raw.trim()

  // Fail closed: prod key is a placeholder until the prod key pair is generated.
  if (!deps.publicKeyConfigured) {
    return { granted: false, reason: 'token-invalid' }
  }

  let entitlementJwt: string
  try {
    const body = await fetchEntitlement(deps.entitlementUrl, token, deps.fetchImpl)
    entitlementJwt = body.entitlement
  } catch {
    // Covers: network failures, non-2xx (incl. 401 revoked), missing `entitlement`
    // field — all mapped to fetch-error so the caller can suggest retrying.
    return { granted: false, reason: 'fetch-error' }
  }

  try {
    const claims = await verifyEntitlementToken(entitlementJwt, deps.publicKeyPem, {
      audience: ENTITLEMENT_AUDIENCE,
      now: deps.now
    })
    return claims.capabilities.includes(HEADLESS_CAPABILITY)
      ? { granted: true }
      : { granted: false, reason: 'plan-insufficient' }
  } catch {
    // Covers: signature mismatch, expired, wrong audience, malformed payload.
    return { granted: false, reason: 'token-invalid' }
  }
}
