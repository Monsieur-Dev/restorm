/**
 * Loopback login transport — the RFC 8252 native-app flow.
 *
 * 1. spin up a TRANSIENT http listener bound to the 127.0.0.1 literal on an
 *    ephemeral port;
 * 2. open the SYSTEM browser (outside the app firewall, via `shell.openExternal`)
 *    to `<base>/login?return_to=http://127.0.0.1:<port>/callback&nonce=<nonce>`;
 * 3. the backend round-trips through WorkOS and 302s the browser back to our
 *    loopback callback with `?code=<oneTime>&state=<nonce>`;
 * 4. we ASSERT the echoed `state` equals the nonce we generated (callback-binding
 *    / CSRF guard — a request that doesn't carry our nonce is refused and ignored),
 *    take the one-time code, and immediately tear the listener down (single-use);
 * 5. POST the one-time code to `<base>/session` over HTTPS (firewall-bypassed,
 *    host-guarded by the caller) and receive the session JWT in the JSON body —
 *    the long-lived token never rides a URL or browser history.
 *
 * Hardening: bound to 127.0.0.1 only (never 0.0.0.0/::), a high-entropy nonce,
 * a hard timeout so a never-completed login can't leak an open port, GET-only,
 * exact `/callback` path, and the one-time code / session token are never logged.
 *
 * The orchestrator takes injected `openExternal` + `fetchImpl` + clock so it
 * references no electron symbol directly and is testable end-to-end (a test
 * stubs `openExternal` to play the backend against the real loopback server).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'

/** Default ceiling for the whole browser round-trip (incl. the user typing creds).
 * Matches the backend's signed-state TTL (10 min). */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

export interface LoopbackLoginDeps {
  /** `<base>/login`. */
  loginUrl: string
  /** `<base>/session`. */
  sessionUrl: string
  /** Open the system browser (e.g. `shell.openExternal`). */
  openExternal: (url: string) => Promise<void>
  /** Host-guarded (firewall-bypassed) fetch for the session exchange. */
  fetchImpl: typeof fetch
  /** Random URL-safe nonce; injectable for deterministic tests. */
  generateNonce?: () => string
  /** Round-trip timeout (ms). */
  timeoutMs?: number
  /** Structured logger (never receives the code / token). */
  log?: (msg: string, fields?: Record<string, unknown>) => void
}

/** A URL-safe random token (default 256 bits). */
export function generateLoopbackNonce(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url')
}

/** Build the system-browser login URL with the loopback return target + nonce. */
export function buildLoginUrl(loginUrl: string, returnTo: string, nonce: string): string {
  const url = new URL(loginUrl)
  url.searchParams.set('return_to', returnTo)
  url.searchParams.set('nonce', nonce)
  return url.toString()
}

/** The verdict for one inbound request to the loopback listener. */
export interface CallbackVerdict {
  /** HTTP status to return to the browser. */
  status: number
  /** Minimal HTML body (never contains the code). */
  body: string
  /** The one-time code, only when this is the genuine, nonce-matching callback. */
  code?: string
}

const SUCCESS_HTML =
  '<!doctype html><meta charset="utf-8"><title>Restorm</title>' +
  '<body style="font-family:system-ui;text-align:center;padding-top:3rem">' +
  '<h2>Signed in to Restorm</h2><p>You can close this tab and return to the app.</p></body>'

const ERROR_HTML =
  '<!doctype html><meta charset="utf-8"><title>Restorm</title>' +
  '<body style="font-family:system-ui;text-align:center;padding-top:3rem">' +
  '<h2>Login could not be completed</h2><p>Please return to the app and try again.</p></body>'

/**
 * PURE evaluation of one inbound loopback request against the expected nonce.
 * Only a GET to `/callback` carrying `code` and a `state` that EQUALS our nonce
 * yields the code; everything else is refused without aborting the wait (a
 * stray/forged hit on the loopback port must not derail the legitimate flow).
 */
export function evaluateCallback(method: string | undefined, rawUrl: string | undefined, expectedNonce: string): CallbackVerdict {
  if (method !== 'GET') return { status: 405, body: ERROR_HTML }
  let url: URL
  try {
    // rawUrl is path-relative ("/callback?..."); base host is irrelevant here.
    url = new URL(rawUrl ?? '', 'http://127.0.0.1')
  } catch {
    return { status: 400, body: ERROR_HTML }
  }
  if (url.pathname !== '/callback') return { status: 404, body: ERROR_HTML }

  const code = url.searchParams.get('code') ?? ''
  const state = url.searchParams.get('state') ?? ''
  // Constant-ish comparison is unnecessary (the nonce is single-use and local),
  // but the equality MUST hold before we accept the code.
  if (state.length === 0 || state !== expectedNonce) return { status: 400, body: ERROR_HTML }
  if (code.length === 0 || code.length > 4096) return { status: 400, body: ERROR_HTML }

  return { status: 200, body: SUCCESS_HTML, code }
}

/** Redeem the one-time code at the `session` endpoint → the session JWT string. */
export async function exchangeCodeForSession(
  sessionUrl: string,
  code: string,
  fetchImpl: typeof fetch
): Promise<string> {
  const res = await fetchImpl(sessionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code })
  })
  if (!res.ok) {
    throw new Error(`session exchange: backend responded ${String(res.status)}`)
  }
  const body = (await res.json()) as { access_token?: unknown }
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new Error('session exchange: response missing access_token')
  }
  return body.access_token
}

/**
 * Run the full loopback login. Resolves with the session JWT, or rejects on
 * timeout / browser-open failure / exchange failure. Always frees the port.
 */
export async function loopbackLogin(deps: LoopbackLoginDeps): Promise<string> {
  const nonce = (deps.generateNonce ?? generateLoopbackNonce)()
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const log = deps.log ?? ((): void => undefined)

  const code = await new Promise<string>((resolve, reject) => {
    let settled = false

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const verdict = evaluateCallback(req.method, req.url, nonce)
      res.writeHead(verdict.status, { 'content-type': 'text/html; charset=utf-8' })
      res.end(verdict.body)
      if (verdict.code) succeed(verdict.code)
    })

    const timer = setTimeout(() => { fail(new Error('loopback: login timed out')) }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    // Tear the listener + timer down on EVERY exit path (success or failure),
    // exactly once.
    function settle(): boolean {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      server.close()
      return true
    }
    function succeed(value: string): void {
      if (settle()) resolve(value)
    }
    function fail(err: Error): void {
      if (settle()) reject(err)
    }

    server.on('error', (err) => { fail(err instanceof Error ? err : new Error(String(err))) })

    // Bind to the 127.0.0.1 LITERAL only — never the wildcard, so no other host
    // on the network can reach the transient listener.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null
      if (!addr) {
        fail(new Error('loopback: failed to acquire a port'))
        return
      }
      const returnTo = `http://127.0.0.1:${String(addr.port)}/callback`
      const loginFullUrl = buildLoginUrl(deps.loginUrl, returnTo, nonce)
      log('auth: opening system browser for login', { port: addr.port })
      deps.openExternal(loginFullUrl).catch((err: unknown) => {
        fail(err instanceof Error ? err : new Error('loopback: failed to open browser'))
      })
    })
  })

  return exchangeCodeForSession(deps.sessionUrl, code, deps.fetchImpl)
}
