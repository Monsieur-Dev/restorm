import { describe, it, expect, vi, afterEach } from 'vitest'

const { makeReactiveFolderItemMock } = vi.hoisted(() => ({
  makeReactiveFolderItemMock: vi.fn((item: unknown) => item)
}))

// `makeReactiveFolderItem` wraps in a Proxy that emits real DocumentEvents
// on the app-wide event bus (see reactive.ts) — out of scope for this unit
// test (covered by reactive.ts's own suite); mock it as a passthrough spy,
// same pattern as useMcpTreeReplace.test.ts.
vi.mock('../types/reactive', () => ({ makeReactiveFolderItem: makeReactiveFolderItemMock }))

import { cloneEntityForResolution } from './conflictEntityClone'
import type { Folder } from '../../../shared/types/folderTypes'
import type { Scenario } from '../../../shared/types/scenario'

afterEach(() => { vi.clearAllMocks() })

function makeFolder(): Folder {
  return { id: 'f1', name: 'My Folder', tags: [], configuration: {}, items: [] } as unknown as Folder
}

function makeScenario(): Scenario {
  return { id: 's1', name: 'Flow', type: 'scenario', tags: [], params: [], nodes: [], edges: [] } as unknown as Scenario
}

describe('cloneEntityForResolution', () => {
  it('produces an independent deep clone — mutating the clone never touches the original', () => {
    const original = makeFolder()
    const clone = cloneEntityForResolution(original) as Folder
    clone.name = 'Renamed'
    expect(original.name).toBe('My Folder')
    expect(clone.name).toBe('Renamed')
    expect(clone).not.toBe(original)
  })

  it('reactive-wraps folders/requests via makeReactiveFolderItem (the same mechanism the live tree uses)', () => {
    const original = makeFolder()
    cloneEntityForResolution(original)
    expect(makeReactiveFolderItemMock).toHaveBeenCalledTimes(1)
    expect(makeReactiveFolderItemMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', name: 'My Folder' }))
  })

  it('does NOT reactive-wrap scenarios — they are controlled via onScenarioChange, not proxy mutation', () => {
    const original = makeScenario()
    const clone = cloneEntityForResolution(original) as Scenario
    expect(makeReactiveFolderItemMock).not.toHaveBeenCalled()
    expect(clone).toEqual(original)
    expect(clone).not.toBe(original)
  })
})
