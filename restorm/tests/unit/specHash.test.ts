import { describe, it, expect } from 'vitest'
import { computeSpecHash } from '../../src/main/services/apiUpdate/specHash'
import type { NormalizedSpec } from '../../src/main/services/import/idempotent/types'

function spec(partial: Partial<NormalizedSpec> = {}): NormalizedSpec {
  return {
    operations: [],
    models: [],
    enums: [],
    environments: [],
    ...partial
  }
}

describe('computeSpecHash', () => {
  it('produces a sha256:* string', () => {
    const hash = computeSpecHash(spec())
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('is deterministic across calls', () => {
    const sp = spec({
      operations: [{ naturalKey: 'GET /a', name: 'a', deprecated: false, shape: { protocol: 'http', method: 'GET', url: '/a', parameters: [] } }]
    })
    expect(computeSpecHash(sp)).toBe(computeSpecHash(sp))
  })

  it('is order-insensitive for operations / models / enums', () => {
    // Pin the central invariant: an adapter that happens to emit
    // operations in a different order across re-imports must not
    // change the hash. Without this, the checker would surface
    // bogus "update available" notifications on every refresh.
    const a = spec({
      operations: [
        { naturalKey: 'GET /a', name: 'a', deprecated: false, shape: { protocol: 'http', method: 'GET', url: '/a', parameters: [] } },
        { naturalKey: 'GET /b', name: 'b', deprecated: false, shape: { protocol: 'http', method: 'GET', url: '/b', parameters: [] } }
      ],
      models: [
        { name: 'A', deprecated: false, properties: [] },
        { name: 'B', deprecated: false, properties: [] }
      ],
      enums: [
        { name: 'X', values: ['a'], deprecated: false },
        { name: 'Y', values: ['b'], deprecated: false }
      ]
    })
    const b = spec({
      operations: a.operations.slice().reverse(),
      models: a.models.slice().reverse(),
      enums: a.enums.slice().reverse()
    })
    expect(computeSpecHash(a)).toBe(computeSpecHash(b))
  })

  it('changes when an operation is added', () => {
    const a = spec({ operations: [
      { naturalKey: 'GET /a', name: 'a', deprecated: false, shape: { protocol: 'http', method: 'GET', url: '/a', parameters: [] } }
    ] })
    const b = spec({ operations: [
      ...a.operations,
      { naturalKey: 'POST /b', name: 'b', deprecated: false, shape: { protocol: 'http', method: 'POST', url: '/b', parameters: [] } }
    ] })
    expect(computeSpecHash(a)).not.toBe(computeSpecHash(b))
  })

  it('changes when an operation is marked deprecated', () => {
    const op = (deprecated: boolean): NormalizedSpec => spec({ operations: [
      { naturalKey: 'GET /x', name: 'x', deprecated, shape: { protocol: 'http', method: 'GET', url: '/x', parameters: [] } }
    ] })
    expect(computeSpecHash(op(false))).not.toBe(computeSpecHash(op(true)))
  })

  it('does NOT change when only descriptions or defaultValues differ', () => {
    // Tolerated changes: doc-only edits shouldn't trigger "update
    // available" notifications. The user can still see them when
    // they hit Apply, since the pipeline merges descriptions on
    // refresh.
    const op = (description: string): NormalizedSpec => spec({ operations: [
      {
        naturalKey: 'GET /x',
        name: 'x',
        deprecated: false,
        shape: {
          protocol: 'http',
          method: 'GET',
          url: '/x',
          parameters: [{ name: 'id', location: 'path', description, defaultValue: 'foo' }]
        }
      }
    ] })
    expect(computeSpecHash(op('first description'))).toBe(computeSpecHash(op('second description')))
  })

  it('changes when an enum value is added', () => {
    const a = spec({ enums: [{ name: 'Status', values: ['a', 'b'], deprecated: false }] })
    const b = spec({ enums: [{ name: 'Status', values: ['a', 'b', 'c'], deprecated: false }] })
    expect(computeSpecHash(a)).not.toBe(computeSpecHash(b))
  })
})
