import { describe, it, expect, beforeEach } from 'vitest'
import { ValueSourceRegistry } from './valueSourceRegistry'
import type { ValueSourceDescriptor } from './ValueSource'
import { extractSubKey } from './ValueSource'

const demo: ValueSourceDescriptor = {
  id: 'demo',
  labelKey: 'secrets.source.demo',
  canWrite: false,
  isObject: false,
  paramSchema: [{ key: 'name', labelKey: 'secrets.param.name', kind: 'text', required: true }]
}

describe('ValueSourceRegistry', () => {
  let registry: ValueSourceRegistry

  beforeEach(() => {
    registry = new ValueSourceRegistry()
  })

  it('register + lookup a descriptor by id', () => {
    registry.register(demo)
    expect(registry.get('demo')?.labelKey).toBe('secrets.source.demo')
    expect(registry.list().some(d => d.id === 'demo')).toBe(true)
  })

  it('returns undefined for unknown id', () => {
    expect(registry.get('unknown')).toBeUndefined()
  })

  it('list returns all registered descriptors', () => {
    registry.register(demo)
    registry.register({ id: 'another', labelKey: 'secrets.source.another', canWrite: true, isObject: false })
    expect(registry.list()).toHaveLength(2)
  })

  it('overwriting with same id replaces the descriptor', () => {
    registry.register(demo)
    registry.register({ ...demo, labelKey: 'secrets.source.demo.v2' })
    expect(registry.get('demo')?.labelKey).toBe('secrets.source.demo.v2')
    expect(registry.list()).toHaveLength(1)
  })
})

describe('extractSubKey', () => {
  it('returns string payload directly when no path', () => {
    expect(extractSubKey('hello', undefined)).toBe('hello')
  })

  it('returns string payload directly when path is empty string', () => {
    expect(extractSubKey('hello', '')).toBe('hello')
  })

  it('JSON-stringifies non-string payload when no path', () => {
    expect(extractSubKey({ token: 'x' }, undefined)).toBe(JSON.stringify({ token: 'x' }))
  })

  it('extracts a top-level key from an object payload', () => {
    expect(extractSubKey({ token: 'abc' }, 'token')).toBe('abc')
  })

  it('extracts a nested key via dot path', () => {
    expect(extractSubKey({ a: { b: { c: 'deep' } } }, 'a.b.c')).toBe('deep')
  })

  it('throws on missing path segment', () => {
    expect(() => extractSubKey({ token: 'x' }, 'missing')).toThrow(/not found/)
  })

  it('JSON-stringifies a non-string value at the path', () => {
    expect(extractSubKey({ nested: { x: 1 } }, 'nested')).toBe(JSON.stringify({ x: 1 }))
  })
})
