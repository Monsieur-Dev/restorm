/**
 * Host-guarded, firewall-bypassed fetch for the cloud backend.
 *
 * The app's calls to its OWN Edge Functions (session exchange, entitlement poll)
 * are system operations that must skip the user firewall — but the exemption is
 * deliberately as narrow as possible:
 *   - it applies ONLY when the URL is https + the EXACT active-channel project
 *     host + the `/functions/v1/` path (`isBackendFunctionsUrl`), never a
 *     `*.supabase.co` wildcard;
 *   - `redirect: 'manual'` so a 3xx from the backend can never bounce the
 *     bypassed fetch to a different host (the callers treat the resulting
 *     opaque-redirect response as a failure via `!res.ok` — the login/session/
 *     entitlement endpoints never legitimately 3xx);
 *   - the bypass is the scoped `withFirewallBypass` (AsyncLocalStorage) — no
 *     persisted, user-deletable rule.
 *
 * Anything that does NOT match the guard is passed straight through to the base
 * fetch WITHOUT a bypass and with normal redirect handling, so it stays fully
 * firewall-governed. The bypass is injected so this module is electron-free and
 * unit-testable.
 */

import { isBackendFunctionsUrl } from '../../../shared/config/backend'

export interface GuardedFetchDeps {
  /** The EXACT backend host eligible for the bypass (channel project host). */
  allowedHost: string
  /** The scoped firewall bypass (electron-core-ui `withFirewallBypass`). */
  bypass: <T>(fn: () => Promise<T>) => Promise<T>
  /** The underlying fetch (defaults to the global). */
  baseFetch?: typeof fetch
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** Build the guarded fetch. */
export function makeGuardedFetch(deps: GuardedFetchDeps): typeof fetch {
  const baseFetch = deps.baseFetch ?? fetch
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (!isBackendFunctionsUrl(urlOf(input), deps.allowedHost)) {
      // Not our backend host → firewall-governed passthrough, untouched.
      return baseFetch(input, init)
    }
    return deps.bypass(() => baseFetch(input, { ...init, redirect: 'manual' }))
  }) as typeof fetch
}
