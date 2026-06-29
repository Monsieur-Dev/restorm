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

  it('re-types a config snapshot’s KeyValue values to ValueType instances (no "[object Object]")', () => {
    // A config captures KeyValue values as PLAIN { type, value } objects; without
    // re-hydration the executor stringifies them to "[object Object]" (the URL
    // /pet/{{petId}} then resolves to /pet/[object Object] → 404).
    const req = makeRequest([
      {
        id: 'qc-typed', name: 'Typed', requestId: 'req-1', storageTarget: 'project',
        fields: {
          pathParams: [{ key: 'petId', value: { type: 'string', value: '42' }, enabled: true }],
          headers: [{ key: 'api_key', value: { type: 'expression', value: '{{api_key}}' }, enabled: true }]
        },
        createdAt: '', updatedAt: ''
      }
    ])
    const out = buildEffectiveRequest(req, { quickConfigId: 'qc-typed' }) as unknown as {
      pathParams: { value: unknown }[]; headers: { value: unknown }[]
    }
    expect(String(out.pathParams[0].value)).toBe('42')
    expect(String(out.headers[0].value)).toBe('{{api_key}}')
  })
})

describe('buildEffectiveStreamingRequest (quick-config only)', () => {
  it('applies the picked quick-config (same layer as buildEffectiveRequest)', () => {
    const req = makeRequest()
    const out = buildEffectiveStreamingRequest(req, { quickConfigId: 'qc-1' })
    expect(out.url).toBe('https://config.example')
    expect(out.method).toBe('POST')
  })

  it('ignores per-input override keys — a scenario action only PICKS a config, it does not override fields', () => {
    const req = makeRequest()
    expect(buildEffectiveStreamingRequest(req, { overrides: { url: 'https://inline.example' } })).toBe(req)
  })

  it('returns the request unchanged with no config picked', () => {
    const req = makeRequest()
    expect(buildEffectiveStreamingRequest(req, {})).toBe(req)
  })
})
