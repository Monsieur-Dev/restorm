import { describe, it, expect } from 'vitest'
import { applyListOp, isListOp } from './scenarioList'

describe('applyListOp', () => {
  it('sorts asc/desc, by key', () => {
    expect(applyListOp([3, 1, 2], 'sort')).toEqual([1, 2, 3])
    expect(applyListOp([3, 1, 2], 'sort', { order: 'desc' })).toEqual([3, 2, 1])
    expect(applyListOp([{ n: 2 }, { n: 1 }], 'sort', { key: 'n' })).toEqual([{ n: 1 }, { n: 2 }])
  })

  it('dedups (by key)', () => {
    expect(applyListOp([1, 1, 2, 3, 3], 'unique')).toEqual([1, 2, 3])
    expect(applyListOp([{ id: 1 }, { id: 1 }, { id: 2 }], 'unique', { key: 'id' })).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('reverses', () => {
    expect(applyListOp([1, 2, 3], 'reverse')).toEqual([3, 2, 1])
  })

  it('flattens to depth', () => {
    expect(applyListOp([1, [2, [3]]], 'flatten')).toEqual([1, 2, [3]])
    expect(applyListOp([1, [2, [3]]], 'flatten', { depth: 2 })).toEqual([1, 2, 3])
  })

  it('chunks', () => {
    expect(applyListOp([1, 2, 3, 4, 5], 'chunk', { size: 2 })).toEqual([[1, 2], [3, 4], [5]])
  })

  it('slices', () => {
    expect(applyListOp([1, 2, 3, 4], 'slice', { start: 1, end: 3 })).toEqual([2, 3])
  })

  it('groups by key', () => {
    expect(applyListOp([{ t: 'a', n: 1 }, { t: 'b', n: 2 }, { t: 'a', n: 3 }], 'groupBy', { key: 't' })).toEqual({
      a: [{ t: 'a', n: 1 }, { t: 'a', n: 3 }],
      b: [{ t: 'b', n: 2 }]
    })
  })

  it('throws on a non-list', () => {
    expect(() => applyListOp('nope', 'sort')).toThrow()
    expect(() => applyListOp({ a: 1 }, 'reverse')).toThrow()
  })

  it('does not mutate the input', () => {
    const input = [3, 1, 2]
    applyListOp(input, 'sort')
    expect(input).toEqual([3, 1, 2])
  })

  it('isListOp guards', () => {
    expect(isListOp('groupBy')).toBe(true)
    expect(isListOp('nope')).toBe(false)
  })
})
