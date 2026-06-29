/**
 * Session-token helpers.
 *
 * The session JWT is HS256, signed with a secret that lives ONLY in the backend,
 * so the app cannot (and must not pretend to) cryptographically verify it. The
 * app treats it as an OPAQUE bearer token it received directly over HTTPS from
 * its own backend (the one-time-code exchange) and trusts on that basis.
 *
 * For DISPLAY only — the account email and the expiry — we base64url-decode the
 * payload WITHOUT verifying the signature. This is explicitly untrusted parsing:
 * it drives UI labels and the "is my session still fresh?" check, never an
 * authorization decision (capabilities come from the asymmetrically-signed,
 * properly-verified entitlement JWT).
 */

import type { Capability } from '../../../shared/auth/authState'

/** PINNED session audience, mirrors the backend `AUD_SESSION`. */
export const SESSION_AUDIENCE = 'restorm-session'

/** The subset of session claims we read for display / freshness. */
export interface SessionInfo {
  email?: string
  /** organizations.id. */
  org?: string
  /** expiry (epoch seconds), if present. */
  exp?: number
  /** audience, used to sanity-check we were handed the right token kind. */
  aud?: string
}

function base64urlDecode(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, 'base64').toString('utf8')
}

/**
 * Best-effort decode of the session JWT payload (UNVERIFIED). Returns `null` if
 * the token isn't a well-formed JWT. Never throws.
 */
export function decodeSessionInfo(token: string): SessionInfo | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(base64urlDecode(parts[1])) as Record<string, unknown>
    const info: SessionInfo = {}
    if (typeof payload.email === 'string') info.email = payload.email
    if (typeof payload.org === 'string') info.org = payload.org
    if (typeof payload.exp === 'number') info.exp = payload.exp
    if (typeof payload.aud === 'string') info.aud = payload.aud
    return info
  } catch {
    return null
  }
}

/**
 * Whether a session token is unusable: not a JWT, wrong audience, or past `exp`
 * (with a small skew allowance). A missing `exp` is treated as expired — we never
 * trust a token we can't bound. `nowSec` is injectable for deterministic tests.
 */
export function isSessionExpired(token: string, nowSec: number, skewSeconds = 30): boolean {
  const info = decodeSessionInfo(token)
  if (!info) return true
  if (info.aud !== undefined && info.aud !== SESSION_AUDIENCE) return true
  if (typeof info.exp !== 'number') return true
  return nowSec >= info.exp + skewSeconds
}

/** A no-capabilities default — convenience for signed-out derivations. */
export const NO_CAPABILITIES: Capability[] = []
