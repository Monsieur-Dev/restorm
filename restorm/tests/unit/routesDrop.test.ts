import { describe, it, expect } from 'vitest'
import { applyRoutesDrop, canRoutesDrop, type RoutesDropRequest } from '../../src/shared/design/routesDrop'
import type { DesignRoute, DesignRouteGroup } from '../../src/shared/types/apiDesign'

const mkRoute = (id: string): DesignRoute => ({ id, doc: { match: { urlPattern: `/${id}` } } })
const mkGroup = (
  id: string,
  routes: string[] = [],
  opts: { parentId?: string } = {}
): DesignRouteGroup => ({
  id,
  doc: { name: id },
  routes: routes.map(mkRoute),
  ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {})
})

// Root groups A, B; A has routes a1,a2; B has route b1. Plus C nested under A.
const base = (): DesignRouteGroup[] => [
  mkGroup('A', ['a1', 'a2']),
  mkGroup('B', ['b1']),
  mkGroup('C', ['c1'], { parentId: 'A' })
]
const ids = (groups: DesignRouteGroup[] | null): string[] => (groups ?? []).map((g) => g.id)
const parentOf = (groups: DesignRouteGroup[] | null, id: string): string | undefined =>
  (groups ?? []).find((g) => g.id === id)?.parentId
const routesOf = (groups: DesignRouteGroup[] | null, id: string): string[] =>
  (groups ?? []).find((g) => g.id === id)?.routes.map((r) => r.id) ?? []

describe('routesDrop — group reorder / reparent', () => {
  it('reorders a root group before a sibling', () => {
    const next = applyRoutesDrop(base(), { sourceId: 'B', targetId: 'A', position: 'before' })
    // B moves ahead of A; C (nested under A) stays attached to A.
    expect(ids(next)).toEqual(['B', 'A', 'C'])
    expect(parentOf(next, 'B')).toBeUndefined()
  })

  it('reparents a group INTO another (sets parentId, subtree follows)', () => {
    const next = applyRoutesDrop(base(), { sourceId: 'B', targetId: 'A', position: 'into' })
    expect(parentOf(next, 'B')).toBe('A')
    // A still holds C; B is now also a child of A.
    expect(parentOf(next, 'C')).toBe('A')
  })

  it('inherits the target sibling parentId on a before/after reorder', () => {
    // Drop B AFTER the nested C → B joins A as a sibling of C.
    const next = applyRoutesDrop(base(), { sourceId: 'B', targetId: 'C', position: 'after' })
    expect(parentOf(next, 'B')).toBe('A')
  })

  it('promotes a nested group back to root when dropped by a root sibling', () => {
    const next = applyRoutesDrop(base(), { sourceId: 'C', targetId: 'B', position: 'before' })
    expect(parentOf(next, 'C')).toBeUndefined()
  })

  it('refuses a group into itself or a descendant', () => {
    const groups = base()
    expect(canRoutesDrop(groups, { sourceId: 'A', targetId: 'A', position: 'into' })).toBe(false)
    expect(canRoutesDrop(groups, { sourceId: 'A', targetId: 'C', position: 'into' })).toBe(false)
    expect(applyRoutesDrop(groups, { sourceId: 'A', targetId: 'C', position: 'into' })).toBeNull()
  })

  it('never mutates its input', () => {
    const groups = base()
    const snapshot = JSON.stringify(groups)
    applyRoutesDrop(groups, { sourceId: 'B', targetId: 'A', position: 'into' })
    expect(JSON.stringify(groups)).toBe(snapshot)
  })
})

describe('routesDrop — route move / reorder', () => {
  it('moves a route INTO another group (appended)', () => {
    const next = applyRoutesDrop(base(), { sourceId: 'a1', targetId: 'B', position: 'into' })
    expect(routesOf(next, 'A')).toEqual(['a2'])
    expect(routesOf(next, 'B')).toEqual(['b1', 'a1'])
  })

  it('reorders a route before another route in the same group', () => {
    const next = applyRoutesDrop(base(), { sourceId: 'a2', targetId: 'a1', position: 'before' })
    expect(routesOf(next, 'A')).toEqual(['a2', 'a1'])
  })

  it('moves a route across groups, inserted before the anchor', () => {
    const next = applyRoutesDrop(base(), { sourceId: 'b1', targetId: 'a1', position: 'before' })
    expect(routesOf(next, 'A')).toEqual(['b1', 'a1', 'a2'])
    expect(routesOf(next, 'B')).toEqual([])
  })
})

describe('routesDrop — canRoutesDrop validity parity', () => {
  const cases: [string, RoutesDropRequest, boolean][] = [
    ['route before/after a GROUP target is rejected', { sourceId: 'a1', targetId: 'B', position: 'before' }, false],
    ['group before/after a ROUTE target is rejected', { sourceId: 'A', targetId: 'b1', position: 'after' }, false],
    ['route into a group is allowed', { sourceId: 'a1', targetId: 'B', position: 'into' }, true],
    ['unknown source is rejected', { sourceId: 'zzz', targetId: 'A', position: 'into' }, false]
  ]
  it.each(cases)('%s', (_label, req, expected) => {
    expect(canRoutesDrop(base(), req)).toBe(expected)
    // A rejected drop yields no new array.
    if (!expected) expect(applyRoutesDrop(base(), req)).toBeNull()
  })
})
