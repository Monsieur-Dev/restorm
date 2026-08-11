import { describe, it, expect, vi } from 'vitest'
import { forwardErrorLogsToCrashReporting } from './errorLogForwarding'

/** A hand-rolled onError seam the test can fire at will. */
function makeLoggerPort(): {
  onError: (listener: (message: string, meta?: Record<string, unknown>) => void) => () => void
  fire: (message: string, meta?: Record<string, unknown>) => void
  listenerCount: () => number
} {
  const listeners = new Set<(message: string, meta?: Record<string, unknown>) => void>()
  return {
    onError: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    fire: (message, meta) => {
      for (const listener of listeners) listener(message, meta)
    },
    listenerCount: () => listeners.size
  }
}

describe('forwardErrorLogsToCrashReporting', () => {
  it('captures an entry logged while armed, message and meta intact', () => {
    const port = makeLoggerPort()
    const capture = vi.fn()
    forwardErrorLogsToCrashReporting({ onError: port.onError, isArmed: () => true, capture })

    port.fire('request failed', { code: 500 })

    expect(capture).toHaveBeenCalledExactlyOnceWith('request failed', { code: 500 })
  })

  it('drops an entry logged while disarmed — nothing queued for later', () => {
    const port = makeLoggerPort()
    const capture = vi.fn()
    let armed = false
    forwardErrorLogsToCrashReporting({ onError: port.onError, isArmed: () => armed, capture })

    port.fire('logged before consent')
    expect(capture).not.toHaveBeenCalled()

    // Arming later must not retroactively ship the earlier entry.
    armed = true
    port.fire('logged after consent')
    expect(capture).toHaveBeenCalledExactlyOnceWith('logged after consent', undefined)
  })

  it('re-checks the armed state per entry, so a hot opt-out stops the flow', () => {
    const port = makeLoggerPort()
    const capture = vi.fn()
    let armed = true
    forwardErrorLogsToCrashReporting({ onError: port.onError, isArmed: () => armed, capture })

    port.fire('first')
    armed = false
    port.fire('second')

    expect(capture).toHaveBeenCalledExactlyOnceWith('first', undefined)
  })

  it('a capture that throws is swallowed', () => {
    const port = makeLoggerPort()
    forwardErrorLogsToCrashReporting({
      onError: port.onError,
      isArmed: () => true,
      capture: () => {
        throw new Error('sdk hiccup')
      }
    })

    expect(() => {
      port.fire('boom')
    }).not.toThrow()
  })

  it('the returned unsubscribe detaches the bridge', () => {
    const port = makeLoggerPort()
    const capture = vi.fn()
    const unsubscribe = forwardErrorLogsToCrashReporting({
      onError: port.onError,
      isArmed: () => true,
      capture
    })

    unsubscribe()
    port.fire('after detach')

    expect(capture).not.toHaveBeenCalled()
    expect(port.listenerCount()).toBe(0)
  })
})
