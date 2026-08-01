import { describe, it, expect } from 'vitest'
import { snapshotMirrorPayload } from './mirrorPayload'
import type { FolderItem } from '../../../shared/types/collections'

function envFolder(id: string): FolderItem {
  return { id, name: id, folderType: 'environment', items: [], tags: [], configuration: {}, environments: [] } as unknown as FolderItem
}

function plainFolder(id: string): FolderItem {
  return { id, name: id, items: [], tags: [], configuration: {} } as unknown as FolderItem
}

describe('snapshotMirrorPayload', () => {
  it('keeps only environment folders', () => {
    const payload = snapshotMirrorPayload([envFolder('a'), plainFolder('b'), envFolder('c')], 0)
    expect(payload.collections.map((c) => c.id)).toEqual(['a', 'c'])
  })

  // The stale-render case this exists for: an empty tree rendered at version 0
  // while main has since moved to 3. Its stamp must stay 0 so main's
  // strictly-older comparison refuses it, instead of 3 < 3 accepting an empty
  // tree over a populated one.
  it('keeps the version it was built from, so a stale tree stays refusable', () => {
    const stale = snapshotMirrorPayload([], 0)
    expect(stale.builtFromVersion).toBe(0)
    expect(stale.builtFromVersion).toBeLessThan(3)
  })

  it('carries the current version for a tree rendered after the replace', () => {
    const fresh = snapshotMirrorPayload([envFolder('a')], 3)
    expect(fresh.builtFromVersion).toBe(3)
    expect(fresh.collections).toHaveLength(1)
  })
})
