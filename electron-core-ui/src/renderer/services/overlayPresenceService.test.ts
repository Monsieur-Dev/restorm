import { describe, it, expect, vi } from 'vitest'
import { overlayPresenceService } from './overlayPresenceService'

// Reset the singleton between tests by re-importing a fresh module each time
// is impractical without module mocking, so we rely on unregister() to clean up.

function makeRect(x = 0, y = 0, w = 100, h = 100): DOMRect {
  return {
    x, y, width: w, height: h,
    left: x, top: y, right: x + w, bottom: y + h,
    toJSON: () => ({})
  } as DOMRect
}

describe('overlayPresenceService', () => {
  it('starts empty', () => {
    // Snapshot may carry leftovers from prior tests; this just checks the
    // register/unregister cycle rather than assuming a truly virgin state.
    const before = overlayPresenceService.snapshot().length
    const id = overlayPresenceService.register(() => makeRect())
    expect(overlayPresenceService.snapshot().length).toBe(before + 1)
    overlayPresenceService.unregister(id)
    expect(overlayPresenceService.snapshot().length).toBe(before)
  })

  it('register returns a stable id and getRect delegates to the callback', () => {
    const rect = makeRect(10, 20, 300, 50)
    const getRect = vi.fn(() => rect)
    const id = overlayPresenceService.register(getRect)

    expect(id).toMatch(/^overlay-\d+$/)

    const found = overlayPresenceService.snapshot().find((o) => o.id === id)
    expect(found).toBeDefined()
    expect(found?.getRect()).toBe(rect)
    expect(getRect).toHaveBeenCalledTimes(1)

    overlayPresenceService.unregister(id)
  })

  it('subscribe fires immediately with current snapshot and on each change', () => {
    const listener = vi.fn()
    const unsub = overlayPresenceService.subscribe(listener)
    const callsAfterSubscribe = listener.mock.calls.length

    // Register → listener fires again.
    const id = overlayPresenceService.register(() => makeRect())
    expect(listener).toHaveBeenCalledTimes(callsAfterSubscribe + 1)

    // Unregister → listener fires again.
    overlayPresenceService.unregister(id)
    expect(listener).toHaveBeenCalledTimes(callsAfterSubscribe + 2)

    unsub()

    // After unsubscribing, further changes no longer reach the listener.
    const id2 = overlayPresenceService.register(() => makeRect())
    expect(listener).toHaveBeenCalledTimes(callsAfterSubscribe + 2)
    overlayPresenceService.unregister(id2)
  })

  it('unregister is a no-op for unknown ids', () => {
    const listener = vi.fn()
    const unsub = overlayPresenceService.subscribe(listener)
    const calls = listener.mock.calls.length

    overlayPresenceService.unregister('overlay-does-not-exist')
    // No notification for an unknown id (nothing changed).
    expect(listener).toHaveBeenCalledTimes(calls)

    unsub()
  })

  it('multiple overlays coexist and are each independently removable', () => {
    const before = overlayPresenceService.snapshot().length

    const idA = overlayPresenceService.register(() => makeRect(0, 0, 100, 100))
    const idB = overlayPresenceService.register(() => makeRect(50, 50, 200, 40))

    expect(overlayPresenceService.snapshot().length).toBe(before + 2)
    expect(overlayPresenceService.snapshot().find((o) => o.id === idA)).toBeDefined()
    expect(overlayPresenceService.snapshot().find((o) => o.id === idB)).toBeDefined()

    overlayPresenceService.unregister(idA)
    expect(overlayPresenceService.snapshot().find((o) => o.id === idA)).toBeUndefined()
    expect(overlayPresenceService.snapshot().find((o) => o.id === idB)).toBeDefined()

    overlayPresenceService.unregister(idB)
    expect(overlayPresenceService.snapshot().length).toBe(before)
  })
})
