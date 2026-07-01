/**
 * Auth composition root — the ONE place that wires the
 * EntitlementService to real electron + node dependencies (safeStorage, the
 * filesystem, `shell.openExternal`, the BrowserWindow broadcast, and the
 * host-guarded firewall-bypassed fetch). Every other auth module lives in ECUI
 * and stays electron-free + unit-testable; this file is the thin, untested seam.
 */

import { app, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import {
  logger,
  withFirewallBypass,
  permissionService,
  EntitlementService,
  seedEntitlementForE2E,
  startEntitlementAutoRefresh,
  AuthStore,
  type AuthStoreFs,
  type SecureStoragePort,
  loopbackLogin,
  makeGuardedFetch,
  broadcastAuthState,
  registerAuthIpc,
  AvatarFirewallExemption,
  getFeatureService,
  isFeatureServiceInitialized
} from 'electron-core-ui/main'
import type { AuthState } from '../../../shared/auth/authState'
import {
  endpointUrl,
  functionsHost,
  resolveChannel,
  isBackendFunctionsUrl,
  type ReleaseChannel
} from '../../../shared/config/backend'
import { entitlementPublicKeyPem, isEntitlementPublicKeyConfigured } from '../entitlement/keys'

/** Restorm audience strings — injected into ECUI's generic service. */
const RESTORM_ENTITLEMENT_AUDIENCE = 'restorm-entitlement'
const RESTORM_SESSION_AUDIENCE = 'restorm-session'

/** Filename of the encrypted token cache under `userData`. */
const AUTH_CACHE_FILE = 'auth-session.dat'

/** Restorm-branded HTML shown in the browser tab after a successful loopback login. */
const SUCCESS_HTML =
  '<!doctype html><meta charset="utf-8"><title>Restorm</title>' +
  '<body style="font-family:system-ui;text-align:center;padding-top:3rem">' +
  '<h2>Signed in to Restorm</h2><p>You can close this tab and return to the app.</p></body>'

/** HTML shown in the browser on a failed / invalid loopback callback. */
const ERROR_HTML =
  '<!doctype html><meta charset="utf-8"><title>Restorm</title>' +
  '<body style="font-family:system-ui;text-align:center;padding-top:3rem">' +
  '<h2>Login could not be completed</h2><p>Please return to the app and try again.</p></body>'

/**
 * The `openExternal` the login loopback uses to hand the WorkOS auth URL to a
 * browser. Normally the system browser (`shell.openExternal`), which drives the
 * hosted AuthKit sign-in.
 *
 * In an UNPACKAGED end-to-end run with `RESTORM_E2E_AUTH_URL_FILE` set, it
 * instead writes the auth URL to that file (temp-write + atomic rename so a
 * polling reader never sees a partial URL) and does NOT open a browser: a
 * Playwright-driven browser context — which the test can automate, unlike the
 * system browser — reads the URL and fills the sign-in form. The loopback
 * callback capture + code→session exchange are unchanged. This is a hard NO-OP
 * in any packaged build (the `app.isPackaged` guard), the same dev-only
 * discipline as `seedEntitlementForE2E`.
 */
function makeLoginOpenExternal(): (url: string) => Promise<void> {
  const e2eUrlFile = process.env['RESTORM_E2E_AUTH_URL_FILE']
  if (!app.isPackaged && e2eUrlFile !== undefined && e2eUrlFile.length > 0) {
    logger.warn('⚠️ TEST auth-URL capture ON — login URL written to file, system browser NOT opened (RESTORM_E2E_AUTH_URL_FILE is set)')
    return (url: string): Promise<void> => {
      const tmp = `${e2eUrlFile}.tmp`
      writeFileSync(tmp, url, { mode: 0o600 })
      renameSync(tmp, e2eUrlFile)
      return Promise.resolve()
    }
  }
  return (url: string) => shell.openExternal(url)
}

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
 *
 * Also invalidates the FeatureFlippingService so any `Type: Entitlement`
 * strategy re-evaluates against the new capabilities. The service may not
 * be initialized yet on the very first boot broadcast (the entitlement service
 * fires before `setupIPC` completes on some startup races) — guarded defensively.
 */
function broadcastAuthStateWithAvatarExemption(channel: string, state: AuthState): void {
  avatarExemption.sync(state)
  broadcastAuthState(channel, state)
  // Invalidate so `useFeature` subscribers re-evaluate Entitlement strategies.
  if (isFeatureServiceInitialized()) {
    getFeatureService().invalidate()
  }
}

/**
 * The app version that drives backend-channel resolution — normally
 * `app.getVersion()`. In an UNPACKAGED e2e run the built app has no package.json
 * beside its bundled main entry, so `app.getVersion()` loses the real
 * `-preview` suffix and would resolve to the PROD backend; setting
 * `RESTORM_E2E_BACKEND_VERSION` (dev-only) pins the version — and thus the
 * channel — for the stage login e2e (pass any `-preview` version to target dev).
 * A hard NO-OP in any packaged build, the same discipline as the other e2e seams.
 */
function resolveBackendVersion(): string {
  const override = process.env['RESTORM_E2E_BACKEND_VERSION']
  if (!app.isPackaged && override !== undefined && override.length > 0) return override
  return app.getVersion()
}

/**
 * Build the EntitlementService for this launch's channel, register its IPC, and
 * kick off cache-restore + refresh. Call ONCE after `app.whenReady` (userData
 * must be resolvable). Idempotent: a second call returns the existing instance.
 */
export function initEntitlementService(version: string = resolveBackendVersion()): EntitlementService {
  if (instance) return instance

  const channel: ReleaseChannel = resolveChannel(version)
  const host = functionsHost(channel)
  // Bypass is scoped to the EXACT channel project host (never *.supabase.co),
  // and never follows a 3xx out of it (redirect: 'manual').
  const backendFetch = makeGuardedFetch({
    isEligibleUrl: (url) => isBackendFunctionsUrl(url, host),
    bypass: withFirewallBypass
  })
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
    portalUrl: endpointUrl(channel, 'customer-portal'),
    publicKeyPem: entitlementPublicKeyPem(channel),
    publicKeyConfigured: isEntitlementPublicKeyConfigured(channel),
    fetchImpl: backendFetch,
    login: (signal) => loopbackLogin({
      loginUrl: endpointUrl(channel, 'login'),
      sessionUrl: endpointUrl(channel, 'session'),
      openExternal: makeLoginOpenExternal(),
      fetchImpl: backendFetch,
      log: (msg, fields) => { logger.info(msg, fields) },
      successHtml: SUCCESS_HTML,
      errorHtml: ERROR_HTML,
      ...(signal ? { signal } : {})
    }),
    broadcast: broadcastAuthStateWithAvatarExemption,
    entitlementAudience: RESTORM_ENTITLEMENT_AUDIENCE,
    sessionAudience: RESTORM_SESSION_AUDIENCE,
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

/**
 * Create a channel-scoped, firewall-bypassed fetch for the backend Edge
 * Functions host. Used by the headless CLI path (`checkHeadlessEntitlement`)
 * which cannot go through `initEntitlementService` (requires
 * `app.whenReady` + `safeStorage`). The fetch is identical to what the
 * EntitlementService uses internally — same guarded fetch, same bypass scope.
 */
export function makeBackendFetch(version: string): typeof fetch {
  const channel = resolveChannel(version)
  const host = functionsHost(channel)
  return makeGuardedFetch({
    isEligibleUrl: (url) => isBackendFunctionsUrl(url, host),
    bypass: withFirewallBypass
  })
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
