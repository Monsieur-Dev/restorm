import { describe, it, expect, vi } from 'vitest'
import {
  noteCollectionsSync,
  getCollectionsSyncCount,
  waitForCollectionsSyncAfter
} from './collectionsSyncSignal'

// The module owns a process-global monotonic counter (there is one renderer
// mirror stream per main process), so each test captures the current count as
// its own baseline rather than assuming a fixed start.
describe('collectionsSyncSignal', () => {
  it('monotonically counts each sync receipt', () => {
    const start = getCollectionsSyncCount()
    noteCollectionsSync()
    noteCollectionsSync()
    expect(getCollectionsSyncCount()).toBe(start + 2)
  })

  it('resolves immediately when a sync already arrived since the captured point', async () => {
    const before = getCollectionsSyncCount()
    noteCollectionsSync()
    await expect(waitForCollectionsSyncAfter(before, 10_000)).resolves.toBe(true)
  })

  it('resolves true once the next sync arrives after the captured point', async () => {
    const before = getCollectionsSyncCount()
    const pending = waitForCollectionsSyncAfter(before, 10_000)
    // Not yet — no sync since `before`.
    noteCollectionsSync()
    await expect(pending).resolves.toBe(true)
  })

  it('releases only the waiters whose threshold the new count reaches', async () => {
    const before = getCollectionsSyncCount()
    const first = waitForCollectionsSyncAfter(before, 10_000)
    // A second waiter captured AFTER the first still needs its own sync.
    const second = waitForCollectionsSyncAfter(before + 1, 10_000)
    noteCollectionsSync() // count = before + 1 → releases `first` only
    await expect(first).resolves.toBe(true)
    const secondSettled = await Promise.race([
      second.then(() => 'settled' as const),
      Promise.resolve('pending' as const)
    ])
    expect(secondSettled).toBe('pending')
    noteCollectionsSync() // count = before + 2 → releases `second`
    await expect(second).resolves.toBe(true)
  })

  it('resolves false on timeout and never hangs', async () => {
    vi.useFakeTimers()
    try {
      const before = getCollectionsSyncCount()
      const pending = waitForCollectionsSyncAfter(before, 3_000)
      await vi.advanceTimersByTimeAsync(3_000)
      await expect(pending).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
