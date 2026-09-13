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

import { collectExpandableIds, folderToListViewItems, folderAsRootListViewItem, folderItemToListViewItem } from './FolderToListView'
import type { Folder, FolderItem } from '../../../shared/types/folderTypes'
import type { RecordingSession } from '../../../shared/types/recordingSession'
import { recordingNodeRowId } from '../../../shared/recording/recordingSections'

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

describe('a recording session row', () => {
  function session(items?: FolderItem[]): RecordingSession {
    return { type: 'recording', id: 'rec-1', name: 'Petstore session', url: 'http://localhost:8080/', protocols: ['http'], whitelist: [], blacklist: [], ...(items ? { items } : {}) }
  }

  it('expands into the virtual captures + routes rows — no browser row while idle', () => {
    const row = folderItemToListViewItem(session(), { ...options, expandedIds: new Set(['rec-1']) })
    expect(row.id).toBe('rec-1')
    expect(row.isExpandable).toBe(true)
    expect(row.isExpanded).toBe(true)
    expect(row.children?.map((c) => c.id)).toEqual([recordingNodeRowId('rec-1', 'captures'), recordingNodeRowId('rec-1', 'routes')])
    // Draggable onto the workbench (side-by-side open), never moved in the tree.
    expect(row.children?.every((c) => c.draggable === true)).toBe(true)
  })

  it('hangs the deduced routes under the routes row', () => {
    const request = { type: 'http', id: 'r1', name: 'GET pets', method: 'GET', url: 'http://localhost:8080/api/pets', headers: [], params: [] } as unknown as FolderItem
    const row = folderItemToListViewItem(session([request]), { ...options, expandedIds: new Set(['rec-1', recordingNodeRowId('rec-1', 'routes')]) })
    const routes = row.children?.find((c) => c.id === recordingNodeRowId('rec-1', 'routes'))
    expect(routes?.isExpandable).toBe(true)
    expect(routes?.children?.map((c) => c.id)).toEqual(['r1'])
  })

  it('is always expandable, and its routes row joins the expandable ids once routes exist', () => {
    expect(collectExpandableIds(session())).toEqual(['rec-1'])
    const request = { type: 'http', id: 'r1', name: 'GET pets', url: 'http://x' } as unknown as FolderItem
    expect(collectExpandableIds(session([request]))).toEqual(['rec-1', recordingNodeRowId('rec-1', 'routes')])
  })
})
