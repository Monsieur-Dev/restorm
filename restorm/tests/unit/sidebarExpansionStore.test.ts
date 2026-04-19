import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getStoredExpansion,
  setStoredExpansion,
  filterKnownIds
} from '../../src/renderer/src/services/sidebarExpansionStore'

interface StoreEntry { value: unknown }
type FakeStore = Map<string, StoreEntry>

function installFakeStorage(store: FakeStore): void {
  (window as unknown as { api?: unknown }).api = {
    storage: {
      get: vi.fn((key: string) => Promise.resolve(store.get(key)?.value)),
      set: vi.fn((key: string, value: unknown) => {
        store.set(key, { value })
        return Promise.resolve(true)
      }),
      delete: vi.fn((key: string) => {
        store.delete(key)
        return Promise.resolve(true)
      })
    }
  }
}

describe('sidebarExpansionStore', () => {
  let store: FakeStore

  beforeEach(() => {
    store = new Map()
    installFakeStorage(store)
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  describe('filterKnownIds', () => {
    it('keeps ids that exist and drops the rest', () => {
      const known = ['a', 'b', 'c']
      const stored = ['a', 'x', 'b', 'y']
      expect(filterKnownIds(stored, known)).toEqual(['a', 'b'])
    })

    it('returns an empty array when nothing overlaps', () => {
      expect(filterKnownIds(['x', 'y'], ['a', 'b'])).toEqual([])
    })

    it('preserves the stored order (not the known-ids order)', () => {
      expect(filterKnownIds(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
    })

    it('accepts a Set for the known-ids argument', () => {
      expect(filterKnownIds(['a', 'b'], new Set(['a']))).toEqual(['a'])
    })
  })

  describe('getStoredExpansion / setStoredExpansion', () => {
    it('returns null when nothing has been stored', async () => {
      const result = await getStoredExpansion('/tmp/project.restorm')
      expect(result).toBeNull()
    })

    it('round-trips ids via storage', async () => {
      await setStoredExpansion('/tmp/project.restorm', ['root', 'folder-a', 'folder-b'])
      const result = await getStoredExpansion('/tmp/project.restorm')
      expect(result).toEqual(['root', 'folder-a', 'folder-b'])
    })

    it('dedupes repeated ids before writing', async () => {
      await setStoredExpansion('/tmp/project.restorm', ['a', 'a', 'b', 'a'])
      const result = await getStoredExpansion('/tmp/project.restorm')
      expect(result).toEqual(['a', 'b'])
    })

    it('persists an empty-array entry (collapse-all is meaningful state)', async () => {
      await setStoredExpansion('/tmp/project.restorm', [])
      const result = await getStoredExpansion('/tmp/project.restorm')
      expect(result).toEqual([])
    })

    it('keys by file path so different projects do not collide', async () => {
      await setStoredExpansion('/a/project.restorm', ['only-a'])
      await setStoredExpansion('/b/project.restorm', ['only-b'])
      expect(await getStoredExpansion('/a/project.restorm')).toEqual(['only-a'])
      expect(await getStoredExpansion('/b/project.restorm')).toEqual(['only-b'])
    })

    it('returns null for garbage / legacy values instead of throwing', async () => {
      await (window as unknown as { api: { storage: { set: (k: string, v: unknown) => Promise<boolean> } } })
        .api.storage.set('restorm-main-sidebar:/legacy.restorm', 'not-an-object')
      const result = await getStoredExpansion('/legacy.restorm')
      expect(result).toBeNull()
    })

    it('is a no-op when filePath is empty', async () => {
      await setStoredExpansion('', ['nope'])
      expect(await getStoredExpansion('')).toBeNull()
    })
  })
})
