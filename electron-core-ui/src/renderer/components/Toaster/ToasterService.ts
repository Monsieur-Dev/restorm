import { logger } from '../../services/logger'
import type {
  DoNotDisturbChangePayload,
  ShowFrameChangePayload,
  Toast,
  ToastInput,
  ToasterEvent,
  ToastsChangePayload
} from './types'

interface ToasterState {
  toasts: Toast[]
  showFrame: boolean
  doNotDisturb: boolean
  maxToasts: number
  /** Counts how many times this id has been registered — used to warn on collisions. */
  registrations: number
}

type EventPayload =
  | ToastsChangePayload
  | ShowFrameChangePayload
  | DoNotDisturbChangePayload

type Listener = (toasterId: string, payload: EventPayload) => void

const DEFAULT_MAX_TOASTS = 50

/**
 * Stable fallback array for `getToasts` when the requested toasterId
 * has no registered state yet. Must stay module-level so every call
 * returns the SAME reference — `useSyncExternalStore`'s `getSnapshot`
 * is called on every render and a fresh `[]` each time would be read
 * as "store changed", triggering an infinite re-render loop (OYO-203).
 */
const EMPTY_TOASTS_SNAPSHOT: readonly Toast[] = Object.freeze([])

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for older runtimes/JSDOM without randomUUID.
  return `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

class ToasterServiceImpl {
  private states = new Map<string, ToasterState>()
  private listeners = new Map<ToasterEvent, Set<Listener>>()

  // ── Registration ──────────────────────────────────────────────────

  /** Called by `<Toaster>` on mount. Warns on id collisions but keeps the latest config. */
  register(
    toasterId: string,
    initial: { showFrame: boolean; doNotDisturb: boolean; maxToasts: number }
  ): void {
    const existing = this.states.get(toasterId)
    if (existing) {
      existing.registrations += 1
      logger.warn(`[ToasterService] Toaster id "${toasterId}" registered more than once (count=${existing.registrations}). Latest registration wins.`)
      // Reconfigure with latest settings (match the "latest wins" rule).
      existing.showFrame = initial.showFrame
      existing.doNotDisturb = initial.doNotDisturb
      existing.maxToasts = initial.maxToasts
      return
    }
    this.states.set(toasterId, {
      toasts: [],
      showFrame: initial.showFrame,
      doNotDisturb: initial.doNotDisturb,
      maxToasts: initial.maxToasts,
      registrations: 1
    })
  }

  unregister(toasterId: string): void {
    this.states.delete(toasterId)
  }

  // ── Toast operations ──────────────────────────────────────────────

  /**
   * Push a toast. Returns the toast id.
   *
   * When the toaster is in Do-Not-Disturb mode, the toast is dropped
   * silently and the returned id is `''` (empty string).
   *
   * When `input.id` is provided and matches an existing toast id, the
   * existing toast is updated in place and its timer restarts.
   */
  push(toasterId: string, input: ToastInput): string {
    const state = this.states.get(toasterId)
    if (!state) return ''

    const now = Date.now()
    const ariaLive = input.ariaLive ?? 'polite'
    // Under DND we still accept the toast, but mark it as if it had
    // already been displayed — the user can review it later via the
    // frame, but it doesn't interrupt them transparently.
    const startHidden = state.doNotDisturb

    // Update-in-place when id matches an existing toast.
    if (input.id !== undefined) {
      const idx = state.toasts.findIndex((t) => t.id === input.id)
      if (idx >= 0) {
        const existing = state.toasts[idx]
        if (!existing) return input.id
        const updated: Toast = {
          id: existing.id,
          title: input.title,
          body: input.body,
          durationMs: input.durationMs,
          ariaLive,
          createdAt: now,
          exiting: false,
          // Re-pushing the same id reveals the toast even if a prior
          // hide() had set it to hidden — unless DND is active, in
          // which case the update is archived like a fresh push.
          hidden: startHidden,
          // Preserve `seen` across update-in-place: an already-viewed
          // toast whose content is refreshed (e.g. progress updates)
          // shouldn't re-trigger the unseen badge.
          seen: existing.seen
        }
        state.toasts = [
          ...state.toasts.slice(0, idx),
          updated,
          ...state.toasts.slice(idx + 1)
        ]
        this.emit('toastsChange', toasterId, { toasts: state.toasts })
        return existing.id
      }
    }

    const id = input.id ?? genId()
    const toast: Toast = {
      id,
      title: input.title,
      body: input.body,
      durationMs: input.durationMs,
      ariaLive,
      createdAt: now,
      exiting: false,
      hidden: startHidden,
      seen: false
    }
    state.toasts = [...state.toasts, toast]

    // Enforce maxToasts by dropping the oldest (first).
    while (state.toasts.length > state.maxToasts) {
      state.toasts = state.toasts.slice(1)
    }

    this.emit('toastsChange', toasterId, { toasts: state.toasts })
    return id
  }

  /** Mark the toast as exiting (for animation), then remove it after `gracePeriodMs`. */
  dismiss(toasterId: string, toastId: string, gracePeriodMs = 0): void {
    const state = this.states.get(toasterId)
    if (!state) return
    const idx = state.toasts.findIndex((t) => t.id === toastId)
    if (idx < 0) return
    const existing = state.toasts[idx]
    if (!existing || existing.exiting) return
    const exiting: Toast = { ...existing, exiting: true }
    state.toasts = [
      ...state.toasts.slice(0, idx),
      exiting,
      ...state.toasts.slice(idx + 1)
    ]
    this.emit('toastsChange', toasterId, { toasts: state.toasts })

    if (gracePeriodMs <= 0) {
      this.finalizeDismiss(toasterId, toastId)
      return
    }
    setTimeout(() => { this.finalizeDismiss(toasterId, toastId) }, gracePeriodMs)
  }

  private finalizeDismiss(toasterId: string, toastId: string): void {
    const state = this.states.get(toasterId)
    if (!state) return
    const next = state.toasts.filter((t) => t.id !== toastId)
    if (next.length === state.toasts.length) return
    state.toasts = next
    this.emit('toastsChange', toasterId, { toasts: state.toasts })
  }

  /**
   * Mark a toast as `seen` (rendered at least once with opacity > 0).
   * Idempotent — a no-op if the toast is already seen or unknown.
   */
  markSeen(toasterId: string, toastId: string): void {
    const state = this.states.get(toasterId)
    if (!state) return
    const idx = state.toasts.findIndex((t) => t.id === toastId)
    if (idx < 0) return
    const existing = state.toasts[idx]
    if (!existing || existing.seen) return
    state.toasts = [
      ...state.toasts.slice(0, idx),
      { ...existing, seen: true },
      ...state.toasts.slice(idx + 1)
    ]
    this.emit('toastsChange', toasterId, { toasts: state.toasts })
  }

  clear(toasterId: string): void {
    const state = this.states.get(toasterId)
    if (!state) return
    if (state.toasts.length === 0) return
    state.toasts = []
    this.emit('toastsChange', toasterId, { toasts: state.toasts })
  }

  // ── Flags (showFrame, doNotDisturb) ───────────────────────────────

  getToasts(toasterId: string): Toast[] {
    // Return `EMPTY_TOASTS_SNAPSHOT` rather than a fresh `[]` on the
    // "unregistered toasterId" path so `useSyncExternalStore` sees a
    // stable reference between calls and doesn't loop. The readonly
    // cast is safe: `getToasts` is a read-only observer and consumers
    // treat the returned array as frozen.
    return this.states.get(toasterId)?.toasts ?? (EMPTY_TOASTS_SNAPSHOT as Toast[])
  }

  getShowFrame(toasterId: string): boolean {
    return this.states.get(toasterId)?.showFrame ?? false
  }

  setShowFrame(toasterId: string, show: boolean): void {
    const state = this.states.get(toasterId)
    if (!state) return
    if (state.showFrame === show) return
    state.showFrame = show
    this.emit('showFrameChange', toasterId, { showFrame: show })
    // Opening the frame reveals every stored toast — flip each toast's
    // `hidden` flag back to false and emit one `toastsChange` so all
    // subscribers see the reset. Subsequent pushes won't touch siblings.
    if (show) {
      const anyHidden = state.toasts.some((t) => t.hidden)
      if (anyHidden) {
        state.toasts = state.toasts.map((t) => (t.hidden ? { ...t, hidden: false } : t))
        this.emit('toastsChange', toasterId, { toasts: state.toasts })
      }
    }
  }

  toggleShowFrame(toasterId: string): void {
    const state = this.states.get(toasterId)
    if (!state) return
    this.setShowFrame(toasterId, !state.showFrame)
  }

  /**
   * Toggle the toaster's visibility — the semantic used by a
   * bell/tray trigger. When the frame is open, closes everything via
   * `hide()` (frame + stack). Otherwise opens the frame: any stored
   * toasts become visible again, including ones previously marked
   * hidden by `hide()`. Calling this with transparent toasts already
   * visible simply elevates them into framed mode.
   */
  toggleVisibility(toasterId: string): void {
    const state = this.states.get(toasterId)
    if (!state) return
    if (state.showFrame) {
      this.hide(toasterId)
      return
    }
    this.setShowFrame(toasterId, true)
  }

  /**
   * Hide the entire toaster (frame + transparent stack) without
   * dismissing any toast. Every current toast is marked `hidden: true`;
   * pushing a new toast adds it alongside, leaving already-hidden
   * siblings alone. Re-opening the frame reveals them all again.
   */
  hide(toasterId: string): void {
    const state = this.states.get(toasterId)
    if (!state) return
    if (state.showFrame) {
      state.showFrame = false
      this.emit('showFrameChange', toasterId, { showFrame: false })
    }
    const anyVisible = state.toasts.some((t) => !t.hidden)
    if (anyVisible) {
      state.toasts = state.toasts.map((t) => (t.hidden ? t : { ...t, hidden: true }))
      this.emit('toastsChange', toasterId, { toasts: state.toasts })
    }
  }

  getDoNotDisturb(toasterId: string): boolean {
    return this.states.get(toasterId)?.doNotDisturb ?? false
  }

  setDoNotDisturb(toasterId: string, enabled: boolean): void {
    const state = this.states.get(toasterId)
    if (!state || state.doNotDisturb === enabled) return
    state.doNotDisturb = enabled
    this.emit('doNotDisturbChange', toasterId, { doNotDisturb: enabled })
  }

  toggleDoNotDisturb(toasterId: string): void {
    const state = this.states.get(toasterId)
    if (!state) return
    this.setDoNotDisturb(toasterId, !state.doNotDisturb)
  }

  // ── Events ────────────────────────────────────────────────────────

  on(event: ToasterEvent, listener: Listener): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
    return () => { set.delete(listener) }
  }

  private emit(event: ToasterEvent, toasterId: string, payload: EventPayload): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) {
      try {
        listener(toasterId, payload)
      } catch (err) {
        logger.error('[ToasterService] listener threw', { error: String(err) })
      }
    }
  }

  /** @internal Test helper — resets all state. */
  _reset(): void {
    this.states.clear()
    this.listeners.clear()
  }
}

export const toasterService: ToasterServiceImpl = new ToasterServiceImpl()

export type { ToasterServiceImpl }

export const TOASTER_DEFAULTS = {
  MAX_TOASTS: DEFAULT_MAX_TOASTS
}
