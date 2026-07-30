// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useRef } from 'react'

// Mock the reactive reifier so the test runs without pulling the
// electron-core-ui renderer bridge. It records what it was handed and
// echoes it back, so the test can assert reifyItem delegated (and never
// took the old `'items' in r` folder shortcut for a scenario).
const makeReactiveFolderItem = vi.hoisted(() => vi.fn((item: unknown) => item))
vi.mock('../types/reactive', () => ({ makeReactiveFolderItem }))

import { reifyItem, readTreeReplacePayload, useMcpTreeReplace } from './useMcpTreeReplace'
import type { FolderItem } from '../../../shared/types/collections'

describe('readTreeReplacePayload', () => {
  it('reads the versioned `{ items, mcpVersion }` payload', () => {
    expect(readTreeReplacePayload({ items: [{ id: 'a' }], mcpVersion: 7 }))
      .toEqual({ items: [{ id: 'a' }], mcpVersion: 7 })
  })

  it('tolerates a bare array (version 0)', () => {
    expect(readTreeReplacePayload([{ id: 'a' }])).toEqual({ items: [{ id: 'a' }], mcpVersion: 0 })
  })

  it('defaults a missing / non-numeric version to 0', () => {
    expect(readTreeReplacePayload({ items: [] })).toEqual({ items: [], mcpVersion: 0 })
    expect(readTreeReplacePayload({ items: [], mcpVersion: 'nope' })).toEqual({ items: [], mcpVersion: 0 })
  })

  it('rejects a malformed payload', () => {
    expect(readTreeReplacePayload(null)).toBeNull()
    expect(readTreeReplacePayload({ nope: true })).toBeNull()
    expect(readTreeReplacePayload('x')).toBeNull()
  })
})

describe('reifyItem', () => {
  it('delegates a top-level scenario to makeReactiveFolderItem (not mangled into a folder)', () => {
    const scenario = { id: 's1', name: 'Flow', type: 'scenario', items: [], configuration: {}, nodes: [{ id: 'n1' }], edges: [] }
    const out = reifyItem(scenario)
    expect(makeReactiveFolderItem).toHaveBeenCalledWith(scenario)
    // The scenario's graph data must survive (the old code dropped nodes/edges).
    expect((out as { nodes?: unknown[] }).nodes).toEqual([{ id: 'n1' }])
  })

  it('reifies folders and requests', () => {
    expect(reifyItem({ id: 'f', name: 'F', items: [], configuration: {} })).toBeTruthy()
    expect(reifyItem({ id: 'r', name: 'R', type: 'http' })).toBeTruthy()
  })

  it('drops malformed / unrecognised entries', () => {
    expect(reifyItem(null)).toBeNull()
    expect(reifyItem('nope')).toBeNull()
    expect(reifyItem({ random: true })).toBeNull()
  })
})

describe('useMcpTreeReplace — rootItemsRef synchronous write', () => {
  type TreeReplaceCb = (payload: unknown) => void
  let treeReplaceCb: TreeReplaceCb | null = null

  afterEach(() => {
    cleanup()
    treeReplaceCb = null
    ;(window as unknown as { restorm?: unknown }).restorm = undefined
  })

  function mountHook(): { rootItemsRef: { current: FolderItem[] }; setRootItems: ReturnType<typeof vi.fn> } {
    const setRootItems = vi.fn()
    const { result } = renderHook(() => {
      const rootItemsRef = useRef<FolderItem[]>([])
      useMcpTreeReplace({
        setRootItems,
        rootItemsRef,
        mcpDrivenRef: useRef(false),
        lastMcpVersionRef: useRef(0),
        bumpAllTabContentVersions: vi.fn(),
        pruneOrphanTabs: vi.fn()
      })
      return rootItemsRef
    })
    return { rootItemsRef: result.current, setRootItems }
  }

  it('writes the fresh tree into rootItemsRef.current synchronously, inside the same handler call that also invokes setRootItems', () => {
    ;(window as unknown as { restorm: unknown }).restorm = {
      runtime: {
        onMcpTreeReplace: (cb: TreeReplaceCb) => { treeReplaceCb = cb; return () => { treeReplaceCb = null } }
      }
    }
    const { rootItemsRef, setRootItems } = mountHook()
    expect(treeReplaceCb).not.toBeNull()
    expect(rootItemsRef.current).toEqual([])

    treeReplaceCb?.({ items: [{ id: 'r1', name: 'r1', type: 'http' }], mcpVersion: 1 })

    // `renderHook` never re-rendered (no `rerender()` call, no `act()` needed
    // to flush a commit) — reading `.current` right after the handler
    // returns is the whole point: a same-tick `mcp:open-tab` consumer would
    // see exactly this.
    expect(rootItemsRef.current).toEqual([{ id: 'r1', name: 'r1', type: 'http' }])
    expect(setRootItems).toHaveBeenCalledWith([{ id: 'r1', name: 'r1', type: 'http' }])
  })
})
