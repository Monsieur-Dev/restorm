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

  it('getResolvedEntity yields nothing until a side is picked, then a clone of it', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    // Nothing is decided for the user: an untouched conflict has no answer.
    expect(result.current.getResolvedEntity('r1')).toBeNull()
    act(() => { result.current.pickOursVersion('r1') })
    expect(result.current.getResolvedEntity('r1')).toMatchObject({ id: 'r1', url: 'https://ours.example.com' })
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
    // A resolved copy only exists once a side has been picked.
    act(() => { result.current.pickOursVersion('r1') })
    act(() => { result.current.pickOursVersion('s1') })
    const resolved = result.current.getResolvedEntity('r1') as { name: string }
    resolved.name = 'Edited name'
    const conflict = result.current.conflicts.find((c) => c.id === 'r1')
    expect(conflict?.ours).toMatchObject({ name: 'Find pet by ID' })
    expect(conflict?.theirs).toMatchObject({ name: 'Find pet by ID' })
  })

  it('onScenarioChange patches the scenario\'s resolved copy immutably', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    // Editing presupposes a decision: the resolved column shows a prompt,
    // not an editable copy, until a side has been picked.
    act(() => { result.current.pickOursVersion('s1') })
    act(() => { result.current.onScenarioChange('s1', { notes: 'my notes' }) })
    expect(result.current.getResolvedEntity('s1')).toMatchObject({ id: 's1', notes: 'my notes' })
  })

  it('onScenarioChange is a no-op for a non-scenario conflict id', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    const before = result.current.getResolvedEntity('r1')
    act(() => { result.current.onScenarioChange('r1', { notes: 'ignored' }) })
    expect(result.current.getResolvedEntity('r1')).toBe(before)
  })

  it('a new versions object resets the whole session (conflicts, decisions and selection)', () => {
    const { result, rerender } = renderHook(({ v }) => useConflictResolution(v), { initialProps: { v: VERSIONS } })
    act(() => { result.current.selectConflict('r2') })
    act(() => { result.current.pickTheirsVersion('r1') })

    const nextVersions = { path: 'api.restorm', base: null, ours: OURS_YAML, theirs: THEIRS_YAML }
    rerender({ v: nextVersions })

    expect(result.current.selectedConflictId).toBe('r1')
    // A new pull is a new session: every decision from the previous one is
    // dropped, so nothing carries over as already-answered.
    expect(result.current.getResolvedEntity('r1')).toBeNull()
    expect(result.current.allResolved).toBe(false)
  })

  it('pickQuickConfigVersion records a per-config ours/theirs choice, keyed by conflict + config name', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    // Nothing is resolved until a side is picked — seed the picks this
    // test's assertions assume.
    act(() => { result.current.pickOursVersion('r1') })
    act(() => { result.current.pickOursVersion('r2') })
    act(() => { result.current.pickOursVersion('s1') })
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

  it('pickedSideById derives from equality: the fresh resolved copy (= ours) greens "user", a theirs pick flips to "server"', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    // Nothing is resolved until a side is picked — seed the picks this
    // test's assertions assume.
    act(() => { result.current.pickOursVersion('r1') })
    act(() => { result.current.pickOursVersion('r2') })
    act(() => { result.current.pickOursVersion('s1') })
    expect(result.current.pickedSideById['r1']).toBe('user')
    act(() => { result.current.pickTheirsVersion('r1') })
    expect(result.current.pickedSideById['r1']).toBe('server')
  })

  it('a hand edit re-derives the checks: a divergent edit clears both, editing back into equality with a side re-greens it', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    // Nothing is resolved until a side is picked — seed the picks this
    // test's assertions assume.
    act(() => { result.current.pickOursVersion('r1') })
    act(() => { result.current.pickOursVersion('r2') })
    act(() => { result.current.pickOursVersion('s1') })
    const resolved = result.current.getResolvedEntity('r1') as { url: string }
    resolved.url = 'https://neither.example.com'
    act(() => { result.current.onResolvedEdited('r1') })
    expect(result.current.pickedSideById['r1']).toBeNull()
    resolved.url = 'https://theirs.example.com'
    act(() => { result.current.onResolvedEdited('r1') })
    expect(result.current.pickedSideById['r1']).toBe('server')
  })

  it('scenario conflicts derive equality from the graph + notes (no field diff exists for them)', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))
    // Nothing is resolved until a side is picked — seed the picks this
    // test's assertions assume.
    act(() => { result.current.pickOursVersion('r1') })
    act(() => { result.current.pickOursVersion('r2') })
    act(() => { result.current.pickOursVersion('s1') })
    expect(result.current.pickedSideById['s1']).toBe('user')
    act(() => { result.current.pickTheirsVersion('s1') })
    expect(result.current.pickedSideById['s1']).toBe('server')
    act(() => { result.current.onScenarioChange('s1', { notes: 'diverged' }) })
    expect(result.current.pickedSideById['s1']).toBeNull()
  })
})

describe('a session starts undecided', () => {
  it('resolves nothing up front, and reports itself incomplete', () => {
    // Pre-seeding the resolved column with a clone of `ours` made the
    // choice look already made: the user could finish without ever opening
    // the list and silently publish our side of every conflict they never
    // looked at.
    const { result } = renderHook(() => useConflictResolution(VERSIONS))

    expect(result.current.getResolvedEntity('r1')).toBeNull()
    expect(result.current.isResolved('r1')).toBe(false)
    expect(result.current.allResolved).toBe(false)
  })

  it('becomes complete only once EVERY conflict has been decided', () => {
    const { result } = renderHook(() => useConflictResolution(VERSIONS))

    act(() => { result.current.pickOursVersion('r1') })
    expect(result.current.isResolved('r1')).toBe(true)
    // Two of the three still open — finishing must stay blocked.
    expect(result.current.allResolved).toBe(false)

    act(() => { result.current.pickTheirsVersion('r2') })
    act(() => { result.current.pickOursVersion('s1') })
    expect(result.current.allResolved).toBe(true)
  })
})
