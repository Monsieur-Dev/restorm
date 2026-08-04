import { describe, it, expect } from 'vitest'
import { sentRequest } from './sentRequest'
import type { ResponseHistoryDetail } from '../../../shared/types/responseHistory'

const detail = (response: Record<string, unknown>): ResponseHistoryDetail => ({
  guid: 'g1',
  requestId: 'r1',
  type: 'http',
  success: true,
  timestamp: '2026-05-21T00:00:00Z',
  pinned: false,
  // Each case supplies only the request-side fields under test, so the literal
  // is not a complete protocol variant.
  response: response as unknown as ResponseHistoryDetail['response']
})

const dispatched = { url: 'https://api/users/7', method: 'POST', headers: { 'x-sent': '1' } }

describe('sentRequest', () => {
  it('completes the dispatched request with the params, path params and body only the detail resolves', () => {
    const request = sentRequest(dispatched, detail({
      type: 'http',
      requestParams: [{ key: 'page', value: '2' }],
      requestPathParams: [{ key: 'id', value: '7' }],
      requestBody: { type: 'text', content: '{"name":"Ana"}' }
    }))
    expect(request).toMatchObject({
      url: 'https://api/users/7',
      method: 'POST',
      params: { page: '2' },
      pathParams: { id: '7' },
      body: { type: 'text', content: '{"name":"Ana"}' }
    })
  })

  it('reports no body when the protocol spells "nothing captured" as an empty string', () => {
    // The SOAP detail declares `requestBody` a required string, so an
    // uncaptured envelope arrives as '' rather than undefined. Reporting
    // `body: ''` on a request that did send an envelope is a false statement,
    // not a harmless one — omission is the only honest answer.
    const request = sentRequest(
      { url: 'https://api/soap', method: 'POST', headers: {} },
      detail({ type: 'soap', requestBody: '' })
    )
    expect(request).not.toHaveProperty('body')
  })

  it('lifts a bare string body into the structured shape', () => {
    // `body` is a selector surface: `response.request.body.content` must
    // resolve on every protocol, not only on those whose detail already
    // carries a structured body.
    const request = sentRequest(
      { url: 'https://api/soap', method: 'POST', headers: {} },
      detail({ type: 'soap', requestBody: '<Envelope><Body/></Envelope>' })
    )
    expect(request['body']).toEqual({ type: 'text', content: '<Envelope><Body/></Envelope>' })
  })

  it('keeps the dispatched headers on top of the resolved rows', () => {
    // The dispatched set is what really left the process — it carries what the
    // authentication step injected, which the request's own rows never hold.
    const request = sentRequest(
      { ...dispatched, headers: { authorization: 'Bearer live', 'x-sent': '1' } },
      detail({ type: 'http', requestHeaders: [{ key: 'authorization', value: '{{token}}' }, { key: 'accept', value: 'application/json' }] })
    )
    expect(request['headers']).toEqual({ authorization: 'Bearer live', accept: 'application/json', 'x-sent': '1' })
  })

  it('fills in headers a protocol never echoes back', () => {
    const request = sentRequest(
      { url: 'https://api/graphql', method: 'POST', headers: {} },
      detail({ type: 'graphql', requestHeaders: [{ key: 'accept', value: 'application/json' }] })
    )
    expect(request['headers']).toEqual({ accept: 'application/json' })
  })

  it('drops disabled rows — they never went on the wire', () => {
    const request = sentRequest(dispatched, detail({
      type: 'http',
      requestParams: [{ key: 'page', value: '2' }, { key: 'debug', value: '1', enabled: false }]
    }))
    expect(request['params']).toEqual({ page: '2' })
  })

  it('returns the dispatched request untouched when no detail was built', () => {
    expect(sentRequest(dispatched, null)).toEqual({
      url: 'https://api/users/7',
      method: 'POST',
      headers: { 'x-sent': '1' }
    })
  })

  it('omits an empty section rather than showing an empty object', () => {
    const request = sentRequest(dispatched, detail({ type: 'http', requestParams: [], requestPathParams: [] }))
    expect(request).not.toHaveProperty('params')
    expect(request).not.toHaveProperty('pathParams')
  })
})
