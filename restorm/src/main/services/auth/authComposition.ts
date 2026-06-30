/**
 * Auth composition root — the ONE place that wires the
 * EntitlementService to real electron + node dependencies (safeStorage, the
 * filesystem, `shell.openExternal`, the BrowserWindow broadcast, and the
 * host-guarded firewall-bypassed fetch). Every other auth module stays
 * electron-free + unit-testable; this file is the thin, untested seam.
 */

import { app, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { logger, withFirewallBypass, permissionService } from 'electron-core-ui'
import type { AuthState } from '../../../shared/auth/authState'
import { endpointUrl, functionsHost, resolveChannel, type ReleaseChannel } from '../../../shared/config/backend'
import { entitlementPublicKeyPem, isEntitlementPublicKeyConfigured } from '../entitlement/keys'
import { EntitlementService, seedEntitlementForE2E } from '../entitlement/EntitlementService'
import { startEntitlementAutoRefresh } from '../entitlement/autoRefresh'
import { AuthStore, type AuthStoreFs, type SecureStoragePort } from './authStore'
import { loopbackLogin } from './loopbackLogin'
import { makeGuardedFetch } from './guardedFetch'
import { broadcastAuthState, registerAuthIpc } from './authIpc'
import { AvatarFirewallExemption } from './avatarFirewallExemption'

/** Filename of the encrypted token cache under `userData`. */
const AUTH_CACHE_FILE = 'auth-session.dat'

function makeStoragePort(): SecureStoragePort {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plainText) => safeStorage.encryptString(plainText),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted)
  }
}

function makeFsPort(): AuthStoreFs {
  return {
    read: (filePath) => {
      try {
        return readFileSync(filePath)
      } catch {
        return null
      }
    },
    // 0600: readable only by the owning user — defence in depth for the plaintext
    // fallback path (no keyring), and harmless on the encrypted path.
    write: (filePath, data) => { writeFileSync(filePath, data, { mode: 0o600 }) },
    remove: (filePath) => {
      try {
        rmSync(filePath, { force: true })
      } catch {
        /* best-effort */
      }
    }
  }
}

let instance: EntitlementService | null = null
/** Tears down the focus + interval auto-refresh triggers; set once the service is
 * built, called on app quit. */
let stopAutoRefresh: (() => void) | null = null

/** Keeps the firewall's system allowlist in lock-step with the signed-in user's
 * avatar host (register on login, swap on profile change, drop on logout). */
const avatarExemption = new AvatarFirewallExemption(permissionService)

/**
 * Broadcast the auth state to renderers, reconciling the avatar-host firewall
 * exemption FIRST. The avatar `<img src={photoUrl}>` is a display/system asset,
 * not user API traffic — without the exemption the renderer's fetch to the
 * provider CDN (Google/MS/GitHub…) is blocked by the USER firewall (which only
 * exempts the backend functions host) and the photo never loads
 * (ERR_BLOCKED_BY_CLIENT). Syncing before the broadcast means the host is
 * allowed by the time the renderer mounts the avatar; it is dropped on logout /
 * a photo-less profile.
 */
function broadcastAuthStateWithAvatarExemption(channel: string, state: AuthState): void {
  avatarExemption.sync(state)
  broadcastAuthState(channel, state)
}

/**
 * Build the EntitlementService for this launch's channel, register its IPC, and
 * kick off cache-restore + refresh. Call ONCE after `app.whenReady` (userData
 * must be resolvable). Idempotent: a second call returns the existing instance.
 */
export function initEntitlementService(version: string = app.getVersion()): EntitlementService {
  if (instance) return instance

  const channel: ReleaseChannel = resolveChannel(version)
  // Bypass is scoped to the EXACT channel project host (never *.supabase.co),
  // and never follows a 3xx out of it (redirect: 'manual').
  const backendFetch = makeGuardedFetch({ allowedHost: functionsHost(channel), bypass: withFirewallBypass })
  const store = new AuthStore(
    join(app.getPath('userData'), AUTH_CACHE_FILE),
    makeStoragePort(),
    makeFsPort(),
    (msg, fields) => { logger.warn(msg, fields) }
  )

  instance = new EntitlementService({
    store,
    entitlementUrl: endpointUrl(channel, 'entitlement'),
    checkoutUrl: endpointUrl(channel, 'checkout'),
    publicKeyPem: entitlementPublicKeyPem(channel),
    publicKeyConfigured: isEntitlementPublicKeyConfigured(channel),
    fetchImpl: backendFetch,
    login: (signal) => loopbackLogin({
      loginUrl: endpointUrl(channel, 'login'),
      sessionUrl: endpointUrl(channel, 'session'),
      openExternal: (url) => shell.openExternal(url),
      fetchImpl: backendFetch,
      log: (msg, fields) => { logger.info(msg, fields) },
      ...(signal ? { signal } : {})
    }),
    broadcast: broadcastAuthStateWithAvatarExemption,
    log: (msg, fields) => { logger.warn(msg, fields) }
  })

  registerAuthIpc(instance, (url) => shell.openExternal(url))

  // Dev-only e2e seam: seed a Pro entitlement when RESTORM_E2E_ENTITLEMENT_PLAN=pro.
  // The guard inside seedEntitlementForE2E also checks isPackaged, but we pass
  // app.isPackaged explicitly so the call is a hard NO-OP in any packaged build.
  if (seedEntitlementForE2E(instance, app.isPackaged, process.env['RESTORM_E2E_ENTITLEMENT_PLAN'])) {
    logger.warn('⚠️ TEST entitlement seeded (plan=pro, mcp.pro cap) — dev-only, RESTORM_E2E_ENTITLEMENT_PLAN is set')
  }

  // Auto-refresh the entitlement on window focus (the « S'abonner » checkout
  // returns into the app via the system browser — focus is the moment we learn
  // the user is back) and on a periodic poll, so a subscription upgrade reflects
  // without a re-login. `refresh()` no-ops when signed out and fails soft when
  // offline, so these ambient triggers are always safe.
  const service = instance
  stopAutoRefresh = startEntitlementAutoRefresh({
    refresh: () => { void service.refresh() },
    onFocus: (handler) => {
      app.on('browser-window-focus', handler)
      return () => { app.off('browser-window-focus', handler) }
    }
  })

  // Restore a cached session + entitlement and refresh in the background; never
  // let a restore failure crash startup.
  void instance.init().catch((err: unknown) => {
    logger.warn('auth: entitlement service init failed', {
      message: err instanceof Error ? err.message : String(err)
    })
  })

  logger.info('EntitlementService initialized', { channel })
  return instance
}

/** The initialized service, or throw if `initEntitlementService` hasn't run. */
export function getEntitlementService(): EntitlementService {
  if (!instance) {
    throw new Error('EntitlementService not initialized. Call initEntitlementService() first.')
  }
  return instance
}

/** Stop the entitlement auto-refresh triggers (timer + focus listener). Call on
 * app quit so neither outlives the process. Idempotent. */
export function stopEntitlementAutoRefresh(): void {
  stopAutoRefresh?.()
  stopAutoRefresh = null
}

/** Test-only reset. */
export function resetEntitlementServiceForTests(): void {
  stopEntitlementAutoRefresh()
  avatarExemption.clear()
  instance = null
}
