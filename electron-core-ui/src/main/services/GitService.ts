import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
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
  GitResetResult,
  GitPullResult,
  GitFetchCompareResult,
  GitConflictVersions,
  GitConflictCommitTimestamps
, GitLogEntry} from '../../types/git'
import { NO_GIT_STATE } from '../../types/git'

/** Debounce window for folder-watch-triggered refreshes, tunable per host. */
const DEFAULT_WATCH_DEBOUNCE_MS = 500

/**
 * Ceiling on a single background `fetch` inside {@link GitService.fetchAndCompare}.
 * That call runs unattended (folder watch, check-on-open, the semi-pull
 * CRON) and holds this folder's serialization queue (see `withFolderLock`)
 * while it's in flight — an unresponsive remote must not wedge every other
 * git operation on this folder behind it forever. User-driven operations
 * (`pull`, `push`, `commit`, …) are left unbounded on purpose: a hang there
 * is already visible to the user (a pending UI action), whereas a hung
 * background fetch would silently freeze unrelated operations with no
 * on-screen indication anything is wrong.
 */
const FETCH_TIMEOUT_MS = 10_000

/** Rejects with a timeout error if `promise` hasn't settled within `timeoutMs`.
 * Doesn't cancel the underlying operation (simple-git/git has no cancellation
 * hook) — it only bounds how long this promise makes its caller wait. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, timedOut])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

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
 * a host project is one YAML file, so there is exactly one candidate
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
  /** Shallow watcher on the folder ROOT (depth 0, `.git` excluded) — a
   * working-tree write (an autosave of the project file, or an external
   * editor touching it) changes `git status` without touching any of the
   * `.git` signal paths the main watcher targets, and would otherwise
   * leave the app's git state (push pastille / disabled push button)
   * stale until the next open or manual action. */
  private rootWatcher: FSWatcher | null = null
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  private gitInstalledChecked = false
  private cliMissingToastFired = false
  private readonly stateChangeCallbacks = new Set<(state: GitState) => void>()
  private readonly cliMissingCallbacks = new Set<() => void>()
  private readonly pullAvailableCallbacks = new Set<() => void>()

  /**
   * Per-folder serialization queue. Every primitive that runs a real `git`
   * process on a folder (the 12 methods below that call `this.git(folder)`)
   * goes through {@link withFolderLock} keyed on that folder — two git
   * invocations against the same working tree at once is how a background
   * fetch (folder watch, check-on-open, the semi-pull CRON) can corrupt an
   * explicit user-driven pull's outcome (a fetched ref moving mid-pull, or a
   * bare git ref-update rejection). Different folders never contend — the
   * map holds one entry per folder ever touched and is deliberately never
   * pruned: a session opens a handful of folders at most, and a stale
   * entry is just an already-settled promise (the next operation on that
   * folder chains behind it instantly, at zero cost) — far simpler and
   * safer than precisely detecting "is this folder done for good".
   */
  private readonly folderLocks = new Map<string, Promise<unknown>>()

  constructor(config: GitServiceConfig = {}) {
    this.config = { watchDebounceMs: config.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS }
  }

  private git(folder: string): SimpleGit {
    // HARD guard: an empty or relative folder would make simple-git fall
    // back to `process.cwd()` — in dev/e2e that is the SOURCE REPOSITORY,
    // and a stray commit/push then lands on the development branch (this
    // actually happened: an e2e run committed seed-file churn into the
    // app's own branch). No caller legitimately passes a relative folder.
    if (!isAbsolute(folder)) {
      throw new Error(`[GitService] refusing non-absolute git folder "${folder}" — a git operation must never fall back to process.cwd()`)
    }
    // Strip inherited GIT_* environment overrides (GIT_DIR, GIT_WORK_TREE,
    // GIT_INDEX_FILE, …): a host app launched FROM a git hook (or any
    // git-spawned context) inherits them, and git then targets THAT
    // repository regardless of `baseDir` — the e2e suite running under the
    // repo's pre-push hook actually committed into the app's own source
    // branch through this. `baseDir` must be the single source of truth.
    // SSH_ASKPASS is stripped too: simple-git REFUSES an explicit env that
    // carries it (allowUnsafeAskPass safety) — and a git-hook context
    // exports it alongside GIT_DIR, which broke isGitRepo → the whole GIT
    // UI read as "not a repo".
    const cleanedEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'SSH_ASKPASS')
    ) as Record<string, string>
    // Never let git stop to ask for credentials. A push to a remote whose
    // token expired would otherwise sit forever on a prompt no window
    // shows — and since every operation on a folder queues behind the
    // previous one, that single hung process takes the whole Git UI down
    // for the rest of the session. Failing fast turns it into an error
    // message the push flow already knows how to surface.
    // Set AFTER the filter above on purpose: this is OUR value, not an
    // inherited one, and it is the only GIT_* var we want git to see.
    cleanedEnv['GIT_TERMINAL_PROMPT'] = '0'
    return simpleGit({ baseDir: folder }).env(cleanedEnv)
  }

  /**
   * Run `operation` after every previously-queued operation on the same
   * folder has settled, whether that prior operation succeeded or failed.
   * A hand-rolled promise chain rather than a lock object: no acquire/
   * release pairing to get wrong, no risk of a caller forgetting to
   * release. `operation` itself must not call back into `withFolderLock`
   * for the SAME folder (it would deadlock, awaiting a queue slot behind
   * itself) — none of the 12 primitives below call each other, so this
   * never nests. Orchestrators (`refresh`, `checkForRemoteUpdate`,
   * `setActiveFolder`) are safe too: they `await` one locked primitive to
   * completion (releasing the queue) before calling the next, never
   * holding the queue across two primitive calls.
   */
  private withFolderLock<T>(folder: string, operation: () => Promise<T>): Promise<T> {
    const key = resolve(folder)
    const previous = this.folderLocks.get(key) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    // The stored tail must settle right after `operation` does (so the
    // NEXT queued operation waits exactly as long as this one takes) but
    // must never itself reject — a rejection would otherwise reject every
    // future `.then` chained onto it for this folder, permanently wedging
    // the queue after the first failure.
    this.folderLocks.set(key, result.catch(() => undefined))
    return result
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
    // Filesystem pre-check before touching the git CLI: a folder with no `.git`
    // in any ancestor is not a repo, so there is no reason to probe git for it.
    // This also keeps the one-time "git isn't installed" notice from firing
    // when the user simply opens a file outside any repository — the probe (and
    // its toast) only run once we know git could actually apply here.
    if (!this.hasGitAncestor(folder)) return false
    if (!(await this.ensureGitInstalled())) return false
    return this.withFolderLock(folder, async () => {
      try {
        return await this.git(folder).checkIsRepo()
      } catch (error) {
        logger.warn('[GitService] isGitRepo failed', { folder, error: String(error) })
        return false
      }
    })
  }

  /**
   * Walk up from `folder` looking for a `.git` entry — a directory in a normal
   * clone, a file in a worktree or submodule. Purely filesystem: it never
   * spawns git, so it is safe when the git CLI is absent.
   */
  private hasGitAncestor(folder: string): boolean {
    let dir = resolve(folder)
    for (;;) {
      if (existsSync(join(dir, '.git'))) return true
      const parent = resolve(dir, '..')
      if (parent === dir) return false
      dir = parent
    }
  }

  public async getStatus(folder: string): Promise<GitStatus> {
    return this.withFolderLock(folder, async () => {
      const result = await this.git(folder).status()
      return toGitStatus(result)
    })
  }

  public async stage(folder: string, paths: string[]): Promise<void> {
    await this.withFolderLock(folder, () => this.git(folder).add(paths))
  }

  /**
   * simple-git's `commit()` doesn't always reject when there's nothing
   * staged — depending on the installed git/simple-git version, a
   * no-op commit (nothing added since the last commit) can resolve with
   * an EMPTY `result.commit` instead of throwing. Treat that as a
   * failure explicitly rather than trusting the promise's resolution:
   * every caller (the Push modal, the MCP `git_confirm_push` route)
   * reports `success` straight to the user/agent as "it's committed" —
   * a false positive there is a silent no-op passed off as a real
   * write.
   */
  /**
   * Commit, optionally restricted to explicit paths.
   *
   * Without `paths` this commits whatever the index holds — including
   * files the user staged themselves in a terminal, which the app has no
   * business publishing. Passing the project file scopes the commit to it
   * and leaves everything else in the working tree untouched.
   */
  public async commit(folder: string, message: string, paths?: string[]): Promise<GitCommitResult> {
    return this.withFolderLock(folder, async () => {
      try {
        const result = paths && paths.length > 0
          ? await this.git(folder).commit(message, paths)
          : await this.git(folder).commit(message)
        if (!result.commit) {
          return { success: false, error: 'Nothing to commit — no changes are staged.' }
        }
        return { success: true, commit: result.commit }
      } catch (error) {
        logger.error('[GitService] commit failed', { folder, error: String(error) })
        return { success: false, error: String(error) }
      }
    })
  }

  /** Full history for the history view: every ref, topologically ordered
   * (newest first). Field/record separators are control chars so no commit
   * message can break the parse. */
  public async log(folder: string): Promise<GitLogEntry[]> {
    return this.withFolderLock(folder, async () => {
      const FIELD = String.fromCharCode(31)
      const RECORD = String.fromCharCode(30)
      const format = ['%H', '%P', '%an', '%ae', '%aI', '%D', '%s', '%b'].join(`%x1f`)
      const raw = await this.git(folder).raw([
        'log', '--all', '--topo-order', '--date=iso-strict', `--pretty=format:${format}%x1e`
      ])
      const entries: GitLogEntry[] = []
      for (const record of raw.split(RECORD)) {
        const trimmed = record.replace(/^\n/, '')
        if (trimmed.trim() === '') continue
        const [hash, parents, authorName, authorEmail, date, refs, subject, body = ''] = trimmed.split(FIELD)
        if (!hash) continue
        entries.push({
          hash,
          parents: (parents ?? '').split(' ').filter((p) => p !== ''),
          authorName: authorName ?? '',
          authorEmail: authorEmail ?? '',
          date: date ?? '',
          refs: (refs ?? '').split(',').map((r) => r.trim()).filter((r) => r !== ''),
          subject: subject ?? '',
          body: body
        })
      }
      return entries
    })
  }

  public async push(folder: string): Promise<GitPushResult> {
    return this.withFolderLock(folder, async () => {
      try {
        const status = await this.git(folder).status()
        if (status.tracking) {
          await this.git(folder).push()
        } else {
          // First publish of a freshly-initialised branch: no upstream is
          // configured yet, so a bare `git push` refuses outright ("The
          // current branch <b> has no upstream branch"). Do what git's own
          // hint says — push once with --set-upstream so this and every
          // later push just work.
          await this.git(folder).push(['--set-upstream', 'origin', status.current ?? 'main'])
        }
        return { success: true }
      } catch (error) {
        logger.error('[GitService] push failed', { folder, error: String(error) })
        return { success: false, error: String(error) }
      }
    })
  }

  /**
   * Pull from the upstream of the current branch. When the merge stops on
   * conflicts, `git pull` exits non-zero and simple-git rejects — the
   * version-agnostic way to recover the conflict list is to re-read
   * `status()` afterwards rather than parse the rejected error shape.
   *
   * `--no-rebase` is explicit, not optional: git (≥2.27ish) refuses a bare
   * `git pull` on divergent branches when `pull.rebase`/`pull.ff` aren't
   * configured — it errors out asking the user to choose a strategy
   * instead of attempting anything. Left to the host's ambient config,
   * that error looks identical to a real failure from here (no merge is
   * ever attempted, so `status().conflicted` is empty) — meaning the
   * ENTIRE conflict-resolution feature silently never triggers on any
   * host without `pull.rebase` configured (git's default, unconfigured
   * state). This whole feature is merge-based (`MERGE_HEAD`,
   * `status().conflicted`, `abortMerge`'s `merge --abort`) — pinning
   * `--no-rebase` is the objectively correct strategy for this app
   * regardless of host config, not a workaround.
   */
  public async pull(folder: string): Promise<GitPullResult> {
    return this.withFolderLock(folder, async () => {
      try {
        await this.git(folder).pull(['--no-rebase'])
        // simple-git's pull() resolves as long as the fetch step succeeded --
        // it does not independently confirm the merge it just attempted went
        // through cleanly. When the remote-tracking ref was already current
        // (e.g. a background fetch beat this call to it), pull() can resolve
        // "successfully" while the merge it ran left the worktree mid-conflict.
        // Re-read status() to catch that case rather than trust the resolved
        // promise alone.
        const postPullStatus = await this.git(folder).status().catch(() => null)
        const postPullConflicts = postPullStatus?.conflicted ?? []
        if (postPullConflicts.length > 0) {
          return { success: false, conflicted: true, conflictFiles: postPullConflicts }
        }
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
    })
  }

  /** Semi-pull: fetch the remote without merging, then compare. Used by the
   * folder watch here and by the CRON schedule / check-on-open added on
   * top of this foundation. Runs through the same per-folder queue as
   * every other primitive, but — unlike them — is itself triggered
   * unattended (no user is waiting on it), so its `fetch` is bounded by
   * {@link FETCH_TIMEOUT_MS}: an unresponsive remote must fail this one
   * background check, not wedge the queue for every other operation on
   * this folder behind it indefinitely. */
  public async fetchAndCompare(folder: string): Promise<GitFetchCompareResult> {
    return this.withFolderLock(folder, async () => {
      try {
        await withTimeout(this.git(folder).fetch(), FETCH_TIMEOUT_MS, 'fetch')
        const status = await this.git(folder).status()
        return { remoteHasNewerVersion: status.behind > 0, behind: status.behind }
      } catch (error) {
        logger.warn('[GitService] fetchAndCompare failed', { folder, error: String(error) })
        return { remoteHasNewerVersion: false, behind: 0, error: String(error) }
      }
    })
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
    return this.withFolderLock(folder, async () => {
      const showStage = async (stage: 1 | 2 | 3): Promise<string | null> => {
        try {
          return await this.git(folder).show([`:${stage}:${filePath}`])
        } catch {
          return null
        }
      }
      const [base, ours, theirs] = await Promise.all([showStage(1), showStage(2), showStage(3)])
      return { path: filePath, base, ours, theirs }
    })
  }

  /**
   * Read a file as it currently stands in the WORKING TREE, guarded to
   * the repo folder. This is the "ours" side of a pre-merge comparison:
   * what the user has right now, after their save — as opposed to
   * `getFileAtHead` (last commit) and `getFileAtRemote` (upstream).
   *
   * A dedicated primitive rather than a generic file read: the three
   * sides of the comparison must all come from the same guarded surface,
   * and a generic reader scoped to the application's own directory
   * silently returns an empty string for a user project living anywhere
   * else — which reads as "I have no content", the single most dangerous
   * possible answer here (it makes every merge adopt the other side
   * wholesale).
   *
   * Resolves to `null` when the file doesn't exist, never an empty
   * string, so callers can tell "absent" from "genuinely empty".
   */
  public async getWorkingTreeFile(folder: string, filePath: string): Promise<string | null> {
    if (!this.isPathWithinFolder(folder, filePath)) {
      throw new Error(`getWorkingTreeFile: filePath escapes the repo folder: ${filePath}`)
    }
    const absolute = join(folder, filePath)
    if (!existsSync(absolute)) return null
    try {
      return await readFile(absolute, 'utf-8')
    } catch (error) {
      logger.warn('[GitService] getWorkingTreeFile failed', { folder, filePath, error: String(error) })
      return null
    }
  }

  /**
   * Read `filePath`'s content on the branch's UPSTREAM ref (e.g.
   * `origin/main`) — the "theirs" side when comparing a working tree
   * against the remote WITHOUT starting a merge.
   *
   * This is what lets the app answer "does my in-progress version
   * conflict with the server's?" before committing anything. The
   * merge-based path (`getConflictVersions`) can only read its three
   * sides from the git index's conflict stages, which exist solely
   * during an in-progress merge — and reaching that state requires
   * committing first. Sourcing `theirs` from the upstream ref instead
   * keeps the whole comparison read-only: no commit, no merge, no
   * mutation of the working tree.
   *
   * Resolves to `null` when there is no upstream, or the path doesn't
   * exist there (deleted / never pushed), rather than rejecting.
   */
  public async getFileAtRemote(folder: string, filePath: string): Promise<string | null> {
    if (!this.isPathWithinFolder(folder, filePath)) {
      throw new Error(`getFileAtRemote: filePath escapes the repo folder: ${filePath}`)
    }
    return this.withFolderLock(folder, async () => {
      try {
        const status = await this.git(folder).status()
        if (!status.tracking) return null
        return await this.git(folder).show([`${status.tracking}:${filePath}`])
      } catch {
        return null
      }
    })
  }

  /**
   * Move the local branch onto its upstream WITHOUT touching the working
   * tree (`git reset --mixed <upstream>`): HEAD and the index end up at
   * the remote's tip while every file on disk keeps the user's
   * in-progress content, which then reads as ordinary unstaged
   * modifications against the new base.
   *
   * This is the "update to the latest version but keep my changes" move.
   * A plain `git merge`/`git pull` can't do it: git refuses to merge over
   * uncommitted changes to the same path, which is precisely why the old
   * flow had to commit before it could update — the behaviour this
   * replaces.
   */
  public async resetToRemoteKeepingWorkingTree(folder: string): Promise<GitResetResult> {
    return this.withFolderLock(folder, async () => {
      try {
        const status = await this.git(folder).status()
        if (!status.tracking) return { success: false, error: 'no upstream branch' }
        await this.git(folder).reset(['--mixed', status.tracking])
        return { success: true }
      } catch (error) {
        logger.error('[GitService] resetToRemoteKeepingWorkingTree failed', { folder, error: String(error) })
        return { success: false, error: String(error) }
      }
    })
  }

  /**
   * Hard-reset the branch AND the working tree onto the upstream
   * (`git reset --hard <upstream>`): every local modification to tracked
   * files is discarded and the checkout matches the remote exactly.
   *
   * Destructive by design — the "throw my changes away and start clean
   * from the server's version" move, for the user who experimented
   * locally and simply wants the latest shared state back. Callers MUST
   * confirm with the user first; nothing here asks.
   */
  public async resetHardToRemote(folder: string): Promise<GitResetResult> {
    return this.withFolderLock(folder, async () => {
      try {
        const status = await this.git(folder).status()
        if (!status.tracking) return { success: false, error: 'no upstream branch' }
        await this.git(folder).reset(['--hard', status.tracking])
        return { success: true }
      } catch (error) {
        logger.error('[GitService] resetHardToRemote failed', { folder, error: String(error) })
        return { success: false, error: String(error) }
      }
    })
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
  /**
   * The file as it stood at the MERGE BASE — the last commit the local
   * branch and its upstream have in common.
   *
   * This, not `HEAD`, is the common ancestor a three-way merge needs.
   * They coincide only while every local change is uncommitted; the
   * moment the branch holds a commit of its own, `HEAD` already contains
   * our work, so our side reads as "unchanged since the base" and the
   * merge adopts the other side over it — silently reverting exactly the
   * work the user committed.
   *
   * Resolves to `null` when there is no upstream, no common ancestor, or
   * the file didn't exist there.
   */
  public async getFileAtMergeBase(folder: string, filePath: string): Promise<string | null> {
    if (!this.isPathWithinFolder(folder, filePath)) {
      throw new Error(`getFileAtMergeBase: filePath escapes the repo folder: ${filePath}`)
    }
    return this.withFolderLock(folder, async () => {
      try {
        const status = await this.git(folder).status()
        if (!status.tracking) return null
        const base = (await this.git(folder).raw(['merge-base', 'HEAD', status.tracking])).trim()
        if (!base) return null
        return await this.git(folder).show([`${base}:${filePath}`])
      } catch {
        return null
      }
    })
  }

  public async getFileAtHead(folder: string, filePath: string): Promise<string | null> {
    if (!this.isPathWithinFolder(folder, filePath)) {
      throw new Error(`getFileAtHead: filePath escapes the repo folder: ${filePath}`)
    }
    return this.withFolderLock(folder, async () => {
      try {
        return await this.git(folder).show([`HEAD:${filePath}`])
      } catch {
        return null
      }
    })
  }

  /**
   * Restore one file to its content at a past commit, writing it into the
   * working tree WITHOUT staging or committing. Deliberately not a branch
   * rewind: HEAD stays put, so the repo doesn't go "behind" — the recovered
   * content is a plain uncommitted edit the user commits (and pushes)
   * themselves if they want to keep it. Returns the recovered content so the
   * caller can re-hydrate the open editor (otherwise the app's next autosave,
   * still holding the pre-recovery tree in memory, would overwrite it).
   */
  public async recoverFileAtRevision(folder: string, filePath: string, revision: string): Promise<string> {
    if (!isAbsolute(folder)) {
      throw new Error(`recoverFileAtRevision: refusing non-absolute folder "${folder}"`)
    }
    if (!this.isPathWithinFolder(folder, filePath)) {
      throw new Error(`recoverFileAtRevision: filePath escapes the repo folder: ${filePath}`)
    }
    return this.withFolderLock(folder, async () => {
      const content = await this.git(folder).show([`${revision}:${filePath}`])
      await writeFile(join(folder, filePath), content, 'utf-8')
      return content
    })
  }

  /** Write the user's resolved content to disk and stage it (marks the
   * conflict resolved from git's point of view). Finalising the merge
   * (committing) is a separate `commit()` call once every conflict in the
   * pull's `conflictFiles` has been written. */
  public async writeResolvedConflict(folder: string, filePath: string, content: string): Promise<void> {
    // Same cwd-fallback guard as `git()` — this method WRITES a file, so a
    // relative folder would drop the resolved YAML into process.cwd().
    if (!isAbsolute(folder)) {
      throw new Error(`writeResolvedConflict: refusing non-absolute folder "${folder}"`)
    }
    if (!this.isPathWithinFolder(folder, filePath)) {
      throw new Error(`writeResolvedConflict: filePath escapes the repo folder: ${filePath}`)
    }
    await this.withFolderLock(folder, async () => {
      await writeFile(join(folder, filePath), content, 'utf-8')
      await this.git(folder).add([filePath])
    })
  }

  /** Commit timestamps (Unix seconds) for the two sides of an in-progress
   * merge conflict — `HEAD` (ours) and `MERGE_HEAD` (theirs). Either
   * resolves to `null` if the ref can't be read (e.g. `MERGE_HEAD` absent
   * outside a merge) rather than rejecting the whole call — a caller using
   * this as a tie-breaker should treat `null` as "no signal", not an
   * error. */
  public async getConflictCommitTimestamps(folder: string): Promise<GitConflictCommitTimestamps> {
    return this.withFolderLock(folder, async () => {
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
    })
  }

  public async abortMerge(folder: string): Promise<void> {
    await this.withFolderLock(folder, () => this.git(folder).merge(['--abort']))
  }

  // ==========================================================================
  // Active folder + watch (AC3, AC4)
  // ==========================================================================

  /**
   * Set the folder whose git state is tracked + watched. The host's
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

  /**
   * Manual "check now" — the status-bar refresh button's backend. Runs the
   * same two passes the folder watch chains (local status refresh, then the
   * semi-pull remote check), so both the push side (working-tree changes)
   * and the pull side (remote ahead) light up without waiting for the CRON
   * tick or a watch event. Safe no-op without an active folder.
   */
  public async refreshNow(): Promise<void> {
    await this.refresh()
    await this.checkForRemoteUpdate()
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
    this.rootWatcher = watchPaths(folder, {
      ignoreInitial: true,
      depth: 0,
      ignored: (path) => path.includes('/.git')
    })
    const trigger = (): void => {
      if (this.watchTimer) clearTimeout(this.watchTimer)
      this.watchTimer = setTimeout(() => {
        // Sequential, not concurrent: `refresh()` and `checkForRemoteUpdate()`
        // each run their own locked primitives (isGitRepo/getStatus, then
        // fetchAndCompare) — the per-folder queue would already keep their
        // underlying git processes from overlapping even fired concurrently,
        // but chaining them here keeps `state` updates in a predictable
        // order (status reflects the pre-fetch tree before the semi-pull
        // check runs) rather than interleaving two independent call chains.
        void (async () => {
          await this.refresh()
          await this.checkForRemoteUpdate()
        })()
      }, this.config.watchDebounceMs)
    }
    this.watcher.on('all', trigger)
    this.rootWatcher.on('all', trigger)
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
    if (this.rootWatcher) {
      void this.rootWatcher.close()
      this.rootWatcher = null
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
    // Test seam. An automated suite usually opens its fixtures from inside the
    // host repository's own checkout, so this check fires against whatever
    // state that repository happens to be in — and a developer with an
    // unpushed commit gets a "pull available" toast on top of the application
    // under test. That toast is a real, clickable surface: it sits over
    // whatever is beneath it and swallows the clicks aimed at it, which turns
    // into UI failures that look like product bugs and move from run to run.
    // Suites that are ABOUT this check clear the variable for their own launch.
    if (process.env['ECUI_DISABLE_GIT_REMOTE_CHECK'] === '1') return
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
