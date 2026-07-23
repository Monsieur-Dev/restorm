import React, { useMemo } from 'react'
import { useAuthState, type CapabilityGate } from 'electron-core-ui/renderer'
import { hasCapability, type Capability } from '../../../shared/auth/authState'
import { subscribeToPro } from '../services/subscribeToPro'

/**
 * Computes the `CapabilityGate` `ElectronCoreUiProvider` threads down to
 * `SettingItem` for `capability`-tagged settings (e.g. Settings→Git). Must
 * be a real React component (not a plain object built once at module
 * scope, e.g. inline in `main.tsx`'s bootstrap call) so `capabilityGate`'s
 * identity refreshes — and every capability-gated setting row re-renders —
 * on login/logout/entitlement refresh.
 */
export const GitCapabilityGateHost: React.FC<{ children: (gate: CapabilityGate) => React.ReactNode }> = ({ children }) => {
  const authState = useAuthState()
  const gate = useMemo<CapabilityGate>(() => ({
    isLocked: (capability: string) => !hasCapability(authState, capability as Capability),
    onSubscribe: () => { void subscribeToPro() }
  }), [authState])
  return <>{children(gate)}</>
}

export default GitCapabilityGateHost
