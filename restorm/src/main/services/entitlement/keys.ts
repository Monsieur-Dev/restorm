/**
 * Embedded entitlement-verification public keys, one per release channel.
 *
 * The entitlement JWT is signed ASYMMETRICALLY (EdDSA / Ed25519): the PRIVATE
 * key lives ONLY in the Supabase Edge Function; the app ships only the PUBLIC
 * key and verifies offline. Embedding it as a compiled-in constant (NOT reading
 * a `.pem` from disk) is deliberate:
 *   - inside a packaged asar a stray `.pem` is not reliably present;
 *   - a constant cannot be swapped on disk by a local attacker to make the app
 *     trust a forged `enterprise` entitlement.
 *
 * The key is per channel because DEV and PROD use DIFFERENT key pairs (the DEV
 * pair is the sandbox key; PROD is generated at launch). Same channel switch as
 * the backend URL (`shared/config/backend.ts`).
 */

import type { ReleaseChannel } from '../../../shared/config/backend'

/**
 * DEV / sandbox Ed25519 public key (SPKI PEM) — pairs with the private key held
 * in the dev Supabase `ENTITLEMENT_JWT_PRIVATE_KEY` secret (the 2nd, clean pair;
 * the 1st dev private key was burned).
 */
const PREVIEW_ENTITLEMENT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA497icWt0Ipy90EdQU9v5iu8V4pK/BsrXE9XwciMjllc=
-----END PUBLIC KEY-----`

/**
 * PROD Ed25519 public key (SPKI PEM) — pairs with the private key held ONLY in
 * the prod Supabase `ENTITLEMENT_JWT_PRIVATE_KEY` secret (generated for the
 * go-live; the private half is archived in the owner's vault, never in the repo).
 */
const PROD_ENTITLEMENT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAYe6SneJJMzSDcypmO3ZZwIh7vZS1kScgOIgVEUjtAQw=
-----END PUBLIC KEY-----`

/** The SPKI PEM of the entitlement public key for a release channel. */
export function entitlementPublicKeyPem(channel: ReleaseChannel): string {
  return channel === 'preview' ? PREVIEW_ENTITLEMENT_PUBLIC_KEY : PROD_ENTITLEMENT_PUBLIC_KEY
}

/** True once the channel's key is a real, populated SPKI PEM (the PROD slot is a
 * placeholder until the prod pair is generated). Callers use this to fail closed
 * rather than attempt a verify with a non-key. */
export function isEntitlementPublicKeyConfigured(channel: ReleaseChannel): boolean {
  return !entitlementPublicKeyPem(channel).includes('<PROD_ENTITLEMENT_PUBLIC_KEY_SPKI>')
}
