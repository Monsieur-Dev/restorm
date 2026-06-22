import React, {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { ToasterInteractionContext } from './ToasterInteractionContext'
import type { Toast as ToastData } from './types'

export interface ToastProps {
  toast: ToastData
  /** Which edge the toast slides from — derived from the toaster's position. */
  fromSide: 'left' | 'right'
  /** Test id root — propagated down. */
  dataTestId?: string | undefined
  /** Fired when the toast should leave (close button or auto-dismiss). */
  onRequestDismiss: (toastId: string) => void
  /** Fired on mount once the toast has rendered with non-zero opacity. */
  onSeen: (toastId: string) => void
}

/**
 * Internal component — a single toast. Owns its own dismiss timer, which
 * pauses while the enclosing toaster is hovered/focused.
 */
export const Toast: React.FC<ToastProps> = React.memo(({
  toast,
  fromSide,
  dataTestId,
  onRequestDismiss,
  onSeen
}) => {
  const { paused } = useContext(ToasterInteractionContext)

  // Enter animation: start in `--pending` state, flip it off on the next
  // frame so the CSS transition plays.
  const [pending, setPending] = useState(true)
  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => { setPending(false) })
    return () => { cancelAnimationFrame(raf) }
  }, [])

  // Mark seen once the enter transition has begun (pending=false means
  // the class has been removed and the browser is interpolating opacity
  // from 0 toward 1 — the toast is visible in the DOM with opacity > 0).
  // Skipped for already-seen toasts and for exiting ones.
  useEffect(() => {
    if (toast.seen) return
    if (pending) return
    if (toast.exiting) return
    onSeen(toast.id)
  }, [toast.id, toast.seen, toast.exiting, pending, onSeen])

  // Freeze the current height as an inline `max-height` so that on exit
  // the `.toast--exiting` rule can transition max-height to 0. Without
  // a definite starting value, `max-height` can't animate. Re-measures
  // on content change (update-in-place) so the pinned value stays
  // accurate. We clear the previous pin before measuring — otherwise
  // `offsetHeight` returns the clipped height and the toast stays
  // sized to its old content.
  const rootRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (toast.exiting) return
    const el = rootRef.current
    if (!el) return
    el.style.maxHeight = ''
    const h = el.offsetHeight
    if (h > 0) el.style.maxHeight = `${h}px`
  }, [toast.exiting, toast.title, toast.body, toast.durationMs])

  // Auto-dismiss timer with pause support.
  const elapsedRef = useRef(0)
  const resumedAtRef = useRef<number | null>(null)
  const progressRef = useRef<HTMLDivElement | null>(null)

  // Reset timer when the toast is updated in place (createdAt changes).
  useEffect(() => {
    elapsedRef.current = 0
    resumedAtRef.current = null
  }, [toast.createdAt, toast.durationMs])

  useEffect(() => {
    const duration = toast.durationMs
    if (duration === undefined) return
    if (toast.exiting) return

    const tick = (): void => {
      // Sample the real elapsed time, accounting for pauses.
      const now = Date.now()
      let total = elapsedRef.current
      if (resumedAtRef.current !== null) total += now - resumedAtRef.current
      if (total >= duration) {
        onRequestDismiss(toast.id)
      }
    }

    // Start or resume.
    if (paused) {
      if (resumedAtRef.current !== null) {
        elapsedRef.current += Date.now() - resumedAtRef.current
        resumedAtRef.current = null
      }
      // Freeze the progress bar at its current width.
      const bar = progressRef.current
      if (bar) {
        const rect = bar.getBoundingClientRect()
        const parentRect = bar.parentElement?.getBoundingClientRect()
        const widthPct = parentRect && parentRect.width > 0 ? (rect.width / parentRect.width) * 100 : 0
        bar.style.transition = 'none'
        bar.style.width = `${widthPct}%`
      }
      return
    }

    resumedAtRef.current = Date.now()
    // Restart the progress-bar transition for the remaining time.
    const remaining = Math.max(0, duration - elapsedRef.current)
    const bar = progressRef.current
    if (bar) {
      const startPct = duration > 0 ? (elapsedRef.current / duration) * 100 : 0
      bar.style.transition = 'none'
      bar.style.width = `${startPct}%`
      // Next frame, start the animation to full width.
      requestAnimationFrame(() => {
        bar.style.transition = `width ${remaining}ms linear`
        bar.style.width = '100%'
      })
    }

    const id = window.setTimeout(tick, remaining + 10)
    return () => { window.clearTimeout(id) }
  }, [paused, toast.id, toast.createdAt, toast.durationMs, toast.exiting, onRequestDismiss])

  const handleKeyDown = useMemo(() => (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onRequestDismiss(toast.id)
    }
  }, [toast.id, onRequestDismiss])

  const rootClass = [
    'toast',
    pending ? 'toast--pending' : '',
    toast.exiting ? 'toast--exiting' : '',
    fromSide === 'right' ? 'toast--from-right' : 'toast--from-left'
  ].filter(Boolean).join(' ')

  const cellTestId = dataTestId ? `${dataTestId}-toast-${toast.id}` : undefined

  return (
    <div
      ref={rootRef}
      className={rootClass}
      role="status"
      aria-live={toast.ariaLive}
      data-toast-id={toast.id}
      data-toast-title={toast.title}
      data-toast-seen={toast.seen ? 'true' : 'false'}
      onKeyDown={handleKeyDown}
      {...(cellTestId && { 'data-testid': cellTestId })}
    >
      <div className="toast-header">
        <span className="toast-title">{toast.titleNode ?? toast.title}</span>
        <button
          type="button"
          className="toast-close"
          aria-label="Dismiss notification"
          onClick={() => { onRequestDismiss(toast.id) }}
          {...(cellTestId && { 'data-testid': `${cellTestId}-close` })}
        >
          <span className="codicon codicon-close" />
        </button>
      </div>
      <div className="toast-body">
        {toast.body}
      </div>
      {toast.durationMs !== undefined && (
        <div className="toast-progress">
          <div className="toast-progress-bar" ref={progressRef} />
        </div>
      )}
    </div>
  )
})

Toast.displayName = 'Toast'
