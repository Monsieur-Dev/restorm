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
 *
 * The session audience string (`sessionAudience`) is injected by the caller so
 * this module stays generic — a host app binds its own audience value (e.g.
 * `'myapp-session'`) rather than having it hard-coded here.
 */

/** The subset of session claims we read for display / freshness. */
export interface SessionInfo {
  email?: string
  /** display name (first + last), when the backend captured it from the provider. */
  name?: string
  /** profile photo URL (e.g. Google picture), when the provider supplied one. */
  photoUrl?: string
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
    const encodedPayload = parts[1]
    if (encodedPayload === undefined) return null
    const payload = JSON.parse(base64urlDecode(encodedPayload)) as Record<string, unknown>
    const info: SessionInfo = {}
    if (typeof payload['email'] === 'string') info.email = payload['email']
    // `name` / `photoUrl` are best-effort display fields the backend mints only
    // when the provider supplied them (omitted otherwise — never null keys).
    if (typeof payload['name'] === 'string') info.name = payload['name']
    if (typeof payload['photoUrl'] === 'string') info.photoUrl = payload['photoUrl']
    if (typeof payload['org'] === 'string') info.org = payload['org']
    if (typeof payload['exp'] === 'number') info.exp = payload['exp']
    if (typeof payload['aud'] === 'string') info.aud = payload['aud']
    return info
  } catch {
    return null
  }
}

/**
 * Whether a session token is unusable: not a JWT, wrong audience, or past `exp`
 * (with a small skew allowance). A missing `exp` is treated as expired — we never
 * trust a token we can't bound. `nowSec` and `sessionAudience` are injectable for
 * deterministic tests and generic usage.
 */
export function isSessionExpired(token: string, nowSec: number, sessionAudience: string, skewSeconds = 30): boolean {
  const info = decodeSessionInfo(token)
  if (!info) return true
  if (info.aud !== undefined && info.aud !== sessionAudience) return true
  if (typeof info.exp !== 'number') return true
  return nowSec >= info.exp + skewSeconds
}

/** A no-capabilities default — convenience for signed-out derivations. */
export const NO_CAPABILITIES: string[] = []
