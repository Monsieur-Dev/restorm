/**
 * The `onError` observer seam: error-level entries are broadcast to listeners,
 * other levels are not, a throwing listener never breaks the logger, and a
 * listener that logs an error from inside the notification is not re-entered
 * (the loop guard). Winston and electron are stubbed — this exercises only the
 * listener registry around the transport call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true }
}))

const winstonLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  level: 'info',
  transports: []
}

vi.mock('winston', () => {
  const FakeConsoleTransport = vi.fn()
  const FakeFileTransport = vi.fn()
  const format = {
    combine: vi.fn(() => ({})),
    timestamp: vi.fn(() => ({})),
    colorize: vi.fn(() => ({})),
    printf: vi.fn(() => ({})),
    json: vi.fn(() => ({}))
  }
  return {
    default: {
      createLogger: vi.fn(() => winstonLogger),
      format,
      transports: { Console: FakeConsoleTransport, File: FakeFileTransport }
    }
  }
})

import { logger } from './LoggerService'

describe('logger.onError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('notifies listeners for error-level entries, with message and meta', () => {
    const seen: [string, Record<string, unknown> | undefined][] = []
    const unsubscribe = logger.onError((message, meta) => {
      seen.push([message, meta])
    })

    logger.error('boom', { code: 7 })

    expect(seen).toEqual([['boom', { code: 7 }]])
    expect(winstonLogger.error).toHaveBeenCalledWith('boom', { code: 7 })
    unsubscribe()
  })

  it('does not notify for warn/info/debug entries', () => {
    const listener = vi.fn()
    const unsubscribe = logger.onError(listener)

    logger.warn('w')
    logger.info('i')
    logger.debug('d')

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('unsubscribing stops the notifications', () => {
    const listener = vi.fn()
    const unsubscribe = logger.onError(listener)
    unsubscribe()

    logger.error('after unsubscribe')

    expect(listener).not.toHaveBeenCalled()
  })

  it('a throwing listener is swallowed and later listeners still run', () => {
    const late = vi.fn()
    const unsubscribeThrowing = logger.onError(() => {
      throw new Error('observer bug')
    })
    const unsubscribeLate = logger.onError(late)

    expect(() => {
      logger.error('boom')
    }).not.toThrow()
    expect(late).toHaveBeenCalledTimes(1)

    unsubscribeThrowing()
    unsubscribeLate()
  })

  it('a listener that logs an error is written but not re-broadcast (loop guard)', () => {
    const listener = vi.fn((message: string) => {
      if (message === 'outer') logger.error('nested')
    })
    const unsubscribe = logger.onError(listener)

    logger.error('outer')

    // The nested entry reached winston like any log line…
    expect(winstonLogger.error).toHaveBeenCalledWith('nested', undefined)
    // …but the listener only ever saw the outer one.
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('outer', undefined)
    unsubscribe()
  })
})
