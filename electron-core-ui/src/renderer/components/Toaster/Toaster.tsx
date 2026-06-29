import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Workbench from '../Workbench/Workbench'
import { Button } from '../Button'
import { ScrollableElement } from '../ScrollableElement'
import { Toast } from './Toast'
import { ToasterInteractionContext } from './ToasterInteractionContext'
import { toasterService, TOASTER_DEFAULTS } from './ToasterService'
import type { Toast as ToastData, ToasterProps } from './types'
import { useOverlayPresence } from '../../hooks/useOverlayPresence'
import './toaster.css'

const DEFAULT_ENTER = 200
const DEFAULT_EXIT = 150
const DEFAULT_REFLOW = 200

/**
 * Portal-rendered toast container. Registers itself with the
 * `toasterService` under the given `id` so that any caller can push
 * toasts to it via `toasterService.push(id, …)` or the `useToasts(id)`
 * hook. See the component README for the full usage.
 */
export const Toaster: React.FC<ToasterProps> = ({
  id,
  position,
  width = 450,
  order = 'desc',
  initialShowFrame = false,
  initialDoNotDisturb = false,
  maxToasts = TOASTER_DEFAULTS.MAX_TOASTS,
  margin = 8,
  animationDurations,
  'data-testid': dataTestId
}) => {
  const { t: translate } = useTranslation()
  const enterMs = animationDurations?.enter ?? DEFAULT_ENTER
  const exitMs = animationDurations?.exit ?? DEFAULT_EXIT
  const reflowMs = animationDurations?.reflow ?? DEFAULT_REFLOW

  // ── Register / unregister with the service ──────────────────────
  // Only `id` drives registration identity; `initial*` and `maxToasts`
  // are captured via refs so they don't retrigger register/unregister
  // on every prop tick.
  const initialRef = useRef({
    showFrame: initialShowFrame,
    doNotDisturb: initialDoNotDisturb,
    maxToasts
  })
  useEffect(() => {
    toasterService.register(id, initialRef.current)
    return () => { toasterService.unregister(id) }
  }, [id])

  // ── Service-backed reactive state via useSyncExternalStore ──────
  const subscribeToasts = useCallback((onStoreChange: () => void) => {
    return toasterService.on('toastsChange', (toasterId) => {
      if (toasterId === id) onStoreChange()
    })
  }, [id])
  const toasts = useSyncExternalStore<ToastData[]>(
    subscribeToasts,
    () => toasterService.getToasts(id)
  )

  const subscribeShowFrame = useCallback((onStoreChange: () => void) => {
    return toasterService.on('showFrameChange', (toasterId) => {
      if (toasterId === id) onStoreChange()
    })
  }, [id])
  const showFrame = useSyncExternalStore<boolean>(
    subscribeShowFrame,
    () => toasterService.getShowFrame(id)
  )

  // ── Pause on hover / focus ──────────────────────────────────────
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const interaction = useMemo(() => ({ paused: hovered || focused }), [hovered, focused])

  // ── Dismiss with exit-animation grace period ────────────────────
  const handleDismiss = useCallback((toastId: string) => {
    toasterService.dismiss(id, toastId, exitMs)
  }, [id, exitMs])

  const handleMarkSeen = useCallback((toastId: string) => {
    toasterService.markSeen(id, toastId)
  }, [id])

  const handleClearAll = useCallback(() => {
    // Mark each toast as exiting first (gives them their animation),
    // then clear at once after the exit duration.
    const current = toasterService.getToasts(id)
    for (const t of current) {
      toasterService.dismiss(id, t.id, exitMs)
    }
  }, [id, exitMs])

  const handleHide = useCallback(() => {
    toasterService.hide(id)
  }, [id])

  const subscribeDnd = useCallback((onStoreChange: () => void) => {
    return toasterService.on('doNotDisturbChange', (toasterId) => {
      if (toasterId === id) onStoreChange()
    })
  }, [id])
  const doNotDisturbNow = useSyncExternalStore<boolean>(
    subscribeDnd,
    () => toasterService.getDoNotDisturb(id)
  )

  const handleToggleDnd = useCallback(() => {
    toasterService.toggleDoNotDisturb(id)
  }, [id])

  // ── FLIP reflow animation when the list reshuffles ──────────────
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const positionsRef = useRef<Map<string, number>>(new Map())
  const flipReadyRef = useRef(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => { flipReadyRef.current = true })
      return () => { cancelAnimationFrame(raf2) }
    })
    return () => { cancelAnimationFrame(raf) }
  }, [])
  // Key the effect on `toasts` so it only runs when the list actually
  // changes. Running on every render (e.g. on hover) makes spurious
  // pixel-rounding differences trigger FLIP transforms.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const prev = positionsRef.current
    const next = new Map<string, number>()
    const rows = body.querySelectorAll<HTMLElement>('[data-toast-id]')
    // Skip FLIP when:
    //   - a toast is exiting: the CSS max-height/margin-bottom
    //     transition on `.toast--exiting` shrinks the layout smoothly;
    //     remaining toasts slide down naturally, no FLIP needed.
    //   - a toast was just removed (finalize): positionsRef still
    //     holds pre-exit positions (useLayoutEffect only ran at
    //     dismiss-start, not during the interpolation), so a FLIP now
    //     would snap toasts back up and re-animate the whole slide.
    //   - the set of ids is unchanged: this is an update-in-place
    //     (same toast ids, one or more had content/height changes).
    //     A height delta on one toast makes its neighbors shift, but
    //     those neighbors didn't "move into a new slot" — animating
    //     them would just add a slow drift on top of the browser's
    //     instant reflow.
    const anyExiting = toasts.some((t) => t.exiting)
    const currentIds = new Set(toasts.map((t) => t.id))
    const anyRemoved = [...prev.keys()].some((id) => !currentIds.has(id))
    const sameIds = !anyRemoved && toasts.length === prev.size
    const skipFlip = anyExiting || anyRemoved || sameIds
    rows.forEach((el) => {
      const toastId = el.dataset['toastId']
      if (!toastId) return
      const top = el.getBoundingClientRect().top
      next.set(toastId, top)
      if (!flipReadyRef.current) return
      if (skipFlip) return
      const prevTop = prev.get(toastId)
      // Sub-pixel threshold avoids false positives from rounding.
      if (prevTop !== undefined && Math.abs(prevTop - top) > 0.5) {
        const delta = prevTop - top
        el.style.transition = 'none'
        el.style.transform = `translateY(${delta}px)`
        requestAnimationFrame(() => {
          el.style.transition = `transform ${reflowMs}ms ease-out, opacity ${enterMs}ms ease-out`
          el.style.transform = ''
        })
      }
    })
    positionsRef.current = next
  }, [toasts, reflowMs, enterMs])

  // ── Render ──────────────────────────────────────────────────────
  // When the frame is closed, transparent mode only displays toasts
  // that aren't flagged `hidden`. When the frame is open, all toasts
  // are shown regardless (and are un-hidden by `setShowFrame(true)`).
  const visibleToasts = showFrame ? toasts : toasts.filter((t) => !t.hidden)
  const wantsRender = showFrame || visibleToasts.length > 0
  // Register the visible toast cluster with the overlay-presence service
  // so the MiniBrowser (or any other compositor-level surface) can step
  // out of its way. Only when there's at least one toast on screen —
  // when the toaster is empty, there's nothing for us to occlude.
  const toasterRootRef = useRef<HTMLDivElement>(null)
  useOverlayPresence(toasterRootRef, visibleToasts.length > 0)

  // Mount/unmount fade: keep the component in the DOM for `exitMs`
  // after `wantsRender` goes false so the fade-out CSS has time to
  // play. `entering` is raised on each transition from closed→open
  // so the first paint sits at opacity 0, and the class is flipped
  // off next frame to trigger the fade-in transition.
  //
  // All state changes happen inside timer callbacks (microtask or
  // setTimeout) so no setState runs synchronously in an effect body.
  const [visible, setVisible] = useState(wantsRender)
  const [entering, setEntering] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (wantsRender) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      if (!visible) {
        queueMicrotask(() => {
          setVisible(true)
          setEntering(true)
        })
      }
      return
    }
    if (!visible || closeTimerRef.current) return
    closeTimerRef.current = setTimeout(() => {
      setVisible(false)
      closeTimerRef.current = null
    }, exitMs)
  }, [wantsRender, visible, exitMs])
  useLayoutEffect(() => {
    if (!entering) return
    const raf = requestAnimationFrame(() => { setEntering(false) })
    return () => { cancelAnimationFrame(raf) }
  }, [entering])

  const closing = visible && !wantsRender

  if (!visible) return null
  if (typeof document === 'undefined') return null

  // Order: 'desc' → newest closest to the anchored corner. Given the
  // corners, for top-* we want the list top to be the newest, for
  // bottom-* the newest at the bottom. Data is stored oldest-first, so
  // we reverse when the anchor is top-*.
  const anchorTop = position.startsWith('top-')
  const asc = order === 'asc'
  const orderedToasts: ToastData[] = (() => {
    if (asc) return anchorTop ? [...visibleToasts].reverse() : [...visibleToasts]
    // desc
    return anchorTop ? [...visibleToasts] : [...visibleToasts].reverse()
  })()

  const fromSide: 'left' | 'right' = position.endsWith('-right') ? 'right' : 'left'

  const rootClass = [
    'toaster',
    showFrame ? 'toaster--framed' : '',
    entering ? 'toaster--entering' : '',
    closing ? 'toaster--closing' : ''
  ].filter(Boolean).join(' ')

  const cssVars = {
    '--toaster-margin': `${margin}px`,
    '--toaster-enter-duration': `${enterMs}ms`,
    '--toaster-exit-duration': `${exitMs}ms`,
    width: `${width}px`
  } as React.CSSProperties

  const content = (
    <Workbench className="toaster-workbench" border={false}>
      <div
        ref={toasterRootRef}
        className={rootClass}
        data-position={position}
        data-showframe={showFrame ? 'true' : 'false'}
        data-donotdisturb={doNotDisturbNow ? 'true' : 'false'}
        data-toast-count={visibleToasts.length}
        role="region"
        aria-label={translate('toaster.notificationsRegion')}
        style={cssVars}
        onMouseEnter={() => { setHovered(true) }}
        onMouseLeave={() => { setHovered(false) }}
        onFocus={() => { setFocused(true) }}
        onBlur={(e) => {
          // Only clear focused when focus truly leaves the toaster.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setFocused(false)
        }}
        {...(dataTestId && { 'data-testid': dataTestId })}
      >
        {showFrame && (
          <div className="toaster-header" data-testid={dataTestId ? `${dataTestId}-header` : undefined}>
            <span
              className={`toaster-header-label${visibleToasts.length > 0 ? ' toaster-header-label--hidden' : ''}`}
              data-testid={dataTestId ? `${dataTestId}-empty-label` : undefined}
            >
              No new notifications
            </span>
            <div className="toaster-header-actions">
              <Button
                small
                secondary
                icon="clear-all"
                options={{ ariaLabel: 'Clear all', title: 'Clear all' }}
                onClick={handleClearAll}
                {...(dataTestId && { 'data-testid': `${dataTestId}-clear` })}
              />
              <Button
                small
                secondary
                icon="bell-slash"
                options={{ ariaLabel: 'Do not disturb', title: 'Do not disturb' }}
                onClick={handleToggleDnd}
                {...(dataTestId && { 'data-testid': `${dataTestId}-dnd` })}
                {...(doNotDisturbNow && { emphasis: 1 })}
              />
              <Button
                small
                secondary
                icon="chevron-down"
                options={{ ariaLabel: 'Hide', title: 'Hide' }}
                onClick={handleHide}
                {...(dataTestId && { 'data-testid': `${dataTestId}-hide` })}
              />
            </div>
          </div>
        )}
        <ScrollableElement
          className="toaster-scroll"
          contentClassName="toaster-body"
          contentRef={bodyRef}
          options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false, handleMouseWheel: false }}
        >
          <ToasterInteractionContext.Provider value={interaction}>
            {orderedToasts.map((t) => (
              <Toast
                key={t.id}
                toast={t}
                fromSide={fromSide}
                dataTestId={dataTestId}
                onRequestDismiss={handleDismiss}
                onSeen={handleMarkSeen}
              />
            ))}
          </ToasterInteractionContext.Provider>
        </ScrollableElement>
      </div>
    </Workbench>
  )

  return createPortal(content, document.body)
}
