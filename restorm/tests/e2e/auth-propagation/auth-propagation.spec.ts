import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { launchRestormElectronApp, writeAppLogs } from '../helpers/launch-restorm'

/**
 * Cross-instance LIVE auth propagation — two real app instances sharing one
 * userData, no backend involved.
 *
 * The propagation chain under test: instance-side `fs.watch` on the shared
 * `auth-session.dat` → debounce → `EntitlementService.reloadFromStore()` →
 * `auth:state-changed` broadcast → the titlebar account button re-renders.
 * The test plays the role of "the other instance" by writing the cache file
 * exactly the way the app does (plaintext envelope, temp-write + atomic
 * rename) and then deleting it (logout). BOTH running instances must follow,
 * live, with no restart.
 *
 * Deliberately backend-free: `isSessionExpired` only decodes the session JWT
 * (expiry + audience — the signature belongs to the backend that consumes the
 * token), so a fabricated HS256-shaped token is enough to drive the
 * signed-in/signed-out transitions. The plan stays `community` throughout —
 * capabilities require the SIGNED entitlement JWT, which cannot be fabricated;
 * that trust-model guard has its own unit tests. What only this test proves is
 * the file-watch plumbing across real processes.
 */

const AVATAR = '[data-testid="titlebar-account-avatar"]'

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** An HS256-shaped session token that decodes to a live restorm session. The
 * signature is garbage on purpose — client-side session checks are decode-only. */
function fabricateSessionToken(email: string): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const payload = b64url({
    aud: 'restorm-session',
    email,
    exp: Math.floor(Date.now() / 1000) + 3600
  })
  return `${header}.${payload}.e2e-not-a-real-signature`
}

/** Write the cache the way the app does: plaintext envelope, atomic rename. */
function writeAuthCache(userDataDir: string, sessionToken: string): void {
  const envelope = JSON.stringify({
    v: 1,
    enc: false,
    data: JSON.stringify({ sessionToken, entitlementToken: null })
  })
  const target = join(userDataDir, 'auth-session.dat')
  const tmp = `${target}.tmp-e2e`
  writeFileSync(tmp, envelope, { mode: 0o600 })
  renameSync(tmp, target)
}

test('a login and a logout written to the shared cache propagate live to both running instances', async ({}, testInfo) => {
  const restormRoot = process.cwd()
  const sharedUserData = join(restormRoot, 'tests/e2e/.tmp/userdata', `shared-${randomUUID()}`)
  mkdirSync(sharedUserData, { recursive: true })

  // Two REAL instances on the SAME userData. The second one loses the
  // single-instance lock and (by design) keeps running without it — the same
  // shape as the MCP `create_instance` flow.
  const appA = await launchRestormElectronApp({
    restormRoot,
    extraEnv: { RESTORM_USER_DATA_OVERRIDE: sharedUserData }
  })
  const appB = await launchRestormElectronApp({
    restormRoot,
    extraEnv: { RESTORM_USER_DATA_OVERRIDE: sharedUserData }
  })

  try {
    const pageA: Page = await appA.firstWindow()
    const pageB: Page = await appB.firstWindow()
    await expect(pageA.locator('[data-testid="titlebar-account-button"]')).toBeVisible({ timeout: 30000 })
    await expect(pageB.locator('[data-testid="titlebar-account-button"]')).toBeVisible({ timeout: 30000 })

    // Both start signed out: no avatar in the titlebar.
    await expect(pageA.locator(AVATAR)).toHaveCount(0)
    await expect(pageB.locator(AVATAR)).toHaveCount(0)

    // "Another instance" logs in: the cache lands on disk.
    writeAuthCache(sharedUserData, fabricateSessionToken('propagation@e2e.local'))

    // Both running instances must adopt it LIVE — watch → debounce → reload →
    // broadcast. Generous timeout: two Electron apps under xvfb on a loaded
    // host, but the mechanism itself settles in well under a second.
    await expect(pageA.locator(AVATAR)).toBeVisible({ timeout: 10000 })
    await expect(pageB.locator(AVATAR)).toBeVisible({ timeout: 10000 })

    // "Another instance" logs out: the cache disappears.
    rmSync(join(sharedUserData, 'auth-session.dat'), { force: true })

    await expect(pageA.locator(AVATAR)).toHaveCount(0, { timeout: 10000 })
    await expect(pageB.locator(AVATAR)).toHaveCount(0, { timeout: 10000 })
  } finally {
    writeAppLogs(appA, testInfo.outputDir)
    writeAppLogs(appB, testInfo.outputDir)
    await appA.close().catch(() => undefined)
    await appB.close().catch(() => undefined)
    rmSync(sharedUserData, { recursive: true, force: true })
  }
})
