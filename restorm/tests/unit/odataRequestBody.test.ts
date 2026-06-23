import { describe, it, expect } from 'vitest'
import { composeODataRequestBody, type ODataBodySource } from '../../src/shared/utils/odataRequestBody'

const base: ODataBodySource = {
  url: 'http://localhost:8078/odata/Pets'
}

describe('composeODataRequestBody', () => {
  it('entity-set read → GET with no body', () => {
    const out = composeODataRequestBody({ ...base, operationKind: 'entity-set' })
    expect(out).toEqual({ method: 'GET' })
  })

  it('function read → GET with no body', () => {
    const out = composeODataRequestBody({ ...base, operationKind: 'function' })
    expect(out).toEqual({ method: 'GET' })
  })

  it('unset operationKind defaults to a GET read', () => {
    expect(composeODataRequestBody(base)).toEqual({ method: 'GET' })
  })

  it('action → POST carrying the actionBody JSON', () => {
    const out = composeODataRequestBody({
      ...base,
      operationKind: 'action',
      actionBody: '{"rating":5}'
    })
    expect(out.method).toBe('POST')
    expect(out.rawBody).toBe('{"rating":5}')
    // No explicit content-type — the default application/json applies downstream.
    expect(out.rawBodyContentType).toBeUndefined()
  })

  it('action with an empty actionBody → POST with no body', () => {
    const out = composeODataRequestBody({ ...base, operationKind: 'action', actionBody: '' })
    expect(out).toEqual({ method: 'POST' })
  })

  it('batch (multipart, default) → POST with a multipart/mixed envelope', () => {
    const out = composeODataRequestBody({
      ...base,
      operationKind: 'batch',
      batchSubRequests: [
        { method: 'GET', url: 'Pets(1)' },
        { method: 'GET', url: 'Pets(2)' }
      ]
    })
    expect(out.method).toBe('POST')
    expect(out.rawBodyContentType).toMatch(/^multipart\/mixed; boundary=/)
    expect(out.rawBody).toContain('GET Pets(1) HTTP/1.1')
    expect(out.rawBody).toContain('GET Pets(2) HTTP/1.1')
  })

  it('batch sub-request headers flatten into the envelope', () => {
    const out = composeODataRequestBody({
      ...base,
      operationKind: 'batch',
      batchSubRequests: [
        { method: 'POST', url: 'Pets', body: '{"Name":"Rex"}', headers: [{ key: 'Prefer', value: 'return=minimal' }] }
      ]
    })
    expect(out.rawBody).toContain('Prefer: return=minimal')
    expect(out.rawBody).toContain('{"Name":"Rex"}')
  })

  it('batch (json format) → POST with a JSON-batch content type', () => {
    const out = composeODataRequestBody({
      ...base,
      operationKind: 'batch',
      batchFormat: 'json',
      batchSubRequests: [{ method: 'GET', url: 'Pets' }]
    })
    expect(out.method).toBe('POST')
    expect(out.rawBodyContentType).toContain('application/json')
    expect(out.rawBody).toBeDefined()
    // The JSON batch envelope wraps the sub-requests under a `requests` array.
    const parsed = JSON.parse(out.rawBody ?? '{}') as Record<string, unknown>
    expect(parsed).toHaveProperty('requests')
  })

  it('empty batch → an error (no body), not a malformed POST', () => {
    const out = composeODataRequestBody({ ...base, operationKind: 'batch', batchSubRequests: [] })
    expect(out.method).toBe('POST')
    expect(out.rawBody).toBeUndefined()
    expect(out.error).toMatch(/no sub-requests/i)
  })

  it('v4.01 batch converts absolute sub-URLs to service-root-relative by default', () => {
    const out = composeODataRequestBody({
      url: 'http://localhost:8078/odata/$batch',
      operationKind: 'batch',
      odataVersion: 'v4.01',
      batchSubRequests: [{ method: 'GET', url: 'http://localhost:8078/odata/Pets(1)' }]
    })
    // The /$batch suffix is stripped to derive the service root, so the absolute
    // sub-URL collapses to a relative one.
    expect(out.rawBody).toContain('GET Pets(1) HTTP/1.1')
    expect(out.rawBody).not.toContain('GET http://localhost:8078/odata/Pets(1) HTTP/1.1')
  })

  it('v4.01 batch keeps absolute URLs when forceAbsoluteBatchUrls is set', () => {
    const out = composeODataRequestBody({
      url: 'http://localhost:8078/odata/$batch',
      operationKind: 'batch',
      odataVersion: 'v4.01',
      forceAbsoluteBatchUrls: true,
      batchSubRequests: [{ method: 'GET', url: 'http://localhost:8078/odata/Pets(1)' }]
    })
    expect(out.rawBody).toContain('http://localhost:8078/odata/Pets(1)')
  })
})
