/**
 * Deep-link scheme registration and OAuth callback dispatch for packaged builds.
 *
 * Transport split for the OAuth login:
 *   - dev/unpackaged: loopback (http://127.0.0.1:<port>/callback) — a transient
 *     local HTTP listener. Firewall-friendly, zero OS registration.
 *   - packaged: deep-link (<scheme>://auth/callback) — registered with the OS
 *     so the system browser can hand the callback directly back to the running
 *     app, without an open port and without depending on loopback being reachable.
 *
 * Usage in index.ts:
 *   1. Call `registerDeepLinkSchemes(app, app.getVersion())` before app.whenReady().
 *   2. Wire `handleDeepLinkUrl` to `app.on('open-url')` (macOS) and to
 *      `app.on('second-instance')` after extracting the URL from argv (Win/Lin).
 *
 * Usage in authComposition.ts:
 *   - When `app.isPackaged`, use `deepLinkLogin` as the `login` dep instead of
 *     `loopbackLogin`. The scheme is 'restorm' for release builds and
 *     'restorm-preview' for preview builds.
 */

import type { App } from 'electron'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch as fsWatch, writeFileSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { logger, generateLoopbackNonce, buildLoginUrl, LoopbackLoginCancelledError } from 'electron-core-ui/main'

// ── URL-scheme constants ────────────────────────────────────────────────────

/** URL prefixes that belong to this app's registered custom schemes. */
export const DEEP_LINK_PREFIXES = ['restorm://', 'restorm-preview://'] as const

/** Returns true when `url` is a deep-link callback URL for this app. */
export function isDeepLinkUrl(url: string): boolean {
  return DEEP_LINK_PREFIXES.some((p) => url.startsWith(p))
}

// ── scheme registration ─────────────────────────────────────────────────────

/**
 * Register restorm:// (and, for preview builds, restorm-preview://) as the
 * OS default protocol client. On Windows/Linux, the '--' argv terminator is
 * included so Chromium does not try to interpret the deep-link URL as a
 * command-line flag. macOS routes through NSAppleEventManager and does not
 * need the terminator.
 *
 * Call BEFORE app.whenReady().
 */
export function registerDeepLinkSchemes(app: App, appVersion: string): void {
  const isPreview = appVersion.includes('-preview')

  // On Windows/Linux, pass the argv terminator so the OS-launched child process
  // receives the deep-link URL as a plain argument, not as a Chromium flag.
  const extraArgs = process.platform !== 'darwin' ? ['--'] : undefined

  function doRegister(scheme: string): void {
    if (extraArgs !== undefined) {
      app.setAsDefaultProtocolClient(scheme, process.execPath, extraArgs)
    } else {
      app.setAsDefaultProtocolClient(scheme)
    }
  }

  doRegister('restorm')
  if (isPreview) {
    doRegister('restorm-preview')
  }
}

// ── pending OAuth callback (one in-flight deep-link login at a time) ────────

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

interface PendingCallback {
  nonce: string
  resolve: (code: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let pendingCallback: PendingCallback | null = null

/** Opaque read of the pending slot — defeats stale control-flow narrowing at
 * call sites where an intervening call may have consumed it. */
function currentPendingCallback(): PendingCallback | null {
  return pendingCallback
}

// ── cross-instance callback relay ───────────────────────────────────────────
//
// The OS delivers a deep-link callback to ONE process: the single-instance
// lock holder on Windows/Linux, whichever instance the system picks on macOS.
// The login it answers may be pending in a DIFFERENT instance (all real
// instances share userData, so several can run at once). The relay closes that
// gap with a file inbox under userData:
//
//   - the receiving instance, when the callback's `state` matches no login of
//     its own, WRITES it to `<inbox>/cb-<state>.json` (0600, atomic rename);
//   - every instance watches the inbox; the one whose pending nonce equals
//     `<state>` CLAIMS the file by renaming it to a private name — rename is
//     atomic, so exactly one claimant wins even if two instances raced — then
//     completes its session exchange and deletes the file.
//
// The nonce doubles as the address: only the instance that generated it will
// ever look for that filename, so there is no broadcast and no contention in
// the common case. Files older than the login timeout are swept — a callback
// nobody claimed within 10 minutes answers a login that no longer exists.
//
// A file inbox rather than the MCP mesh, deliberately: MCP can be disabled by
// the user or absent on a headless host, and login must not depend on it. The
// one-time code briefly rests on disk in 0600 — the same directory already
// holds the (encrypted) session cache, the code is single-use, short-lived,
// and consumed by the claim.

const INBOX_PREFIX = 'cb-'
const INBOX_TTL_MS = DEFAULT_TIMEOUT_MS

let inboxDir: string | null = null
let inboxWatcher: Pick<FSWatcher, 'close'> | null = null

/** Nonces are URL-safe (A–Z a–z 0–9 - _); anything else has no business being a
 * filename component. */
function isSafeStateToken(state: string): boolean {
  return /^[A-Za-z0-9_-]{8,256}$/.test(state)
}

function inboxFileFor(state: string): string {
  if (inboxDir === null) throw new Error('deep-link relay not initialized')
  return join(inboxDir, `${INBOX_PREFIX}${state}.json`)
}

/** Drop relayed callbacks past the login timeout — nobody will ever claim them. */
function sweepInbox(): void {
  if (inboxDir === null) return
  let entries: string[]
  try {
    entries = readdirSync(inboxDir)
  } catch {
    return
  }
  const cutoff = Date.now() - INBOX_TTL_MS
  for (const name of entries) {
    if (!name.startsWith(INBOX_PREFIX)) continue
    const full = join(inboxDir, name)
    try {
      if (statSync(full).mtimeMs < cutoff) rmSync(full, { force: true })
    } catch {
      /* claimed or already gone — exactly what we want */
    }
  }
}

/** Publish a callback that answers ANOTHER instance's login. */
function relayForeignCallback(code: string, state: string): void {
  if (inboxDir === null) {
    logger.warn('auth: deep-link callback matches no local login and the relay is not initialized — dropped')
    return
  }
  if (!isSafeStateToken(state) || code.length === 0 || code.length > 4096) {
    logger.warn('auth: deep-link callback rejected by the relay (malformed state or code)')
    return
  }
  try {
    const target = inboxFileFor(state)
    const tmp = `${target}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify({ code }), { mode: 0o600 })
    renameSync(tmp, target)
    logger.info('auth: deep-link callback relayed to the instance that owns the login')
  } catch (err) {
    logger.warn('auth: failed to relay deep-link callback', {
      message: err instanceof Error ? err.message : String(err)
    })
  }
  sweepInbox()
}

/**
 * If a relayed callback addressed to THIS instance's pending login is sitting
 * in the inbox, claim and consume it. The rename is the mutual exclusion: of
 * every instance that might try, exactly one rename succeeds.
 */
function tryClaimRelayedCallback(): void {
  if (inboxDir === null || pendingCallback === null) return
  const { nonce } = pendingCallback
  if (!isSafeStateToken(nonce)) return
  const source = inboxFileFor(nonce)
  const claimed = `${source}.claimed-${process.pid}`
  try {
    renameSync(source, claimed)
  } catch {
    return // absent, or another claimant won — nothing addressed to us
  }
  let code = ''
  try {
    const parsed = JSON.parse(readFileSync(claimed, 'utf8')) as { code?: unknown }
    if (typeof parsed.code === 'string') code = parsed.code
  } catch {
    /* fall through to the guard below */
  } finally {
    rmSync(claimed, { force: true })
  }
  completePendingCallback(code, nonce)
}

/**
 * Start the cross-instance relay: create the inbox (0700) and watch it so a
 * callback relayed by another instance is claimed the moment it lands. Call
 * once after `userData` is resolvable. Safe to call in dev (the loopback
 * transport simply never produces deep-link callbacks).
 */
export function initDeepLinkRelay(userDataDir: string): void {
  inboxDir = join(userDataDir, 'auth-callbacks')
  try {
    mkdirSync(inboxDir, { recursive: true, mode: 0o700 })
    sweepInbox()
    inboxWatcher = fsWatch(inboxDir, () => { tryClaimRelayedCallback() })
  } catch (err) {
    // Degraded: same-instance login still works; only the multi-instance
    // relay is lost. Never let auth setup break startup.
    logger.warn('auth: deep-link relay unavailable', {
      message: err instanceof Error ? err.message : String(err)
    })
    inboxWatcher = null
  }
}

/** Stop watching the relay inbox. Call on app quit. Idempotent. */
export function stopDeepLinkRelay(): void {
  try {
    inboxWatcher?.close()
  } catch {
    /* already closed */
  }
  inboxWatcher = null
  inboxDir = null
}

/** Complete (or reject) the pending login with an addressed callback. The
 * caller has already established `state === pendingCallback.nonce`. */
function completePendingCallback(code: string, state: string): void {
  if (pendingCallback?.nonce !== state) return
  const { resolve, reject, timer } = pendingCallback
  pendingCallback = null
  clearTimeout(timer)
  if (code.length === 0 || code.length > 4096) {
    reject(new Error('auth: deep-link callback missing or oversized code'))
    return
  }
  resolve(code)
}

/**
 * Dispatch an incoming AUTH deep-link URL.
 * Expected structure: `<scheme>://auth/callback?code=<code>&state=<nonce>`
 *
 * The echoed `state` is the address: when it matches this instance's pending
 * login nonce, the exchange completes here (the CSRF property — a callback
 * whose state matches nothing this instance generated can never complete ITS
 * login). When it doesn't, the callback belongs to a login pending in another
 * instance sharing this userData, so it is relayed through the inbox for that
 * instance to claim. A malformed URL is logged and dropped — it must not kill
 * a pending login that may still receive its real callback.
 */
export function handleDeepLinkUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    logger.warn('auth: deep-link callback has a malformed URL — ignored')
    return
  }

  const code = parsed.searchParams.get('code') ?? ''
  const state = parsed.searchParams.get('state') ?? ''
  if (state.length === 0) {
    logger.warn('auth: deep-link callback carries no state — ignored')
    return
  }

  if (pendingCallback?.nonce === state) {
    completePendingCallback(code, state)
    return
  }

  // Not ours: either no login is in-flight here, or ours has a different
  // nonce. Both mean the same thing — the owner is (possibly) another
  // instance. Relay, and keep any local pending untouched.
  relayForeignCallback(code, state)
}

// ── top-level URL router ────────────────────────────────────────────────────

/**
 * Route a deep-link URL by its host. Auth callbacks (`<scheme>://auth/…`) go
 * to the OAuth handler; every other form is acknowledged and dropped here so
 * the auth path can never capture them — the `restorm://open?...` family gets
 * its own routing when it lands, and grows from this switch.
 */
export function routeDeepLinkUrl(url: string): void {
  let host: string
  try {
    host = new URL(url).host
  } catch {
    logger.warn('deep-link: malformed URL — ignored')
    return
  }
  if (host === 'auth') {
    handleDeepLinkUrl(url)
    return
  }
  logger.info('deep-link: no route registered for this URL form — ignored', { host })
}

// ── deepLinkLogin ───────────────────────────────────────────────────────────

export interface DeepLinkLoginDeps {
  /** `<base>/login` — receives return_to + nonce as query params. */
  loginUrl: string
  /** `<base>/session` — the one-time code is POST-ed here for the session JWT. */
  sessionUrl: string
  /**
   * The registered custom scheme for this build. Release builds use 'restorm';
   * preview builds use 'restorm-preview'. The return_to sent to the backend is
   * `<scheme>://auth/callback`, which the OS routes back to the running app.
   */
  scheme: 'restorm' | 'restorm-preview'
  /** Open the system browser (e.g. `shell.openExternal`). */
  openExternal: (url: string) => Promise<void>
  /** Host-guarded (firewall-bypassed) fetch for the session exchange. */
  fetchImpl: typeof fetch
  /** Random URL-safe nonce; injectable for deterministic tests. */
  generateNonce?: () => string
  /** Round-trip timeout (ms). Defaults to 10 min — matches the backend signed-state TTL. */
  timeoutMs?: number
  /** Structured logger (never receives the one-time code or the session token). */
  log?: (msg: string, fields?: Record<string, unknown>) => void
  /**
   * Cancels an in-flight attempt (the « Se connecter » restartable retry). Rejects
   * with `LoopbackLoginCancelledError` so the caller can treat a supersede as a
   * non-error (same semantics as the loopback transport).
   */
  signal?: AbortSignal
}

/**
 * Run the full deep-link OAuth login for packaged builds.
 *
 * Opens the system browser to the login URL with `return_to` set to the app's
 * registered custom scheme. Resolves with the session JWT once the OS routes
 * the callback URL back to the app and `handleDeepLinkUrl` dispatches it.
 *
 * Only one deep-link login can be in-flight at a time. A new call supersedes
 * any prior attempt, matching the loopback transport's restartable behaviour.
 */
export async function deepLinkLogin(deps: DeepLinkLoginDeps): Promise<string> {
  const nonce = (deps.generateNonce ?? generateLoopbackNonce)()
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const log = deps.log ?? ((): void => undefined)

  const returnTo = `${deps.scheme}://auth/callback`
  const loginFullUrl = buildLoginUrl(deps.loginUrl, returnTo, nonce)

  const code = await new Promise<string>((resolve, reject) => {
    const signal = deps.signal

    // Already cancelled before we started.
    if (signal?.aborted) {
      reject(new LoopbackLoginCancelledError())
      return
    }

    // Supersede any prior in-flight attempt (user clicked « Se connecter » again
    // or a previous attempt timed out without being cleaned up).
    if (pendingCallback) {
      const prev = pendingCallback
      pendingCallback = null
      clearTimeout(prev.timer)
      prev.reject(new LoopbackLoginCancelledError())
    }

    let onAbort: (() => void) | null = null

    const timer = setTimeout(() => {
      if (pendingCallback?.nonce === nonce) {
        pendingCallback = null
        if (onAbort && signal) signal.removeEventListener('abort', onAbort)
        reject(new Error('auth: deep-link login timed out'))
      }
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    pendingCallback = { nonce, resolve, reject, timer }

    // The callback may ALREADY be sitting in the relay inbox: the OS can
    // deliver it to another instance (and that instance relay it) in the gap
    // between our nonce existing and this registration. Claim it now rather
    // than waiting for a watcher event that already fired.
    tryClaimRelayedCallback()

    if (signal) {
      onAbort = (): void => {
        if (pendingCallback?.nonce === nonce) {
          pendingCallback = null
          clearTimeout(timer)
          reject(new LoopbackLoginCancelledError())
        }
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    // The eager claim above may have completed the login already (a relayed
    // callback was waiting for us) — in that case there is no browser to open.
    // Read through an accessor: the claim mutates module state behind the
    // control-flow analysis, which otherwise still believes the registration
    // assignment above.
    if (currentPendingCallback()?.nonce !== nonce) return

    log('auth: opening system browser for deep-link login', {
      scheme: deps.scheme,
      returnTo
    })
    deps.openExternal(loginFullUrl).catch((err: unknown) => {
      if (pendingCallback?.nonce === nonce) {
        pendingCallback = null
        clearTimeout(timer)
        if (onAbort && signal) signal.removeEventListener('abort', onAbort)
        reject(err instanceof Error ? err : new Error('auth: failed to open browser'))
      }
    })
  })

  // Exchange the one-time code for the session JWT. The code is single-use and
  // never logged; the session token is returned from this function only, never
  // stored here.
  const res = await deps.fetchImpl(deps.sessionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code })
  })
  if (!res.ok) {
    throw new Error(`auth: session exchange failed with status ${String(res.status)}`)
  }
  const body = (await res.json()) as { access_token?: unknown }
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new Error('auth: session exchange response missing access_token')
  }
  return body.access_token
}

/** Reset module-level state. For tests only — do NOT call in production code. */
export function resetDeepLinkStateForTests(): void {
  if (pendingCallback) {
    clearTimeout(pendingCallback.timer)
    pendingCallback = null
  }
  stopDeepLinkRelay()
}
