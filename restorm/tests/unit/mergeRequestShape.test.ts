import { describe, it, expect } from 'vitest'
import { mergeHttpRequestShape } from '../../src/main/services/apiUpdate/mergeRequestShape'
import type { NormalizedOperation } from '../../src/main/services/import/idempotent/types'

function httpRequest(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'req',
    name: 'r',
    type: 'http',
    method: 'GET',
    url: '/x',
    headers: [],
    params: [],
    pathParams: [],
    ...extras
  }
}

function op(parameters: { name: string; location: string; defaultValue?: string }[]): NormalizedOperation {
  return {
    naturalKey: 'GET /x',
    name: 'r',
    deprecated: false,
    shape: { protocol: 'http', method: 'GET', url: '/x', parameters }
  }
}

describe('mergeHttpRequestShape', () => {
  it('appends new params with empty values, leaves existing ones alone', () => {
    // Pin the rule from the ticket: a refresh must not overwrite a
    // user's stored value on a param that's still in the spec — only
    // adding the params the spec is now describing for the first
    // time.
    const req = httpRequest({ params: [{ id: 'a', key: 'limit', value: '50', enabled: true }] }) as never
    mergeHttpRequestShape(req, op([
      { name: 'limit', location: 'query' },
      { name: 'offset', location: 'query', defaultValue: '0' }
    ]))
    const r = req as unknown as { params: { key: string; value: unknown }[] }
    expect(r.params).toEqual([
      { id: 'a', key: 'limit', value: '50', enabled: true },
      { key: 'offset', value: '0', enabled: true }
    ])
  })

  it('appends header parameters into the headers bucket', () => {
    const req = httpRequest() as never
    mergeHttpRequestShape(req, op([{ name: 'X-Trace-Id', location: 'header' }]))
    const r = req as unknown as { headers: { key: string }[]; params: { key: string }[] }
    expect(r.headers.map((h) => h.key)).toEqual(['X-Trace-Id'])
    expect(r.params).toHaveLength(0)
  })

  it('appends path parameters into the pathParams bucket', () => {
    const req = httpRequest() as never
    mergeHttpRequestShape(req, op([{ name: 'id', location: 'path' }]))
    const r = req as unknown as { pathParams: { key: string }[] }
    expect(r.pathParams.map((p) => p.key)).toEqual(['id'])
  })

  it('keeps params that vanished from the spec', () => {
    // Pin the non-destructive rule: removing a param from the spec
    // doesn't strip the local KV — the user may still need the
    // outdated param to talk to a non-up-to-date server.
    const req = httpRequest({ params: [{ id: 'a', key: 'sort', value: 'asc' }] }) as never
    mergeHttpRequestShape(req, op([])) // empty spec — sort vanished
    const r = req as unknown as { params: { key: string }[] }
    expect(r.params.map((p) => p.key)).toEqual(['sort'])
  })

  it('skips body / formData parameters — those go through the body editor, not KV rows', () => {
    const req = httpRequest() as never
    mergeHttpRequestShape(req, op([
      { name: 'payload', location: 'body' },
      { name: 'file', location: 'formData' }
    ]))
    const r = req as unknown as { headers: unknown[]; params: unknown[]; pathParams: unknown[] }
    expect(r.headers).toHaveLength(0)
    expect(r.params).toHaveLength(0)
    expect(r.pathParams).toHaveLength(0)
  })

  it('is a no-op for non-HTTP requests', () => {
    const req = { id: 'g', name: 'g', type: 'graphql' } as never
    mergeHttpRequestShape(req, op([{ name: 'x', location: 'query' }]))
    expect(req).toEqual({ id: 'g', name: 'g', type: 'graphql' })
  })
})
