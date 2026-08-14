import { describe, it, expect } from 'vitest'
import { PROTOCOL_REGISTRY, REQUEST_TYPES, protocolSpec, graphqlTypeNameForRequestType, requestTabTitle } from './protocolRegistry'
import { REQUEST_CLASS_REGISTRY } from './models/requests/requestFactory'

/**
 * Drift guard for the protocol-registry socle: the class-free metadata registry
 * ({@link PROTOCOL_REGISTRY}) is the single source of truth, and every sibling
 * registry keyed on the same discriminant must cover exactly the same key set.
 * A protocol added to one registry but not the others fails here rather than
 * misbehaving at runtime.
 */
describe('protocol registry socle', () => {
  const registryKeys = Object.keys(PROTOCOL_REGISTRY).sort()

  it('derives REQUEST_TYPES from the registry keys (same set)', () => {
    expect([...REQUEST_TYPES].sort()).toEqual(registryKeys)
  })

  it('keeps the canonical protocol order in REQUEST_TYPES', () => {
    expect(REQUEST_TYPES).toEqual(['http', 'graphql', 'grpc', 'soap', 'websocket', 'sse', 'stomp', 'odata', 'redis', 'auth', 'jsonrpc', 'jsonrpcBatch', 'trpc', 'amqp', 'kafka'])
  })

  it('has a request-class factory entry for every protocol', () => {
    expect(Object.keys(REQUEST_CLASS_REGISTRY).sort()).toEqual(registryKeys)
  })

  it('every spec exposes a unique GraphQL type name resolvable back to itself', () => {
    const names = new Set<string>()
    for (const type of REQUEST_TYPES) {
      const name = protocolSpec(type).graphqlTypeName
      expect(name).toBeTruthy()
      expect(names.has(name)).toBe(false)
      names.add(name)
      expect(graphqlTypeNameForRequestType(type)).toBe(name)
    }
  })

  it('resolves null for an unknown discriminant (no silent HTTP fallback)', () => {
    expect(graphqlTypeNameForRequestType('does-not-exist')).toBeNull()
    expect(graphqlTypeNameForRequestType(undefined)).toBeNull()
  })

  it('every spec declares a tab type and an IPC namespace', () => {
    for (const type of REQUEST_TYPES) {
      const spec = protocolSpec(type)
      expect(spec.tabType).toMatch(/-request$/)
      expect(spec.ipcNamespace).toBeTruthy()
    }
  })

  it('composes a non-empty tab title for every protocol', () => {
    for (const type of REQUEST_TYPES) {
      // `method` covers HTTP's field-driven prefix; the other protocols ignore it.
      const title = requestTabTitle({ type, name: 'Ping', method: 'GET' })
      expect(title, `${type} composes no tab title`).toBeTruthy()
      expect(title).toContain('Ping')
    }
  })

  it('prefixes the name per the spec, and only per the spec', () => {
    expect(requestTabTitle({ type: 'http', name: 'Ping', method: 'DELETE' })).toBe('DELETE Ping')
    expect(requestTabTitle({ type: 'graphql', name: 'Ping' })).toBe('GraphQL Ping')
    expect(requestTabTitle({ type: 'jsonrpcBatch', name: 'Ping' })).toBe('JSON-RPC Batch Ping')
    // No `tabTitle` in the spec → the bare name, no invented prefix.
    expect(requestTabTitle({ type: 'kafka', name: 'Ping' })).toBe('Ping')
    expect(requestTabTitle({ type: 'odata', name: 'Ping' })).toBe('Ping')
  })

  it('falls back to the bare name rather than rendering an absent field', () => {
    expect(requestTabTitle({ type: 'http', name: 'Ping' })).toBe('Ping')
    expect(requestTabTitle({ type: 'http', name: 'Ping', method: '' })).toBe('Ping')
  })

  it('resolves null for an unknown discriminant (no silent HTTP fallback)', () => {
    expect(requestTabTitle({ type: 'does-not-exist', name: 'Ping' })).toBeNull()
    expect(requestTabTitle({ name: 'Ping' })).toBeNull()
  })
})
