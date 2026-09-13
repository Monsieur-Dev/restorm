import { describe, it, expect } from 'vitest'
import { classifyCapture, graphqlOperationOf, grpcRouteOf, websocketMessageTypeOf } from '../../src/shared/recording/classifyCapture'

const base = {
  method: 'POST',
  url: 'http://api.test/graphql',
  requestHeaders: [{ key: 'Content-Type', value: 'application/json' }],
  requestBodyText: null as string | null,
  responseMimeType: 'application/json',
  responseHeaders: []
}

describe('capture classification', () => {
  it('a plain JSON call is http', () => {
    expect(classifyCapture({ ...base, url: 'http://api.test/users', requestBodyText: '{"name":"x"}' })).toEqual({ protocol: 'http' })
  })

  it('a JSON body carrying a query is GraphQL, with its operation', () => {
    const body = JSON.stringify({ query: 'query Users($n: Int) { users(first: $n) { id } }', variables: { n: 1 } })
    expect(classifyCapture({ ...base, requestBodyText: body })).toEqual({ protocol: 'graphql', graphql: { operationType: 'query', operationName: 'Users' } })
  })

  it('operationName in the body wins over the document', () => {
    const body = JSON.stringify({ query: 'mutation A { a } mutation B { b }', operationName: 'B' })
    expect(classifyCapture({ ...base, requestBodyText: body })).toEqual({ protocol: 'graphql', graphql: { operationType: 'mutation', operationName: 'B' } })
  })

  it('a shorthand anonymous query is a query without a name', () => {
    expect(graphqlOperationOf('{ users { id } }')).toEqual({ operationType: 'query', operationName: null })
    expect(graphqlOperationOf('# comment\n  subscription OnEvent { event }')).toEqual({ operationType: 'subscription', operationName: 'OnEvent' })
    expect(graphqlOperationOf('SELECT 1')).toBeNull()
  })

  it('application/graphql bodies and GET ?query= are GraphQL too', () => {
    expect(classifyCapture({ ...base, requestHeaders: [{ key: 'content-type', value: 'application/graphql' }], requestBodyText: 'query Ping { ping }' }))
      .toEqual({ protocol: 'graphql', graphql: { operationType: 'query', operationName: 'Ping' } })
    expect(classifyCapture({ ...base, method: 'GET', url: 'http://api.test/graphql?query=%7B%20ping%20%7D&operationName=P' }))
      .toEqual({ protocol: 'graphql', graphql: { operationType: 'query', operationName: 'P' } })
  })

  it('a batched GraphQL request classifies on its first operation', () => {
    const body = JSON.stringify([{ query: 'query A { a }' }, { query: 'query B { b }' }])
    expect(classifyCapture({ ...base, requestBodyText: body }).graphql).toEqual({ operationType: 'query', operationName: 'A' })
  })

  it('a grpc-web content type is gRPC-web with service and method from the path', () => {
    const result = classifyCapture({
      ...base,
      url: 'http://api.test/pets.v1.PetService/GetPet',
      requestHeaders: [{ key: 'content-type', value: 'application/grpc-web+proto' }],
      responseMimeType: 'application/grpc-web+proto'
    })
    expect(result).toEqual({ protocol: 'grpc-web', grpc: { service: 'pets.v1.PetService', method: 'GetPet' } })
    expect(grpcRouteOf('http://api.test/only')).toBeNull()
  })

  it('a grpc-web response type is enough when the request header is missing', () => {
    const result = classifyCapture({ ...base, url: 'http://api.test/S/M', requestHeaders: [], responseMimeType: 'application/grpc-web-text' })
    expect(result.protocol).toBe('grpc-web')
  })

  it('finds the WebSocket message discriminant in conventional fields', () => {
    expect(websocketMessageTypeOf('{"type":"chat.message","text":"hi"}')).toBe('chat.message')
    expect(websocketMessageTypeOf('{"event":"presence"}')).toBe('presence')
    expect(websocketMessageTypeOf('["join", {"room": 1}]')).toBe('join')
    expect(websocketMessageTypeOf('{"payload":1}')).toBeNull()
    expect(websocketMessageTypeOf('plain text')).toBeNull()
    expect(websocketMessageTypeOf('{not json')).toBeNull()
  })
})
