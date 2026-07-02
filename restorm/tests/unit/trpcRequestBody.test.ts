import { describe, it, expect } from 'vitest'
import { composeTrpcRequestBody, unwrapTrpcEnvelope, unwrapTrpcError } from '../../src/shared/utils/trpcRequestBody'

describe('composeTrpcRequestBody', () => {
  it('query → GET with no body (input rides the URL)', () => {
    expect(composeTrpcRequestBody({ kind: 'query', input: '{"id":1}' })).toEqual({ method: 'GET' })
  })

  it('query with no input → GET with no body', () => {
    expect(composeTrpcRequestBody({ kind: 'query' })).toEqual({ method: 'GET' })
  })

  it('mutation → POST with the v10 non-batch envelope', () => {
    const out = composeTrpcRequestBody({ kind: 'mutation', input: '{"name":"Rex"}' })
    expect(out.method).toBe('POST')
    expect(out.rawBody).toBe('{"0":{"json":{"name":"Rex"}}}')
    expect(out.rawBodyContentType).toBe('application/json')
  })

  it('mutation with no input → POST with an empty envelope', () => {
    const out = composeTrpcRequestBody({ kind: 'mutation', input: '' })
    expect(out.rawBody).toBe('{"0":{}}')
  })

  it('mutation input carries a Handlebars placeholder untouched (resolved downstream)', () => {
    const out = composeTrpcRequestBody({ kind: 'mutation', input: '{"ownerId":"{{ownerId}}"}' })
    expect(out.rawBody).toBe('{"0":{"json":{"ownerId":"{{ownerId}}"}}}')
  })
})

describe('unwrapTrpcEnvelope', () => {
  it('extracts result.data from the non-batch success envelope', () => {
    const raw = JSON.stringify([{ result: { data: { id: 1, name: 'Rex' } } }])
    expect(unwrapTrpcEnvelope(raw)).toEqual({ id: 1, name: 'Rex' })
  })

  it('extracts a primitive result.data payload', () => {
    const raw = JSON.stringify([{ result: { data: 'hello' } }])
    expect(unwrapTrpcEnvelope(raw)).toBe('hello')
  })

  it('returns undefined for an error envelope (no `result` key)', () => {
    const raw = JSON.stringify([{ error: { json: { message: 'boom', code: 'BAD_REQUEST' } } }])
    expect(unwrapTrpcEnvelope(raw)).toBeUndefined()
  })

  it('returns undefined for a non-array body', () => {
    expect(unwrapTrpcEnvelope(JSON.stringify({ result: { data: 1 } }))).toBeUndefined()
  })

  it('returns undefined for an empty array body', () => {
    expect(unwrapTrpcEnvelope(JSON.stringify([]))).toBeUndefined()
  })

  it('returns undefined for non-JSON / malformed input rather than throwing', () => {
    expect(unwrapTrpcEnvelope('not json')).toBeUndefined()
    expect(unwrapTrpcEnvelope(undefined)).toBeUndefined()
    expect(unwrapTrpcEnvelope('')).toBeUndefined()
  })
})

describe('unwrapTrpcError', () => {
  it('extracts "code: message" from a v10 error envelope', () => {
    const raw = JSON.stringify([{ error: { json: { message: 'No user with that id', code: 'NOT_FOUND' } } }])
    expect(unwrapTrpcError(raw)).toBe('NOT_FOUND: No user with that id')
  })

  it('falls back to the bare message when the envelope has no code', () => {
    const raw = JSON.stringify([{ error: { json: { message: 'boom' } } }])
    expect(unwrapTrpcError(raw)).toBe('boom')
  })

  it('returns undefined for a success envelope (no `error` key)', () => {
    const raw = JSON.stringify([{ result: { data: { id: 1 } } }])
    expect(unwrapTrpcError(raw)).toBeUndefined()
  })

  it('returns undefined for non-JSON / malformed input rather than throwing', () => {
    expect(unwrapTrpcError('not json')).toBeUndefined()
    expect(unwrapTrpcError(undefined)).toBeUndefined()
    expect(unwrapTrpcError('')).toBeUndefined()
  })
})
