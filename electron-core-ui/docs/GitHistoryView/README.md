# GitHistoryView

Generic git-history master/detail view: a commit list (newest first) with a
row-aligned graph lanes gutter on the left, and the selected commit's full
details on the right, separated by a resizable vertical sash.

## Overview

The component is pure display: the host feeds it commits from its own git
plumbing (e.g. `GitService.log`, which wraps `git log --all --topo-order`)
and owns any action taken on a commit. The graph is NOT a generic DAG
layout: `computeLaneLayout` implements the classic first-parent lane
assignment (the gitk/GitLens family), so the chain seeded on lane 0 —
main/master via `mainTipHash` — always renders as one straight vertical
line, with branches curving out of it and back in.

## Installation

```typescript
import { GitHistoryView, computeLaneLayout } from 'electron-core-ui/renderer'
import type { GitHistoryCommit, GitHistoryViewProps, LaneRow } from 'electron-core-ui/renderer'
```

## Props

```typescript
export interface GitHistoryViewProps {
  /** Commits newest-first in topological order (`git log --all --topo-order`). */
  commits: GitHistoryCommit[]
  /** Hash of the main/master tip — seeds lane 0 so that chain renders as a
   * straight vertical line. */
  mainTipHash?: string
  /** Initial selection; defaults to the first (newest) commit. */
  initialSelectedHash?: string
  'data-testid'?: string
}

export interface GitHistoryCommit {
  hash: string
  /** Parent hashes, FIRST PARENT FIRST — drives the lane layout. */
  parents: string[]
  subject: string
  body: string
  authorName: string
  authorEmail: string
  /** ISO-8601 author date. */
  date: string
  /** Decoration refs ("HEAD -> main", "origin/main", "tag: v1", …). */
  refs: string[]
}
```

## Usage

```tsx
const entries = await window.api.git.log(gitFolder)
const commits = entries.map(toGitHistoryCommit)
const mainTip = commits.find((c) => c.refs.some((r) => /(^|\/|\s)(main|master)$/.test(r)))

<Modal isOpen={open} onClose={close} title={t('git.historyTitle')}>
  <GitHistoryView commits={commits} mainTipHash={mainTip?.hash} />
</Modal>
```

## Lane layout (`computeLaneLayout`)

Exported separately for testing and for hosts that want to render the graph
themselves. Rules:

- a commit takes the leftmost lane that awaits it; other awaiting lanes
  converge into its dot (`joinLanes`);
- its FIRST parent keeps the same lane (straight chains), unless a lane
  further LEFT already awaits that parent — then the line bends into it
  (`forkLanes`), never the other way around, which is what keeps the
  leftmost/main chain straight;
- extra parents (merges) open or join lanes to the right;
- parents outside the loaded window (shallow edges) terminate their lane;
- freed lanes are reused, keeping the gutter narrow.

## i18n keys

`gitHistory.commits`, `gitHistory.noCommitSelected`, `gitHistory.author`,
`gitHistory.date`, `gitHistory.hash`, `gitHistory.parents` — present in all
27 locales.
