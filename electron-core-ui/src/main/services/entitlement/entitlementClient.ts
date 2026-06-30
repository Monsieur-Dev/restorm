/**
 * Entitlement client — fetches the signed entitlement from the
 * backend and verifies it OFFLINE, plus the grace / refresh time arithmetic.
 *
 * Security contract:
 *   - the token is EdDSA (Ed25519), verified with the embedded PUBLIC key;
 *   - verification PINS `algorithms: ['EdDSA']` so a forged `alg:none` / HS256
 *     token is rejected (alg-confusion guard);
 *   - the audience is PINNED to the injected `audience` string so a session /
 *     state token can never be replayed as an entitlement (token-confusion guard);
 *   - `exp` (iat + 15d) is enforced by the verify itself — a cached token past
 *     its hard grace ceiling is cryptographically unusable, even offline.
 *
 * We use `jose` (the same library the backend signs with) rather than hand-rolled
 * crypto: offline licence verification is exactly where a subtle JWT bug
 * (skipped exp, alg confusion, base64url edge case) defeats the whole model.
 *
 * The audience is injected via `verifyEntitlementToken`'s opts so this module
 * stays generic — a host app binds its own audience value.
 */

import * as jose from 'jose'
import type { PlanTier } from '../../../shared/auth/authState'

/** PINNED algorithm — Ed25519 only. The literal constant is used for `importSPKI`
 * (which expects a string literal), while the mutable array is passed to `jwtVerify`
 * (which expects `string[]`). */
const ENTITLEMENT_ALG = 'EdDSA' as const
const ENTITLEMENT_ALGS: string[] = [ENTITLEMENT_ALG]

/** The verified entitlement claims (recovered from a valid token). Mirrors the
 * backend `EntitlementClaims`. `org` is the JWT `sub`. */
export interface EntitlementClaims {
  org: string
  uid: string
  email: string
  plan: PlanTier
  capabilities: string[]
  /** issued-at (epoch seconds). */
  iat: number
  /** hard grace ceiling (epoch seconds) = iat + 15d; verify rejects past it. */
  exp: number
  /** online-refresh-due marker (epoch seconds) = iat + 24h; advisory. */
  refreshAfter: number
}

/** The parsed JSON body returned by the `entitlement` endpoint. The JWT is
 * authoritative; the loose fields are advisory convenience. */
export interface EntitlementResponse {
  /** The signed EdDSA entitlement JWT — the only field we trust after verifying. */
  entitlement: string
  plan?: string
  capabilities?: string[]
  expires_in?: number
  grace_seconds?: number
}

/** Import an Ed25519 SPKI PEM public key for verification. */
export function importEntitlementPublicKey(spkiPem: string): Promise<jose.CryptoKey> {
  return jose.importSPKI(spkiPem, ENTITLEMENT_ALG)
}

/**
 * Verify an entitlement JWT with the public key (signature + freshness +
 * audience + algorithm pinning). Throws if invalid / tampered / expired /
 * wrong-aud / wrong-alg. The returned claims are the ONLY trusted source of plan
 * + capabilities.
 *
 * @param publicKey either an already-imported key or the raw SPKI PEM string.
 * @param opts.audience the expected audience string (e.g. `'myapp-entitlement'`).
 *   REQUIRED — not having a default forces the caller to be explicit.
 */
export async function verifyEntitlementToken(
  token: string,
  publicKey: jose.CryptoKey | string,
  opts: { now?: () => number; audience: string }
): Promise<EntitlementClaims> {
  const key = typeof publicKey === 'string' ? await importEntitlementPublicKey(publicKey) : publicKey
  const { payload } = await jose.jwtVerify(token, key, {
    algorithms: ENTITLEMENT_ALGS,
    audience: opts.audience,
    ...(opts.now !== undefined ? { currentDate: new Date(opts.now()) } : {})
  })

  const plan = payload['plan']
  const capabilities = payload['capabilities']
  const refreshAfter = payload['refreshAfter']
  if (typeof plan !== 'string' || !Array.isArray(capabilities) || typeof refreshAfter !== 'number') {
    throw new Error('entitlement: malformed payload')
  }
  // `capabilities` may legitimately contain strings the app doesn't model yet;
  // keep them verbatim (the app ignores unknown ones at the gate site).
  return {
    org: typeof payload.sub === 'string' ? payload.sub : '',
    uid: typeof payload['uid'] === 'string' ? payload['uid'] : '',
    email: typeof payload['email'] === 'string' ? payload['email'] : '',
    plan: plan as PlanTier,
    capabilities: capabilities.filter((c): c is string => typeof c === 'string'),
    iat: Number(payload.iat),
    exp: Number(payload.exp),
    refreshAfter
  }
}

/**
 * Fetch a fresh entitlement from the backend with the session JWT as a bearer
 * token. Returns the parsed body (caller verifies `entitlement` offline before
 * trusting anything). Throws on non-2xx / network failure so the caller can fall
 * back to a cached entitlement within grace.
 *
 * @param fetchImpl injected so the caller can wrap it in `withFirewallBypass`
 *   (host-guarded) and tests can stub it — this module never references electron.
 */
export async function fetchEntitlement(
  entitlementUrl: string,
  sessionToken: string,
  fetchImpl: typeof fetch
): Promise<EntitlementResponse> {
  const res = await fetchImpl(entitlementUrl, {
    method: 'GET',
    headers: { authorization: `Bearer ${sessionToken}` }
  })
  if (!res.ok) {
    throw new Error(`entitlement: backend responded ${String(res.status)}`)
  }
  const parsed = (await res.json()) as { entitlement?: unknown }
  if (typeof parsed.entitlement !== 'string' || parsed.entitlement.length === 0) {
    throw new Error('entitlement: response missing signed token')
  }
  return parsed as EntitlementResponse
}

/** Checkout request body. The backend resolves the customer + the Pro price from
 * the session; the app only chooses how many seats and which billing cycle. */
export interface CheckoutRequest {
  /** Seat count (backend enforces 1..1000). */
  seats: number
  cycle: 'monthly' | 'annual'
}

/** The « S'abonner » upsell default: a single monthly seat. A seat/cycle picker
 * can refine this later. */
export const DEFAULT_CHECKOUT_REQUEST: CheckoutRequest = { seats: 1, cycle: 'monthly' }

/** A non-2xx checkout response, carrying the HTTP status so the caller can map
 * the backend's contract (notably 403 = checkout is org-admin-only) to a precise
 * user-facing outcome instead of a generic failure. */
export class CheckoutHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`checkout: backend responded ${String(statusCode)}`)
    this.name = 'CheckoutHttpError'
  }
}

/**
 * Ask the backend to create a Paddle checkout transaction for the signed-in user
 * and return the hosted checkout URL (or `null` — the backend may legitimately
 * omit a URL in edge cases). The session JWT (bearer) is the only credential; the
 * backend resolves the customer + the Pro price, so the app only sends the seat /
 * cycle choice. Throws `CheckoutHttpError` on a non-2xx response (so the caller
 * can special-case 403 admin-only) and rethrows network failures.
 *
 * @param fetchImpl injected so the caller wraps it in `withFirewallBypass`
 *   (host-guarded) and tests can stub it — this module never references electron.
 */
export async function createCheckout(
  checkoutUrl: string,
  sessionToken: string,
  fetchImpl: typeof fetch,
  body: CheckoutRequest = DEFAULT_CHECKOUT_REQUEST
): Promise<string | null> {
  const res = await fetchImpl(checkoutUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    throw new CheckoutHttpError(res.status)
  }
  const parsed = (await res.json()) as { checkoutUrl?: unknown }
  // checkoutUrl is nullable in the contract; treat anything but a non-empty
  // string as "no URL to open" and let the caller decide what to surface.
  return typeof parsed.checkoutUrl === 'string' && parsed.checkoutUrl.length > 0
    ? parsed.checkoutUrl
    : null
}

/**
 * Ask the backend to create a hosted customer-portal session for the signed-in
 * user and return its URL (or `null` — the backend returns no URL when the
 * account has no billing customer, i.e. it never subscribed). The session JWT
 * (bearer) is the only credential; the backend resolves the customer from it.
 * Throws on a non-2xx response (mapped to a generic failure by the caller) and
 * rethrows network failures.
 *
 * @param fetchImpl injected so the caller wraps it in `withFirewallBypass`
 *   (host-guarded) and tests can stub it — this module never references electron.
 */
export async function createCustomerPortalSession(
  portalUrl: string,
  sessionToken: string,
  fetchImpl: typeof fetch
): Promise<string | null> {
  const res = await fetchImpl(portalUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken}` }
  })
  if (!res.ok) {
    throw new Error(`customer-portal: backend responded ${String(res.status)}`)
  }
  const parsed = (await res.json()) as { portalUrl?: unknown }
  // portalUrl is nullable in the contract (no billing customer → nothing to
  // manage); treat anything but a non-empty string as "no URL to open".
  return typeof parsed.portalUrl === 'string' && parsed.portalUrl.length > 0
    ? parsed.portalUrl
    : null
}

/** Epoch seconds, injectable clock. */
export function nowSeconds(now?: () => number): number {
  return Math.floor((now?.() ?? Date.now()) / 1000)
}

/**
 * Whether a cached entitlement is still within its hard offline-grace window
 * (now < exp). Past it the token is cryptographically unusable and treated as
 * absent. (Verification also enforces this; this helper lets the service check
 * cheaply without a re-verify.)
 */
export function isWithinGrace(claims: Pick<EntitlementClaims, 'exp'>, nowSec: number): boolean {
  return nowSec < claims.exp
}

/**
 * Whether an entitlement is due an online refresh (now ≥ refreshAfter, = iat+24h).
 * Advisory only — the app keeps using the current token until `exp`; it just
 * re-polls when online to pick up plan changes early.
 */
export function needsRefresh(claims: Pick<EntitlementClaims, 'refreshAfter'>, nowSec: number): boolean {
  return nowSec >= claims.refreshAfter
}
