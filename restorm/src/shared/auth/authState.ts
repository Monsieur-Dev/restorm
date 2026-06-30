/**
 * Auth + entitlement state — re-exported from the ECUI generic layer.
 *
 * `AuthState.capabilities` is `string[]` in ECUI (host-app-agnostic). Restorm
 * narrows its runtime capability strings with the `Capability` union below
 * (compile-time safety; any unknown string is still "not granted" at runtime).
 *
 * Import from here — not directly from `electron-core-ui` — so all three
 * layers (main, preload, renderer) share the IDENTICAL types.
 */

export type {
  PlanTier,
  AuthUser,
  AuthState,
  CheckoutResult
} from '../../../../electron-core-ui/src/shared/auth/authState'

export {
  AUTH_IPC,
  SIGNED_OUT_STATE,
  hasCapability
} from '../../../../electron-core-ui/src/shared/auth/authState'

/**
 * Capability flag strings — the contract with the Restorm backend entitlement
 * JWT. Modelled as a string union for ergonomics; any unknown capability is
 * treated as "not granted" at runtime (forward-compatible).
 *
 * Must stay in lock-step with:
 *   cloud/supabase/functions/_shared/providers/capabilities.ts
 */
export type Capability =
  | 'scenario.headless'
  | 'scenario.stepDebug'
  | 'secrets.vaults'
  | 'firewall.policies'
  | 'team.seats'
  | 'support.priority'
  | 'sso'
  | 'scim'
  | 'audit.logs'
  // Gates the advanced MCP tools. The request-driving tools stay free;
  // the MCP server itself is NOT gated — only Pro tools refuse at call time.
  // Backend contract: minted into `pro` + `enterprise`, never `community`.
  | 'mcp.pro'
