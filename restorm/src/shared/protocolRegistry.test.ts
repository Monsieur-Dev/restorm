import { describe, it, expect } from 'vitest'
import { PROTOCOL_REGISTRY, REQUEST_TYPES, protocolSpec, graphqlTypeNameForRequestType } from './protocolRegistry'
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
    expect(REQUEST_TYPES).toEqual(['http', 'graphql', 'grpc', 'soap', 'websocket', 'odata', 'auth', 'jsonrpc', 'jsonrpcBatch', 'trpc'])
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
})
