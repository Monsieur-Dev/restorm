// @vitest-environment jsdom
/**
 * The whole behaviour is an EDGE detection, and an edge detection is exactly
 * the kind of thing a later refactor breaks silently: clearing on every render
 * while a run is live would undo a selection the user makes DURING the run,
 * and clearing on the wrong transition would never fire at all. These assert
 * the edge, not just the happy path.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDeselectOnRunStart, type ScenarioRunState } from './useDeselectOnRunStart'

interface Node { id: string; selected?: boolean }

/** Drive the hook through a sequence of engine states over a node list, and
 * report every array the hook committed. */
function drive(states: ScenarioRunState[], initial: Node[]): { nodes: Node[]; commits: Node[][] } {
  let nodes = initial
  const commits: Node[][] = []
  const setNodes = vi.fn((updater: (current: Node[]) => Node[]) => {
    nodes = updater(nodes)
    commits.push(nodes)
  })
  const [first, ...rest] = states
  if (first === undefined) throw new Error('drive() needs at least one engine state')
  const { rerender } = renderHook(
    ({ state }: { state: ScenarioRunState }) => { useDeselectOnRunStart<Node>(state, setNodes) },
    { initialProps: { state: first } }
  )
  for (const state of rest) rerender({ state })
  return { nodes, commits }
}

describe('useDeselectOnRunStart', () => {
  it('clears the selection when a run starts', () => {
    const { nodes, commits } = drive(['idle', 'running'], [{ id: 'a', selected: true }, { id: 'b' }])
    expect(commits).toHaveLength(1)
    expect(nodes).toEqual([{ id: 'a', selected: false }, { id: 'b' }])
  })

  it('clears it for a run armed in step mode, which starts paused', () => {
    const { nodes } = drive(['idle', 'paused'], [{ id: 'a', selected: true }])
    expect(nodes).toEqual([{ id: 'a', selected: false }])
  })

  it('does NOT clear again while the run is in flight', () => {
    // Stepping flips running↔paused repeatedly; a box the user selects mid-run
    // must survive it.
    const { commits } = drive(['idle', 'running', 'paused', 'running', 'paused'], [{ id: 'a', selected: true }])
    expect(commits).toHaveLength(1)
  })

  it('clears again on the NEXT run', () => {
    const { commits } = drive(['idle', 'running', 'completed', 'running'], [{ id: 'a', selected: true }])
    expect(commits).toHaveLength(2)
  })

  it('leaves the array identity alone when nothing is selected', () => {
    // A fresh array here would re-render every box at the moment the run needs
    // the frame budget most.
    const initial = [{ id: 'a' }, { id: 'b' }]
    const { nodes, commits } = drive(['idle', 'running'], initial)
    expect(commits).toHaveLength(1)
    expect(nodes).toBe(initial)
  })

  it('stays out of the way while the engine is idle or finished', () => {
    const { commits } = drive(['idle', 'completed', 'failed', 'cancelled', 'idle'], [{ id: 'a', selected: true }])
    expect(commits).toHaveLength(0)
  })
})
