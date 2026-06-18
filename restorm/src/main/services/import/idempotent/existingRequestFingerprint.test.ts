// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { existingRequestFingerprint } from './previewImportDiff'
import type { Request } from '../../../../shared/types/requests'

const asRequest = (o: unknown): Request => o as Request

describe('existingRequestFingerprint', () => {
  // The regression: it read pathParameters/queryParameters (which don't
  // exist on the model) → always empty → merged-count never fired. The
  // model uses pathParams (path) + params (query).
  it('reads the real model fields (pathParams / params / headers)', () => {
    const fp = existingRequestFingerprint(asRequest({
      pathParams: [{ key: 'id' }],
      params: [{ key: 'page' }, { key: 'size' }],
      headers: [{ key: 'X-Tenant' }]
    }))
    expect(fp).toBe(['header:X-Tenant', 'path:id', 'query:page', 'query:size'].sort().join('|'))
    expect(fp).not.toBe('')
  })

  it('returns the SAME fingerprint regardless of param order (sorted)', () => {
    const a = existingRequestFingerprint(asRequest({ params: [{ key: 'b' }, { key: 'a' }] }))
    const b = existingRequestFingerprint(asRequest({ params: [{ key: 'a' }, { key: 'b' }] }))
    expect(a).toBe(b)
  })

  it('returns empty for a request with no params/headers', () => {
    expect(existingRequestFingerprint(asRequest({}))).toBe('')
  })

  it('does NOT read the old (wrong) field names', () => {
    // A request carrying ONLY the old names must fingerprint empty now.
    const fp = existingRequestFingerprint(asRequest({
      pathParameters: [{ key: 'id' }],
      queryParameters: [{ key: 'page' }]
    }))
    expect(fp).toBe('')
  })
})
