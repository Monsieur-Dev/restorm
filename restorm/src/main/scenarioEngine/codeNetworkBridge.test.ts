// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { codeNetworkBridge } from './codeNetworkBridge'

const request = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { request } }))

describe('codeNetworkBridge', () => {
  beforeEach(() => request.mockReset())

  it('maps a successful response (status, headers, raw string body)', async () => {
    request.mockResolvedValue({ status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, data: '{"a":1}' })
    const resp = await codeNetworkBridge({ url: 'http://x/y', method: 'GET', headers: {} }, new AbortController().signal)
    expect(resp).toEqual({ status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
  })

  it('returns 4xx/5xx without throwing (fetch-like)', async () => {
    request.mockResolvedValue({ status: 404, statusText: 'Not Found', headers: {}, data: 'nope' })
    const resp = await codeNetworkBridge({ url: 'http://x/404', method: 'GET', headers: {} }, new AbortController().signal)
    expect(resp.status).toBe(404)
    expect(resp.error).toBeUndefined()
  })

  it('reports a transport / firewall failure as `error` (never throws)', async () => {
    request.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('host blocked by firewall'), { isAxiosError: true, code: 'EBLOCKED' })))
    const resp = await codeNetworkBridge({ url: 'http://blocked/x', method: 'GET', headers: {} }, new AbortController().signal)
    expect(resp.status).toBe(0)
    expect(resp.error).toMatch(/firewall/)
  })

  it('forwards method / body / signal and never throws on status', async () => {
    request.mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, data: '' })
    const signal = new AbortController().signal
    await codeNetworkBridge({ url: 'http://x', method: 'POST', headers: { 'x-h': '1' }, body: 'b' }, signal)
    const arg = request.mock.calls[0][0] as Record<string, unknown>
    expect(arg.url).toBe('http://x')
    expect(arg.method).toBe('POST')
    expect(arg.data).toBe('b')
    expect(arg.signal).toBe(signal)
    expect(arg.responseType).toBe('text')
    expect(typeof arg.validateStatus).toBe('function')
  })

  it('joins array (multi-value) response headers', async () => {
    request.mockResolvedValue({ status: 200, statusText: 'OK', headers: { 'set-cookie': ['a=1', 'b=2'] }, data: '' })
    const resp = await codeNetworkBridge({ url: 'http://x', method: 'GET', headers: {} }, new AbortController().signal)
    expect(resp.headers['set-cookie']).toBe('a=1, b=2')
  })

  it('passes size + time caps so a runaway response cannot OOM/hang the host', async () => {
    request.mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, data: '' })
    await codeNetworkBridge({ url: 'http://x', method: 'GET', headers: {} }, new AbortController().signal)
    const arg = request.mock.calls[0][0] as Record<string, unknown>
    expect(typeof arg.maxContentLength).toBe('number')
    expect(arg.maxContentLength).toBeGreaterThan(0)
    expect(arg.maxBodyLength).toBe(arg.maxContentLength)
    expect(typeof arg.timeout).toBe('number')
    expect(arg.timeout).toBeGreaterThan(0)
  })

  it('truncates an over-cap body to the byte limit', async () => {
    const huge = 'x'.repeat(70 * 1024 * 1024) // > 64 MiB cap
    request.mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, data: huge })
    const resp = await codeNetworkBridge({ url: 'http://x', method: 'GET', headers: {} }, new AbortController().signal)
    expect(resp.body.length).toBe(64 * 1024 * 1024)
  })
})
