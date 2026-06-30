/**
 * Host-guarded, firewall-bypassed fetch for the cloud backend.
 *
 * The app's calls to its OWN Edge Functions (session exchange, entitlement poll)
 * are system operations that must skip the user firewall — but the exemption is
 * deliberately as narrow as possible:
 *   - it applies ONLY when the caller's `isEligibleUrl` predicate returns `true`,
 *     which the host app pins to its exact backend host + the `/functions/v1/`
 *     path prefix (never a wildcard);
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

export interface GuardedFetchDeps {
  /** Predicate: return `true` ONLY for the URLs that should be firewall-bypassed
   * and receive `redirect: 'manual'`. The host app pins this to its own backend
   * host (never a wildcard). */
  isEligibleUrl: (url: string) => boolean
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
    if (!deps.isEligibleUrl(urlOf(input))) {
      // Not our backend host → firewall-governed passthrough, untouched.
      return baseFetch(input, init)
    }
    return deps.bypass(() => baseFetch(input, { ...init, redirect: 'manual' }))
  }) as typeof fetch
}
