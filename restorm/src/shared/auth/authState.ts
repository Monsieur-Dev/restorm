/**
 * Auth + entitlement state — the renderer-facing shape of the capability source
 * of truth. Lives in `shared/` so the main process (which owns
 * the state), the preload bridge, and the renderer all reference the IDENTICAL
 * types + channel names.
 *
 * The capability strings MUST stay in lock-step with the backend contract
 * (`cloud/supabase/functions/_shared/providers/capabilities.ts`): the entitlement
 * JWT embeds these exact strings and the app gates UI off them. A capability the
 * app doesn't know about is simply ignored (forward-compatible), never granted.
 */

/** Plan tiers mirrored from the backend `PlanTier` enum. Community = the free /
 * signed-out baseline (NOT "Free"). */
export type PlanTier = 'community' | 'pro' | 'enterprise'

/**
 * Capability flag strings — the contract with the backend entitlement JWT. We
 * model them as a string union for ergonomics but treat any unknown string as
 * "not granted" at runtime, so a backend that adds a capability before the app
 * knows it can never crash the app.
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

/** The signed-in user's display profile. `email` is always present (it rides the
 * session JWT); `name` / `photoUrl` are best-effort and may be absent — the
 * backend does not yet surface them to the app (a backend follow-up). */
export interface AuthUser {
  email: string
  name?: string
  photoUrl?: string
}

/**
 * The reactive auth state broadcast to every renderer. It is a pure value
 * snapshot — no functions, no tokens — safe to serialise over IPC. The raw
 * session / entitlement JWTs never cross the bridge.
 */
export interface AuthState {
  /** True when a non-expired session JWT is held. */
  signedIn: boolean
  /** The user profile when signed in, else `null`. */
  user: AuthUser | null
  /** Current plan; defaults to `community` when signed out or without a live sub. */
  plan: PlanTier
  /** Granted capabilities (absence = denied). Empty for community / signed-out. */
  capabilities: Capability[]
}

/** The canonical signed-out snapshot. Frozen so a consumer can't mutate the shared
 * default in place. */
export const SIGNED_OUT_STATE: Readonly<AuthState> = Object.freeze({
  signedIn: false,
  user: null,
  plan: 'community',
  capabilities: [] as Capability[]
})

/**
 * IPC channel names for the auth surface. Centralised so main, preload and the
 * renderer can never drift on a string literal. `STATE_CHANGED` is a main→renderer
 * push (broadcast on every state transition).
 */
export const AUTH_IPC = {
  LOGIN: 'auth:login',
  LOGOUT: 'auth:logout',
  GET_STATE: 'auth:get-state',
  STATE_CHANGED: 'auth:state-changed',
  CHECKOUT: 'auth:checkout'
} as const

/**
 * Result of a « S'abonner » checkout attempt, surfaced to the renderer. The raw
 * Paddle URL never crosses the bridge — the main process opens it directly in
 * the system browser — so the renderer only learns the outcome.
 */
export type CheckoutResult =
  /** The checkout URL was created and handed to the system browser. */
  | { status: 'opened' }
  /** No signed-in session — the caller should prompt login first. */
  | { status: 'not-signed-in' }
  /** Checkout is org-admin-only (backend 403) — a non-admin must ask their org
   * admin to subscribe. Surfaced as a distinct, actionable message. */
  | { status: 'forbidden' }
  /** Backend / network / open failure; already logged in the main process. */
  | { status: 'error' }

/** Convenience: does a state grant a given capability? */
export function hasCapability(state: AuthState, capability: Capability): boolean {
  return state.capabilities.includes(capability)
}
