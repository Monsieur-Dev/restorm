import { watch, type FSWatcher } from 'chokidar'
import { existsSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { BrowserWindow } from 'electron'
import { logger } from 'electron-core-ui'

/**
 * Watcher on the OPEN project's secrets sidecar (`<project>.restorm.env`).
 *
 * The sidecar is read ONCE at project open and held in memory (on the
 * SecretValue instances, the save baseline, and the main-side env
 * context) — an external edit is invisible to the app and would be
 * OVERWRITTEN by the next save. Unlike the project file, the resolution
 * is a SILENT reload (no prompt): the renderer re-reads the sidecar and
 * re-applies the values in place.
 *
 * Own-write guard: every app path that touches the sidecar goes through
 * the `restorm:secrets:read` / `restorm:secrets:write` IPC handlers,
 * which call {@link noteOwnSidecarBytes} — a digest baseline the watcher
 * compares against, so the app's own writes (including the delete-when-
 * empty case) never trigger a reload.
 */

const DEBOUNCE_MS = 250

let watcher: FSWatcher | null = null
let debounceTimer: NodeJS.Timeout | null = null
let watchedPath: string | null = null
/** Digest of the sidecar bytes the app last read or wrote — `null` maps
 * to "no file" (absent sidecar, or deleted by an empty-content write). */
let knownDigest: string | null = null

function digestOf(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

function currentDiskDigest(): string | null {
  if (!watchedPath) return null
  try {
    if (!existsSync(watchedPath)) return null
    return digestOf(readFileSync(watchedPath, 'utf-8'))
  } catch (error: unknown) {
    logger.warn('[secretsSidecarWatcher] Failed to probe the sidecar', { path: watchedPath, error: String(error) })
    return knownDigest
  }
}

/** Record the bytes the app itself just read/wrote (`null` = file absent
 * or deleted). Called from the secrets IPC handlers. */
export function noteOwnSidecarBytes(filePath: string, content: string | null): void {
  if (watchedPath !== null && filePath !== watchedPath) return
  knownDigest = content === null ? null : digestOf(content)
}

/** Arm the watcher for `<projectPath>.env` (stopping any previous one).
 * The sidecar may not exist yet — chokidar picks up its later creation. */
export function armSecretsSidecarWatcher(projectPath: string): void {
  const sidecarPath = `${projectPath}.env`
  if (watchedPath === sidecarPath) return
  disarmSecretsSidecarWatcher()
  watchedPath = sidecarPath
  knownDigest = currentDiskDigest()
  try {
    watcher = watch(sidecarPath, { ignoreInitial: true })
    watcher.on('all', () => { scheduleProbe() })
    watcher.on('error', (error: unknown) => {
      logger.warn('[secretsSidecarWatcher] Watcher error', { path: sidecarPath, error: String(error) })
    })
  } catch (error: unknown) {
    logger.warn('[secretsSidecarWatcher] Failed to arm', { path: sidecarPath, error: String(error) })
  }
}

export function disarmSecretsSidecarWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    void watcher.close().catch((error: unknown) => {
      logger.warn('[secretsSidecarWatcher] Failed to close', { error: String(error) })
    })
    watcher = null
  }
  watchedPath = null
  knownDigest = null
}

function scheduleProbe(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    probe()
  }, DEBOUNCE_MS)
}

function probe(): void {
  if (!watchedPath) return
  const disk = currentDiskDigest()
  if (disk === knownDigest) return
  // Re-baseline BEFORE broadcasting: the renderer's silent reload calls
  // `secrets:read` (which re-notes the bytes anyway), and an idempotent
  // baseline means a lost broadcast can't loop.
  knownDigest = disk
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('restorm:secrets:externally-changed', { path: watchedPath })
  }
  logger.info('[secretsSidecarWatcher] Sidecar changed on disk — silent reload requested', { path: watchedPath })
}
