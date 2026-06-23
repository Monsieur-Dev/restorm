import { describe, it, expect } from 'vitest'
import { normalizeODataResponse, detectODataVersionMismatch, isV4Family } from '../../src/shared/utils/odataResponse'

describe('detectODataVersionMismatch', () => {
  it('flags a v4 request that got a v2 `d.results` envelope', () => {
    const body = { d: { results: [{ ID: 1 }], __count: '1' } }
    expect(detectODataVersionMismatch(body, 'v4')).toBe('v2')
  })

  it('flags a v4 request that got a v3-style `d` wrapper without __count', () => {
    const body = { d: { results: [{ ID: 1 }] } }
    expect(detectODataVersionMismatch(body, 'v4')).toBe('v3')
  })

  it('flags a v2 request that got a bare v4 `value` collection', () => {
    const body = { '@odata.context': 'x', value: [{ ID: 1 }] }
    expect(detectODataVersionMismatch(body, 'v2')).toBe('v4')
  })

  it('returns null when the envelope matches the request version', () => {
    expect(detectODataVersionMismatch({ value: [{ ID: 1 }] }, 'v4')).toBeNull()
    expect(detectODataVersionMismatch({ d: { results: [] } }, 'v2')).toBeNull()
  })

  it('returns null for inconclusive shapes (single entity / error)', () => {
    expect(detectODataVersionMismatch({ error: { code: 'X' } }, 'v4')).toBeNull()
    expect(detectODataVersionMismatch({ ID: 1, Name: 'x' }, 'v4')).toBeNull()
    expect(detectODataVersionMismatch(null, 'v4')).toBeNull()
  })
})

describe('normalizeODataResponse', () => {
  describe('v4 payloads', () => {
    it('returns the body untouched and lifts known annotations', () => {
      const body = {
        '@odata.context': 'http://x/$metadata#People',
        '@odata.count': 42,
        '@odata.nextLink': 'http://x/People?$skip=10',
        value: [{ Id: 1 }, { Id: 2 }]
      }
      const out = normalizeODataResponse(body, 'v4')
      expect(out?.body).toBe(body)
      expect(out?.value).toEqual([{ Id: 1 }, { Id: 2 }])
      expect(out?.count).toBe(42)
      expect(out?.nextLink).toBe('http://x/People?$skip=10')
    })

    it('coerces a string @odata.count to a number', () => {
      const out = normalizeODataResponse({ value: [], '@odata.count': '7' }, 'v4')
      expect(out?.count).toBe(7)
    })

    it('returns null for primitives and arrays', () => {
      expect(normalizeODataResponse('nope')).toBeNull()
      expect(normalizeODataResponse(42)).toBeNull()
      expect(normalizeODataResponse(null)).toBeNull()
      expect(normalizeODataResponse([1, 2])).toBeNull()
    })
  })

  describe('v2 / v3 envelope', () => {
    it('unwraps `d.results` into `value`', () => {
      const body = { d: { results: [{ Id: 1 }, { Id: 2 }] } }
      const out = normalizeODataResponse(body, 'v2')
      expect(out?.value).toEqual([{ Id: 1 }, { Id: 2 }])
      expect(out?.body.value).toEqual([{ Id: 1 }, { Id: 2 }])
      expect(out?.body['@odata.version']).toBe('v2')
    })

    it('maps `d.__count` to `@odata.count` as a number', () => {
      const body = { d: { results: [], __count: '42' } }
      const out = normalizeODataResponse(body, 'v3')
      expect(out?.count).toBe(42)
      expect(out?.body['@odata.count']).toBe(42)
    })

    it('maps `d.__next` to `@odata.nextLink`', () => {
      const body = { d: { results: [], __next: 'http://x/People?$skiptoken=10' } }
      const out = normalizeODataResponse(body, 'v2')
      expect(out?.nextLink).toBe('http://x/People?$skiptoken=10')
    })

    it('wraps a single-entity v2 response into a singleton `value` array', () => {
      const body = { d: { Id: 1, Name: 'Alice' } }
      const out = normalizeODataResponse(body, 'v2')
      expect(out?.value).toEqual([{ Id: 1, Name: 'Alice' }])
      // Entity fields are also surfaced at top level for callers that
      // still want a flat view.
      expect(out?.body.Id).toBe(1)
      expect(out?.body.Name).toBe('Alice')
    })

    it('passes through a v2 body that is missing the `d` wrapper', () => {
      const body = { message: 'no wrapper here' }
      const out = normalizeODataResponse(body, 'v2')
      expect(out?.body).toBe(body)
    })
  })

  describe('v4.01 delta payloads', () => {
    it('extracts @odata.deltaLink on v4.01 responses', () => {
      const body = {
        '@odata.context': 'http://x/$metadata#People/$delta',
        '@odata.deltaLink': 'http://x/People?$deltatoken=abc123',
        value: [{ Id: 1, Name: 'Alice' }, { '@removed': { reason: 'deleted' }, Id: 2 }]
      }
      const out = normalizeODataResponse(body, 'v4.01')
      expect(out?.deltaLink).toBe('http://x/People?$deltatoken=abc123')
      expect(out?.value).toHaveLength(2)
    })

    it('extracts @odata.deltaLink on v4 responses too (v4 family)', () => {
      const body = {
        '@odata.deltaLink': 'http://x/People?$deltatoken=xyz',
        value: []
      }
      const out = normalizeODataResponse(body, 'v4')
      expect(out?.deltaLink).toBe('http://x/People?$deltatoken=xyz')
    })

    it('omits deltaLink when the annotation is absent', () => {
      const body = { value: [{ Id: 1 }] }
      const out = normalizeODataResponse(body, 'v4.01')
      expect(out?.deltaLink).toBeUndefined()
    })
  })
})

describe('isV4Family', () => {
  it('returns true for v4', () => {
    expect(isV4Family('v4')).toBe(true)
  })

  it('returns true for v4.01', () => {
    expect(isV4Family('v4.01')).toBe(true)
  })

  it('returns false for v3', () => {
    expect(isV4Family('v3')).toBe(false)
  })

  it('returns false for v2', () => {
    expect(isV4Family('v2')).toBe(false)
  })
})

describe('detectODataVersionMismatch — v4.01', () => {
  it('flags a v4.01 request that got a v2 envelope', () => {
    const body = { d: { results: [{ ID: 1 }], __count: '1' } }
    expect(detectODataVersionMismatch(body, 'v4.01')).toBe('v2')
  })

  it('returns null when v4.01 response has v4-style value array', () => {
    const body = { value: [{ ID: 1 }], '@odata.deltaLink': 'http://x/delta' }
    expect(detectODataVersionMismatch(body, 'v4.01')).toBeNull()
  })
})
