// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { makeReconnectBudget } from './WebSocketExecutionService'

describe('makeReconnectBudget', () => {
  it('returns false until the cap is exceeded, then true', () => {
    const b = makeReconnectBudget(3)
    expect(b.onReconnect()).toBe(false) // 1
    expect(b.onReconnect()).toBe(false) // 2
    expect(b.onReconnect()).toBe(false) // 3 (== cap, still allowed)
    expect(b.onReconnect()).toBe(true)  // 4 (> cap → end)
  })

  it('onConnect resets the budget so a later flap starts fresh', () => {
    const b = makeReconnectBudget(2)
    expect(b.onReconnect()).toBe(false) // 1
    expect(b.onReconnect()).toBe(false) // 2
    b.onConnect()
    // Budget reset — two more attempts are allowed again before tripping.
    expect(b.onReconnect()).toBe(false) // 1
    expect(b.onReconnect()).toBe(false) // 2
    expect(b.onReconnect()).toBe(true)  // 3 (> cap)
  })

  it('trips immediately when the cap is 0', () => {
    const b = makeReconnectBudget(0)
    expect(b.onReconnect()).toBe(true)
  })
})
