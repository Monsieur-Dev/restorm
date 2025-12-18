import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import MonacoWorkbench from '../MonacoWorkbench'
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
  const [visible, setVisible] = useState(isOpen)

  useEffect(() => {
    if (isOpen) {
      setVisible(true)
      return
    }

    const timeout = window.setTimeout(() => {
      setVisible(false)
    }, 150)

    return () => {
      window.clearTimeout(timeout)
    }
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

  if (!visible) {
    return null
  }

  const overlayClassName = [
    'ecu-modal-overlay',
    !isOpen ? 'ecu-modal-closing' : ''
  ].filter(Boolean).join(' ')

  const containerClassName = [
    'ecu-modal-container',
    size === 'dialog' ? 'ecu-modal-dialog' : ''
  ].filter(Boolean).join(' ')

  const content = (
    <div className={overlayClassName}>
      <MonacoWorkbench className="ecu-modal-workbench" border={false} fullscreen>
        <div
          className={containerClassName}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
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
      </MonacoWorkbench>
    </div>
  )

  if (typeof document === 'undefined') {
    return content
  }

  return createPortal(content, document.body)
}

export default Modal
