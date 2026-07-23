import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const findByIdMock = vi.hoisted(() => vi.fn())
// Partial mock (spread the real module) rather than replacing it wholesale
// — CollectionStore.ts also exports `pubsub`/`PUBSUB_TOPICS`, which other
// test files importing the real module need. A full-replacement mock here
// can leak across test files sharing a worker and strip those out from
// under them.
vi.mock('../../services/CollectionStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/CollectionStore')>()
  return { ...actual, collectionStore: { findById: findByIdMock } }
})

import { expectedTopLevelEnvironmentFolderIds, waitForCollectionStoreReady } from './project'

describe('expectedTopLevelEnvironmentFolderIds', () => {
  it('picks out only the top-level environment folders, by id', () => {
    const content = {
      collections: [
        { id: 'env-1', folderType: 'environment', items: [] },
        { id: 'regular-folder', items: [] },
        { id: 'env-2', folderType: 'environment', items: [] },
        { id: 'req-1', type: 'http' }
      ]
    }
    expect(expectedTopLevelEnvironmentFolderIds(content)).toEqual(['env-1', 'env-2'])
  })

  it('returns an empty array for a file with no environment folders — the empty-project edge case', () => {
    const content = { collections: [{ id: 'regular-folder', items: [] }, { id: 'req-1', type: 'http' }] }
    expect(expectedTopLevelEnvironmentFolderIds(content)).toEqual([])
  })

  it('returns an empty array for a genuinely empty project', () => {
    expect(expectedTopLevelEnvironmentFolderIds({ collections: [] })).toEqual([])
  })

  it('tolerates malformed / missing content instead of throwing', () => {
    expect(expectedTopLevelEnvironmentFolderIds(null)).toEqual([])
    expect(expectedTopLevelEnvironmentFolderIds(undefined)).toEqual([])
    expect(expectedTopLevelEnvironmentFolderIds({})).toEqual([])
    expect(expectedTopLevelEnvironmentFolderIds({ collections: 'not-an-array' })).toEqual([])
  })
})

describe('waitForCollectionStoreReady', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    findByIdMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves true immediately for an empty expected-id list — the empty-project case never polls at all', async () => {
    await expect(waitForCollectionStoreReady([], 3_000)).resolves.toBe(true)
    expect(findByIdMock).not.toHaveBeenCalled()
  })

  it('resolves true as soon as every expected id is found', async () => {
    findByIdMock.mockReturnValue({ id: 'found' }) // present from the very first poll
    const pending = waitForCollectionStoreReady(['env-1'], 3_000)
    await vi.advanceTimersByTimeAsync(0)
    await expect(pending).resolves.toBe(true)
  })

  it('keeps polling until all expected ids land, then resolves true', async () => {
    let calls = 0
    findByIdMock.mockImplementation(() => {
      calls += 1
      // Not found for the first 3 polls, found from the 4th onward —
      // simulates the real renderer→main mirror taking a few render cycles.
      return calls >= 4 ? { id: 'found' } : null
    })
    const pending = waitForCollectionStoreReady(['env-1'], 3_000)
    await vi.advanceTimersByTimeAsync(500) // well past 4 polls at the 50ms interval
    await expect(pending).resolves.toBe(true)
  })

  it('resolves false once the timeout elapses with the id never landing — this is the safety guarantee: open_project can NEVER hang', async () => {
    findByIdMock.mockReturnValue(null) // never found
    const pending = waitForCollectionStoreReady(['env-1'], 500)
    await vi.advanceTimersByTimeAsync(500)
    await expect(pending).resolves.toBe(false)
  })

  it('requires EVERY expected id to be found, not just one', async () => {
    findByIdMock.mockImplementation((id: string) => (id === 'env-1' ? { id } : null))
    const pending = waitForCollectionStoreReady(['env-1', 'env-2'], 300)
    await vi.advanceTimersByTimeAsync(300)
    await expect(pending).resolves.toBe(false)
  })
})
