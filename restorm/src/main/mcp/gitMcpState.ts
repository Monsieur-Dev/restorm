/**
 * In-memory pending-review state for the git MCP routes' 2-step flows —
 * `git_commit_push` → `git_confirm_push` and `git_pull` →
 * `git_resolve_conflicts` (see `tools/git.ts`). A single desktop instance
 * has exactly one active project at a time, so a single pending slot per
 * flow (not keyed by project/session) is enough; a fresh call to the
 * first step of either flow overwrites (invalidates) whatever was
 * pending before it — an agent that started a review and never finished
 * it can't leave stale state an unrelated later call might accidentally
 * match against.
 */

import type { GitEntityChange } from '../../shared/git/gitCommitDiff'
import type { ConflictEntity } from '../../shared/git/gitConflictModel'
import type { GitConflictVersions, GitConflictCommitTimestamps } from 'electron-core-ui'

export interface PendingCommitReview {
  token: string
  gitFolder: string
  relativePath: string
  /** The diff `git_commit_push` computed — re-diffed and compared at
   * `git_confirm_push` time so a project change in between (another MCP
   * write, or a live user edit) can't silently commit something the
   * agent never reviewed. */
  changes: GitEntityChange[]
  title: string
  body: string
}

export interface PendingConflictResolution {
  token: string
  gitFolder: string
  relativePath: string
  versions: GitConflictVersions
  conflicts: ConflictEntity[]
  commitTimestamps: GitConflictCommitTimestamps
}

let pendingCommitReview: PendingCommitReview | null = null
let pendingConflictResolution: PendingConflictResolution | null = null

export function setPendingCommitReview(review: Omit<PendingCommitReview, 'token'>): PendingCommitReview {
  const stored: PendingCommitReview = { ...review, token: crypto.randomUUID() }
  pendingCommitReview = stored
  return stored
}

export function getPendingCommitReview(): PendingCommitReview | null {
  return pendingCommitReview
}

export function clearPendingCommitReview(): void {
  pendingCommitReview = null
}

export function setPendingConflictResolution(pending: Omit<PendingConflictResolution, 'token'>): PendingConflictResolution {
  const stored: PendingConflictResolution = { ...pending, token: crypto.randomUUID() }
  pendingConflictResolution = stored
  return stored
}

export function getPendingConflictResolution(): PendingConflictResolution | null {
  return pendingConflictResolution
}

export function clearPendingConflictResolution(): void {
  pendingConflictResolution = null
}

/** Test-only reset — mirrors `resetGitService`'s naming convention. */
export function resetGitMcpStateForTests(): void {
  pendingCommitReview = null
  pendingConflictResolution = null
}
