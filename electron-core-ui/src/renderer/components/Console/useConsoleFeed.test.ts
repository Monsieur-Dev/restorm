import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConsoleFeedStore, type ConsoleFeedSource } from './useConsoleFeed'
import type { ConsoleRecord } from './types'

function rec(id: string, overrides: Partial<ConsoleRecord> = {}): ConsoleRecord {
  return {
    id,
    timestamp: '2026-05-10T00:00:00.000Z',
    protocol: 'http',
    method: 'GET',
    url: `http://x/${id}`,
    host: 'x',
    port: 80,
    headers: {},
    verdict: 'allow',
    ...overrides
  }
}

/**
 * Controllable feed source: the test holds the emit callback so it
 * can push records on demand, and tracks whether the store
 * subscribed / unsubscribed.
 */
function makeSource(): ConsoleFeedSource & { emit: (r: ConsoleRecord) => void; subscribed: () => boolean } {
  let cb: ((r: ConsoleRecord) => void) | null = null
  return {
    onRecord(fn) {
      cb = fn
      return () => { cb = null }
    },
    emit(r) { cb?.(r) },
    subscribed() { return cb !== null }
  }
}

describe('ConsoleFeedStore', () => {
  beforeEach(() => {
    // The store batches via `requestAnimationFrame`, which the node
    // test env doesn't provide — shim it onto `setTimeout` so fake
    // timers can drive the flush.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      return setTimeout(() => { cb(performance.now()) }, 0) as unknown as number
    })
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('flows records from a source registered BEFORE the first subscribe', async () => {
    const store = new ConsoleFeedStore()
    const source = makeSource()
    store.setSource(source)
    expect(source.subscribed()).toBe(false) // lazy — no listeners yet

    const listener = vi.fn()
    store.subscribe(listener)
    expect(source.subscribed()).toBe(true)

    source.emit(rec('a'))
    source.emit(rec('b'))
    await vi.runAllTimersAsync() // flush the rAF batch
    expect(listener).toHaveBeenCalled()
    expect(store.getSnapshot().map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('flows records from a source registered AFTER the first subscribe (retry path)', async () => {
    const store = new ConsoleFeedStore()
    const source = makeSource()

    const listener = vi.fn()
    store.subscribe(listener)
    expect(source.subscribed()).toBe(false) // no source yet

    // Source wired late — must kick off the subscription immediately
    // because a consumer is already mounted.
    store.setSource(source)
    expect(source.subscribed()).toBe(true)

    source.emit(rec('late'))
    await vi.runAllTimersAsync()
    expect(store.getSnapshot().map((r) => r.id)).toEqual(['late'])
  })

  it('dedupes by id — a re-emitted id replaces the record in place', async () => {
    const store = new ConsoleFeedStore()
    const source = makeSource()
    store.setSource(source)
    store.subscribe(vi.fn())

    source.emit(rec('p', { verdict: 'pending' }))
    source.emit(rec('q'))
    source.emit(rec('p', { verdict: 'allow', status: 200 })) // patch of 'p'
    await vi.runAllTimersAsync()

    const snap = store.getSnapshot()
    expect(snap.map((r) => r.id)).toEqual(['p', 'q']) // still 2 entries, order preserved
    expect(snap[0]?.verdict).toBe('allow')
    expect(snap[0]?.status).toBe(200)
  })

  it('batches a burst of records into one notify pass per frame', async () => {
    const store = new ConsoleFeedStore()
    const source = makeSource()
    store.setSource(source)
    const listener = vi.fn()
    store.subscribe(listener)

    for (let i = 0; i < 10; i++) source.emit(rec(`r${i}`))
    expect(listener).not.toHaveBeenCalled() // nothing flushed synchronously
    await vi.runAllTimersAsync()
    expect(listener).toHaveBeenCalledTimes(1) // one coalesced notify
    expect(store.getSnapshot()).toHaveLength(10)
  })

  it('clear() empties the buffer and notifies', async () => {
    const store = new ConsoleFeedStore()
    const source = makeSource()
    store.setSource(source)
    const listener = vi.fn()
    store.subscribe(listener)

    source.emit(rec('a'))
    await vi.runAllTimersAsync()
    expect(store.getSnapshot()).toHaveLength(1)

    listener.mockClear()
    store.clear()
    expect(store.getSnapshot()).toHaveLength(0)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('clear() is a no-op (no notify) when already empty', () => {
    const store = new ConsoleFeedStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.clear()
    expect(listener).not.toHaveBeenCalled()
  })

  it('a second setSource swaps the feed — old source unsubscribed, new one live', async () => {
    const store = new ConsoleFeedStore()
    const sourceA = makeSource()
    const sourceB = makeSource()
    store.setSource(sourceA)
    store.subscribe(vi.fn())
    expect(sourceA.subscribed()).toBe(true)

    // Re-register with a different source (e.g. HMR re-eval of bootstrap).
    store.setSource(sourceB)
    expect(sourceA.subscribed()).toBe(false) // old source torn down
    expect(sourceB.subscribed()).toBe(true)  // new source live

    // Records from the stale source must NOT land; the new one must.
    sourceA.emit(rec('stale'))
    sourceB.emit(rec('fresh'))
    await vi.runAllTimersAsync()
    expect(store.getSnapshot().map((r) => r.id)).toEqual(['fresh'])
  })

  it('unsubscribe removes the listener', async () => {
    const store = new ConsoleFeedStore()
    const source = makeSource()
    store.setSource(source)
    const listener = vi.fn()
    const unsub = store.subscribe(listener)

    unsub()
    source.emit(rec('a'))
    await vi.runAllTimersAsync()
    expect(listener).not.toHaveBeenCalled()
  })
})
