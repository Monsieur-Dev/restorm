/**
 * Avatar firewall exemption — keeps the firewall's system allowlist in lock-step
 * with the signed-in user's avatar photo host.
 *
 * The avatar `<img src={photoUrl}>` is a display/system asset, not user API
 * traffic, but the renderer's fetch to the provider CDN (Google/MS/GitHub…) is
 * governed by the USER firewall — which only exempts the backend functions host
 * — so the photo is blocked (`net::ERR_BLOCKED_BY_CLIENT`). We exempt the
 * photoUrl host via the firewall's system allowlist (scoped, non-user-deletable)
 * for the duration of the session: registered on login, swapped on a profile
 * change, dropped on logout. Only ONE host is exempt at a time (the current
 * user's), so a stale host never lingers allow-listed after sign-out.
 *
 * Kept electron-free + injectable (the allowlist port is the ECUI
 * `permissionService`) so the swap/drop behaviour is unit-testable with a fake.
 */

import type { AuthState } from '../../../shared/auth/authState'
import type { SystemEndpointDeclaration } from '../../../types/firewall'

/** The slice of the firewall PermissionService this needs — register / drop a
 * system-exempted host, and (optionally) declare it so it appears in the
 * outbound inventory. Mirrors `permissionService`'s methods; the declaration
 * half is optional so a test fake can implement the allowlist alone. */
export interface SystemHostAllowlist {
  addSystemAllowedHost(host: string): void
  removeSystemAllowedHost(host: string): void
  declareSystemEndpoint?(declaration: SystemEndpointDeclaration): void
}

/** Declaration id + purpose key under which the avatar CDN exemption is
 * declared. Stable across logins — the host changes, the entry doesn't. */
const AVATAR_ENDPOINT_ID = 'avatar'
const AVATAR_PURPOSE_KEY = 'firewall.outbound.purpose.avatar'

/** The host of the signed-in user's avatar photo, or `null` when absent /
 * unparsable (signed out, no photo, or a malformed URL → initials fallback). */
export function avatarHostOf(state: AuthState): string | null {
  const url = state.user?.photoUrl
  if (typeof url !== 'string' || url === '') return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Tracks the single avatar host currently exempted in the firewall, swapping it
 * on a profile change and dropping it on logout / a photo-less profile.
 */
export class AvatarFirewallExemption {
  /** The host currently exempted, or `null` when none is. */
  private current: string | null = null

  constructor(private readonly allowlist: SystemHostAllowlist) {
    // Declare up-front, host-less: signed out is the common boot state and
    // `sync(SIGNED_OUT_STATE)` is a no-op transition, so waiting for the first
    // change would leave the row missing exactly when the user is most likely
    // to go looking for it.
    this.declare(null)
  }

  /**
   * Reconcile the firewall exemption to `state`: register the new avatar host
   * (and drop the previous one) when it changes, drop it entirely when the state
   * carries no photo (logout / no-photo profile). Returns the now-exempted host
   * (or `null`). Idempotent — re-syncing the same state is a no-op.
   */
  sync(state: AuthState): string | null {
    const host = avatarHostOf(state)
    if (host !== this.current) {
      if (this.current !== null) this.allowlist.removeSystemAllowedHost(this.current)
      if (host !== null) this.allowlist.addSystemAllowedHost(host)
      this.current = host
      this.declare(host)
    }
    return host
  }

  /** Drop any active exemption (app teardown / test reset). Idempotent. */
  clear(): void {
    if (this.current !== null) {
      this.allowlist.removeSystemAllowedHost(this.current)
      this.current = null
      this.declare(null)
    }
  }

  /**
   * Mirror the exemption into the firewall's outbound inventory. The entry is
   * declared even when signed out (`host: null`, reported inactive) so an audit
   * shows that the app WOULD reach an avatar CDN once the user logs in, rather
   * than surfacing it only after the fact.
   */
  private declare(host: string | null): void {
    this.allowlist.declareSystemEndpoint?.({
      id: AVATAR_ENDPOINT_ID,
      host,
      purposeKey: AVATAR_PURPOSE_KEY,
      consentGate: null,
      exemption: 'system-allowlist'
    })
  }
}
