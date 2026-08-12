/**
 * The import wizard's one-shot authentication call must reach the wire
 * without a firewall prompt.
 *
 * Why this is a unit test and not an e2e: the app hands the firewall an
 * `e2eBypass` flag derived from `RESTORM_USER_DATA_OVERRIDE`, and every
 * Playwright fixture sets that variable — so `PermissionService.classify`
 * returns `allow` before it looks at anything else, and NO Playwright
 * scenario can observe firewall behaviour at all. A green e2e over an
 * authenticated import therefore proves nothing about this interaction;
 * only a test that runs the real interceptor with the bypass off does.
 *
 * So this drives the genuine article: the real `MainProcessInterceptor`
 * patched over `http`, and the real `PermissionService` forced to a
 * verdict that would block. If the auth prefetch ever stops opening its
 * firewall bypass, the request is denied by the interceptor and these
 * assertions fail.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import https from 'node:https'

// The interceptor + permission service read Electron's userData path and
// enumerate windows to broadcast prompts. Neither exists outside a running
// Electron process; the empty window list also keeps a prompt from hanging.
vi.mock('electron', () => ({
  app: {
    getPath: (): string => '/tmp/restorm-auth-prefetch-firewall-test',
    isPackaged: false,
    isReady: (): boolean => false,
    getName: (): string => 'restorm',
    getVersion: (): string => '0.0.0-test',
    on: vi.fn()
  },
  BrowserWindow: { getAllWindows: (): never[] => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))

const { installMainProcessInterceptor, permissionService, firewallService } = await import('electron-core-ui/main')
const { authPrefetchOneShot } = await import('../../src/main/services/AuthenticationPrefetch')

/**
 * Port 1 on loopback refuses immediately, so an allowed request fails fast
 * with ECONNREFUSED and no traffic leaves the machine. That error is the
 * signal the call reached the real transport; a firewall block produces a
 * different message entirely.
 */
const REFUSED_URL = 'http://127.0.0.1:1/oauth/token'

describe('authPrefetchOneShot — firewall', () => {
  // Installing the interceptor rewrites the http/https/fetch slots on the
  // shared Node builtins, which outlive this file inside a vitest worker.
  // Snapshot them and put them back so a sibling test file that happens to
  // make a request isn't silently routed through a firewall it never armed.
  const pristine = {
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    fetch: globalThis.fetch
  }

  beforeAll(() => {
    installMainProcessInterceptor()
    // Records would otherwise fan out to the console panel over IPC.
    vi.spyOn(firewallService, 'emit').mockImplementation(vi.fn())
  })

  afterAll(() => {
    http.request = pristine.httpRequest
    http.get = pristine.httpGet
    https.request = pristine.httpsRequest
    https.get = pristine.httpsGet
    globalThis.fetch = pristine.fetch
    vi.restoreAllMocks()
  })

  it('reaches the transport instead of being blocked, even when the verdict would deny', async () => {
    // `deny` is the harshest verdict the interceptor can reach without any
    // user interaction: it answers synchronously with a denied stub. Only an
    // active bypass keeps the request away from it.
    const classifySpy = vi.spyOn(permissionService, 'classify').mockReturnValue('deny')

    const result = await authPrefetchOneShot({
      method: 'POST',
      url: REFUSED_URL,
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      body: '{"client_id":"VALID_CLIENT_ID"}'
    })

    // The verdict was never consulted — the bypass short-circuits ahead of it.
    expect(classifySpy).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.error).not.toMatch(/[Ff]irewall/)
    expect(result.error).toMatch(/ECONNREFUSED/)

    classifySpy.mockRestore()
  })

  it('blocks a cloud-metadata target, since the bypass removed the firewall as that gate', async () => {
    // The bypass means the firewall no longer vets this URL, so the SSRF
    // guard is the only thing standing between a hostile auth-route URL and
    // the metadata endpoint. It must refuse before any socket is opened.
    const classifySpy = vi.spyOn(permissionService, 'classify').mockReturnValue('allow')

    const result = await authPrefetchOneShot({
      method: 'GET',
      url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      headers: []
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    // Refused by the guard, not by a connection attempt.
    expect(result.error).not.toMatch(/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/)

    classifySpy.mockRestore()
  })

  it('still allows a loopback target, which a local auth server legitimately is', async () => {
    // `allowPrivateHosts` is the whole point of the option: guarding must not
    // break the ordinary case of an auth server on localhost.
    const result = await authPrefetchOneShot({ method: 'GET', url: REFUSED_URL, headers: [] })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/ECONNREFUSED/)
  })

  it('leaves the bypass behind once it settles, so later traffic is still governed', async () => {
    // The bypass is scoped to the prefetch's own async context. A call made
    // afterwards must be classified again — otherwise the auth route would
    // have punched a hole open for the rest of the import.
    await authPrefetchOneShot({ method: 'GET', url: REFUSED_URL, headers: [] })

    const classifySpy = vi.spyOn(permissionService, 'classify').mockReturnValue('deny')
    const blocked = await new Promise<string>((resolve) => {
      const req = http.request({ hostname: '127.0.0.1', port: 1, method: 'GET' })
      req.on('error', (err: Error) => { resolve(err.message) })
      req.end()
    })

    expect(classifySpy).toHaveBeenCalled()
    expect(blocked).toMatch(/[Ff]irewall/)

    classifySpy.mockRestore()
  })
})
