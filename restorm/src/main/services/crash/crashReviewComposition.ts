/**
 * Binds the crash-report review to a real window.
 *
 * The thin Electron-facing seam: the decision table lives in
 * `CrashReviewService` and `crashReviewDecision`, both electron-free and
 * unit-tested. This only knows how to put the question on screen and how to
 * hear the answer.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { logger, getSettingsService } from 'electron-core-ui/main'
import { CRASH_IPC, type CrashReviewRequest } from '../../../shared/crash/crashTypes'
import { CRASH_REVIEW_SETTING_KEY } from '../../../shared/config/observability'
import { getConsentService } from '../privacy/consentComposition'
import { CrashReviewService, type CrashReviewPort } from './CrashReviewService'
import { crashReviewMode } from './crashReviewDecision'

let instance: CrashReviewService | null = null
/** Resolvers for reviews currently on screen, keyed by request id. */
const waiting = new Map<string, (send: boolean) => void>()
let listening = false

/** The window that gets asked: the focused one, else the first that is visible. */
function reviewWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible())
  return BrowserWindow.getFocusedWindow() ?? windows[0] ?? null
}

/**
 * Answers arrive on one shared listener rather than one per request, so a
 * report the user never answers cannot leave a handler installed for the life
 * of the process.
 */
function ensureListening(): void {
  if (listening) return
  listening = true
  ipcMain.on(CRASH_IPC.RESOLVE_REVIEW, (_event, id: unknown, send: unknown) => {
    if (typeof id !== 'string') return
    const resolve = waiting.get(id)
    if (resolve === undefined) return
    waiting.delete(id)
    resolve(send === true)
  })
}

function makePort(): CrashReviewPort {
  return {
    canAsk: () => reviewWindow() !== null,
    ask: (request: CrashReviewRequest) =>
      new Promise<boolean>((resolve) => {
        const window = reviewWindow()
        if (window === null) { resolve(false); return }
        ensureListening()
        waiting.set(request.id, resolve)
        // A window that goes away takes the question with it. Without this the
        // promise would never settle and the SDK would hold the event for the
        // life of the process.
        const abandon = (): void => {
          if (!waiting.delete(request.id)) return
          resolve(false)
        }
        window.once('closed', abandon)
        window.webContents.once('destroyed', abandon)
        try {
          window.webContents.send(CRASH_IPC.REVIEW_REQUESTED, request)
        } catch {
          abandon()
        }
      })
  }
}

/** Build the review service. Idempotent. */
export function initCrashReview(): CrashReviewService {
  instance ??= new CrashReviewService({
    port: makePort(),
    log: (message, fields) => { logger.info(message, fields) }
  })
  return instance
}

/**
 * Decide whether one scrubbed event may be sent, asking the user when their
 * consent was their own choice and they have not waived the per-report step.
 *
 * Never throws: a review that fails for any reason resolves to "do not send".
 */
export async function reviewCrashReport(request: CrashReviewRequest): Promise<boolean> {
  try {
    const mode = crashReviewMode({
      consent: getConsentService()?.getDecision('crash') ?? null,
      reviewEnabled: readReviewEnabled()
    })
    return await initCrashReview().review(mode, request)
  } catch (error) {
    logger.warn('Crash report discarded: review could not be resolved', {
      message: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

/** The "show me each report" preference. Defaults ON — the consent prompt
 * promised the user they would see each report, so the promise holds unless
 * they knowingly waive it. */
function readReviewEnabled(): boolean {
  try {
    const stored = getSettingsService().get(CRASH_REVIEW_SETTING_KEY)
    return typeof stored === 'boolean' ? stored : true
  } catch {
    return true
  }
}
