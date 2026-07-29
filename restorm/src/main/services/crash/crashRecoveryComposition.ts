/**
 * Binds crash recovery to Electron: the persisted store, the settle timer and
 * the relaunch itself.
 *
 * The thin untested seam, deliberately — the whole state machine (what to open,
 * when the loop marker is written and cleared) lives in `crashRecovery.ts` and
 * is exercised without an app, a disk or a clock. This file only knows where
 * the record is kept and how to restart the process.
 */

import { app, BrowserWindow } from 'electron'
import { logger, getStorageService, getFileService, isFileServiceInitialized } from 'electron-core-ui/main'
import { CRASH_IPC, type CrashRecoveryNotice } from '../../../shared/crash/crashTypes'
import {
  CrashRecoveryService,
  withoutOpenArg,
  type CrashRecoveryRecord,
  type CrashRecoveryStore
} from './crashRecovery'

/** Namespaced like `updates:lastSeenVersion`, in the same `config.json`. */
const CRASH_RECOVERY_KEY = 'crash:recovery'

/**
 * How long a launch must last before its automatic open is considered proven.
 *
 * It has to clear the startup open itself, which happens at `dom-ready` plus
 * `DEFAULT_UI_DELAY_MS`, and then leave room for the file to be parsed and
 * rendered — the work that a poisonous file actually dies in. Generous on
 * purpose: erring long costs one un-reopened file after an unrelated hard kill,
 * while erring short would clear the marker before the crash it exists to
 * catch, and the protection would never fire.
 */
const SETTLE_MS = 20_000

let instance: CrashRecoveryService | null = null

/**
 * Whether this launch withheld a file. Defaults to "no", which is the truth on
 * every launch until the startup decision says otherwise.
 */
let notice: CrashRecoveryNotice = { fileWithheld: false, withheldPath: null }

/**
 * Record that a file was withheld, and tell the renderer.
 *
 * BOTH a push and a stored value, because neither alone is reliable. The
 * decision is taken well after `dom-ready`, so a renderer that read it once at
 * mount would always read "no" — the push is what actually delivers it. But a
 * renderer that reloads afterwards missed the push, so the value is kept for it
 * to read. Same read-and-subscribe shape as the armed and consent states.
 */
export function recordRecoveryNotice(next: CrashRecoveryNotice): void {
  notice = next
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    try {
      window.webContents.send(CRASH_IPC.RECOVERY_NOTICE, next)
    } catch {
      // A window can be torn down between the check and the send. Telling the
      // user about the protection must never be able to break the app.
    }
  }
}

/** What this launch withheld, if anything. */
export function readRecoveryNotice(): CrashRecoveryNotice {
  return notice
}

/**
 * The record, in the same JSON store as the reopen-last-file path it guards —
 * one file, one write, and no chance of the two disagreeing after a half-failed
 * write to one of them.
 */
function makeStore(): CrashRecoveryStore {
  return {
    read(): CrashRecoveryRecord | null {
      const raw = getStorageService().get(CRASH_RECOVERY_KEY)
      if (typeof raw !== 'object' || raw === null) return null
      const record = raw as CrashRecoveryRecord
      // Read defensively: this file is user-editable and survives upgrades, so
      // a shape from another version must degrade to "no recovery pending"
      // rather than propagate a wrong type into the decision.
      return {
        ...(typeof record.pendingPath === 'string' ? { pendingPath: record.pendingPath } : {}),
        ...(record.inFlight === true ? { inFlight: true } : {})
      }
    },
    write(record: CrashRecoveryRecord | null): void {
      if (record === null) {
        getStorageService().delete(CRASH_RECOVERY_KEY)
        return
      }
      getStorageService().set(CRASH_RECOVERY_KEY, record)
    }
  }
}

/** The crash-recovery service. Built on first use; storage is ready by then
 * (nothing calls this before the window exists). */
export function getCrashRecovery(): CrashRecoveryService {
  instance ??= new CrashRecoveryService({
    store: makeStore(),
    log: (message, fields) => { logger.info(message, fields) }
  })
  return instance
}

/**
 * Clear the loop marker once this launch has lasted long enough to prove the
 * file it opened is not what kills it.
 *
 * Also hooked to `before-quit`, so a user who opens the app and closes it again
 * within the settle window is not mistaken for a crash on the next launch. That
 * hook cannot fire on the recovery path itself: the relaunch uses `app.exit`,
 * which emits nothing — and the service refuses to mark survival after a crash
 * regardless.
 */
export function scheduleSurvivalMark(): void {
  setTimeout(() => { getCrashRecovery().markLaunchSurvived() }, SETTLE_MS)
  app.once('before-quit', () => { getCrashRecovery().markLaunchSurvived() })
}

/**
 * Record what to reopen and restart the app.
 *
 * `app.exit` rather than `app.quit`: quitting runs the window's close handler,
 * which asks the renderer to save unsaved work — and the renderer this is
 * recovering from has just stopped being able to answer, so the app would hang
 * on a dialog nobody can complete. Work in progress is not lost by exiting
 * abruptly; it is already being written continuously to the draft store
 * (`attachDraftStoreForFile`), which is what that store is for.
 */
export function recoverAndRelaunch(): void {
  const path = currentFilePath()
  try {
    getCrashRecovery().beginRecovery(path)
  } catch (error) {
    // Recovery state is a nicety; relaunching is not. Never let the bookkeeping
    // stop the restart the user has just asked for.
    logger.error('Crash recovery could not record the pending file; relaunching anyway', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
  logger.info('Relaunching after a crash', { reopening: path !== null })
  // Our arguments, minus any `--open`: the file to reopen travels in the record
  // instead, so it goes through the guarded path rather than the command line
  // that bypasses it. See `withoutOpenArg`.
  app.relaunch({ args: withoutOpenArg(process.argv.slice(1)) })
  app.exit(0)
}

/** The file open at the moment of the crash, if any. */
function currentFilePath(): string | null {
  try {
    if (!isFileServiceInitialized()) return null
    return getFileService().getFilePath()
  } catch {
    return null
  }
}
