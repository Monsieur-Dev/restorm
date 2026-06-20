import { describe, it, expect } from 'vitest'
import { cloneForEventBus } from './cloneForEventBus'

describe('cloneForEventBus', () => {
  it('deep-clones plain objects and arrays', () => {
    const input = { a: 1, b: [2, { c: 3 }], d: { e: 'x' } }
    const out = cloneForEventBus(input)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
    expect(out.b).not.toBe(input.b)
    expect(out.d).not.toBe(input.d)
  })

  it('preserves Date instances as fresh copies', () => {
    const input = { when: new Date('2020-01-02T03:04:05Z') }
    const out = cloneForEventBus(input)
    expect(out.when).toBeInstanceOf(Date)
    expect(out.when.getTime()).toBe(input.when.getTime())
    expect(out.when).not.toBe(input.when)
  })

  it('does not stack-overflow on a self-referential object', () => {
    const input: Record<string, unknown> = { name: 'root' }
    input['self'] = input
    const out = cloneForEventBus(input)
    expect(out['name']).toBe('root')
    // The cycle is preserved as a reference back to the clone, not the source.
    expect(out['self']).toBe(out)
    expect(out['self']).not.toBe(input)
  })

  it('does not stack-overflow on a cyclic array graph', () => {
    const a: unknown[] = [1]
    const b: unknown[] = [a]
    a.push(b)
    const out = cloneForEventBus(a)
    expect(out[0]).toBe(1)
    const clonedB = out[1] as unknown[]
    expect(clonedB[0]).toBe(out)
  })

  it('preserves shared (non-cyclic) references as shared in the clone', () => {
    const shared = { v: 42 }
    const input = { left: shared, right: shared }
    const out = cloneForEventBus(input)
    expect(out.left).toEqual({ v: 42 })
    expect(out.left).toBe(out.right)
    expect(out.left).not.toBe(shared)
  })
})
