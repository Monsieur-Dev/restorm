import { describe, it, expect } from 'vitest'
import { isLargeImport, LARGE_IMPORT_LEAF_THRESHOLD } from './importSelectionHelpers'
import type { FolderItem } from '../../../../shared/types/folderTypes'

/** N minimal HTTP-request leaves, each with a distinct natural key. */
function reqs(n: number): FolderItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    name: `req ${i}`,
    type: 'http',
    method: 'GET',
    url: `/route/${i}`
  })) as unknown as FolderItem[]
}

describe('isLargeImport', () => {
  it('is false for an empty or small preview', () => {
    expect(isLargeImport([])).toBe(false)
    expect(isLargeImport(reqs(10))).toBe(false)
  })

  it('is false exactly at the threshold and true one past it', () => {
    expect(isLargeImport(reqs(LARGE_IMPORT_LEAF_THRESHOLD))).toBe(false)
    expect(isLargeImport(reqs(LARGE_IMPORT_LEAF_THRESHOLD + 1))).toBe(true)
  })

  it('honours a custom threshold', () => {
    expect(isLargeImport(reqs(5), 3)).toBe(true)
    expect(isLargeImport(reqs(3), 3)).toBe(false)
  })

  it('counts routes, not the folders that hold them', () => {
    const folder = {
      id: 'f',
      name: 'Folder',
      configuration: {},
      items: reqs(4)
    } as unknown as FolderItem
    expect(isLargeImport([folder], 3)).toBe(true)
    expect(isLargeImport([folder], 4)).toBe(false)
  })
})
