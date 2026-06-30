import { useAuthState } from 'electron-core-ui/renderer'
import { hasCapability, type AuthState, type Capability } from '../../../shared/auth/authState'

// Re-export useAuthState so existing consumers can import from this module.
export { useAuthState }
export type { AuthState }

/**
 * True when the live entitlement currently grants `capability`. Re-renders on
 * login / logout / entitlement refresh. The single read a gated control needs:
 * `const locked = !useCapability('scenario.stepDebug')`.
 */
export function useCapability(capability: Capability): boolean {
  return hasCapability(useAuthState(), capability)
}
