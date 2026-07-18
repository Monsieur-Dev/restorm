// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// Mock the reactive reifier so the test runs in a plain node env without
// pulling the electron-core-ui renderer bridge. It records what it was
// handed and echoes it back, so the test can assert reifyItem delegated
// (and never took the old `'items' in r` folder shortcut for a scenario).
const makeReactiveFolderItem = vi.hoisted(() => vi.fn((item: unknown) => item))
vi.mock('../types/reactive', () => ({ makeReactiveFolderItem }))

import { reifyItem, readTreeReplacePayload } from './useMcpTreeReplace'

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
