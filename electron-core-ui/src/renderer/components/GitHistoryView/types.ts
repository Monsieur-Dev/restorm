/** One commit as the history view consumes it — the host maps its own git
 * plumbing (e.g. `git log --all --topo-order` via simple-git) to this shape.
 * `parents` drives the graph topology; everything else is display-only. */
export interface GitHistoryCommit {
  hash: string
  /** Parent hashes, FIRST PARENT FIRST — the first-parent chain is what the
   * lane layout keeps straight. */
  parents: string[]
  subject: string
  body: string
  authorName: string
  authorEmail: string
  /** ISO-8601 author date. */
  date: string
  /** Decoration refs pointing at this commit ("HEAD -> main", "origin/main",
   * "tag: v1.2", …), already split by the host. */
  refs: string[]
}

/** Per-row drawing plan produced by `computeLaneLayout` — everything the SVG
 * gutter needs, precomputed so rendering is a dumb map. */
export interface LaneRow {
  /** Lane of this row's commit dot. */
  commitLane: number
  /** Lanes that pass straight through this row untouched. */
  passLanes: number[]
  /** Lanes whose line ENDS on this commit (children lanes converging in). */
  joinLanes: number[]
  /** Lanes this commit's extra/redirected parents continue on (curves out). */
  forkLanes: number[]
  /** The commit's own lane continues below (first parent tracked in-lane). */
  continuesDown: boolean
  /** The commit's own lane arrives from above (a child expected it). */
  continuesUp: boolean
  /** Lane count to size this row's gutter. */
  laneCount: number
}
