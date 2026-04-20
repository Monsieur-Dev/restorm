import { describe, it, expect } from 'vitest'
import { normalizeODataResponse } from '../../src/shared/utils/odataResponse'

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
})
