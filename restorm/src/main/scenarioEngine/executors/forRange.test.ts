// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { forExecutor } from './timeAndFlowExecutors'
import type { ExecResult } from '../types'

function runFor(config: Record<string, unknown>, inputs: Record<string, unknown> = {}): ExecResult {
  const act = { nodeId: 'f', kind: 'for', scope: [], inputs } as never
  const ctx = {
    node: { id: 'f', kind: 'for', config, inputs: [], outputs: [], position: { x: 0, y: 0 } },
    variables: new Map<string, unknown>(),
    log: () => undefined
  } as never
  return forExecutor(act, ctx) as ExecResult
}

function itemsOf(res: ExecResult): unknown[] {
  const sa = (res as { scopeAction?: { items?: unknown[] } }).scopeAction
  return sa?.items ?? []
}

describe('forExecutor — range building', () => {
  it('builds a normal ascending range', () => {
    expect(itemsOf(runFor({ from: 0, to: 5, step: 1, operator: '<' }))).toEqual([0, 1, 2, 3, 4])
  })

  it('wired inputs win over config', () => {
    expect(itemsOf(runFor({ from: 0, to: 2, step: 1, operator: '<' }, { to: 4 }))).toEqual([0, 1, 2, 3])
  })

  it('throws (does not silently truncate) when the range exceeds the iteration cap', () => {
    // 0..1e9 step 1 would clip to 100k silently before; now it throws.
    expect(() => runFor({ from: 0, to: 1_000_000_000, step: 1, operator: '<' })).toThrow(/iteration limit/)
  })
})
