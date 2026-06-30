// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { startEntitlementAutoRefresh } from './autoRefresh'

/** A controllable focus channel: capture the handler so a test can fire it. */
function makeFocus(): { onFocus: (h: () => void) => () => void; fire: () => void; unsubscribed: () => boolean } {
  let handler: (() => void) | null = null
  let unsubscribed = false
  return {
    onFocus: (h) => {
      handler = h
      return () => { unsubscribed = true }
    },
    fire: () => handler?.(),
    unsubscribed: () => unsubscribed
  }
}

/** A controllable interval: capture the callback so a test can tick it. */
function makeTimer(): {
  setIntervalImpl: (cb: () => void, ms: number) => ReturnType<typeof setInterval>
  clearIntervalImpl: (h: ReturnType<typeof setInterval>) => void
  tick: () => void
  ms: () => number | null
  cleared: () => boolean
} {
  let cb: (() => void) | null = null
  let ms: number | null = null
  let cleared = false
  return {
    setIntervalImpl: (c, m) => { cb = c; ms = m; return 1 as unknown as ReturnType<typeof setInterval> },
    clearIntervalImpl: () => { cleared = true },
    tick: () => cb?.(),
    ms: () => ms,
    cleared: () => cleared
  }
}

describe('startEntitlementAutoRefresh', () => {
  it('refreshes on window focus', () => {
    const refresh = vi.fn()
    const focus = makeFocus()
    const timer = makeTimer()
    startEntitlementAutoRefresh({
      refresh,
      onFocus: focus.onFocus,
      now: () => 1_000_000,
      setIntervalImpl: timer.setIntervalImpl,
      clearIntervalImpl: timer.clearIntervalImpl
    })

    focus.fire()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes on each interval tick (past the throttle window)', () => {
    const refresh = vi.fn()
    const focus = makeFocus()
    const timer = makeTimer()
    let nowMs = 1_000_000
    startEntitlementAutoRefresh({
      refresh,
      onFocus: focus.onFocus,
      intervalMs: 150_000,
      minGapMs: 30_000,
      now: () => nowMs,
      setIntervalImpl: timer.setIntervalImpl,
      clearIntervalImpl: timer.clearIntervalImpl
    })

    expect(timer.ms()).toBe(150_000)
    timer.tick()
    nowMs += 150_000
    timer.tick()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('coalesces a focus storm within the throttle window into one refresh', () => {
    const refresh = vi.fn()
    const focus = makeFocus()
    const timer = makeTimer()
    let nowMs = 1_000_000
    startEntitlementAutoRefresh({
      refresh,
      onFocus: focus.onFocus,
      minGapMs: 30_000,
      now: () => nowMs,
      setIntervalImpl: timer.setIntervalImpl,
      clearIntervalImpl: timer.clearIntervalImpl
    })

    focus.fire()            // t=0 → refresh
    nowMs += 1_000
    focus.fire()            // +1s → throttled
    nowMs += 5_000
    focus.fire()            // +6s → throttled
    expect(refresh).toHaveBeenCalledTimes(1)

    nowMs += 30_000         // now past the 30s gap
    focus.fire()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('dispose stops the timer and detaches the focus listener', () => {
    const refresh = vi.fn()
    const focus = makeFocus()
    const timer = makeTimer()
    const dispose = startEntitlementAutoRefresh({
      refresh,
      onFocus: focus.onFocus,
      now: () => 1_000_000,
      setIntervalImpl: timer.setIntervalImpl,
      clearIntervalImpl: timer.clearIntervalImpl
    })

    dispose()
    expect(timer.cleared()).toBe(true)
    expect(focus.unsubscribed()).toBe(true)
  })
})
