/**
 * EntitlementService — the REACTIVE capability source of truth.
 *
 * The existing `FeatureFlippingService` is static / YAML-driven / synchronous and
 * cannot model an entitlement that flips live on login / logout / refresh, so
 * this is a dedicated service (we mirror its singleton SHAPE, we do not overload
 * it). It owns the session JWT + the verified entitlement claims, derives the
 * renderer-facing `AuthState`, persists through the injected `AuthStore`, and
 * broadcasts every transition so the renderer updates within the instance.
 *
 * Trust model: capabilities + plan come ONLY from the asymmetrically-signed
 * entitlement JWT after a successful OFFLINE verify. The session JWT is an opaque
 * bearer credential (used to fetch the entitlement and to read the display email);
 * it never grants a capability. Any failure to fetch/verify a fresh entitlement
 * falls back to the cached one while it is within grace, else to community — it
 * never escalates.
 *
 * Every electron-coupled concern (storage, browser login, network, broadcast,
 * clock) is injected, so the whole reactive behaviour is unit-testable with fakes.
 */

import {
  AUTH_IPC,
  SIGNED_OUT_STATE,
  type AuthState,
  type AuthUser,
  type MemberRole,
  type PlanTier
} from '../../../shared/auth/authState'

// ---- dev-only e2e test seam ------------------------------------------------

/**
 * Seed a Pro entitlement without a real JWT. Called from the composition root
 * ONLY when `!app.isPackaged` (enforced by the caller) AND the explicit opt-in
 * env var is set.
 *
 * Returns `true` when the seed was applied; `false` when the guard rejects it
 * (isPackaged or wrong envPlan). The return value is used for logging.
 */
export const E2E_PRO_CAPABILITIES: readonly string[] = [
  'mcp.pro',
  'git.client'
  // NOTE: extend here if new Pro-feature e2e suites require additional caps.
]

/** What a caller may override in the seeded snapshot. Everything is optional:
 * the defaults are the ones an e2e suite wants, and a documentation-capture
 * run wants a presentable identity instead of `e2e@test.local` — that string
 * would otherwise end up printed in published screenshots. */
export interface E2ESeedOverrides {
  email?: string
  displayName?: string
  capabilities?: readonly string[]
}

export function seedEntitlementForE2E(
  service: EntitlementService,
  isPackaged: boolean,
  envPlan: string | undefined,
  overrides: E2ESeedOverrides = {}
): boolean {
  // Double-guard: caller (authComposition) already checks !isPackaged, but the
  // explicit check here makes the NO-OP branch directly unit-testable without
  // mocking electron.
  if (isPackaged || envPlan !== 'pro') return false
  service.__seedEntitlementForTesting({
    signedIn: true,
    user: {
      email: overrides.email ?? 'e2e@test.local',
      ...(overrides.displayName === undefined ? {} : { name: overrides.displayName })
    },
    plan: 'pro',
    role: 'admin',
    capabilities: [...(overrides.capabilities ?? E2E_PRO_CAPABILITIES)]
  })
  return true
}
import { decodeSessionInfo, isSessionExpired } from '../auth/sessionToken'
import {
  createCheckout,
  createCustomerPortalSession,
  fetchEntitlement,
  importEntitlementPublicKey,
  isWithinGrace,
  needsRefresh,
  nowSeconds,
  verifyEntitlementToken,
  type EntitlementClaims
} from './entitlementClient'
import type { CryptoKey } from 'jose'

/**
 * A backend call made with the session JWT came back non-2xx. Carries the HTTP
 * status and, when the body provided one, the backend's machine-readable error
 * code — so a caller can distinguish "you are not allowed" from "it is broken"
 * without parsing prose.
 */
export class SessionCallError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string
  ) {
    super(`session call failed with ${status}${code ? ` (${code})` : ''}`)
    this.name = 'SessionCallError'
  }
}

export interface EntitlementServiceDeps {
  /** Secure token persistence. */
  store: { load: () => { sessionToken: string; entitlementToken: string | null } | null; save: (d: { sessionToken: string; entitlementToken: string | null }) => void; clear: () => void }
  /** `<base>/entitlement`. */
  entitlementUrl: string
  /** `<base>/checkout` — the « S'abonner » upsell creates a Paddle transaction here. */
  checkoutUrl: string
  /** `<base>/customer-portal` — "manage my subscription" mints a hosted Paddle
   * customer-portal session here (manage / cancel / change card / invoices). */
  portalUrl: string
  /** Embedded Ed25519 SPKI public key PEM for this channel. */
  publicKeyPem: string
  /** False when the channel's key is a placeholder (prod, pre-launch) → never
   * trust an entitlement (fail closed to community). Default true. */
  publicKeyConfigured?: boolean
  /** Host-guarded (firewall-bypassed) fetch for backend calls. */
  fetchImpl: typeof fetch
  /** Drive the browser loopback login → session JWT. The `signal` lets a fresh
   * sign-in cancel the in-flight attempt (restartable retry). */
  login: (signal?: AbortSignal) => Promise<string>
  /** Push a new state to all renderers (the `auth:state-changed` broadcast). */
  broadcast: (channel: string, state: AuthState) => void
  /** The expected audience of entitlement tokens (e.g. `'myapp-entitlement'`). */
  entitlementAudience: string
  /** The expected audience of session tokens (e.g. `'myapp-session'`). */
  sessionAudience: string
  /** Injectable clock (epoch ms). */
  now?: () => number
  /** Structured logger (never receives tokens). */
  log?: (msg: string, fields?: Record<string, unknown>) => void
}

export class EntitlementService {
  private sessionToken: string | null = null
  /** The cached entitlement: the raw signed token plus its verified claims, kept
   * together so we can re-persist the exact token we verified. */
  private entitlement: { token: string; claims: EntitlementClaims } | null = null
  private importedKey: CryptoKey | null = null
  private lastBroadcast: AuthState | null = null
  private readonly log: (msg: string, fields?: Record<string, unknown>) => void
  /** Dev-only test seam (set via {@link __seedEntitlementForTesting}). When
   * non-null, {@link deriveState} returns this snapshot directly, bypassing the
   * JWT verify path.  NEVER set in packaged builds — enforced by the caller in
   * authComposition which guards on `!app.isPackaged`. */
  private seededState: AuthState | null = null

  constructor(private readonly deps: EntitlementServiceDeps) {
    this.log = deps.log ?? ((): void => undefined)
  }

  private get keyConfigured(): boolean {
    return this.deps.publicKeyConfigured ?? true
  }

  /**
   * Restore persisted auth on boot: drop an expired session, verify the cached
   * entitlement (only kept if still within grace), then derive + broadcast. When
   * online and the entitlement is due a refresh (or absent), poll for a fresh one
   * best-effort.
   */
  async init(): Promise<void> {
    const cached = this.deps.store.load()
    if (cached && !isSessionExpired(cached.sessionToken, nowSeconds(this.deps.now), this.deps.sessionAudience)) {
      this.sessionToken = cached.sessionToken
      if (cached.entitlementToken) {
        const claims = await this.verifyCached(cached.entitlementToken)
        this.entitlement = claims ? { token: cached.entitlementToken, claims } : null
      }
    } else if (cached) {
      // Stored session is past its 30-day life — discard it.
      this.deps.store.clear()
    }
    this.emit()

    if (this.sessionToken && (this.entitlement === null || needsRefresh(this.entitlement.claims, nowSeconds(this.deps.now)))) {
      await this.refresh()
    }
  }

  /** The current snapshot. */
  getState(): AuthState {
    return this.deriveState()
  }

  /**
   * Adopt whatever the SHARED auth cache now holds — the live-propagation path,
   * called when another instance's write (login, logout, plan change) lands in
   * the store this instance also reads.
   *
   * Three properties are deliberate:
   *
   * - **Read-only.** Unlike `init()`, an expired or absent cache is adopted as
   *   signed-out but never `clear()`ed: the instance that WROTE the file owns
   *   it, and a reader deleting it would race the writer.
   * - **No network.** Every instance re-fetching on every propagated write
   *   would turn one login into a thundering herd against the entitlement
   *   endpoint. The writer already fetched; readers verify what it persisted.
   * - **Nothing is trusted from the file but tokens.** Capabilities are
   *   re-derived here from the signed entitlement JWT, offline-verified by THIS
   *   instance — a doctored cache yields community, not the doctored state.
   *
   * A reload triggered by this instance's own `persist()` re-reads an identical
   * state; `emit()`'s `statesEqual` dedup keeps that from re-broadcasting.
   */
  async reloadFromStore(): Promise<void> {
    const cached = this.deps.store.load()
    if (cached && !isSessionExpired(cached.sessionToken, nowSeconds(this.deps.now), this.deps.sessionAudience)) {
      this.sessionToken = cached.sessionToken
      if (cached.entitlementToken) {
        const claims = await this.verifyCached(cached.entitlementToken)
        this.entitlement = claims ? { token: cached.entitlementToken, claims } : null
      } else {
        this.entitlement = null
      }
    } else {
      this.sessionToken = null
      this.entitlement = null
    }
    this.emit()
  }

  /**
   * Sign in: run the browser loopback login, persist the session immediately
   * (so a failed entitlement fetch still leaves us signed in), then fetch +
   * verify the entitlement. Broadcasts on success. Rejects if the login flow
   * itself fails (timeout / browser / exchange).
   *
   * Restartable: a sign-in while a previous attempt is still in flight CANCELS
   * the stale attempt (closes its loopback listener + invalidates its nonce) and
   * starts a fresh one. The superseded attempt resolves to the current snapshot
   * rather than throwing, so a fire-and-forget caller never sees an unhandled
   * rejection from being retried.
   */
  async signIn(): Promise<AuthState> {
    this.loginAbort?.abort()
    const abort = new AbortController()
    this.loginAbort = abort
    try {
      return await this.runSignIn(abort.signal)
    } finally {
      if (this.loginAbort === abort) this.loginAbort = null
    }
  }

  /** AbortController for the in-flight login attempt; a new signIn aborts it. */
  private loginAbort: AbortController | null = null

  private async runSignIn(signal: AbortSignal): Promise<AuthState> {
    let sessionToken: string
    try {
      sessionToken = await this.deps.login(signal)
    } catch (err) {
      // Superseded by a newer sign-in → swallow; the fresh attempt owns the
      // outcome. A genuine login failure (browser/timeout) still propagates.
      if (signal.aborted) return this.getState()
      throw err
    }
    // Won the race against a supersede the instant before we resolved → don't
    // clobber the newer attempt's session with this stale one.
    if (signal.aborted) return this.getState()
    this.sessionToken = sessionToken
    this.entitlement = null
    this.persist()
    this.emit()
    await this.refresh()
    return this.getState()
  }

  /** Sign out: forget the session + entitlement, clear the cache, broadcast. */
  signOut(): void {
    this.sessionToken = null
    this.entitlement = null
    this.deps.store.clear()
    this.emit()
  }

  /**
   * Create a Paddle checkout for the « S'abonner » upsell. Returns `null` when
   * there is no live session (the caller prompts login first); otherwise
   * `{ checkoutUrl }` where the URL may itself be `null` (the backend can omit
   * it). The session JWT is private to this service — the bearer call lives here,
   * mirroring `refresh()`; the URL is handed to the main process to open in the
   * system browser (it never reaches the renderer). Throws `CheckoutHttpError`
   * (e.g. 403 admin-only) / network errors so the IPC layer can map them.
   */
  async startCheckout(): Promise<{ checkoutUrl: string | null } | null> {
    if (!this.sessionToken || isSessionExpired(this.sessionToken, nowSeconds(this.deps.now), this.deps.sessionAudience)) {
      return null
    }
    const checkoutUrl = await createCheckout(this.deps.checkoutUrl, this.sessionToken, this.deps.fetchImpl)
    return { checkoutUrl }
  }

  /**
   * Mint a hosted Paddle customer-portal session for "manage my subscription".
   * Returns `null` when there is no live session (the caller prompts login
   * first); otherwise `{ portalUrl }` where the URL may itself be `null` (the
   * backend has no billing customer for this account → nothing to manage). The
   * session JWT stays private to this service, mirroring `startCheckout()`; the
   * URL is handed to the main process to open in the system browser (it never
   * reaches the renderer). Rethrows network / backend errors so the IPC layer
   * can map them to a generic failure.
   */
/**
   * POST `body` to a backend endpoint with the live session JWT, and return the
   * parsed JSON. `null` when there is no usable session — the caller prompts a
   * login rather than guessing why the call failed.
   *
   * Deliberately generic: this service is the only place the session token
   * lives, so anything needing an authenticated backend call has to come
   * through here rather than being handed the token. What the endpoint IS, and
   * what the body means, stay entirely the host application's business — this
   * library knows about sessions, not about any particular product's API.
   *
   * The token never leaves the main process: callers pass a URL and a body and
   * receive JSON, so no renderer path can ever obtain a credential.
   */
  async postWithSession<T>(url: string, body: unknown): Promise<T | null> {
    if (
      !this.sessionToken ||
      isSessionExpired(this.sessionToken, nowSeconds(this.deps.now), this.deps.sessionAudience)
    ) {
      return null
    }
    const res = await this.deps.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.sessionToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      // Surface the status so the caller can tell "you may not" from "it broke";
      // the body may carry a machine-readable error code, so pass it along.
      let code: string | undefined
      try {
        const parsed = (await res.json()) as { error?: unknown }
        if (typeof parsed.error === 'string') code = parsed.error
      } catch {
        // A non-JSON error body is not itself an error worth masking the status with.
      }
      throw new SessionCallError(res.status, code)
    }
    return (await res.json()) as T
  }

  async startCustomerPortal(): Promise<{ portalUrl: string | null } | null> {
    if (!this.sessionToken || isSessionExpired(this.sessionToken, nowSeconds(this.deps.now), this.deps.sessionAudience)) {
      return null
    }
    const portalUrl = await createCustomerPortalSession(this.deps.portalUrl, this.sessionToken, this.deps.fetchImpl)
    return { portalUrl }
  }

  /**
   * Re-poll the entitlement when signed in. Best-effort: a network / backend /
   * verify failure leaves the existing (cached, within-grace) entitlement in
   * place and is swallowed — offline use must not sign the user out.
   */
  async refresh(): Promise<void> {
    if (!this.sessionToken) return
    try {
      const body = await fetchEntitlement(this.deps.entitlementUrl, this.sessionToken, this.deps.fetchImpl)
      // Sliding session: the backend re-mints a fresh session JWT on every online
      // poll and returns it here, so an app left open past the 30-day session life
      // never lapses. Adopt it (before persist, so it rides the same write) only
      // when it verifies as a live session token — never downgrade to a bad one.
      if (
        body.session_token &&
        !isSessionExpired(body.session_token, nowSeconds(this.deps.now), this.deps.sessionAudience)
      ) {
        this.sessionToken = body.session_token
      }
      const verified = await this.verify(body.entitlement)
      if (verified) {
        this.entitlement = { token: body.entitlement, claims: verified }
        this.persist()
        this.emit()
      }
    } catch (err) {
      this.log('auth: entitlement refresh failed; keeping cached entitlement', {
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  // ---- dev-only test seam --------------------------------------------------

  /**
   * Inject a fixed auth snapshot without going through JWT verification.
   * ONLY called by {@link seedEntitlementForE2E} which itself is guarded by
   * `!app.isPackaged` in authComposition — dead code in packaged builds.
   * Emits immediately so renderers reflect the seeded state at first paint.
   */
  __seedEntitlementForTesting(state: AuthState): void {
    this.seededState = { ...state }
    this.emit()
  }

  // ---- internals -----------------------------------------------------------

  /** Verify a token from the wire; returns claims or null on any failure. */
  private async verify(token: string): Promise<EntitlementClaims | null> {
    if (!this.keyConfigured) {
      this.log('auth: entitlement public key not configured for this channel; treating as community')
      return null
    }
    try {
      this.importedKey ??= await importEntitlementPublicKey(this.deps.publicKeyPem)
      return await verifyEntitlementToken(token, this.importedKey, {
        ...(this.deps.now !== undefined ? { now: this.deps.now } : {}),
        audience: this.deps.entitlementAudience
      })
    } catch (err) {
      this.log('auth: entitlement verification failed', {
        message: err instanceof Error ? err.message : String(err)
      })
      return null
    }
  }

  /** Verify a CACHED token and keep it only if still within its grace window. */
  private async verifyCached(token: string): Promise<EntitlementClaims | null> {
    const verified = await this.verify(token)
    if (verified && isWithinGrace(verified, nowSeconds(this.deps.now))) return verified
    return null
  }

  private persist(): void {
    if (!this.sessionToken) {
      this.deps.store.clear()
      return
    }
    this.deps.store.save({
      sessionToken: this.sessionToken,
      entitlementToken: this.entitlement?.token ?? null
    })
  }

  private deriveState(): AuthState {
    // Dev-only seam: return the injected snapshot verbatim, bypassing JWT path.
    if (this.seededState) return { ...this.seededState }

    if (!this.sessionToken || isSessionExpired(this.sessionToken, nowSeconds(this.deps.now), this.deps.sessionAudience)) {
      return { ...SIGNED_OUT_STATE, capabilities: [] }
    }
    const session = decodeSessionInfo(this.sessionToken)
    const email = session?.email ?? this.entitlement?.claims.email ?? ''
    // `name` / `photoUrl` are display-only session claims (avatar). Set only when
    // present so `AuthUser` carries no null fields when the provider omitted them.
    const user: AuthUser = { email }
    if (session?.name) user.name = session.name
    if (session?.photoUrl) user.photoUrl = session.photoUrl

    // Role gates the account-management UI (billing/seats/members). It rides the
    // session claim; the backend re-checks the LIVE role on every privileged
    // call, so a stale claim here only affects which controls are shown, never
    // what a member can actually do. Default to `member` (least privilege).
    const role: MemberRole = session?.role === 'admin' ? 'admin' : 'member'

    let plan: PlanTier = 'community'
    let capabilities: string[] = []
    if (this.entitlement && isWithinGrace(this.entitlement.claims, nowSeconds(this.deps.now))) {
      plan = this.entitlement.claims.plan
      capabilities = [...this.entitlement.claims.capabilities]
    }
    return { signedIn: true, user, plan, role, capabilities }
  }

  /** Derive + broadcast, but only when the snapshot actually changed. */
  private emit(): void {
    const state = this.deriveState()
    if (this.lastBroadcast && statesEqual(this.lastBroadcast, state)) return
    this.lastBroadcast = state
    this.deps.broadcast(AUTH_IPC.STATE_CHANGED, state)
  }
}

/** Structural equality of two auth snapshots — used to suppress duplicate
 * broadcasts when a derive produces an unchanged state. */
function statesEqual(a: AuthState, b: AuthState): boolean {
  return a.signedIn === b.signedIn &&
    a.plan === b.plan &&
    (a.user?.email ?? null) === (b.user?.email ?? null) &&
    (a.user?.name ?? null) === (b.user?.name ?? null) &&
    (a.user?.photoUrl ?? null) === (b.user?.photoUrl ?? null) &&
    a.capabilities.length === b.capabilities.length &&
    a.capabilities.every((c, i) => c === b.capabilities[i])
}
