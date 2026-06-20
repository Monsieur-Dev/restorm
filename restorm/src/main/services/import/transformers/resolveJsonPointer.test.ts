// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { resolveJsonPointer } from './_shared'

describe('resolveJsonPointer — prototype-pollution safety', () => {
  const root = {
    definitions: { Pet: { type: 'object' } },
    components: { schemas: { User: { type: 'object' } } }
  }

  it('resolves a normal pointer', () => {
    expect(resolveJsonPointer(root, '#/definitions/Pet')).toEqual({ type: 'object' })
    expect(resolveJsonPointer(root, '#/components/schemas/User')).toEqual({ type: 'object' })
  })

  it('decodes ~1 and ~0 escapes', () => {
    const r = { 'a/b': { x: 1 }, 'c~d': { y: 2 } }
    expect(resolveJsonPointer(r, '#/a~1b')).toEqual({ x: 1 })
    expect(resolveJsonPointer(r, '#/c~0d')).toEqual({ y: 2 })
  })

  it('refuses prototype-climbing segments (no walk to Object.prototype)', () => {
    expect(resolveJsonPointer(root, '#/__proto__')).toBeUndefined()
    expect(resolveJsonPointer(root, '#/__proto__/polluted')).toBeUndefined()
    expect(resolveJsonPointer(root, '#/constructor/prototype')).toBeUndefined()
    expect(resolveJsonPointer(root, '#/prototype')).toBeUndefined()
  })

  it('returns undefined for an inherited (non-own) property', () => {
    // `toString` exists on the prototype but is not an own key → must not resolve.
    expect(resolveJsonPointer(root, '#/toString')).toBeUndefined()
  })

  it('returns undefined for a missing path or non-pointer', () => {
    expect(resolveJsonPointer(root, '#/definitions/Missing')).toBeUndefined()
    expect(resolveJsonPointer(root, 'definitions/Pet')).toBeUndefined()
  })
})
