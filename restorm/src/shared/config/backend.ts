/**
 * Per-channel cloud backend configuration.
 *
 * The desktop app talks to its own Supabase Edge Functions for login, session
 * exchange and entitlement polling. Preview builds hit the DEV project; release
 * builds hit PROD. We resolve the channel off the app version's `-preview`
 * suffix (package.json ships `0.1.x-preview`; the release pipeline strips it) so
 * there is nothing extra to thread through the build — the same switch drives
 * the embedded entitlement public key (`main/services/entitlement/keys.ts`).
 *
 * Pure + version-string-injected (never reads `app.getVersion()` directly) so it
 * is trivially unit-testable and usable from any process.
 */

export type ReleaseChannel = 'preview' | 'prod'

/**
 * DEV (preview) Edge Functions base URL — the dev Supabase project preview builds
 * talk to (confirmed by the lead, 2026-06-29).
 */
const DEV_FUNCTIONS_URL = 'https://ntxmtfngtfevisbylniz.supabase.co/functions/v1'

/**
 * PROD (release) Edge Functions base URL — the prod Supabase project release
 * builds talk to (confirmed by the lead, 2026-06-29).
 */
const PROD_FUNCTIONS_URL = 'https://jkfaqkaakovwlsncukif.supabase.co/functions/v1'

/** Resolve the release channel from an app version string. The `-preview`
 * suffix (e.g. `0.1.7-preview`) ⇒ the DEV/preview channel; anything else ⇒ prod. */
export function resolveChannel(version: string): ReleaseChannel {
  return version.includes('-preview') ? 'preview' : 'prod'
}

/** The Edge Functions base URL (`.../functions/v1`, no trailing slash) for a
 * channel. Individual endpoints are appended as `${base}/login` etc. */
export function functionsBaseUrl(channel: ReleaseChannel): string {
  return channel === 'preview' ? DEV_FUNCTIONS_URL : PROD_FUNCTIONS_URL
}

/** The EXACT host of the channel's Edge Functions (e.g.
 * `ntxmtfngtfevisbylniz.supabase.co`). Used to scope the firewall bypass to this
 * one project host only — never a wildcard `*.supabase.co`. */
export function functionsHost(channel: ReleaseChannel): string {
  return new URL(functionsBaseUrl(channel)).host
}

/** Endpoint paths under the functions base. */
export const BACKEND_ENDPOINTS = {
  login: 'login',
  session: 'session',
  entitlement: 'entitlement'
} as const

/** Build a full endpoint URL for a channel, e.g. `loginUrl('preview')`. */
export function endpointUrl(channel: ReleaseChannel, endpoint: keyof typeof BACKEND_ENDPOINTS): string {
  return `${functionsBaseUrl(channel)}/${BACKEND_ENDPOINTS[endpoint]}`
}

/**
 * Host-allow predicate for the firewall bypass: ONLY our own Edge Functions are
 * eligible — https, the `/functions/v1/...` path, AND an EXACT match on the
 * active channel's project host (`allowedHost`, e.g.
 * `ntxmtfngtfevisbylniz.supabase.co`). Pinning the exact host (not a
 * `*.supabase.co` wildcard) means no other Supabase project / subdomain can ever
 * receive the firewall exemption.
 */
export function isBackendFunctionsUrl(rawUrl: string, allowedHost: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.host !== allowedHost) return false
  return url.pathname.startsWith('/functions/v1/')
}
