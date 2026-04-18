import type { ReactNode } from 'react'

export type ToasterPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export type ToasterOrder = 'asc' | 'desc'

export type ScrollDismissBehavior = 'silent' | 'scroll-to' | 'pause'

/** Input accepted by `toasterService.push()` / `pushToast()`. */
export interface ToastInput {
  /**
   * When set and a toast with the same id already exists in the target
   * toaster, the existing toast is updated in place (title/body/duration
   * merged, timer + createdAt reset). Otherwise, a fresh uuid is
   * generated and returned by `push()`.
   */
  id?: string | undefined
  title: string
  body: ReactNode
  /** Duration before auto-dismiss. `undefined` → indefinite (no progress bar). */
  durationMs?: number | undefined
  /** ARIA live politeness. Defaults to `'polite'`. */
  ariaLive?: 'polite' | 'assertive' | undefined
}

/** Lifecycle representation of a toast stored in `ToasterService`. */
export interface Toast {
  id: string
  title: string
  body: ReactNode
  durationMs: number | undefined
  ariaLive: 'polite' | 'assertive'
  createdAt: number
  /** True once the dismiss animation has started. */
  exiting: boolean
  /**
   * True once the toast has been pushed into a "stored but not
   * displayed" state — set by `hide()` on every current toast. Stays
   * true until the toaster is explicitly opened (frame bell) again;
   * subsequent pushes do NOT reset sibling toasts' `hidden` flag.
   */
  hidden: boolean
  /**
   * Historical flag: true once this toast has been rendered to the
   * user at least once (DOM-mounted with opacity > 0). Used e.g. to
   * drive an "unseen notification" badge. Preserved across
   * `push()` update-in-place.
   */
  seen: boolean
}

export interface AnimationDurations {
  /** Mount animation duration (ms). Default 200. */
  enter?: number | undefined
  /** Unmount animation duration (ms). Default 150. */
  exit?: number | undefined
  /** FLIP reflow duration when the list reshuffles (ms). Default 200. */
  reflow?: number | undefined
}

export interface ToasterProps {
  /** Unique identifier — used to target this toaster from the service. */
  id: string
  position: ToasterPosition
  /** Container width in px. Default 450. */
  width?: number | undefined
  /**
   * Stacking order. `'desc'` (default): newest toast closest to the
   * anchored corner. `'asc'`: oldest closest.
   */
  order?: ToasterOrder | undefined
  /** Initial framed-mode state. Uncontrolled; state lives in the service. */
  initialShowFrame?: boolean | undefined
  /** Initial Do-Not-Disturb state. */
  initialDoNotDisturb?: boolean | undefined
  /** Hard cap on stored toasts. Oldest are dropped silently. Default 50. */
  maxToasts?: number | undefined
  /** Offset from the window edges in px. Default 8. */
  margin?: number | undefined
  /** What to do with toasts that are scrolled out of view. Default `'silent'`. */
  scrollDismissBehavior?: ScrollDismissBehavior | undefined
  animationDurations?: AnimationDurations | undefined
  'data-testid'?: string | undefined
}

export type ToasterEvent =
  | 'toastsChange'
  | 'showFrameChange'
  | 'doNotDisturbChange'

export interface ToastsChangePayload {
  toasts: Toast[]
}

export interface ShowFrameChangePayload {
  showFrame: boolean
}

export interface DoNotDisturbChangePayload {
  doNotDisturb: boolean
}
