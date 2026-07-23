import { describe, it, expect } from 'vitest'
import { computeLaneLayout } from './laneLayout'
import type { GitHistoryCommit } from './types'

function at<T>(items: T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`missing row ${index}`)
  return item
}

function commit(hash: string, parents: string[], refs: string[] = []): GitHistoryCommit {
  return { hash, parents, subject: hash, body: '', authorName: 'a', authorEmail: 'a@b', date: '2026-01-01T00:00:00Z', refs }
}

describe('computeLaneLayout', () => {
  it('renders a linear history as one straight lane-0 line', () => {
    const rows = computeLaneLayout([
      commit('c3', ['c2']),
      commit('c2', ['c1']),
      commit('c1', [])
    ], 'c3')
    expect(rows.map((r) => r.commitLane)).toEqual([0, 0, 0])
    expect(rows.map((r) => r.laneCount)).toEqual([1, 1, 1])
    expect(at(rows, 0)).toMatchObject({ continuesUp: true, continuesDown: true })
    expect(at(rows, 2)).toMatchObject({ continuesUp: true, continuesDown: false })
  })

  it('keeps main straight on lane 0 while a merged branch curves out and back', () => {
    // main: m3 ← m2 ← m1 ; feature f1 forked from m1, merged in m3.
    const rows = computeLaneLayout([
      commit('m3', ['m2', 'f1']),
      commit('f1', ['m1']),
      commit('m2', ['m1']),
      commit('m1', [])
    ], 'm3')
    const [m3, f1, m2, m1] = [at(rows, 0), at(rows, 1), at(rows, 2), at(rows, 3)]
    expect(m3.commitLane).toBe(0)
    expect(m3.forkLanes).toEqual([1])            // merge edge out to the feature lane
    expect(f1.commitLane).toBe(1)                // feature lives on lane 1
    expect(f1.passLanes).toEqual([0])            // main passes straight beside it
    // main still expects m2 at this row, so the feature lane runs parallel
    // and converges later, at the common ancestor's dot.
    expect(f1.continuesDown).toBe(true)
    expect(f1.forkLanes).toEqual([])
    expect(m2.commitLane).toBe(0)
    expect(m2.passLanes).toEqual([1])
    expect(m1.commitLane).toBe(0)
    expect(m1.joinLanes).toEqual([1])            // the feature lane ends on the ancestor
  })

  it('a branch tip nobody expected opens its own lane (detached work)', () => {
    const rows = computeLaneLayout([
      commit('main2', ['main1']),
      commit('wild1', ['main1']),
      commit('main1', [])
    ], 'main2')
    expect(at(rows, 0).commitLane).toBe(0)
    expect(at(rows, 1).commitLane).toBe(1)
    expect(at(rows, 1).continuesUp).toBe(false)
    // main ALREADY awaits main1 here, so the wild tip bends straight into
    // the main lane (short branch, no parallel run).
    expect(at(rows, 1).forkLanes).toEqual([0])
    expect(at(rows, 1).continuesDown).toBe(false)
    expect(at(rows, 2).commitLane).toBe(0)
    expect(at(rows, 2).joinLanes).toEqual([])
  })

  it('terminates lanes on parents outside the loaded window (shallow edge)', () => {
    const rows = computeLaneLayout([commit('tip', ['missing'])], 'tip')
    expect(at(rows, 0).continuesDown).toBe(false)
    expect(at(rows, 0).forkLanes).toEqual([])
  })

  it('reuses freed lanes instead of growing forever', () => {
    // Two successive short-lived branches must reuse lane 1.
    const rows = computeLaneLayout([
      commit('m4', ['m3', 'b2']),
      commit('b2', ['m3']),
      commit('m3', ['m2', 'b1']),
      commit('b1', ['m2']),
      commit('m2', ['m1']),
      commit('m1', [])
    ], 'm4')
    expect(at(rows, 1).commitLane).toBe(1)  // b2
    expect(at(rows, 3).commitLane).toBe(1)  // b1 reuses lane 1
    expect(Math.max(...rows.map((r) => r.laneCount))).toBe(2)
  })
})
