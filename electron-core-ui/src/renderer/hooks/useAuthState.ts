import { useEffect, useState } from 'react'
import { SIGNED_OUT_STATE } from '../../shared/auth/authState'
import type { AuthState } from '../../shared/auth/authState'

/**
 * Subscribe to the live cloud auth/entitlement snapshot.
 *
 * Initialises to the signed-out snapshot, reads the current `AuthState` once on
 * mount (`account.getState()`), then tracks every transition
 * (`account.onStateChanged`), so a consumer re-renders the instant the user logs
 * in, logs out, or the entitlement refreshes.
 *
 * Requires the host app's preload to expose `window.api.account` (login, logout,
 * getState, onStateChanged, subscribe).
 */
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>(SIGNED_OUT_STATE)
  useEffect(() => {
    const account = window.api.account
    let cancelled = false
    void account.getState().then((next) => {
      if (!cancelled) setState(next)
    })
    const unsubscribe = account.onStateChanged((next) => { setState(next) })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return state
}
