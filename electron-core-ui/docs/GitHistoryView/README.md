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
  /**
   * Restore the open file to a past commit's content. Wired to the row's
   * right-click "recover this version" entry; the host owns the actual
   * checkout-file-at-revision + re-hydrate. Omitting it hides the entry.
   * Active on every row, including the commit the working copy is
   * currently at — that's the row a user needs to undo a prior recover
   * and return to the checked-out version.
   */
  onRecoverVersion?: (hash: string) => void
  /**
   * Formats an ISO commit date for display. Defaults to a raw
   * `toLocaleString` when omitted, so consumers without a custom format
   * (e.g. `demo/`) keep working unchanged. A host app with a
   * user-configurable date/time format setting should inject a formatter
   * here — the library never reads a host-specific setting itself.
   */
  formatDate?: (iso: string) => string
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
  <GitHistoryView
    commits={commits}
    mainTipHash={mainTip?.hash}
    // Right-click a commit → "recover this version". The host restores the
    // open file to that revision in the WORKING TREE (uncommitted) and
    // re-hydrates its editor — `window.api.git.recoverFileAtRevision` does
    // the checkout; a normal commit + push is left to the user.
    onRecoverVersion={(hash) => host.recoverOpenFileAt(hash)}
    // Optional: render dates per a host setting instead of the raw
    // toLocaleString fallback (e.g. an app-level "date format" preference).
    formatDate={(iso) => formatUserDate(new Date(iso))}
  />
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

## Lane colors

The gutter cycles through 7 theme variables — `--git-lane-1` … `--git-lane-7`,
defined in `resources/themes/base.yaml` — applied via CSS classes
(`.ecui-git-history-lane-1` … `-7` in `gitHistoryView.css`, each setting
`stroke`/`fill`) rather than literal colors in the component. A lane's class
is `ecui-git-history-lane-{(lane % 7) + 1}`. Theme families override only the
lanes that would otherwise be unreadable on their background (see the
`_base.yaml` of the affected family) — most families inherit the base palette
unchanged.

## i18n keys

`gitHistory.commits`, `gitHistory.noCommitSelected`, `gitHistory.author`,
`gitHistory.date`, `gitHistory.hash`, `gitHistory.parents` — present in all
27 locales.
