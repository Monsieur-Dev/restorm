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
import { logger, withFirewallBypass } from 'electron-core-ui'
import { endpointUrl, functionsHost, resolveChannel, type ReleaseChannel } from '../../../shared/config/backend'
import { entitlementPublicKeyPem, isEntitlementPublicKeyConfigured } from '../entitlement/keys'
import { EntitlementService } from '../entitlement/EntitlementService'
import { AuthStore, type AuthStoreFs, type SecureStoragePort } from './authStore'
import { loopbackLogin } from './loopbackLogin'
import { makeGuardedFetch } from './guardedFetch'
import { broadcastAuthState, registerAuthIpc } from './authIpc'

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
    publicKeyPem: entitlementPublicKeyPem(channel),
    publicKeyConfigured: isEntitlementPublicKeyConfigured(channel),
    fetchImpl: backendFetch,
    login: () => loopbackLogin({
      loginUrl: endpointUrl(channel, 'login'),
      sessionUrl: endpointUrl(channel, 'session'),
      openExternal: (url) => shell.openExternal(url),
      fetchImpl: backendFetch,
      log: (msg, fields) => { logger.info(msg, fields) }
    }),
    broadcast: broadcastAuthState,
    log: (msg, fields) => { logger.warn(msg, fields) }
  })

  registerAuthIpc(instance)

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

/** Test-only reset. */
export function resetEntitlementServiceForTests(): void {
  instance = null
}
