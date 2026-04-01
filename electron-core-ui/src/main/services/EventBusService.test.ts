import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock electron
const mockGetAllWindows = vi.fn((): unknown[] => [])
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => mockGetAllWindows()
  }
}))

// Mock logger
vi.mock('./LoggerService', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

// We need a fresh instance per test, so import the class indirectly
// The module exports a singleton; we'll test via it, resetting with clearAll.
import { eventBusService } from './EventBusService'
import { logger } from './LoggerService'

describe('EventBusService', () => {
  beforeEach(() => {
    eventBusService.clearAll()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // subscribe + emit
  // ---------------------------------------------------------------
  describe('subscribe + emit', () => {
    it('fires handler when event is emitted', async () => {
      const handler = vi.fn()
      eventBusService.subscribe('test:event', handler)

      await eventBusService.emit('test:event', { data: 42 })

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith({ data: 42 })
    })

    it('does nothing when emitting an event with no subscribers', async () => {
      await expect(eventBusService.emit('unknown:event', null)).resolves.toBeUndefined()
    })
  })

  // ---------------------------------------------------------------
  // Multiple handlers
  // ---------------------------------------------------------------
  describe('multiple handlers', () => {
    it('fires all handlers for the same event', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      eventBusService.subscribe('multi', handler1)
      eventBusService.subscribe('multi', handler2)

      await eventBusService.emit('multi', 'payload')

      expect(handler1).toHaveBeenCalledWith('payload')
      expect(handler2).toHaveBeenCalledWith('payload')
    })
  })

  // ---------------------------------------------------------------
  // Unsubscribe
  // ---------------------------------------------------------------
  describe('unsubscribe', () => {
    it('stops firing after unsubscribe', async () => {
      const handler = vi.fn()
      const sub = eventBusService.subscribe('unsub:test', handler)

      await eventBusService.emit('unsub:test', 1)
      expect(handler).toHaveBeenCalledOnce()

      sub.unsubscribe()

      await eventBusService.emit('unsub:test', 2)
      expect(handler).toHaveBeenCalledOnce() // still 1
    })

    it('cleans up handler set when last subscriber unsubscribes', () => {
      const sub = eventBusService.subscribe('cleanup', vi.fn())
      expect(eventBusService.hasSubscribers('cleanup')).toBe(true)

      sub.unsubscribe()
      expect(eventBusService.hasSubscribers('cleanup')).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // emitSync (fire-and-forget via setImmediate)
  // ---------------------------------------------------------------
  describe('emitSync', () => {
    it('fires handler asynchronously via setImmediate', async () => {
      const handler = vi.fn()
      eventBusService.subscribe('sync:test', handler)

      eventBusService.emitSync('sync:test', 'data')

      // Handler should not have been called yet (it's deferred)
      expect(handler).not.toHaveBeenCalled()

      // Flush setImmediate
      await new Promise<void>((resolve) => {
        setImmediate(() => { resolve() })
      })
      // Allow the inner async emit to settle
      await new Promise((resolve) => { setTimeout(resolve, 0) })

      expect(handler).toHaveBeenCalledWith('data')
    })
  })

  // ---------------------------------------------------------------
  // hasSubscribers / clear / clearAll
  // ---------------------------------------------------------------
  describe('hasSubscribers', () => {
    it('returns false when no subscribers', () => {
      expect(eventBusService.hasSubscribers('nope')).toBe(false)
    })

    it('returns true when subscribers exist', () => {
      eventBusService.subscribe('exists', vi.fn())
      expect(eventBusService.hasSubscribers('exists')).toBe(true)
    })
  })

  describe('clear', () => {
    it('removes all subscribers for a specific event', () => {
      eventBusService.subscribe('clearme', vi.fn())
      eventBusService.subscribe('keepme', vi.fn())

      eventBusService.clear('clearme')

      expect(eventBusService.hasSubscribers('clearme')).toBe(false)
      expect(eventBusService.hasSubscribers('keepme')).toBe(true)
    })
  })

  describe('clearAll', () => {
    it('removes all subscribers for all events', () => {
      eventBusService.subscribe('a', vi.fn())
      eventBusService.subscribe('b', vi.fn())

      eventBusService.clearAll()

      expect(eventBusService.hasSubscribers('a')).toBe(false)
      expect(eventBusService.hasSubscribers('b')).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // Handler errors don't break other handlers
  // ---------------------------------------------------------------
  describe('error isolation', () => {
    it('continues calling other handlers when one throws', async () => {
      const errorHandler = vi.fn(() => { throw new Error('boom') })
      const goodHandler = vi.fn()

      eventBusService.subscribe('error:test', errorHandler)
      eventBusService.subscribe('error:test', goodHandler)

      await eventBusService.emit('error:test', 'val')

      expect(errorHandler).toHaveBeenCalledWith('val')
      expect(goodHandler).toHaveBeenCalledWith('val')
      expect(logger.error).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------
  // broadcast
  // ---------------------------------------------------------------
  describe('broadcast', () => {
    it('sends to all non-destroyed windows', () => {
      const mockSend = vi.fn()
      const mockWindows = [
        { isDestroyed: () => false, webContents: { send: mockSend } },
        { isDestroyed: () => true, webContents: { send: vi.fn() } },
        { isDestroyed: () => false, webContents: { send: mockSend } }
      ]
      mockGetAllWindows.mockReturnValue(mockWindows)

      eventBusService.broadcast('channel', { msg: 'hi' })

      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(mockSend).toHaveBeenCalledWith('channel', { msg: 'hi' })
    })
  })
})
