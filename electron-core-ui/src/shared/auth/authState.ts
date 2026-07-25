/**
 * Auth + entitlement state — the renderer-facing shape of the capability source
 * of truth. Lives in `shared/` so the main process (which owns the state), the
 * preload bridge, and the renderer all reference the IDENTICAL types + channel
 * names.
 *
 * Capabilities are typed as `string[]` so ECUI stays generic. A host app
 * narrows capabilities with its own union type for compile-time safety; the
 * service treats any unknown capability as "not granted" at runtime so a
 * backend that adds a capability before the app models it can never crash.
 *
 * `PlanTier` names ('community' / 'pro' / 'enterprise') are kept here because
 * they are part of the contract the cloud backend expresses in the JWT, and they
 * map cleanly to any subscription-model SaaS app.
 */

/** Plan tiers from the cloud backend contract. Community = the free / signed-out
 * baseline (NOT 'Free'). */
export type PlanTier = 'community' | 'pro' | 'enterprise'

/** The signed-in user's role within their organization. `admin` (master account)
 * manages billing, seats and members; `member` (a seat-holder) only uses their
 * seat. Generic org-membership concept — the host decides what each role gates. */
export type MemberRole = 'admin' | 'member'

/** The signed-in user's display profile. `email` is always present (it rides the
 * session JWT); `name` / `photoUrl` are best-effort and may be absent when the
 * backend or provider did not surface them. */
export interface AuthUser {
  email: string
  name?: string
  photoUrl?: string
}

/**
 * The reactive auth state broadcast to every renderer. Pure value snapshot —
 * no functions, no tokens — safe to serialise over IPC. Raw session / entitlement
 * JWTs never cross the bridge.
 */
export interface AuthState {
  /** True when a non-expired session JWT is held. */
  signedIn: boolean
  /** The user profile when signed in, else `null`. */
  user: AuthUser | null
  /** Current plan; defaults to `community` when signed out or without a live subscription. */
  plan: PlanTier
  /** The user's org role. Defaults to `member` (least privilege) when signed out
   * or when the session carried no role — never assume admin. */
  role: MemberRole
  /** Granted capabilities (absence = denied). Empty for community / signed-out.
   * The specific capability strings are host-defined; ECUI treats them as opaque. */
  capabilities: string[]
}

/** The canonical signed-out snapshot. Frozen so a consumer can't mutate the shared
 * default in place. */
export const SIGNED_OUT_STATE: Readonly<AuthState> = Object.freeze({
  signedIn: false,
  user: null,
  plan: 'community' as PlanTier,
  role: 'member' as MemberRole,
  capabilities: [] as string[]
})

/**
 * IPC channel names for the auth surface. Centralised so main, preload, and the
 * renderer can never drift on a string literal. `STATE_CHANGED` is a
 * main→renderer push (broadcast on every state transition).
 */
export const AUTH_IPC = {
  LOGIN: 'auth:login',
  LOGOUT: 'auth:logout',
  GET_STATE: 'auth:get-state',
  STATE_CHANGED: 'auth:state-changed',
  CHECKOUT: 'auth:checkout',
  PORTAL: 'auth:customer-portal'
} as const

/**
 * Result of a subscription checkout attempt, surfaced to the renderer. The raw
 * Paddle URL never crosses the bridge — the main process opens it directly in
 * the system browser.
 */
export type CheckoutResult =
  | { status: 'opened' }
  | { status: 'not-signed-in' }
  | { status: 'forbidden' }
  | { status: 'error' }

/**
 * Result of opening the hosted customer portal (manage / cancel the
 * subscription), surfaced to the renderer. Like checkout, the raw portal URL
 * never crosses the bridge — the main process opens it in the system browser.
 *
 * `no-subscription` is the "nothing to manage" outcome: the backend resolved no
 * billing customer for the account (never subscribed), so there is no portal to
 * open. The renderer turns it into an actionable message instead of a silent
 * no-op.
 */
export type PortalResult =
  | { status: 'opened' }
  | { status: 'not-signed-in' }
  | { status: 'no-subscription' }
  | { status: 'error' }

/** Convenience: does a state grant a given capability? */
export function hasCapability(state: AuthState, capability: string): boolean {
  return state.capabilities.includes(capability)
}
