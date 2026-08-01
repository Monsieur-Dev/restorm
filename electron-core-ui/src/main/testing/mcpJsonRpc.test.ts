import { describe, it, expect, afterEach, vi } from 'vitest'
import { postMcpJsonRpc, type McpDiscovery } from './mcpJsonRpc'

const discovery: McpDiscovery = {
  port: 12345,
  token: 'test-token',
  projectPath: null,
  pid: 1,
  startedAt: new Date().toISOString()
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

/** A `fetch` rejection shaped exactly like undici's: a bare
 * `TypeError: fetch failed` whose `cause` carries the real reason. */
function fetchFailure(cause: { code?: string; message?: string }): TypeError {
  const err = new TypeError('fetch failed')
  ;(err as TypeError & { cause?: unknown }).cause = Object.assign(new Error(cause.message ?? 'boom'), cause)
  return err
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

describe('postMcpJsonRpc — dead pooled connection', () => {
  // The host is a `node:http` server with a 5s `keepAliveTimeout`. A step that
  // blocks the event loop for longer than that (a multi-second `execSync`)
  // leaves the client holding a socket the server already closed: the server
  // is a separate process and closes on schedule, while the client's own
  // expiry timer cannot fire while the loop is blocked. The next call then
  // writes to a dead socket. This was reproducibly killing the kafka e2e suite
  // at 4 workers, where its topic-reseed step blocks for ~6.6s.

  it('retries once and succeeds when the pooled connection was already closed', async () => {
    const stub = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(fetchFailure({ code: 'UND_ERR_SOCKET', message: 'other side closed' }))
      .mockResolvedValueOnce(jsonResponse({ id: 1, result: { ok: true } }))
    globalThis.fetch = stub

    const reply = await postMcpJsonRpc(discovery, { method: 'tools/list' })

    expect(reply.result).toEqual({ ok: true })
    expect(stub).toHaveBeenCalledTimes(2)
  })

  it('re-sends the identical envelope on the retry rather than burning a second id', async () => {
    const stub = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(fetchFailure({ code: 'UND_ERR_SOCKET' }))
      .mockResolvedValueOnce(jsonResponse({ id: 1, result: {} }))
    globalThis.fetch = stub

    await postMcpJsonRpc(discovery, { method: 'tools/call' })

    const [, first] = stub.mock.calls[0] as [string, RequestInit]
    const [, second] = stub.mock.calls[1] as [string, RequestInit]
    expect(second.body).toBe(first.body)
  })

  it('does NOT retry a failure that is not a dead connection', async () => {
    // A genuinely unreachable host must fail fast and loudly — retrying real
    // outages into a green is exactly the flake-masking this must not do.
    const stub = vi.fn<typeof fetch>().mockRejectedValue(fetchFailure({ code: 'ECONNREFUSED' }))
    globalThis.fetch = stub

    await expect(postMcpJsonRpc(discovery, { method: 'tools/list' })).rejects.toThrow('fetch failed')
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('surfaces the second failure when the retry also finds a dead connection', async () => {
    const stub = vi.fn<typeof fetch>().mockRejectedValue(fetchFailure({ code: 'UND_ERR_SOCKET' }))
    globalThis.fetch = stub

    await expect(postMcpJsonRpc(discovery, { method: 'tools/list' })).rejects.toThrow('fetch failed')
    expect(stub).toHaveBeenCalledTimes(2)
  })
})
