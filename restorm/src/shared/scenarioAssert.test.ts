import { describe, it, expect, vi } from 'vitest'
import { evalAssert, isAssertOp, isAssertUnaryOp } from './scenarioAssert'

// The shared comparators are delegated; stub it so we test only the assert-only ops.
const stubCompare = vi.fn((op: string | undefined, l: unknown, r: unknown) => op === 'eq' && l === r)

describe('evalAssert', () => {
  it('type checks (unary)', () => {
    expect(evalAssert('isString', 'x', undefined, stubCompare)).toBe(true)
    expect(evalAssert('isString', 5, undefined, stubCompare)).toBe(false)
    expect(evalAssert('isNumber', 5, undefined, stubCompare)).toBe(true)
    expect(evalAssert('isNumber', NaN, undefined, stubCompare)).toBe(false)
    expect(evalAssert('isArray', [1], undefined, stubCompare)).toBe(true)
    expect(evalAssert('isObject', { a: 1 }, undefined, stubCompare)).toBe(true)
    expect(evalAssert('isObject', [1], undefined, stubCompare)).toBe(false)
    expect(evalAssert('isNull', null, undefined, stubCompare)).toBe(true)
  })

  it('exists / isEmpty', () => {
    expect(evalAssert('exists', 0, undefined, stubCompare)).toBe(true)
    expect(evalAssert('exists', null, undefined, stubCompare)).toBe(false)
    expect(evalAssert('isEmpty', '', undefined, stubCompare)).toBe(true)
    expect(evalAssert('isEmpty', [], undefined, stubCompare)).toBe(true)
    expect(evalAssert('isEmpty', {}, undefined, stubCompare)).toBe(true)
    expect(evalAssert('isEmpty', 'x', undefined, stubCompare)).toBe(false)
  })

  it('matchesRegex', () => {
    expect(evalAssert('matchesRegex', 'a1b2', '\\d', stubCompare)).toBe(true)
    expect(evalAssert('matchesRegex', 'abc', '\\d', stubCompare)).toBe(false)
    expect(evalAssert('matchesRegex', 5, '\\d', stubCompare)).toBe(false) // non-string
  })

  it('isOneOf / deepEquals', () => {
    expect(evalAssert('isOneOf', 'b', ['a', 'b', 'c'], stubCompare)).toBe(true)
    expect(evalAssert('isOneOf', 'z', ['a', 'b'], stubCompare)).toBe(false)
    expect(evalAssert('deepEquals', { a: [1, 2] }, { a: [1, 2] }, stubCompare)).toBe(true)
    expect(evalAssert('deepEquals', { a: 1 }, { a: 2 }, stubCompare)).toBe(false)
  })

  it('length comparisons', () => {
    expect(evalAssert('lengthEq', [1, 2, 3], 3, stubCompare)).toBe(true)
    expect(evalAssert('lengthGt', 'hello', 3, stubCompare)).toBe(true)
    expect(evalAssert('lengthLt', { a: 1 }, 3, stubCompare)).toBe(true)
    expect(evalAssert('lengthEq', 5, 1, stubCompare)).toBe(false) // no length
  })

  it('delegates shared comparators to compareValues', () => {
    expect(evalAssert('eq', 7, 7, stubCompare)).toBe(true)
    expect(stubCompare).toHaveBeenCalledWith('eq', 7, 7, undefined, undefined)
  })

  it('guards', () => {
    expect(isAssertOp('deepEquals')).toBe(true)
    expect(isAssertOp('nope')).toBe(false)
    expect(isAssertUnaryOp('isString')).toBe(true)
    expect(isAssertUnaryOp('eq')).toBe(false)
  })
})
