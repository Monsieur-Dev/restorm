import { describe, it, expect } from 'vitest'
import { dynamicHandleIds, pruneOrphanDynamicEdges, isOrphanDynamicEdge } from './orphanEdgeSanitizer'

describe('dynamicHandleIds', () => {
  it('returns property ids + prop- prefix for an object node', () => {
    const dyn = dynamicHandleIds('object', { properties: [{ id: 'prop-a' }, { id: 'prop-b' }] })
    expect(dyn?.prefix).toBe('prop-')
    expect([...(dyn?.ids ?? [])].sort()).toEqual(['prop-a', 'prop-b'])
  })

  it('returns case ids + case- prefix for a switch node', () => {
    const dyn = dynamicHandleIds('switch', { cases: [{ id: 'case-a' }, { id: 'case-b' }] })
    expect(dyn?.prefix).toBe('case-')
    expect([...(dyn?.ids ?? [])].sort()).toEqual(['case-a', 'case-b'])
  })

  it('returns null for a kind that has no dynamic handles', () => {
    expect(dynamicHandleIds('httpRequest', {})).toBeNull()
  })

  it('returns an empty set when the config array is missing or malformed', () => {
    expect(dynamicHandleIds('object', undefined)?.ids.size).toBe(0)
    expect(dynamicHandleIds('object', { properties: 'nope' })?.ids.size).toBe(0)
    expect(dynamicHandleIds('switch', {})?.ids.size).toBe(0)
  })
})

describe('pruneOrphanDynamicEdges', () => {
  it('drops a target-side edge whose prop- handle is no longer declared', () => {
    const edges = [
      { id: 'e1', source: 'src', target: 'obj', sourceHandle: 'response', targetHandle: 'prop-gone' },
      { id: 'e2', source: 'src', target: 'obj', sourceHandle: 'response', targetHandle: 'prop-keep' }
    ]
    const next = pruneOrphanDynamicEdges(edges, 'obj', new Set(['prop-keep']), 'prop-')
    expect(next.map((e) => e.id)).toEqual(['e2'])
  })

  it('drops a source-side edge whose case- handle is no longer declared', () => {
    const edges = [
      { id: 'e1', source: 'sw', target: 'tgt', sourceHandle: 'case-gone', targetHandle: 'in' },
      { id: 'e2', source: 'sw', target: 'tgt', sourceHandle: 'case-keep', targetHandle: 'in' }
    ]
    const next = pruneOrphanDynamicEdges(edges, 'sw', new Set(['case-keep']), 'case-')
    expect(next.map((e) => e.id)).toEqual(['e2'])
  })

  it('keeps edges unrelated to the modified node', () => {
    const edges = [
      { id: 'e1', source: 'other', target: 'obj', sourceHandle: 'response', targetHandle: 'prop-keep' }
    ]
    const next = pruneOrphanDynamicEdges(edges, 'sw', new Set(['case-a']), 'case-')
    expect(next).toEqual(edges)
  })

  it('ignores static handles even when they share the wrong shape', () => {
    // A static handle like `in` / `event` / `response` never starts with prop- /
    // case-, so the prefix guard keeps it untouched.
    const edges = [
      { id: 'e1', source: 'src', target: 'obj', sourceHandle: 'response', targetHandle: 'in' }
    ]
    const next = pruneOrphanDynamicEdges(edges, 'obj', new Set(), 'prop-')
    expect(next).toEqual(edges)
  })
})

describe('isOrphanDynamicEdge', () => {
  const lookup = (m: Record<string, { kind: 'object' | 'switch' | 'httpRequest'; config?: Record<string, unknown> }>) =>
    (id: string) => m[id]

  it('flags a target-side prop- handle removed from an object node', () => {
    const nodes = lookup({
      obj: { kind: 'object', config: { properties: [{ id: 'prop-live' }] } },
      src: { kind: 'httpRequest' }
    })
    expect(isOrphanDynamicEdge(
      { source: 'src', target: 'obj', sourceHandle: 'response', targetHandle: 'prop-gone' }, nodes
    )).toBe(true)
    expect(isOrphanDynamicEdge(
      { source: 'src', target: 'obj', sourceHandle: 'response', targetHandle: 'prop-live' }, nodes
    )).toBe(false)
  })

  it('flags a source-side case- handle removed from a switch node', () => {
    const nodes = lookup({
      sw: { kind: 'switch', config: { cases: [{ id: 'case-live' }] } },
      tgt: { kind: 'httpRequest' }
    })
    expect(isOrphanDynamicEdge(
      { source: 'sw', target: 'tgt', sourceHandle: 'case-gone', targetHandle: 'in' }, nodes
    )).toBe(true)
    expect(isOrphanDynamicEdge(
      { source: 'sw', target: 'tgt', sourceHandle: 'case-live', targetHandle: 'in' }, nodes
    )).toBe(false)
  })

  it('does not flag a static handle that happens to be missing from a dynamic-kind node', () => {
    const nodes = lookup({
      obj: { kind: 'object', config: { properties: [] } },
      src: { kind: 'httpRequest' }
    })
    expect(isOrphanDynamicEdge(
      { source: 'src', target: 'obj', sourceHandle: 'response', targetHandle: 'in' }, nodes
    )).toBe(false)
  })

  it('ignores edges whose endpoint node is gone (handled by other validation)', () => {
    const nodes = lookup({})
    expect(isOrphanDynamicEdge(
      { source: 'src-gone', target: 'tgt-gone', sourceHandle: 'response', targetHandle: 'prop-x' }, nodes
    )).toBe(false)
  })
})
