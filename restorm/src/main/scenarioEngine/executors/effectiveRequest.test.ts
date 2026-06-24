import { describe, it, expect } from 'vitest'
import { buildEffectiveRequest, buildEffectiveStreamingRequest } from './effectiveRequest'
import type { QuickConfig } from '../../../shared/types/requests/QuickConfig'

/** A fake request carrying a PROJECT quick-config on `quickConfigs[]` — the
 * resolver applies the picked config by id from there (no field snapshot on the
 * node). `qc-1` overrides url+method; a settings-target `qc-set` must be IGNORED
 * (scenario actions can't bind a non-portable user-settings config). The
 * per-input inline/wired overrides are NOT applied by this resolver — they layer
 * on in the executor's slot merge — so these tests cover only the config layer. */
function makeRequest(extraConfigs: QuickConfig[] = []): {
  id: string; name: string; type: string; url: string; method: string
  headers: { key: string; value: string }[]; body: unknown
  authenticationRequestId?: string; quickConfigs: QuickConfig[]
  greeting: () => string
} {
  return {
    id: 'req-1',
    name: 'My request',
    type: 'http',
    url: 'https://base.example/api',
    method: 'GET',
    headers: [{ key: 'X-Base', value: '1' }],
    body: { type: 'text', content: 'base-body' },
    quickConfigs: [
      { id: 'qc-1', name: 'Prod', requestId: 'req-1', storageTarget: 'project', fields: { url: 'https://config.example', method: 'POST' }, createdAt: '', updatedAt: '' },
      { id: 'qc-set', name: 'Local', requestId: 'req-1', storageTarget: 'settings', fields: { url: 'https://settings.example' }, createdAt: '', updatedAt: '' },
      ...extraConfigs
    ],
    greeting() { return `hello ${this.name}` }
  }
}

describe('buildEffectiveRequest (config layer only)', () => {
  it('returns the bound request unchanged when no config is picked', () => {
    const req = makeRequest()
    expect(buildEffectiveRequest(req, {})).toBe(req)
    expect(buildEffectiveRequest(req, { requestId: 'req-1' })).toBe(req)
    // Inline overrides do NOT trigger the config-layer clone — they layer on later.
    expect(buildEffectiveRequest(req, { overrides: { url: 'x' } })).toBe(req)
  })

  it('resolves a project quick-config by id from request.quickConfigs', () => {
    const req = makeRequest()
    const out = buildEffectiveRequest(req, { quickConfigId: 'qc-1' })
    expect(out.url).toBe('https://config.example')
    expect(out.method).toBe('POST')
    expect(out.body).toEqual({ type: 'text', content: 'base-body' })
    expect(out).not.toBe(req)
  })

  it('ignores a settings-target config id (not portable with the file)', () => {
    const req = makeRequest()
    expect(buildEffectiveRequest(req, { quickConfigId: 'qc-set' })).toBe(req)
  })

  it('treats a deleted config id as missing (no fields applied)', () => {
    const req = makeRequest()
    expect(buildEffectiveRequest(req, { quickConfigId: 'qc-gone' })).toBe(req)
  })

  it('preserves the prototype so instance methods survive on the clone', () => {
    const req = makeRequest()
    const out = buildEffectiveRequest(req, { quickConfigId: 'qc-1' })
    expect(out.greeting()).toBe('hello My request')
  })

  it('never lets a config clobber identity / protected fields', () => {
    const req = makeRequest([
      { id: 'qc-evil', name: 'Evil', requestId: 'req-1', storageTarget: 'project', fields: { id: 'evil', name: 'evil', type: 'evil' }, createdAt: '', updatedAt: '' }
    ])
    const out = buildEffectiveRequest(req, { quickConfigId: 'qc-evil' })
    expect(out.id).toBe('req-1')
    expect(out.name).toBe('My request')
    expect(out.type).toBe('http')
  })

  it('does not mutate the original request when a config clones it', () => {
    const req = makeRequest([
      { id: 'qc-h', name: 'H', requestId: 'req-1', storageTarget: 'project', fields: { headers: [{ key: 'X-Base', value: '1' }] }, createdAt: '', updatedAt: '' }
    ])
    const out = buildEffectiveRequest(req, { quickConfigId: 'qc-h' })
    const outHeaders = out.headers as { value: string }[]
    outHeaders[0].value = 'mutated'
    expect(req.headers[0]).toEqual({ key: 'X-Base', value: '1' })
  })
})

describe('buildEffectiveStreamingRequest (config + inline field overrides)', () => {
  it('applies the config then inline scalar field overrides on top', () => {
    const req = makeRequest()
    const out = buildEffectiveStreamingRequest(req, { quickConfigId: 'qc-1', overrides: { url: 'https://override.example' } })
    expect(out.url).toBe('https://override.example') // inline wins over config
    expect(out.method).toBe('POST') // from config
  })

  it('applies inline overrides with no config picked', () => {
    const req = makeRequest()
    const out = buildEffectiveStreamingRequest(req, { overrides: { url: 'https://inline.example' } })
    expect(out.url).toBe('https://inline.example')
  })

  it('ignores slot-style override keys (streaming nodes have no per-key KV ports)', () => {
    const req = makeRequest()
    const out = buildEffectiveStreamingRequest(req, { overrides: { 'headers:X-Foo': 'v' } })
    expect(out.headers).toEqual([{ key: 'X-Base', value: '1' }])
  })

  it('returns the request unchanged with neither config nor inline override', () => {
    const req = makeRequest()
    expect(buildEffectiveStreamingRequest(req, {})).toBe(req)
  })
})
