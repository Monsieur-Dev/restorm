import React, { useMemo } from 'react'
import { useAuthState, type CapabilityGate } from 'electron-core-ui/renderer'
import { hasCapability, type Capability } from '../../../shared/auth/authState'
import { CRASH_OPT_OUT_CAPABILITY } from '../../../shared/auth/planCapabilities'
import { subscribeToPro } from '../services/subscribeToPro'

/**
 * Computes the `CapabilityGate` `ElectronCoreUiProvider` threads down to
 * `SettingItem` for `capability`-tagged settings (Settings→Git,
 * Settings→Privacy). Must be a real React component (not a plain object built
 * once at module scope, e.g. inline in `main.tsx`'s bootstrap call) so
 * `capabilityGate`'s identity refreshes — and every capability-gated setting row
 * re-renders — on login/logout/entitlement refresh.
 *
 * Two kinds of gate resolve here. Most are backend-minted capabilities read
 * straight off the entitlement JWT. `crash.optOut` is the exception: it is
 * derived from the PLAN, not minted, because crash reporting is mandatory on
 * the free tier and optional on every paid one. Deriving it keeps the rule out
 * of the backend capability contract — an unminted capability is granted to
 * nobody, which would lock paying users out of an opt-out they are entitled to.
 */
export const CapabilityGateHost: React.FC<{ children: (gate: CapabilityGate) => React.ReactNode }> = ({ children }) => {
  const authState = useAuthState()
  const gate = useMemo<CapabilityGate>(() => ({
    isLocked: (capability: string) => (
      capability === CRASH_OPT_OUT_CAPABILITY
        ? authState.plan === 'community'
        : !hasCapability(authState, capability as Capability)
    ),
    onSubscribe: () => { void subscribeToPro() }
  }), [authState])
  return <>{children(gate)}</>
}
