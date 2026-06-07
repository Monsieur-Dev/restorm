import { describe, it, expect } from 'vitest'
import type { ReactFlowState } from '@xyflow/react'
import { selectHasHttpInScope } from './retryHttpScope'

/**
 * `selectHasHttpInScope` decides whether the retry box reveals its HTTP-status
 * conditions: they only bite when an httpRequest is in the retried body, i.e.
 * forward-reachable from the `attempt` port — NOT off the retry's own
 * `done`/`exhausted` continuation.
 */

interface E { source: string; sourceHandle?: string; target: string }

function makeState(nodes: Record<string, string>, edges: E[]): ReactFlowState {
  const nodeLookup = new Map(Object.entries(nodes).map(([id, kind]) => [id, { data: { kind } }]))
  return { edges, nodeLookup } as unknown as ReactFlowState
}

describe('selectHasHttpInScope', () => {
  it('is true when an httpRequest sits directly off `attempt`', () => {
    const s = makeState(
      { retry: 'retry', http: 'httpRequest' },
      [{ source: 'retry', sourceHandle: 'attempt', target: 'http' }]
    )
    expect(selectHasHttpInScope('retry')(s)).toBe(true)
  })

  it('is true when the httpRequest is several hops downstream of `attempt`', () => {
    const s = makeState(
      { retry: 'retry', cast: 'cast', obj: 'object', http: 'httpRequest' },
      [
        { source: 'retry', sourceHandle: 'attempt', target: 'cast' },
        { source: 'cast', target: 'obj' },
        { source: 'obj', target: 'http' }
      ]
    )
    expect(selectHasHttpInScope('retry')(s)).toBe(true)
  })

  it('is false when the body holds no httpRequest (throw-only)', () => {
    const s = makeState(
      { retry: 'retry', thr: 'throw' },
      [{ source: 'retry', sourceHandle: 'attempt', target: 'thr' }]
    )
    expect(selectHasHttpInScope('retry')(s)).toBe(false)
  })

  it('ignores an httpRequest wired off the retry continuation (`done`, not `attempt`)', () => {
    const s = makeState(
      { retry: 'retry', thr: 'throw', http: 'httpRequest' },
      [
        { source: 'retry', sourceHandle: 'attempt', target: 'thr' },
        { source: 'retry', sourceHandle: 'done', target: 'http' }
      ]
    )
    expect(selectHasHttpInScope('retry')(s)).toBe(false)
  })

  it('terminates on a cycle back through the retry node', () => {
    const s = makeState(
      { retry: 'retry', a: 'cast', b: 'object' },
      [
        { source: 'retry', sourceHandle: 'attempt', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
        { source: 'b', target: 'retry' }
      ]
    )
    expect(selectHasHttpInScope('retry')(s)).toBe(false)
  })
})
