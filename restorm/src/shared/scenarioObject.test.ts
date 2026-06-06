import { describe, it, expect } from 'vitest'
import { applyObjectOp, isObjectOp, OBJECT_OPS } from './scenarioObject'

const SRC = { id: 1, name: 'Rex', meta: { tag: 'dog', age: 4 } }

describe('scenarioObject — the one object-ops core (runtime + preview)', () => {
  it('get reads a dot-path (missing → null)', () => {
    expect(applyObjectOp(SRC, 'get', { path: 'meta.tag' })).toBe('dog')
    expect(applyObjectOp(SRC, 'get', { path: 'meta.missing' })).toBeNull()
  })

  it('set returns a clone with the dot-path written (source untouched)', () => {
    const out = applyObjectOp(SRC, 'set', { path: 'meta.age', other: 5 }) as typeof SRC
    expect(out.meta.age).toBe(5)
    expect(SRC.meta.age).toBe(4)
    expect(applyObjectOp({ a: 1 }, 'set', { path: 'b.c', other: 2 })).toEqual({ a: 1, b: { c: 2 } })
  })

  it('merge shallow-merges (other wins)', () => {
    expect(applyObjectOp({ a: 1, b: 2 }, 'merge', { other: { b: 9, c: 3 } })).toEqual({ a: 1, b: 9, c: 3 })
  })

  it('pick / omit keep / drop keys', () => {
    expect(applyObjectOp(SRC, 'pick', { keys: ['id', 'name'] })).toEqual({ id: 1, name: 'Rex' })
    expect(applyObjectOp(SRC, 'omit', { keys: ['meta'] })).toEqual({ id: 1, name: 'Rex' })
  })

  it('keys / values list the object', () => {
    expect(applyObjectOp({ a: 1, b: 2 }, 'keys')).toEqual(['a', 'b'])
    expect(applyObjectOp({ a: 1, b: 2 }, 'values')).toEqual([1, 2])
  })

  it('a non-object operand THROWS where the op needs one', () => {
    expect(() => applyObjectOp('nope', 'keys')).toThrow(/object/)
    expect(() => applyObjectOp(42, 'merge', { other: {} })).toThrow(/object/)
  })

  it('isObjectOp guards the union', () => {
    expect(OBJECT_OPS).toContain('pick')
    expect(isObjectOp('get')).toBe(true)
    expect(isObjectOp('flatten')).toBe(false)
  })
})
