import React, { useCallback, useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import Workbench from '../Workbench/Workbench'
import { Button } from '../Button'
import { useOverlayPresence } from '../../hooks/useOverlayPresence'
import './modal.css'

export type ModalSize = 'full' | 'dialog'

export interface ModalProps {
  title: React.ReactNode
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  /** Modal size: 'full' for fullscreen-like, 'dialog' for compact dialog box */
  size?: ModalSize
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
}

const ModalInner: React.FC<ModalProps> = ({
  title,
  isOpen,
  onClose,
  children,
  size = 'full',
  onClosed,
  'data-testid': dataTestId,
  scopeToSelector
}) => {
  const [isRendered, setIsRendered] = useState(isOpen)
  // Scoped mode: resolve the nearest ancestor matching `scopeToSelector` from
  // an in-place anchor, then portal the overlay there (instead of the body).
  const [scopedTarget, setScopedTarget] = useState<HTMLElement | null>(null)
  const setAnchor = useCallback((el: HTMLSpanElement | null): void => {
    if (!el || scopeToSelector === undefined) return
    const found = el.closest(scopeToSelector)
    setScopedTarget(found instanceof HTMLElement ? found : null)
  }, [scopeToSelector])
  const [overlayState, setOverlayState] = useState<'open' | 'closing' | 'closed'>('closed')
  const wasOpenRef = useRef(isOpen)
  const rafIdsRef = useRef<number[]>([])
  // Announce the modal's overlay footprint to listeners
  // (`MiniBrowserPanel` collapses its content view while a modal sits
  // over it). Active while the modal is rendered — including the
  // fade-out closing phase — so the view stays collapsed until the
  // overlay fully detaches.
  const overlayRef = useRef<HTMLDivElement>(null)
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
      return () => {
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
          className={containerClassName}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
          data-testid={rootTestId}
          data-ready="true"
          data-size={size}
          data-is-open={isOpen ? 'true' : 'false'}
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
export default Modal
