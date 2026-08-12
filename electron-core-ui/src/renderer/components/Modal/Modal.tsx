import React, { useCallback, useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Workbench } from '../Workbench/Workbench'
import { Button } from '../Button'
import { useOverlayPresence } from '../../hooks/useOverlayPresence'
import './modal.css'

export type ModalSize = 'full' | 'dialog'

/** Upper bound on the close fade (CSS: 120ms) before the overlay is torn
 * down regardless of whether `transitionend` ever arrived. Generous
 * enough never to cut a real animation short, short enough that a stuck
 * overlay is not perceptible. */
const CLOSE_FALLBACK_MS = 400

export interface ModalProps {
  title: React.ReactNode
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  /** Modal size: 'full' for fullscreen-like, 'dialog' for compact dialog box */
  size?: ModalSize
  /**
   * Dialog-size only: widens the compact dialog box beyond its default
   * 320-480px envelope (any CSS width value — `640`, `'52rem'`, `'70%'`).
   * Applied as both the dialog's width and its max-width, capped at 92vw so
   * a large value never overflows a small window. Ignored for `size='full'`.
   */
  dialogWidth?: number | string
  /**
   * Fired once the close animation has finished and the modal has
   * fully unmounted its content — i.e. the "really closed" signal, as
   * opposed to `onClose` which fires the instant the user requests a
   * close (start of the fade-out). Use this when something outside the
   * modal must only react after the fade completes. Driven by the
   * overlay's `transitionend`, so it is robust against React
   * StrictMode's mount/unmount probing (which never synthesises
   * transition events).
   */
  onClosed?: () => void
  /** Optional test id applied to the modal container. Defaults to `modal`. */
  'data-testid'?: string
  /**
   * Scope the modal to a CONTAINER instead of the whole window. When set, the
   * modal portals into the nearest ancestor matching this CSS selector (an
   * invisible in-place anchor resolves it) and its overlay is positioned
   * `absolute; inset: 0` over that container rather than `fixed` over the
   * viewport — so the backdrop (and its blur) covers only that region. The
   * container must be a positioned element (`position: relative` or similar).
   * Falls back to the full-window behaviour when no matching ancestor exists.
   */
  scopeToSelector?: string
  /**
   * `data-testid` of the button (inside the dialog) that a plain Enter
   * keypress triggers — the dialog's DEFAULT action, à la OS dialogs. Without
   * it, Enter merely activates whatever happens to hold focus (on open that
   * is the FIRST focusable, typically Cancel — so Enter on a fresh confirm
   * dialog dismissed it without doing the action).
   *
   * Enter keeps its native behaviour when the focus sits in a multiline
   * surface (a `<textarea>`, a contenteditable, a Monaco editor): it inserts
   * a newline there and never fires the default action. Modified Enter
   * (Shift/Ctrl/Alt/Meta) is never intercepted. A disabled designated button
   * is not clicked.
   */
  enterActionTestId?: string
  /**
   * `data-testid` of the element to focus when the dialog opens, instead of
   * the default "first focusable in DOM order" (which is the header close
   * button — so a dialog whose real entry point is a form field opened with
   * the wrong control armed). Falls back to the default when no element
   * matches. Only meaningful with `trapFocus` (the default).
   */
  initialFocusTestId?: string
  /**
   * Move focus into the dialog on open, trap Tab inside it, and restore focus
   * to the previously-focused element on close. Defaults to `true` — the
   * correct behaviour for an actual dialog (confirmation prompts, settings,
   * forms, …).
   *
   * Set to `false` when `Modal` is reused as a bare "show this existing
   * content bigger" wrapper rather than a real dialog — e.g. a workbench
   * tab's maximize view, where the content never remounts and the user's
   * focus (mid-edit in an embedded editor, a console, …) must stay put
   * across the maximize/restore toggle instead of jumping to the close
   * button.
   */
  trapFocus?: boolean
}

const ModalInner: React.FC<ModalProps> = ({
  title,
  isOpen,
  onClose,
  children,
  size = 'full',
  dialogWidth,
  onClosed,
  'data-testid': dataTestId,
  scopeToSelector,
  enterActionTestId,
  initialFocusTestId,
  trapFocus = true
}) => {
  const [isRendered, setIsRendered] = useState(isOpen)
  // Scoped mode: resolve the nearest ancestor matching `scopeToSelector` from
  // an in-place anchor, then portal the overlay there (instead of the body).
  const [scopedTarget, setScopedTarget] = useState<HTMLElement | null>(null)
  const anchorElRef = useRef<HTMLSpanElement | null>(null)
  const resolveScopedTarget = useCallback((el: HTMLSpanElement | null): void => {
    if (!el || scopeToSelector === undefined) return
    const found = el.closest(scopeToSelector)
    setScopedTarget(found instanceof HTMLElement ? found : null)
  }, [scopeToSelector])
  const setAnchor = useCallback((el: HTMLSpanElement | null): void => {
    anchorElRef.current = el
    resolveScopedTarget(el)
  }, [resolveScopedTarget])
  const [overlayState, setOverlayState] = useState<'open' | 'closing' | 'closed'>('closed')
  const wasOpenRef = useRef(isOpen)
  const rafIdsRef = useRef<number[]>([])
  // Read through a ref so the open/close orchestration effect stays keyed
  // on `isOpen` alone: re-running it whenever the consumer happens to pass
  // a fresh `onClosed` identity would restart the fade mid-flight.
  const onClosedRef = useRef(onClosed)
  useEffect(() => { onClosedRef.current = onClosed }, [onClosed])
  // Announce the modal's overlay footprint to listeners
  // (`MiniBrowserPanel` collapses its content view while a modal sits
  // over it). Active while the modal is rendered — including the
  // fade-out closing phase — so the view stays collapsed until the
  // overlay fully detaches.
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useOverlayPresence(overlayRef, isRendered)

  const rootTestId = dataTestId ?? 'modal'
  const overlayTestId = `${rootTestId}-overlay`
  const headerTestId = `${rootTestId}-header`
  const titleTestId = `${rootTestId}-title`
  const bodyTestId = `${rootTestId}-body`
  const closeButtonTestId = `${rootTestId}-close`

  const emitCloseRequest = useCallback((reason: 'escape' | 'button' | 'middle'): void => {
    if (typeof window === 'undefined') return
    if (typeof CustomEvent === 'undefined') return
    window.dispatchEvent(new CustomEvent('ecu-modal-close-request', { detail: { testId: rootTestId, reason } }))
  }, [rootTestId])

  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = isOpen

    if (isOpen) {
      // Mount first, then toggle to "open" on next frame to animate in.
      const raf1 = requestAnimationFrame(() => {
        setIsRendered(true)
        setOverlayState('closed')
        const raf2 = requestAnimationFrame(() => {
          setOverlayState('open')
        })
        rafIdsRef.current = [raf2]
      })
      return () => {
        cancelAnimationFrame(raf1)
        for (const id of rafIdsRef.current) cancelAnimationFrame(id)
        rafIdsRef.current = []
      }
    }

    if (wasOpen) {
      // Fade out, then unmount on transition end.
      const raf = requestAnimationFrame(() => {
        setOverlayState('closing')
      })
      rafIdsRef.current = [raf]
      // Safety net. Tearing the overlay down ONLY on `transitionend` means
      // any missed transition strands a full-screen overlay on top of the
      // app forever: it is invisible (opacity 0) but still swallows every
      // click, including on the title bar and menu bar, so the window
      // looks alive and answers nothing. A transition can legitimately
      // fail to fire — the element already at the target opacity, a
      // parent hidden mid-close, the tab backgrounded, a user agent
      // honouring reduced motion by dropping it. This timer completes the
      // teardown when that happens; when the transition does fire, the
      // handler wins and this is a no-op.
      const fallback = setTimeout(() => {
        setIsRendered(false)
        setOverlayState('closed')
        onClosedRef.current?.()
      }, CLOSE_FALLBACK_MS)
      return () => {
        clearTimeout(fallback)
        for (const id of rafIdsRef.current) cancelAnimationFrame(id)
        rafIdsRef.current = []
      }
    }

    return undefined
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        emitCloseRequest('escape')
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [emitCloseRequest, isOpen, onClose])

  // Focus management for the dialog (role=dialog aria-modal): move focus IN on
  // open, TRAP Tab inside it, and RESTORE focus to the previously-focused
  // element on close. Without this, keyboard + screen-reader users stay on the
  // element behind the overlay. Gated by `trapFocus` — a maximize-style
  // wrapper around pre-existing content opts out (see the prop doc) since
  // there is no "previously focused element outside the dialog" to move away
  // from, only the same content now shown bigger.
  //
  // Depends on `isRendered`, not just `isOpen`: on the render where `isOpen`
  // first flips true, the dialog hasn't mounted yet (`isRendered` only
  // catches up a frame later via the open/close orchestration effect above),
  // so `dialogRef.current` is still null. Without `isRendered` in the deps
  // this effect would bail out on that first pass and never get a second
  // chance to run — since `isOpen` doesn't change again, its dependency
  // array never fires it a second time — silently skipping the initial
  // focus, the Tab trap, AND the close-time restore (whose cleanup never
  // got registered in the first place).
  useEffect(() => {
    if (!isOpen || !isRendered || !trapFocus || typeof document === 'undefined') return
    const dialog = dialogRef.current
    if (!dialog) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusable = (): HTMLElement[] =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)

    // Move focus in: the designated initial-focus element when one matches,
    // else the first focusable child, else the dialog itself.
    const preferred = initialFocusTestId !== undefined
      ? dialog.querySelector<HTMLElement>(`[data-testid="${initialFocusTestId}"]`)
      : null
    const first = focusable()[0]
    ;(preferred ?? first ?? dialog).focus()

    const handleTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === firstEl || active === dialog)) {
        event.preventDefault()
        lastEl?.focus()
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault()
        firstEl?.focus()
      }
    }

    dialog.addEventListener('keydown', handleTab)
    return () => {
      dialog.removeEventListener('keydown', handleTab)
      // Restore focus to whatever had it before the modal opened.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [isOpen, isRendered, trapFocus, initialFocusTestId])

  // Default action on Enter (see the `enterActionTestId` prop doc). A
  // dialog-level listener, so a child that legitimately consumes Enter and
  // stops propagation (an open dropdown, Monaco) opts out on its own; the
  // multiline guard covers the surfaces that let Enter bubble.
  useEffect(() => {
    if (!isOpen || !isRendered || enterActionTestId === undefined) return
    const dialog = dialogRef.current
    if (!dialog) return

    const handleEnter = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter') return
      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
      const target = event.target instanceof HTMLElement ? event.target : null
      // Multiline surfaces keep their native Enter (newline), never the
      // default action.
      if (target && (
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('.monaco-editor') !== null
      )) return
      const btn = dialog.querySelector<HTMLElement>(`[data-testid="${enterActionTestId}"]`)
      if (!btn) return
      // Respect a disabled designated button (native `disabled`, aria, or the
      // ECUI Button's `disabled` class) — Enter then does nothing special.
      if (
        (btn as HTMLButtonElement).disabled ||
        btn.getAttribute('aria-disabled') === 'true' ||
        btn.classList.contains('disabled')
      ) return
      event.preventDefault()
      event.stopPropagation()
      btn.click()
    }

    dialog.addEventListener('keydown', handleEnter)
    return () => { dialog.removeEventListener('keydown', handleEnter) }
  }, [isOpen, isRendered, enterActionTestId])

  // Re-resolve the scoped container each time the modal OPENS. The anchor's
  // ref callback only fires on mount; without this, a container that was
  // unmounted / replaced between opens (tab switch, route change) would leave
  // `scopedTarget` pointing at a stale, detached node and the portal would
  // render into nothing. Re-resolving on every open keeps it pinned to the
  // live ancestor.
  useEffect(() => {
    if (isOpen && scopeToSelector !== undefined) resolveScopedTarget(anchorElRef.current)
  }, [isOpen, scopeToSelector, resolveScopedTarget])

  // In scoped mode the anchor must stay mounted across open/close so it can
  // (re)resolve the target on the next open.
  const scopedAnchor = scopeToSelector !== undefined
    ? <span ref={setAnchor} style={{ display: 'none' }} aria-hidden="true" />
    : null

  if (!isRendered) {
    return scopedAnchor
  }

  const overlayClassName = [
    'ecu-modal-overlay',
    overlayState === 'closing' ? 'ecu-modal-closing' : ''
  ].filter(Boolean).join(' ')

  const containerClassName = [
    'ecu-modal-container',
    size === 'dialog' ? 'ecu-modal-dialog' : ''
  ].filter(Boolean).join(' ')

  const handleCloseFromButton = (): void => {
    emitCloseRequest('button')
    onClose()
  }

  const handleCloseFromMiddleClick = (): void => {
    emitCloseRequest('middle')
    onClose()
  }

  const content = (
    <div
      ref={overlayRef}
      className={overlayClassName}
      data-state={overlayState}
      data-scoped={scopedTarget !== null ? 'true' : undefined}
      data-testid={overlayTestId}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.propertyName !== 'opacity') return
        // `!isOpen` guards a close that was superseded by a re-open
        // mid-fade: the cancelled fade-out still fires `transitionend`,
        // but if `isOpen` flipped back true the open-branch effect is
        // already driving `overlayState` back to `open` — tearing the
        // modal down (or firing `onClosed`) here would wipe the
        // re-opened state.
        if (overlayState === 'closing' && !isOpen) {
          setIsRendered(false)
          setOverlayState('closed')
          onClosed?.()
        }
      }}
    >
      {/* Transparent drag strip at the title-bar position. Lets the
       * user move the window even with a modal open — without it the
       * overlay swallows mouse events on the title bar region. The
       * strip is non-visual, only carries `-webkit-app-region: drag`.
       * Clickable WCO buttons sit above this strip via their own
       * elevated z-index. */}
      <div
        className="ecu-modal-drag-strip"
        data-testid={`${overlayTestId}-drag-strip`}
        aria-hidden="true"
      />
      <Workbench className="ecu-modal-workbench" border={false} fullscreen>
        <div
          ref={dialogRef}
          className={containerClassName}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
          data-testid={rootTestId}
          data-ready="true"
          data-size={size}
          data-is-open={isOpen ? 'true' : 'false'}
          tabIndex={-1}
          style={size === 'dialog' && dialogWidth !== undefined
            ? { width: dialogWidth, maxWidth: '92vw' }
            : undefined}
        >
          <div
            className="ecu-modal-header"
            data-testid={headerTestId}
            onMouseDown={(event) => {
              // Middle-click on the modal titlebar closes the modal
              if (event.button === 1) {
                event.preventDefault()
                handleCloseFromMiddleClick()
              }
            }}
          >
            <div className="ecu-modal-title" data-testid={titleTestId}>
              {title}
            </div>
            <Button
              small
              secondary
              icon="close"
              onClick={handleCloseFromButton}
              options={{ ariaLabel: 'Close modal' }}
              className="ecu-modal-close"
              data-testid={closeButtonTestId}
            />
          </div>
          <div className="ecu-modal-body" data-testid={bodyTestId}>
            {children}
          </div>
        </div>
      </Workbench>
    </div>
  )

  if (typeof document === 'undefined') {
    return content
  }

  // Scoped: portal into the resolved container (keeping the anchor mounted);
  // fall back to the full-window body portal until/unless a target resolves.
  if (scopeToSelector !== undefined) {
    return (
      <>
        {scopedAnchor}
        {scopedTarget ? createPortal(content, scopedTarget) : createPortal(content, document.body)}
      </>
    )
  }

  return createPortal(content, document.body)
}

export const Modal = React.memo(ModalInner)
