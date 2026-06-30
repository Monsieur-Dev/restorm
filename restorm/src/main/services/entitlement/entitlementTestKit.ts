/**
 * Test support for the auth/entitlement unit tests. Generates
 * ephemeral keys + signs fixture JWTs that mirror the backend's mint contract
 * EXACTLY (`cloud/supabase/functions/_shared/{entitlement,session}.ts`), so the
 * app-side verifier is tested against tokens shaped like the real ones — without
 * needing the real (secret) DEV private key.
 *
 * Not a `.test.ts` file (it exports helpers, no tests); imported by the specs.
 */

import * as jose from 'jose'
import type { Capability, PlanTier } from '../../../shared/auth/authState'

export const ENTITLEMENT_AUD = 'restorm-entitlement'
export const SESSION_AUD = 'restorm-session'

export interface EdKeyPair {
  privateKey: jose.CryptoKey
  publicKey: jose.CryptoKey
  publicSpkiPem: string
}

/** A fresh Ed25519 key pair, with the public half exported as SPKI PEM (the form
 * the app embeds). */
export async function generateEdKeyPair(): Promise<EdKeyPair> {
  const { privateKey, publicKey } = await jose.generateKeyPair('EdDSA', { extractable: true })
  const publicSpkiPem = await jose.exportSPKI(publicKey)
  return { privateKey, publicKey, publicSpkiPem }
}

export interface FixtureEntitlementOpts {
  privateKey: jose.CryptoKey
  org?: string
  uid?: string
  email?: string
  plan?: PlanTier
  capabilities?: Capability[]
  iatSeconds: number
  /** seconds after iat the token hard-expires (grace ceiling). Default 15d. */
  graceSeconds?: number
  /** seconds after iat the refresh becomes due. Default 24h. */
  refreshSeconds?: number
  /** Override the audience (to test aud pinning). */
  audience?: string
  /** Override the signing alg header (to test alg pinning). */
  alg?: string
}

/** Sign a fixture entitlement JWT exactly like the backend `mintEntitlementJwt`. */
export function signEntitlement(opts: FixtureEntitlementOpts): Promise<string> {
  const iat = opts.iatSeconds
  const exp = iat + (opts.graceSeconds ?? 60 * 60 * 24 * 15)
  const refreshAfter = iat + (opts.refreshSeconds ?? 60 * 60 * 24)
  return new jose.SignJWT({
    uid: opts.uid ?? 'user-1',
    email: opts.email ?? 'user@example.com',
    plan: opts.plan ?? 'pro',
    capabilities: opts.capabilities ?? ['scenario.stepDebug', 'scenario.headless'],
    refreshAfter
  })
    .setProtectedHeader({ alg: opts.alg ?? 'EdDSA' })
    .setSubject(opts.org ?? 'org-1')
    .setAudience(opts.audience ?? ENTITLEMENT_AUD)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(opts.privateKey)
}

/** Sign a fixture HS256 session JWT like the backend `mintSessionJwt`. The
 * optional `name` / `photoUrl` mirror the backend's omit-when-absent display
 * claims (only emitted when provided, never as null keys). */
export function signSession(opts: {
  secret: string
  email?: string
  name?: string
  photoUrl?: string
  org?: string
  iatSeconds: number
  ttlSeconds?: number
  audience?: string
}): Promise<string> {
  const iat = opts.iatSeconds
  const exp = iat + (opts.ttlSeconds ?? 60 * 60 * 24 * 30)
  return new jose.SignJWT({
    wuid: 'wuid-1',
    org: opts.org ?? 'org-1',
    role: 'admin',
    email: opts.email ?? 'user@example.com',
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.photoUrl !== undefined ? { photoUrl: opts.photoUrl } : {})
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('appuser-1')
    .setAudience(opts.audience ?? SESSION_AUD)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(opts.secret))
}
