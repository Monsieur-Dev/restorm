import type { GitHistoryCommit, LaneRow } from './types'

/**
 * Classic first-parent lane assignment (the gitk/GitLens family), NOT a
 * generic DAG layout: a commit inherits its lane from the child that
 * expected it, and its FIRST parent inherits that same lane — so a chain of
 * first parents renders as one straight vertical line. Seeding lane 0 with
 * `mainTipHash` therefore guarantees the product requirement: main/master
 * is a straight vertical, branches curve out of it and back in.
 *
 * `commits` must be in display order (newest first, topologically sorted —
 * `git log --topo-order` output). Unknown parents (shallow edges) simply
 * terminate their lane.
 */
export function computeLaneLayout(commits: GitHistoryCommit[], mainTipHash?: string): LaneRow[] {
  // active[i] = the hash lane i is waiting for (the next commit downward),
  // or null when the lane is free.
  const active: (string | null)[] = []
  if (mainTipHash !== undefined && commits.some((c) => c.hash === mainTipHash)) {
    active[0] = mainTipHash
  }

  const known = new Set(commits.map((c) => c.hash))
  const firstFree = (): number => {
    const i = active.indexOf(null)
    return i === -1 ? active.length : i
  }

  const rows: LaneRow[] = []
  for (const commit of commits) {
    const activeBefore = active.slice()

    const waiting: number[] = []
    for (let i = 0; i < active.length; i++) {
      if (active[i] === commit.hash) waiting.push(i)
    }

    let commitLane: number
    let continuesUp: boolean
    if (waiting.length > 0) {
      commitLane = Math.min(...waiting)
      continuesUp = true
    } else {
      // A branch tip nobody expected — open its own lane.
      commitLane = firstFree()
      continuesUp = false
    }

    // Every other lane that expected this commit converges into the dot.
    const joinLanes = waiting.filter((i) => i !== commitLane)
    for (const i of joinLanes) active[i] = null

    const forkLanes: number[] = []
    let continuesDown = false
    const [firstParent, ...extraParents] = commit.parents
    if (firstParent === undefined) {
      // Root commit: the lane ends here.
      active[commitLane] = null
    } else {
      const existing: number[] = []
      for (let i = 0; i < active.length; i++) {
        if (i !== commitLane && active[i] === firstParent) existing.push(i)
      }
      const leftmostExisting = existing.length > 0 ? Math.min(...existing) : -1
      if (leftmostExisting !== -1 && leftmostExisting < commitLane) {
        // A lane further LEFT already awaits this parent: bend into it —
        // never the other way around, so the leftmost chain (main, seeded
        // on lane 0) always stays a straight vertical.
        active[commitLane] = null
        forkLanes.push(leftmostExisting)
      } else if (known.has(firstParent)) {
        active[commitLane] = firstParent
        continuesDown = true
      } else {
        // Parent outside the loaded window (shallow edge): terminate.
        active[commitLane] = null
      }
    }
    for (const parent of extraParents) {
      const existing: number[] = []
      for (let i = 0; i < active.length; i++) {
        if (active[i] === parent) existing.push(i)
      }
      if (existing.length > 0) {
        forkLanes.push(Math.min(...existing))
      } else if (known.has(parent)) {
        const lane = firstFree()
        active[lane] = parent
        forkLanes.push(lane)
      }
      // Unknown extra parent: drawn as nothing (shallow edge).
    }

    const passLanes: number[] = []
    for (let i = 0; i < activeBefore.length; i++) {
      if (i === commitLane) continue
      if (activeBefore[i] !== null && activeBefore[i] !== commit.hash) passLanes.push(i)
    }

    // Trim trailing free lanes so laneCount stays tight.
    while (active.length > 0 && active[active.length - 1] === null) active.pop()

    const laneCount = Math.max(
      commitLane + 1,
      active.length,
      activeBefore.length,
      ...passLanes.map((l) => l + 1),
      ...joinLanes.map((l) => l + 1),
      ...forkLanes.map((l) => l + 1)
    )

    rows.push({ commitLane, passLanes, joinLanes, forkLanes, continuesDown, continuesUp, laneCount })
  }

  return rows
}
