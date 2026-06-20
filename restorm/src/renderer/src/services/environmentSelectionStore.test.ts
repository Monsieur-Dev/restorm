import { describe, it, expect, beforeEach } from 'vitest'
import {
  setStoredFolderEnv,
  getStoredFolderEnv,
  setStoredRequestOverride,
  getStoredRequestOverride
} from './environmentSelectionStore'

// In-memory storage with a deliberate async delay on get, so two
// concurrent read-mutate-write cycles would race (and the second clobber
// the first) if the store didn't serialise them.
const store = new Map<string, unknown>()
function installStorage(): void {
  const api = {
    get: async (key: string): Promise<unknown> => {
      await new Promise((r) => setTimeout(r, 5))
      const v = store.get(key)
      // return a fresh copy so a writer can't mutate the stored object in place
      return v && typeof v === 'object' ? { ...v } : v
    },
    set: (key: string, value: unknown): Promise<boolean> => {
      store.set(key, value)
      return Promise.resolve(true)
    },
    delete: (key: string): Promise<boolean> => {
      store.delete(key)
      return Promise.resolve(true)
    }
  }
  ;(globalThis as unknown as { window: { api: { storage: typeof api } } }).window = { api: { storage: api } }
}

describe('environmentSelectionStore — serialized writes', () => {
  beforeEach(() => {
    store.clear()
    installStorage()
  })

  it('does not lose a folder write under concurrency', async () => {
    await Promise.all([
      setStoredFolderEnv('proj', 'folderA', 'envA'),
      setStoredFolderEnv('proj', 'folderB', 'envB')
    ])
    expect(await getStoredFolderEnv('proj', 'folderA')).toBe('envA')
    expect(await getStoredFolderEnv('proj', 'folderB')).toBe('envB')
  })

  it('does not lose a request override under concurrency', async () => {
    await Promise.all([
      setStoredRequestOverride('proj', 'r1', 'e1'),
      setStoredRequestOverride('proj', 'r2', 'e2'),
      setStoredRequestOverride('proj', 'r3', 'e3')
    ])
    expect(await getStoredRequestOverride('proj', 'r1')).toBe('e1')
    expect(await getStoredRequestOverride('proj', 'r2')).toBe('e2')
    expect(await getStoredRequestOverride('proj', 'r3')).toBe('e3')
  })

  it('last write wins for the same key (sequential semantics preserved)', async () => {
    await Promise.all([
      setStoredFolderEnv('proj', 'folderA', 'first'),
      setStoredFolderEnv('proj', 'folderA', 'second')
    ])
    expect(await getStoredFolderEnv('proj', 'folderA')).toBe('second')
  })
})
