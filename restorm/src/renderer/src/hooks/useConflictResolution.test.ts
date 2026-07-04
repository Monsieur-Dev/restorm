// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

// `cloneEntityForResolution` reactive-wraps folders/requests via
// `makeReactiveFolderItem`, which transitively imports the full
// `electron-core-ui/renderer` barrel (Monaco — doesn't run in jsdom, see
// `conflictEntityClone.test.ts`'s own note). This suite tests the HOOK's
// state management (selection, resolved-copy tracking, reset-on-new-
// versions), not the reactive-wrapping itself — a plain deep-clone stub
// is enough and keeps the test fast + jsdom-safe.
vi.mock('../services/conflictEntityClone', () => ({
  cloneEntityForResolution: (item: unknown) => structuredClone(item)
}))

import { useConflictResolution } from './useConflictResolution'

afterEach(() => { cleanup() })

const OURS_YAML = [
  'collections:',
  '  - id: r1',
  '    name: Find pet by ID',
  '    type: http',
  '    tags: []',
  '    url: https://ours.example.com',
  '  - id: r2',
  '    name: Other request',
  '    type: http',
  '    tags: []',
  '    url: https://ours.example.com/other',
  '  - id: s1',
  '    name: Checkout flow',
  '    type: scenario',
  '    tags: []',
  '    params: []',
  '    nodes: []',
  '    edges: []'
].join('\n')

const THEIRS_YAML = [
  'collections:',
  '  - id: r1',
  '    name: Find pet by ID',
  '    type: http',
  '    tags: []',
  '    url: https://theirs.example.com',
  '  - id: r2',
  '    name: Other request',
  '    type: http',
  '    tags: []',
  '    url: https://theirs.example.com/other',
  '  - id: s1',
  '    name: Checkout flow',
  '    type: scenario',
  '    tags: []',
  '    params: []',
  '    nodes: [{"id":"n1"}]',
  '    edges: []'
].join('\n')

const VERSIONS = { path: 'api.restorm', base: null, ours: OURS_YAML, theirs: THEIRS_YAML }

describe('useConflictResolution', () => {
  it('identifies both conflicting entities and auto-selects the first one', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    expect(result.current.conflicts.map((c) => c.id)).toEqual(['r1', 'r2', 's1'])
    expect(result.current.selectedConflictId).toBe('r1')
  })

  it('returns null selection and an empty conflict list when there is no active conflict', () => {
    const { result } = renderHook(() => useConflictResolution(null))
    expect(result.current.conflicts).toEqual([])
    expect(result.current.selectedConflictId).toBeNull()
  })

  it('selectConflict moves the selection', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    act(() => { result.current.selectConflict('r2') })
    expect(result.current.selectedConflictId).toBe('r2')
  })

  it('getResolvedEntity defaults to a clone of "ours" for a fresh conflict', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    const resolved = result.current.getResolvedEntity('r1')
    expect(resolved).toMatchObject({ id: 'r1', url: 'https://ours.example.com' })
  })

  it('pickTheirsVersion replaces the resolved copy with a fresh clone of "theirs"', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    act(() => { result.current.pickTheirsVersion('r1') })
    expect(result.current.getResolvedEntity('r1')).toMatchObject({ id: 'r1', url: 'https://theirs.example.com' })
  })

  it('pickOursVersion resets the resolved copy back to "ours" (discarding edits)', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    act(() => { result.current.pickTheirsVersion('r1') })
    act(() => { result.current.pickOursVersion('r1') })
    expect(result.current.getResolvedEntity('r1')).toMatchObject({ id: 'r1', url: 'https://ours.example.com' })
  })

  it('editing the resolved clone of a request does not mutate the ours/theirs snapshots', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    const resolved = result.current.getResolvedEntity('r1') as { name: string }
    resolved.name = 'Edited name'
    const conflict = result.current.conflicts.find((c) => c.id === 'r1')
    expect(conflict?.ours).toMatchObject({ name: 'Find pet by ID' })
    expect(conflict?.theirs).toMatchObject({ name: 'Find pet by ID' })
  })

  it('onScenarioChange patches the scenario\'s resolved copy immutably', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    act(() => { result.current.onScenarioChange('s1', { notes: 'my notes' }) })
    expect(result.current.getResolvedEntity('s1')).toMatchObject({ id: 's1', notes: 'my notes' })
  })

  it('onScenarioChange is a no-op for a non-scenario conflict id', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    const before = result.current.getResolvedEntity('r1')
    act(() => { result.current.onScenarioChange('r1', { notes: 'ignored' }) })
    expect(result.current.getResolvedEntity('r1')).toBe(before)
  })

  it('a new versions object resets the whole session (new conflicts, fresh resolved copies, re-selected first conflict)', () => {
    const { result, rerender } = renderHook(({ v }) => useConflictResolution(v), { initialProps: { v: VERSIONS } })
    act(() => { result.current.selectConflict('r2') })
    act(() => { result.current.pickTheirsVersion('r1') })

    const nextVersions = { path: 'api.restorm', base: null, ours: OURS_YAML, theirs: THEIRS_YAML }
    rerender({ v: nextVersions })

    expect(result.current.selectedConflictId).toBe('r1')
    expect(result.current.getResolvedEntity('r1')).toMatchObject({ url: 'https://ours.example.com' })
  })

  it('pickQuickConfigVersion records a per-config ours/theirs choice, keyed by conflict + config name', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    expect(result.current.quickConfigPicks).toEqual({})
    act(() => { result.current.pickQuickConfigVersion('r1', 'Staging', 'theirs') })
    expect(result.current.quickConfigPicks).toEqual({ r1: { Staging: 'theirs' } })
    // A second config on the same conflict is additive; re-picking overrides.
    act(() => { result.current.pickQuickConfigVersion('r1', 'Prod', 'ours') })
    act(() => { result.current.pickQuickConfigVersion('r1', 'Staging', 'ours') })
    expect(result.current.quickConfigPicks).toEqual({ r1: { Staging: 'ours', Prod: 'ours' } })
  })

  it('a new versions object clears the per-config quick-config picks', () => {
    const { result, rerender } = renderHook(({ v }) => useConflictResolution(v), { initialProps: { v: VERSIONS } })
    act(() => { result.current.pickQuickConfigVersion('r1', 'Staging', 'theirs') })
    expect(result.current.quickConfigPicks).toEqual({ r1: { Staging: 'theirs' } })

    rerender({ v: { path: 'api.restorm', base: null, ours: OURS_YAML, theirs: THEIRS_YAML } })
    expect(result.current.quickConfigPicks).toEqual({})
  })
})
