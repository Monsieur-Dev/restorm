import { describe, it, expect, beforeEach, vi } from 'vitest'
import { copySidebarItems, readSidebarClipboard, hasSidebarClipboard, resetSidebarClipboard } from './sidebarClipboard'
import type { FolderItem } from '../../../shared/types/collections'

const fakeRequest = { id: 'r1', name: 'req', type: 'http', url: 'https://x', method: 'GET', headers: [], params: [] } as unknown as FolderItem

describe('sidebarClipboard', () => {
  beforeEach(() => {
    resetSidebarClipboard()
    vi.restoreAllMocks()
  })

  it('copy stages the serialised items in the in-memory cache even when the system clipboard write is denied', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.reject(new Error('denied'))),
        readText: vi.fn(() => Promise.reject(new Error('denied')))
      }
    })
    expect(hasSidebarClipboard()).toBe(false)
    copySidebarItems([fakeRequest])
    expect(hasSidebarClipboard()).toBe(true)
    // The read falls back on the cache when the clipboard read is denied.
    const items = await readSidebarClipboard()
    expect(items).not.toBeNull()
    expect((items?.[0] as { name?: string }).name).toBe('req')
  })

  it('read prefers a marked envelope from the system clipboard (cross-window paste)', async () => {
    const envelope = JSON.stringify({ kind: 'restorm-items', items: [{ id: 'other', name: 'from-elsewhere' }] })
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.resolve()),
        readText: vi.fn(() => Promise.resolve(envelope))
      }
    })
    const items = await readSidebarClipboard()
    expect((items?.[0] as { name?: string }).name).toBe('from-elsewhere')
  })

  it('a non-restorm clipboard text falls back to the cache', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.resolve()),
        readText: vi.fn(() => Promise.resolve('just some text'))
      }
    })
    copySidebarItems([fakeRequest])
    const items = await readSidebarClipboard()
    expect((items?.[0] as { name?: string }).name).toBe('req')
  })
})
