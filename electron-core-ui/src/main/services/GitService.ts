import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { isAbsolute, join, relative, resolve } from 'path'
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git'
import { watch as watchPaths, type FSWatcher } from 'chokidar'
import { logger } from './LoggerService'
import type {
  GitState,
  GitStatus,
  GitFileEntry,
  GitFileState,
  GitCommitResult,
  GitPushResult,
  GitPullResult,
  GitFetchCompareResult,
  GitConflictVersions,
  GitConflictCommitTimestamps
} from '../../types/git'
import { NO_GIT_STATE } from '../../types/git'

/** Debounce window for folder-watch-triggered refreshes, tunable per host. */
const DEFAULT_WATCH_DEBOUNCE_MS = 500

export interface GitServiceConfig {
  /** Debounce window (ms) between a `.git` change and the resulting
   * status refresh + semi-pull. Defaults to 500ms. */
  watchDebounceMs?: number
}

/**
 * Map simple-git's raw per-file status codes to the app-facing
 * {@link GitFileState}. `status.conflicted` is the ground truth for
 * conflicts (an unmerged path can carry several different raw code
 * combinations depending on the conflict type) — checked first.
 */
function mapFileState(file: { path: string; index: string; working_dir: string }, conflicted: string[]): GitFileState {
  if (conflicted.includes(file.path)) return 'conflicted'
  if (file.index === '?' && file.working_dir === '?') return 'untracked'
  if (file.index === 'A') return 'added'
  if (file.index === 'D' || file.working_dir === 'D') return 'deleted'
  if (file.index === 'R') return 'renamed'
  return 'modified'
}

function toGitStatus(result: StatusResult): GitStatus {
  const files: GitFileEntry[] = result.files.map((f) => ({
    path: f.path,
    state: mapFileState(f, result.conflicted)
  }))
  return { branch: result.current, ahead: result.ahead, behind: result.behind, files }
}

/**
 * Generic git plumbing on top of `simple-git`. Operates on a single
 * "active folder" at a time (mirrors `FileService`'s single active file —
 * a Restorm project is one YAML file, so there is exactly one candidate
 * repo folder open at once). Callers pass the folder explicitly on every
 * primitive so the service stays reusable for one-off calls (e.g. the
 * MCP routes) that don't go through the active-folder lifecycle at all.
 *
 * Entity-aware concerns (parsing the project file, semantic diffing,
 * per-entity conflict rendering) are NOT this service's job — see
 * `docs/Git/README.md` for the injection boundary.
 */
export class GitService {
  private readonly config: Required<GitServiceConfig>
  private activeFolder: string | null = null
  private state: GitState = { ...NO_GIT_STATE }
  private watcher: FSWatcher | null = null
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  private gitInstalledChecked = false
  private cliMissingToastFired = false
  private readonly stateChangeCallbacks = new Set<(state: GitState) => void>()
  private readonly cliMissingCallbacks = new Set<() => void>()
  private readonly pullAvailableCallbacks = new Set<() => void>()

  constructor(config: GitServiceConfig = {}) {
    this.config = { watchDebounceMs: config.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS }
  }

  private git(folder: string): SimpleGit {
    return simpleGit({ baseDir: folder })
  }

  // ==========================================================================
  // System git (AC5)
  // ==========================================================================

  /**
   * Probe `git --version` once per process lifetime. On failure, flips
   * `state.gitInstalled` to false and fires the one-time `git:cli-missing`
   * broadcast (the renderer turns it into a toast — see
   * `useGitCliMissingToast`). Only `isGitRepo` routes through this
   * directly, but that's the primitive `refresh()` always calls first on
   * `setActiveFolder` — so the probe fires on every repo activation
   * without needing to be duplicated in every other primitive, which can
   * assume it has already run by the time they're reachable through the
   * normal active-folder lifecycle. Callers that invoke a primitive
   * directly (bypassing `setActiveFolder`, e.g. a one-off MCP call) get a
   * plain ENOENT from the spawned process instead — acceptable since that
   * path already requires the caller to know the folder is a repo.
   */
  private async ensureGitInstalled(): Promise<boolean> {
    if (this.gitInstalledChecked) return this.state.gitInstalled
    this.gitInstalledChecked = true
    try {
      await simpleGit().raw(['--version'])
      return true
    } catch (error) {
      logger.warn('[GitService] git CLI not found on PATH', { error: String(error) })
      this.state = { ...this.state, gitInstalled: false }
      this.notifyStateChange()
      if (!this.cliMissingToastFired) {
        this.cliMissingToastFired = true
        this.notifyCliMissing()
      }
      return false
    }
  }

  // ==========================================================================
  // Primitives (AC1)
  // ==========================================================================

  /** Whether `folder` is inside a git working tree (any ancestor, not just
   * the tree root). */
  public async isGitRepo(folder: string): Promise<boolean> {
    if (!(await this.ensureGitInstalled())) return false
    try {
      return await this.git(folder).checkIsRepo()
    } catch (error) {
      logger.warn('[GitService] isGitRepo failed', { folder, error: String(error) })
      return false
    }
  }

  public async getStatus(folder: string): Promise<GitStatus> {
    const result = await this.git(folder).status()
    return toGitStatus(result)
  }

  public async stage(folder: string, paths: string[]): Promise<void> {
    await this.git(folder).add(paths)
  }

  public async commit(folder: string, message: string): Promise<GitCommitResult> {
    try {
      const result = await this.git(folder).commit(message)
      return { success: true, commit: result.commit }
    } catch (error) {
      logger.error('[GitService] commit failed', { folder, error: String(error) })
      return { success: false, error: String(error) }
    }
  }

  public async push(folder: string): Promise<GitPushResult> {
    try {
      await this.git(folder).push()
      return { success: true }
    } catch (error) {
      logger.error('[GitService] push failed', { folder, error: String(error) })
      return { success: false, error: String(error) }
    }
  }

  /**
   * Pull from the upstream of the current branch. When the merge stops on
   * conflicts, `git pull` exits non-zero and simple-git rejects — the
   * version-agnostic way to recover the conflict list is to re-read
   * `status()` afterwards rather than parse the rejected error shape.
   */
  public async pull(folder: string): Promise<GitPullResult> {
    try {
      await this.git(folder).pull()
      return { success: true, conflicted: false, conflictFiles: [] }
    } catch (error) {
      const status = await this.git(folder).status().catch(() => null)
      const conflictFiles = status?.conflicted ?? []
      if (conflictFiles.length > 0) {
        return { success: false, conflicted: true, conflictFiles }
      }
      logger.error('[GitService] pull failed', { folder, error: String(error) })
      return { success: false, conflicted: false, conflictFiles: [], error: String(error) }
    }
  }

  /** Semi-pull: fetch the remote without merging, then compare. Used by the
   * folder watch here and by the CRON schedule / check-on-open added on
   * top of this foundation. */
  public async fetchAndCompare(folder: string): Promise<GitFetchCompareResult> {
    try {
      await this.git(folder).fetch()
      const status = await this.git(folder).status()
      return { remoteHasNewerVersion: status.behind > 0, behind: status.behind }
    } catch (error) {
      logger.warn('[GitService] fetchAndCompare failed', { folder, error: String(error) })
      return { remoteHasNewerVersion: false, behind: 0, error: String(error) }
    }
  }

  /**
   * True when `filePath`, joined against `folder`, resolves to a path
   * strictly inside `folder` (or `folder` itself). Rejects `..`
   * traversal and absolute overrides. `filePath` on the conflict-blob
   * and conflict-resolution primitives is caller-supplied — the MCP
   * `git_resolve_conflicts` route (built on top of this service) will
   * eventually feed it LLM-generated paths, so the containment check
   * belongs here at the plumbing layer rather than trusting every
   * future caller to re-derive it. Mirrors `PersistenceService`'s
   * `isPathWithin`.
   */
  private isPathWithinFolder(folder: string, filePath: string): boolean {
    const target = resolve(folder, filePath)
    const rel = relative(resolve(folder), target)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }

  /** Read the three git-index stages of a conflicted path. A missing stage
   * (e.g. no common ancestor on an add/add conflict) resolves to `null`
   * rather than rejecting the whole call. */
  public async getConflictVersions(folder: string, filePath: string): Promise<GitConflictVersions> {
    if (!this.isPathWithinFolder(folder, filePath)) {
      throw new Error(`getConflictVersions: filePath escapes the repo folder: ${filePath}`)
    }
    const showStage = async (stage: 1 | 2 | 3): Promise<string | null> => {
      try {
        return await this.git(folder).show([`:${stage}:${filePath}`])
      } catch {
        return null
      }
    }
    const [base, ours, theirs] = await Promise.all([showStage(1), showStage(2), showStage(3)])
    return { path: filePath, base, ours, theirs }
  }

  /**
   * Read `filePath`'s content at the last commit (`HEAD`), for a normal
   * (non-conflicted) repo — the "before" side of a before/after diff
   * (e.g. a commit-message generator comparing the working tree against
   * what's already committed). Distinct from `getConflictVersions`, which
   * only makes sense mid-merge. Resolves to `null` when the path doesn't
   * exist at `HEAD` yet (a brand-new, never-committed file) rather than
   * rejecting.
   */
  public async getFileAtHead(folder: string, filePath: string): Promise<string | null> {
    if (!this.isPathWithinFolder(folder, filePath)) {
      throw new Error(`getFileAtHead: filePath escapes the repo folder: ${filePath}`)
    }
    try {
      return await this.git(folder).show([`HEAD:${filePath}`])
    } catch {
      return null
    }
  }

  /** Write the user's resolved content to disk and stage it (marks the
   * conflict resolved from git's point of view). Finalising the merge
   * (committing) is a separate `commit()` call once every conflict in the
   * pull's `conflictFiles` has been written. */
  public async writeResolvedConflict(folder: string, filePath: string, content: string): Promise<void> {
    if (!this.isPathWithinFolder(folder, filePath)) {
      throw new Error(`writeResolvedConflict: filePath escapes the repo folder: ${filePath}`)
    }
    await writeFile(join(folder, filePath), content, 'utf-8')
    await this.git(folder).add([filePath])
  }

  /** Commit timestamps (Unix seconds) for the two sides of an in-progress
   * merge conflict — `HEAD` (ours) and `MERGE_HEAD` (theirs). Either
   * resolves to `null` if the ref can't be read (e.g. `MERGE_HEAD` absent
   * outside a merge) rather than rejecting the whole call — a caller using
   * this as a tie-breaker should treat `null` as "no signal", not an
   * error. */
  public async getConflictCommitTimestamps(folder: string): Promise<GitConflictCommitTimestamps> {
    const commitTime = async (ref: string): Promise<number | null> => {
      try {
        const raw = await this.git(folder).show([`--no-patch`, `--format=%ct`, ref])
        const seconds = Number(raw.trim())
        return Number.isFinite(seconds) ? seconds : null
      } catch {
        return null
      }
    }
    const [ours, theirs] = await Promise.all([commitTime('HEAD'), commitTime('MERGE_HEAD')])
    return { ours, theirs }
  }

  public async abortMerge(folder: string): Promise<void> {
    await this.git(folder).merge(['--abort'])
  }

  // ==========================================================================
  // Active folder + watch (AC3, AC4)
  // ==========================================================================

  /**
   * Set the folder whose git state is tracked + watched. Restorm's
   * injection point: the host maps "the file the user has open" to "its
   * containing folder" and calls this on every `file:opened` /
   * `file:closed` — GitService itself has no notion of a project file.
   * Passing `null` clears the active folder and stops watching.
   *
   * Check-on-open: once the repo status is known, run the semi-pull check
   * immediately (awaited, not fire-and-forget) so a newly-opened file that
   * already has a newer remote version surfaces the pull-available toast
   * right away, rather than waiting for the next watch event or CRON tick.
   * `checkForRemoteUpdate()` itself gates on `isRepo`, so this is a no-op
   * for a non-git folder.
   */
  public async setActiveFolder(folder: string | null): Promise<void> {
    if (folder === this.activeFolder) return
    this.stopWatching()
    this.activeFolder = folder
    if (!folder) {
      this.state = { ...NO_GIT_STATE, gitInstalled: this.state.gitInstalled }
      this.notifyStateChange()
      return
    }
    await this.refresh()
    if (this.state.isRepo) this.startWatching(folder)
    await this.checkForRemoteUpdate()
  }

  public getActiveFolder(): string | null {
    return this.activeFolder
  }

  private async refresh(): Promise<void> {
    const folder = this.activeFolder
    if (!folder) return
    const isRepo = await this.isGitRepo(folder)
    if (!isRepo) {
      this.state = { ...this.state, isRepo: false, status: null, hasConflicts: false }
      this.notifyStateChange()
      return
    }
    const status = await this.getStatus(folder)
    this.state = {
      ...this.state,
      isRepo: true,
      status,
      hasConflicts: status.files.some((f) => f.state === 'conflicted')
    }
    this.notifyStateChange()
  }

  /**
   * Watch the handful of `.git` paths that actually signal a state
   * change (`HEAD` for branch switches, `index` for stage/commit,
   * `refs/**` for local + fetched-remote branch moves) — NOT the whole
   * `.git` tree, which would also recurse into `objects/**` (hundreds of
   * loose-object dirs that churn on every commit/gc for no signal we
   * care about).
   *
   * Known limitation: in a `git worktree` checkout, `folder/.git` is a
   * FILE (a `gitdir: …` pointer to the real, shared `.git` elsewhere),
   * not a directory — `existsSync` still passes, but `HEAD`/`index`/
   * `refs` never exist under it, so the watcher silently sees nothing
   * and only the folder-open-time `refresh()` fires (no live updates
   * until the next semi-pull / manual action). Resolving the real
   * per-worktree git dir (read the pointer file, watch its
   * `HEAD`/`index` there, and the shared `refs`/`objects` at the common
   * dir) is a follow-up, not implemented here.
   */
  private startWatching(folder: string): void {
    const gitDir = join(folder, '.git')
    if (!existsSync(gitDir)) return
    const targets = [join(gitDir, 'HEAD'), join(gitDir, 'index'), join(gitDir, 'refs')]
    this.watcher = watchPaths(targets, { ignoreInitial: true })
    const trigger = (): void => {
      if (this.watchTimer) clearTimeout(this.watchTimer)
      this.watchTimer = setTimeout(() => {
        void this.refresh()
        void this.checkForRemoteUpdate()
      }, this.config.watchDebounceMs)
    }
    this.watcher.on('all', trigger)
  }

  private stopWatching(): void {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer)
      this.watchTimer = null
    }
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }
  }

  /**
   * Run the semi-pull check against the active folder and fold the result
   * into reactive state — the single implementation shared by the folder
   * watch (91.1), check-on-open, and the CRON schedule (`GitSemiPullController`,
   * 91.6), so "only when the folder is a git dir" (AC#3) is enforced here
   * once rather than duplicated in every caller. A no-op when there is no
   * active folder or the active folder isn't a repo — safe to call
   * unconditionally on a timer.
   *
   * Fires the one-shot `git:pull-available` broadcast (see
   * `onPullAvailable`) only on the false→true EDGE of `remoteHasNewerVersion`
   * — a caller polling on a schedule while the flag is already true (the
   * user hasn't pulled yet) must not re-toast on every tick.
   */
  public async checkForRemoteUpdate(): Promise<void> {
    const folder = this.activeFolder
    if (!folder || !this.state.isRepo) return
    const result = await this.fetchAndCompare(folder)
    if (this.state.remoteHasNewerVersion !== result.remoteHasNewerVersion) {
      this.state = { ...this.state, remoteHasNewerVersion: result.remoteHasNewerVersion }
      this.notifyStateChange()
      if (result.remoteHasNewerVersion) this.notifyPullAvailable()
    }
  }

  // ==========================================================================
  // Reactive state (AC3)
  // ==========================================================================

  public getState(): GitState {
    return { ...this.state }
  }

  public onStateChanged(callback: (state: GitState) => void): () => void {
    this.stateChangeCallbacks.add(callback)
    return () => {
      this.stateChangeCallbacks.delete(callback)
    }
  }

  public onCliMissing(callback: () => void): () => void {
    this.cliMissingCallbacks.add(callback)
    return () => {
      this.cliMissingCallbacks.delete(callback)
    }
  }

  /** Fires on every false→true edge of `state.remoteHasNewerVersion` (see
   * `checkForRemoteUpdate`) — the renderer turns it into a toast offering
   * the real pull (`useGitPullAvailableToast`). Unlike `onCliMissing`,
   * this can fire more than once per process lifetime: pull, then a later
   * remote commit re-arms the edge. */
  public onPullAvailable(callback: () => void): () => void {
    this.pullAvailableCallbacks.add(callback)
    return () => {
      this.pullAvailableCallbacks.delete(callback)
    }
  }

  private notifyStateChange(): void {
    const state = this.getState()
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(state)
      } catch (error) {
        logger.error('[GitService] state change callback threw', { error: String(error) })
      }
    }
    this.broadcastEvent('git:state-changed', state)
  }

  private notifyCliMissing(): void {
    for (const callback of this.cliMissingCallbacks) {
      try {
        callback()
      } catch (error) {
        logger.error('[GitService] cli-missing callback threw', { error: String(error) })
      }
    }
    this.broadcastEvent('git:cli-missing')
  }

  private notifyPullAvailable(): void {
    for (const callback of this.pullAvailableCallbacks) {
      try {
        callback()
      } catch (error) {
        logger.error('[GitService] pull-available callback threw', { error: String(error) })
      }
    }
    this.broadcastEvent('git:pull-available')
  }

  private broadcastEvent(channel: string, ...args: unknown[]): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, ...args)
      }
    }
  }

  /** Test-only: release the watcher/timer without waiting for GC. */
  public dispose(): void {
    this.stopWatching()
  }
}

let gitServiceInstance: GitService | null = null

/** Get (and lazily create) the singleton GitService instance. Unlike
 * `FileService`, no host config is required — every primitive takes its
 * folder explicitly — so there is no separate `initGitService()` step. */
export function getGitService(config?: GitServiceConfig): GitService {
  gitServiceInstance ??= new GitService(config)
  return gitServiceInstance
}

/** Test-only: drop the singleton so the next `getGitService()` call
 * constructs a fresh instance. */
export function resetGitService(): void {
  gitServiceInstance?.dispose()
  gitServiceInstance = null
}
