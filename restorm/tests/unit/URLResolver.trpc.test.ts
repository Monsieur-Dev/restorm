/**
 * URLResolver — tRPC branch: the persisted `url` is the BASE server url; the
 * procedure path is appended (`<base>/<procedure>`), and a query call's
 * `input` is appended as `?input=<encoded>` — the v10 non-batch wire format.
 * A mutation's input rides the POST body instead (`composeTrpcRequestBody`),
 * so it must NOT appear in the resolved URL.
 */

import { describe, it, expect } from 'vitest'
import { resolveUrl } from '../../src/main/services/URLResolver'
import type { FullRequestData, TransformedContext } from '../../src/main/services/ContextServiceTypes'
import Handlebars from 'handlebars'

const transform = (value: string, context: TransformedContext): string => {
  if (!value.includes('{{')) return value
  try {
    return Handlebars.compile(value, { noEscape: true })(context)
  } catch {
    return value
  }
}

function trpcRequest(overrides: Partial<FullRequestData> = {}): FullRequestData {
  return {
    id: 'req-1',
    requestType: 'trpc',
    url: 'http://localhost:9200',
    headers: [],
    trpcKind: 'query',
    ...overrides
  } as FullRequestData
}

describe('URLResolver — tRPC procedure + input composition', () => {
  it('appends the procedure path to the base url', () => {
    const out = resolveUrl(trpcRequest({ trpcProcedure: 'user.get' }), {}, transform)
    expect(out.resolvedUrl).toBe('http://localhost:9200/user.get')
  })

  it('trims a trailing slash on the base url before appending the procedure', () => {
    const out = resolveUrl(trpcRequest({ url: 'http://localhost:9200/', trpcProcedure: 'user.get' }), {}, transform)
    expect(out.resolvedUrl).toBe('http://localhost:9200/user.get')
  })

  it('a query appends `?input=<encoded>` when input is set', () => {
    const out = resolveUrl(
      trpcRequest({ trpcProcedure: 'user.get', trpcKind: 'query', trpcInput: '{"id":1}' }),
      {},
      transform
    )
    expect(out.resolvedUrl).toBe(`http://localhost:9200/user.get?input=${encodeURIComponent('{"id":1}')}`)
  })

  it('a no-input query carries no `input` query param', () => {
    const out = resolveUrl(trpcRequest({ trpcProcedure: 'user.list', trpcKind: 'query' }), {}, transform)
    expect(out.resolvedUrl).toBe('http://localhost:9200/user.list')
  })

  it('a mutation never appends `input` to the URL (it rides the POST body)', () => {
    const out = resolveUrl(
      trpcRequest({ trpcProcedure: 'post.create', trpcKind: 'mutation', trpcInput: '{"title":"Hi"}' }),
      {},
      transform
    )
    expect(out.resolvedUrl).toBe('http://localhost:9200/post.create')
  })

  it('resolves Handlebars in both the procedure and the input', () => {
    const out = resolveUrl(
      trpcRequest({
        url: '{{host}}',
        trpcProcedure: '{{entity}}.get',
        trpcKind: 'query',
        trpcInput: '{"id":"{{userId}}"}'
      }),
      { host: 'http://localhost:9200', entity: 'user', userId: '42' },
      transform
    )
    expect(out.resolvedUrl).toBe(`http://localhost:9200/user.get?input=${encodeURIComponent('{"id":"42"}')}`)
  })
})
