// @vitest-environment jsdom
/**
 * A project file may carry `items:` with nothing after it — valid YAML that
 * parses to `null`, not to an empty list. Every children walk here used to
 * call `.map` / `.flatMap` on it directly, and the resulting throw took the
 * whole renderer down: a white window, no modal, no error the user could
 * act on. Reached in practice by a hand-written project and by a merge
 * fixture that emptied a folder.
 */
import { describe, it, expect, vi } from 'vitest'

// jsdom implements no editing commands, and the ECUI barrel probes for them
// at import time.
vi.hoisted(() => {
  Object.defineProperty(globalThis.document, 'queryCommandSupported', { value: () => false, configurable: true })
})

import { collectExpandableIds, folderToListViewItems, folderAsRootListViewItem } from './FolderToListView'
import type { Folder, FolderItem } from '../../../shared/types/folderTypes'

const options = { expandedIds: new Set<string>(), renderMethodBadge: () => null }

function folderWithNullItems(): Folder {
  return { id: 'f1', name: 'Empty', tags: [], configuration: {}, items: null } as unknown as Folder
}

describe('a folder whose items parsed to null', () => {
  it('collects no expandable id instead of throwing', () => {
    expect(collectExpandableIds(folderWithNullItems() as unknown as FolderItem)).toEqual(['f1'])
  })

  it('converts to an empty child list', () => {
    expect(folderToListViewItems(folderWithNullItems(), options)).toEqual([])
  })

  it('still renders as a root row', () => {
    expect(folderAsRootListViewItem(folderWithNullItems(), options).id).toBe('f1')
  })

  it('walks a nested null-items folder without throwing', () => {
    const parent = {
      id: 'root', name: 'Root', tags: [], configuration: {},
      items: [folderWithNullItems()]
    } as unknown as FolderItem

    expect(collectExpandableIds(parent)).toEqual(['root', 'f1'])
  })
})
