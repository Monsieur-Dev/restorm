import { describe, it, expect, vi } from 'vitest'
import { conflictSafeBoolean, subscribeUnlessConflictMode } from './conflictSafeLiveState'

describe('conflictSafeBoolean', () => {
  it('forces false in conflict mode regardless of the raw value', () => {
    expect(conflictSafeBoolean(true, true)).toBe(false)
    expect(conflictSafeBoolean(false, true)).toBe(false)
  })

  it('passes the raw value through outside conflict mode', () => {
    expect(conflictSafeBoolean(true, false)).toBe(true)
    expect(conflictSafeBoolean(false, false)).toBe(false)
    expect(conflictSafeBoolean(true, undefined)).toBe(true)
  })
})

describe('subscribeUnlessConflictMode', () => {
  it('does not call subscribe at all in conflict mode', () => {
    const subscribe = vi.fn(() => vi.fn())
    const result = subscribeUnlessConflictMode(true, subscribe)
    expect(subscribe).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  it('calls subscribe and returns its unsubscribe outside conflict mode', () => {
    const unsub = vi.fn()
    const subscribe = vi.fn(() => unsub)
    const result = subscribeUnlessConflictMode(false, subscribe)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(result).toBe(unsub)
  })

  it('calls subscribe when conflictMode is undefined (default: live)', () => {
    const subscribe = vi.fn(() => undefined)
    subscribeUnlessConflictMode(undefined, subscribe)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })
})
