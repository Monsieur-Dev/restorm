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
  type Capability,
  type PlanTier
} from '../../../shared/auth/authState'
import { decodeSessionInfo, isSessionExpired } from '../auth/sessionToken'
import {
  createCheckout,
  fetchEntitlement,
  importEntitlementPublicKey,
  isWithinGrace,
  needsRefresh,
  nowSeconds,
  verifyEntitlementToken,
  type EntitlementClaims
} from './entitlementClient'
import type { CryptoKey } from 'jose'

export interface EntitlementServiceDeps {
  /** Secure token persistence. */
  store: { load: () => { sessionToken: string; entitlementToken: string | null } | null; save: (d: { sessionToken: string; entitlementToken: string | null }) => void; clear: () => void }
  /** `<base>/entitlement`. */
  entitlementUrl: string
  /** `<base>/checkout` — the « S'abonner » upsell creates a Paddle transaction here. */
  checkoutUrl: string
  /** Embedded Ed25519 SPKI public key PEM for this channel. */
  publicKeyPem: string
  /** False when the channel's key is a placeholder (prod, pre-launch) → never
   * trust an entitlement (fail closed to community). Default true. */
  publicKeyConfigured?: boolean
  /** Host-guarded (firewall-bypassed) fetch for backend calls. */
  fetchImpl: typeof fetch
  /** Drive the browser loopback login → session JWT. */
  login: () => Promise<string>
  /** Push a new state to all renderers (the `auth:state-changed` broadcast). */
  broadcast: (channel: string, state: AuthState) => void
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

  constructor(private readonly deps: EntitlementServiceDeps) {
    this.log = deps.log ?? ((): void => undefined)
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
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
    if (cached && !isSessionExpired(cached.sessionToken, nowSeconds(this.deps.now))) {
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
   * Sign in: run the browser loopback login, persist the session immediately
   * (so a failed entitlement fetch still leaves us signed in), then fetch +
   * verify the entitlement. Broadcasts on success. Rejects if the login flow
   * itself fails (timeout / browser / exchange).
   */
  async signIn(): Promise<AuthState> {
    // Coalesce concurrent sign-in requests (e.g. a double-click on the account
    // menu) so we never open two loopback listeners / browser tabs at once.
    this.loginInFlight ??= this.runSignIn().finally(() => { this.loginInFlight = null })
    return this.loginInFlight
  }

  private loginInFlight: Promise<AuthState> | null = null

  private async runSignIn(): Promise<AuthState> {
    const sessionToken = await this.deps.login()
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
    if (!this.sessionToken || isSessionExpired(this.sessionToken, nowSeconds(this.deps.now))) {
      return null
    }
    const checkoutUrl = await createCheckout(this.deps.checkoutUrl, this.sessionToken, this.deps.fetchImpl)
    return { checkoutUrl }
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

  // ---- internals -----------------------------------------------------------

  /** Verify a token from the wire; returns claims or null on any failure. */
  private async verify(token: string): Promise<EntitlementClaims | null> {
    if (!this.keyConfigured) {
      this.log('auth: entitlement public key not configured for this channel; treating as community')
      return null
    }
    try {
      this.importedKey ??= await importEntitlementPublicKey(this.deps.publicKeyPem)
      return await verifyEntitlementToken(token, this.importedKey, { now: this.deps.now })
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
    if (!this.sessionToken || isSessionExpired(this.sessionToken, nowSeconds(this.deps.now))) {
      return { ...SIGNED_OUT_STATE, capabilities: [] }
    }
    const session = decodeSessionInfo(this.sessionToken)
    const email = session?.email ?? this.entitlement?.claims.email ?? ''
    const user: AuthUser = { email }

    let plan: PlanTier = 'community'
    let capabilities: Capability[] = []
    if (this.entitlement && isWithinGrace(this.entitlement.claims, nowSeconds(this.deps.now))) {
      plan = this.entitlement.claims.plan
      capabilities = [...this.entitlement.claims.capabilities]
    }
    return { signedIn: true, user, plan, capabilities }
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
    a.capabilities.length === b.capabilities.length &&
    a.capabilities.every((c, i) => c === b.capabilities[i])
}
