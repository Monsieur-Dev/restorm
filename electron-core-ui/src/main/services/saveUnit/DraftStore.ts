/**
 * Draft persistence store.
 *
 * Writes per-unit drafts into a UUID-scoped directory under the user's
 * data directory (`userData/drafts/<uuid>/…`). Each draft is one file;
 * writes are debounced (default 300 ms) and atomic (temp + rename). A
 * sidecar `.last-opened` file records the last-open timestamp of the
 * project; the orphan sweep uses that timestamp to reap directories
 * for projects the user hasn't opened in a long time.
 *
 * Orphan detection used to key on the project's absolute file path,
 * but that breaks the moment the user renames or moves the project
 * outside the app (the drafts would be nuked at next boot even though
 * the project UUID is still valid). An age-based sweep is filesystem-
 * path-agnostic.
 *
 * The store does NOT observe a SaveUnitRegistry on its own — the
 * file service is responsible for calling `writeDraft` / `deleteDraft`
 * in response to registry events. That keeps the store free of
 * registry ordering concerns (it only reacts to explicit commands).
 */

import { promises as fs, existsSync } from 'fs'
import { dirname, join } from 'path'
import crypto from 'crypto'
import type { RuntimeId } from '../../../types/runtime'
import { isTombstone, type Tombstone } from './types'
// Tombstone retained in type import for `static isTombstone` guard return type.

/** Default debounce window between a draft mutation and its on-disk flush. */
export const DEFAULT_DRAFT_DEBOUNCE_MS = 300

/**
 * Reap draft directories whose `.last-opened` marker is older than
 * this many days. Covers the "user uninstalled a project a month ago
 * and never came back" case without nuking drafts for a project the
 * user just renamed yesterday.
 */
export const DEFAULT_DRAFT_MAX_AGE_DAYS = 30

export interface DraftStoreOptions {
  /** `app.getPath('userData')/drafts` — or a test override. */
  readonly rootDir: string
  /**
   * Stable UUID used as the sub-directory under `rootDir`. Host apps
   * typically get this from {@link ensureFolderUuid} / {@link ensureFileUuid}.
   */
  readonly uuid: string
  /** File extension for serialized drafts (`yaml`, `json`, `json5`, …). */
  readonly extension: string
  /**
   * `(value) => string` serializer. Pass whichever format matches the
   * project's `PersistenceConfig.format`. Not injected from this
   * module to keep it dependency-free.
   */
  readonly serialize: (value: unknown) => string
  /** Symmetrical deserializer used by `loadAllDrafts`. */
  readonly deserialize: (raw: string) => unknown
  /** Debounce window in ms (default 300). */
  readonly debounceMs?: number
}

/** Raw draft record loaded from disk. */
export interface LoadedDraft {
  readonly runtimeId: RuntimeId
  /** Either the mutated object (normal draft) or a `Tombstone` (pending delete). */
  readonly payload: unknown
}

interface PendingWrite {
  data: unknown
  timer: ReturnType<typeof setTimeout>
  /**
   * Resolved when the pending write has been flushed or superseded.
   * Used by tests via `flushPendingWrites()`.
   */
  resolve: () => void
  reject: (err: unknown) => void
  promise: Promise<void>
}

const LAST_OPENED_FILE = '.last-opened'

export class DraftStore {
  private readonly projectDir: string
  private readonly debounceMs: number
  private readonly pending = new Map<RuntimeId, PendingWrite>()
  private ensuredDir = false

  constructor(private readonly options: DraftStoreOptions) {
    this.projectDir = join(options.rootDir, options.uuid)
    this.debounceMs = options.debounceMs ?? DEFAULT_DRAFT_DEBOUNCE_MS
  }

  /** Absolute path of the directory this store writes drafts into. */
  getProjectDir(): string {
    return this.projectDir
  }

  /** Absolute path of a draft file for a given runtime id. */
  getDraftPath(runtimeId: RuntimeId): string {
    return join(this.projectDir, `${runtimeId}.draft.${this.options.extension}`)
  }

  /**
   * Refresh the `.last-opened` timestamp. Callers should invoke this
   * each time the project is opened so the age-based orphan sweep
   * keeps the drafts alive.
   */
  async markOpened(): Promise<void> {
    await this.ensureProjectDir()
    await writeLastOpened(this.projectDir, Date.now())
  }

  /**
   * Schedule a debounced write of the given draft. If another write
   * for the same `runtimeId` arrives before `debounceMs` elapses, the
   * earlier write is replaced (the last value wins). The returned
   * promise resolves once the write is actually flushed to disk.
   */
  writeDraft(runtimeId: RuntimeId, data: unknown): Promise<void> {
    const existing = this.pending.get(runtimeId)
    if (existing) {
      clearTimeout(existing.timer)
      existing.data = data
      existing.timer = this.scheduleFlush(runtimeId)
      return existing.promise
    }
    let resolve!: () => void
    let reject!: (err: unknown) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    const entry: PendingWrite = {
      data,
      timer: this.scheduleFlush(runtimeId),
      resolve,
      reject,
      promise
    }
    this.pending.set(runtimeId, entry)
    return promise
  }

  private scheduleFlush(runtimeId: RuntimeId): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      void this.flush(runtimeId)
    }, this.debounceMs)
  }

  /** Force-flush any pending debounced writes. Primarily useful in tests. */
  async flushPendingWrites(): Promise<void> {
    const ids = [...this.pending.keys()]
    await Promise.all(ids.map(async (id) => {
      const entry = this.pending.get(id)
      if (!entry) return
      clearTimeout(entry.timer)
      await this.flush(id)
    }))
  }

  private async flush(runtimeId: RuntimeId): Promise<void> {
    const entry = this.pending.get(runtimeId)
    if (!entry) return
    this.pending.delete(runtimeId)
    try {
      await this.ensureProjectDir()
      const serialized = this.options.serialize(entry.data)
      await atomicWrite(this.getDraftPath(runtimeId), serialized)
      entry.resolve()
    } catch (err) {
      entry.reject(err)
    }
  }

  /** Delete a draft file. Cancels any pending write for the same id. */
  async deleteDraft(runtimeId: RuntimeId): Promise<void> {
    const pending = this.pending.get(runtimeId)
    if (pending) {
      clearTimeout(pending.timer)
      this.pending.delete(runtimeId)
      pending.resolve()
    }
    const draftPath = this.getDraftPath(runtimeId)
    try {
      await fs.unlink(draftPath)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  /**
   * Load every draft in the project directory. Returns the drafts
   * along with their parsed payloads (which may be tombstones).
   */
  async loadAllDrafts(): Promise<LoadedDraft[]> {
    if (!existsSync(this.projectDir)) return []
    const entries = await fs.readdir(this.projectDir, { withFileTypes: true })
    const suffix = `.draft.${this.options.extension}`
    const out: LoadedDraft[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith(suffix)) continue
      const runtimeId = entry.name.slice(0, -suffix.length)
      const raw = await fs.readFile(join(this.projectDir, entry.name), 'utf-8')
      const payload = this.options.deserialize(raw)
      out.push({ runtimeId, payload })
    }
    return out
  }

  /** Ensure the project draft directory exists on disk. */
  private async ensureProjectDir(): Promise<void> {
    if (this.ensuredDir) return
    await fs.mkdir(this.projectDir, { recursive: true })
    this.ensuredDir = true
  }

  /** Tombstone test helper for consumers. */
  static isTombstone(value: unknown): value is Tombstone {
    return isTombstone(value)
  }
}

/**
 * Write a file atomically: serialize to a temp path next to the
 * target, then `fs.rename` into place. A mid-write crash leaves the
 * previous target (if any) intact.
 */
async function atomicWrite(targetPath: string, contents: string): Promise<void> {
  const tmp = `${targetPath}.${crypto.randomUUID()}.tmp`
  await fs.mkdir(dirname(targetPath), { recursive: true })
  await fs.writeFile(tmp, contents, 'utf-8')
  await fs.rename(tmp, targetPath)
}

async function writeLastOpened(projectDir: string, epochMs: number): Promise<void> {
  const marker = join(projectDir, LAST_OPENED_FILE)
  await fs.writeFile(marker, String(epochMs), 'utf-8')
}

async function readLastOpened(projectDir: string): Promise<number | null> {
  const marker = join(projectDir, LAST_OPENED_FILE)
  try {
    const raw = (await fs.readFile(marker, 'utf-8')).trim()
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Remove `userData/drafts/<uuid>` subdirectories whose `.last-opened`
 * marker is older than `maxAgeDays` (default 30). Directories with no
 * marker are also reaped (abandoned from an older build, or the
 * project was never actually attached). Safe to call at app boot.
 *
 * The previous version of this sweep keyed on `.project-path` and
 * checked `existsSync(projectPath)`; that nuked drafts for projects
 * the user had renamed or moved outside the app. Age-based reaping is
 * path-agnostic and relies only on the UUID identity of the project.
 */
export async function sweepOrphanedDrafts(
  rootDir: string,
  maxAgeDays: number = DEFAULT_DRAFT_MAX_AGE_DAYS
): Promise<number> {
  if (!existsSync(rootDir)) return 0
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  const nowMs = Date.now()
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
  let removed = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectDir = join(rootDir, entry.name)
    const lastOpened = await readLastOpened(projectDir)
    if (lastOpened === null) {
      // No marker → abandoned draft directory (legacy build or the
      // project was never fully opened). Reap.
      await fs.rm(projectDir, { recursive: true, force: true })
      removed += 1
      continue
    }
    if (nowMs - lastOpened > maxAgeMs) {
      await fs.rm(projectDir, { recursive: true, force: true })
      removed += 1
    }
  }
  return removed
}
