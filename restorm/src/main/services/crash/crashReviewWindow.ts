/**
 * Which window may be asked to review a crash report.
 *
 * Split out and made pure because the answer is not obvious and getting it
 * wrong is silent. A renderer process that dies leaves its `BrowserWindow`
 * ALIVE — not destroyed, still visible, still focusable — and only its
 * `webContents` reports itself crashed. So the natural test ("is there a window
 * on screen?") says yes about a window that can no longer render anything or
 * answer anything.
 *
 * That matters because the main process synthesises a report for exactly that
 * event. Asking the dead window would send the question to a renderer with no
 * listener left: the promise would never settle, the SDK would hold the event
 * for the life of the process, and the single review slot would stay occupied —
 * so every LATER crash would be discarded too, by a dialog nobody could ever
 * answer. Excluding it turns that into a clean refusal instead: no window able
 * to ask ⇒ unasked ⇒ unsent, which is the rule the rest of this subsystem
 * already follows.
 *
 * Dropping is the only safe direction here. The alternative — send it anyway,
 * since nobody can be asked — would send a report the user was promised they
 * would see first.
 */

/** What the caller must know about a candidate window. */
export interface ReviewWindowState {
  destroyed: boolean
  visible: boolean
  /** True once the window's renderer process has gone. */
  crashed: boolean
}

/** A window can host the question only if it can still render and answer. */
export function canHostReview(state: ReviewWindowState): boolean {
  return !state.destroyed && state.visible && !state.crashed
}

/**
 * Pick the window to ask: the focused one when it can host the question, else
 * the first other window that can.
 *
 * The focused window is preferred but not privileged — a focused window whose
 * renderer has died is precisely the case this exists to reject.
 */
export function pickReviewWindow<T>(
  windows: readonly T[],
  focused: T | null,
  read: (window: T) => ReviewWindowState
): T | null {
  if (focused !== null && canHostReview(read(focused))) return focused
  return windows.find((window) => canHostReview(read(window))) ?? null
}
