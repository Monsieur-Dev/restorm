import { useEffect, useState } from 'react'
import {
  SIGNED_OUT_STATE,
  hasCapability,
  type AuthState,
  type Capability
} from '../../../shared/auth/authState'

/**
 * Subscribe to the live cloud auth/entitlement snapshot.
 *
 * Initialises to the signed-out snapshot, reads the current `AuthState` once on
 * mount (`account.getState()`), then tracks every transition
 * (`account.onStateChanged`), so a consumer re-renders the instant the user logs
 * in, logs out, or the entitlement refreshes.
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

/**
 * True when the live entitlement currently grants `capability`. Re-renders on
 * login / logout / entitlement refresh. The single read a gated control needs:
 * `const locked = !useCapability('scenario.stepDebug')`.
 */
export function useCapability(capability: Capability): boolean {
  return hasCapability(useAuthState(), capability)
}
