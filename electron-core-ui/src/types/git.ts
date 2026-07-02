/**
 * Git integration types — the shared contract between GitService (main),
 * the `git:*` IPC surface, and `useGitState()` (renderer).
 *
 * Kept intentionally low-level: GitService only knows about a folder path
 * and raw git plumbing (status / stage / commit / push / pull / conflict
 * blobs). Entity-aware concerns (parsing the single-file YAML project into
 * requests/scenarios/folders, semantic diffing, per-entity conflict
 * rendering) are host-injected at the UI layer — see `docs/Git/README.md`.
 */

/**
 * Simplified per-file working-tree state, derived from simple-git's raw
 * index/working-dir status codes (see `mapFileState` in GitService).
 */
export type GitFileState = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface GitFileEntry {
  /** Path relative to the repository root. */
  path: string
  state: GitFileState
}

/**
 * Raw working-tree status for a repo. `branch` is the current HEAD branch
 * name, or `null` in a detached-HEAD state. `ahead`/`behind` are relative
 * to the branch's upstream (both `0` when there is none).
 */
export interface GitStatus {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileEntry[]
}

/** Outcome of a `commit()` attempt. */
export interface GitCommitResult {
  success: boolean
  /** Commit SHA on success. */
  commit?: string
  error?: string
}

/** Outcome of a `push()` attempt. */
export interface GitPushResult {
  success: boolean
  error?: string
}

/**
 * Outcome of a `pull()` attempt. `conflicted` is the terminal state a
 * pull can stop on: the working tree is left mid-merge and every path in
 * `conflictFiles` needs `writeResolvedConflict()` (or the whole merge
 * needs `abortMerge()`) before anything else touches the repo.
 */
export interface GitPullResult {
  success: boolean
  conflicted: boolean
  conflictFiles: string[]
  error?: string
}

/** Result of a semi-pull (`fetch` + compare, no merge). */
export interface GitFetchCompareResult {
  /** True when the fetch found commits on the remote tracking branch that
   * are not yet present locally. */
  remoteHasNewerVersion: boolean
  behind: number
  error?: string
}

/**
 * The three git-index stages of a conflicted path: `:1` common ancestor
 * (`null` for an add/add conflict, which has none), `:2` ours, `:3`
 * theirs. Each is the raw blob content at that stage, or `null` when the
 * path didn't exist at that stage (e.g. deleted on one side).
 */
export interface GitConflictVersions {
  path: string
  base: string | null
  ours: string | null
  theirs: string | null
}

/** Reactive snapshot broadcast on every `git:state-changed` push. */
export interface GitState {
  /** Whether the active folder is inside a git working tree. */
  isRepo: boolean
  /**
   * False once a `git --version` probe has failed. The check runs once per
   * process lifetime and never flips back to true — a user who installs
   * git after launch needs to restart the app, which is an acceptable
   * one-time toast tradeoff for a background probe.
   */
  gitInstalled: boolean
  /** Null until the first successful status refresh for the active repo. */
  status: GitStatus | null
  /**
   * Set by the folder-watch-triggered semi-pull; true when the remote
   * default branch has commits that haven't been fetched-and-merged
   * locally yet.
   */
  remoteHasNewerVersion: boolean
  /** True while a `pull()` has left the working tree mid-merge with
   * unresolved conflicts. */
  hasConflicts: boolean
}

/** The state before any folder has been activated, or after a `null`
 * `setActiveFolder`. Frozen so a consumer can't mutate the shared default
 * in place. */
export const NO_GIT_STATE: Readonly<GitState> = Object.freeze({
  isRepo: false,
  gitInstalled: true,
  status: null,
  remoteHasNewerVersion: false,
  hasConflicts: false
})
