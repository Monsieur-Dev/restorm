import React, { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import Workbench from '../Workbench/Workbench'
import { Button } from '../Button'
import './modal.css'

export type ModalSize = 'full' | 'dialog'

export interface ModalProps {
  title: React.ReactNode
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  /** Modal size: 'full' for fullscreen-like, 'dialog' for compact dialog box */
  size?: ModalSize
}

export const Modal: React.FC<ModalProps> = ({ title, isOpen, onClose, children, size = 'full' }) => {
  const [isRendered, setIsRendered] = useState(isOpen)
  const [overlayState, setOverlayState] = useState<'open' | 'closing' | 'closed'>('closed')
  const wasOpenRef = useRef(isOpen)
  const rafIdsRef = useRef<number[]>([])

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
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isRendered) {
    return null
  }

  const overlayClassName = [
    'ecu-modal-overlay',
    overlayState === 'closing' ? 'ecu-modal-closing' : ''
  ].filter(Boolean).join(' ')

  const containerClassName = [
    'ecu-modal-container',
    size === 'dialog' ? 'ecu-modal-dialog' : ''
  ].filter(Boolean).join(' ')

  const content = (
    <div
      className={overlayClassName}
      data-state={overlayState}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.propertyName !== 'opacity') return
        if (overlayState === 'closing') {
          setIsRendered(false)
          setOverlayState('closed')
        }
      }}
    >
      <Workbench className="ecu-modal-workbench" border={false} fullscreen>
        <div
          className={containerClassName}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
          data-testid="modal"
          data-ready="true"
        >
          <div
            className="ecu-modal-header"
            onMouseDown={(event) => {
              // Middle-click on the modal titlebar closes the modal
              if (event.button === 1) {
                event.preventDefault()
                onClose()
              }
            }}
          >
            <div className="ecu-modal-title">
              {title}
            </div>
            <Button
              small
              secondary
              icon="close"
              onClick={onClose}
              options={{ ariaLabel: 'Close modal' }}
              className="ecu-modal-close"
            />
          </div>
          <div className="ecu-modal-body">
            {children}
          </div>
        </div>
      </Workbench>
    </div>
  )

  if (typeof document === 'undefined') {
    return content
  }

  return createPortal(content, document.body)
}

export default Modal
