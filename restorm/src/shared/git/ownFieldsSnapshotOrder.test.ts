import { describe, it, expect } from 'vitest'
import { ownFieldsSnapshot } from './gitCommitDiff'
import type { FolderItem } from '../types/folderTypes'

describe('ownFieldsSnapshot is order-independent', () => {
  it('treats two field orders of the same entity as identical', () => {
    // The project file is rewritten on every save and comes back with a
    // different key order; that must never read as an edit.
    const a = { id: 'r1', type: 'http', name: 'Req', url: 'https://x', tags: [] } as unknown as FolderItem
    const b = { name: 'Req', tags: [], url: 'https://x', id: 'r1', type: 'http' } as unknown as FolderItem
    expect(ownFieldsSnapshot(a)).toBe(ownFieldsSnapshot(b))
  })

  it('still reports a real content change', () => {
    const a = { id: 'r1', name: 'Req', url: 'https://x' } as unknown as FolderItem
    const b = { id: 'r1', name: 'Req', url: 'https://y' } as unknown as FolderItem
    expect(ownFieldsSnapshot(a)).not.toBe(ownFieldsSnapshot(b))
  })

  it('keeps array order significant (header order is content)', () => {
    const a = { id: 'r1', headers: [{ key: 'A' }, { key: 'B' }] } as unknown as FolderItem
    const b = { id: 'r1', headers: [{ key: 'B' }, { key: 'A' }] } as unknown as FolderItem
    expect(ownFieldsSnapshot(a)).not.toBe(ownFieldsSnapshot(b))
  })
})
