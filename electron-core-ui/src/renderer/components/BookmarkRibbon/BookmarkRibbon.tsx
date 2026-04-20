import React, { useCallback, useEffect, useRef, useState } from 'react'
import { getContrastColor } from '../../utils/colorContrast'
import { getColorFromString } from '../../utils/colorFromString'
import { Tooltip } from '../Tooltip'
import { ColorPicker } from '../ColorPicker'
import { Button } from '../Button'
import { InputBox } from '../InputBox'

import './bookmarkRibbon.css'

export interface BookmarkRibbonProps {
  label: string
  /** Explicit colour override. Falls back to a deterministic colour
   * derived from the label when omitted. */
  color?: string
  /** Rename handler — called on tooltip-editor commit. */
  onRename?: (next: string) => void
  /** Colour change handler — called from the tooltip colour picker.
   * When omitted, the picker is hidden from the editor tooltip. */
  onColorChange?: (hex: string) => void
  /** Remove handler — optional; when omitted the trash button is hidden. */
  onRemove?: () => void
  /** Extra class forwarded to the ribbon root. */
  className?: string
  'data-testid'?: string
}

/**
 * Bookmark-style ribbon. Idle: a thin vertical colour strip stuck to
 * the top edge of its positioned ancestor. Hover: the strip extends
 * downward and the label rotates 90° clockwise, reading top-to-bottom.
 * Click: opens a small editor tooltip (rename / recolour / remove).
 *
 * Layout is position-agnostic — use `<BookmarkRibbonStack>` to anchor
 * a row of ribbons to the top-right of a pane.
 */
export const BookmarkRibbon: React.FC<BookmarkRibbonProps> = ({
  label,
  color,
  onRename,
  onColorChange,
  onRemove,
  className,
  'data-testid': dataTestId
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [draftLabel, setDraftLabel] = useState(label)
  const rootRef = useRef<HTMLButtonElement | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)

  // Close the editor tooltip when the user clicks outside of the
  // ribbon button + the tooltip content. `mousedown` runs before
  // `click`, so any intent to interact with the current tooltip is
  // already handled by the editor's own `stopPropagation` before we
  // reach here.
  useEffect(() => {
    if (!isOpen) return undefined
    const handler = (ev: MouseEvent): void => {
      const target = ev.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      if (editorRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => { document.removeEventListener('mousedown', handler) }
  }, [isOpen])

  const effectiveColor = color ?? getColorFromString(label)
  const textColor = getContrastColor(effectiveColor)

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) setDraftLabel(label)
      return !prev
    })
  }, [label])

  const handleCommitRename = useCallback(() => {
    const trimmed = draftLabel.trim()
    if (trimmed && trimmed !== label && onRename) {
      onRename(trimmed)
    }
  }, [draftLabel, label, onRename])

  const handleRemove = useCallback(() => {
    setIsOpen(false)
    onRemove?.()
  }, [onRemove])

  const rootClasses = [
    'ecui-bookmark-ribbon',
    isOpen ? 'ecui-bookmark-ribbon--open' : '',
    className ?? ''
  ].filter(Boolean).join(' ')

  return (
    <>
      <button
        ref={rootRef}
        type="button"
        className={rootClasses}
        style={{ '--bookmark-color': effectiveColor, '--bookmark-text-color': textColor } as React.CSSProperties}
        aria-label={`Tag: ${label}`}
        aria-expanded={isOpen}
        onClick={handleToggle}
        {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
      >
        <span className="ecui-bookmark-ribbon-label">{label}</span>
      </button>
      <Tooltip
        targetRef={rootRef as React.RefObject<HTMLElement | null>}
        show={isOpen}
        placement="below"
        className="ecui-bookmark-ribbon-tooltip"
        {...(dataTestId ? { 'data-testid': `${dataTestId}-tooltip` } : {})}
        content={
          <div
            ref={editorRef}
            className="ecui-bookmark-ribbon-editor"
            onMouseDown={(e) => { e.stopPropagation() }}
          >
            <InputBox
              options={{ placeholder: 'Tag name' }}
              value={draftLabel}
              onChange={(next) => { setDraftLabel(next) }}
              onBlur={handleCommitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleCommitRename()
                  setIsOpen(false)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setIsOpen(false)
                }
              }}
              {...(dataTestId ? { 'data-testid': `${dataTestId}-rename-input` } : {})}
            />
            {onColorChange ? (
              <ColorPicker
                value={effectiveColor}
                onChange={onColorChange}
                disableAlpha
                {...(dataTestId ? { 'data-testid': `${dataTestId}-color-picker` } : {})}
              />
            ) : null}
            {onRemove ? (
              <Button
                secondary
                icon="trash"
                onClick={handleRemove}
                options={{ ariaLabel: 'Remove tag', title: 'Remove tag' }}
                {...(dataTestId ? { 'data-testid': `${dataTestId}-remove` } : {})}
              />
            ) : null}
          </div>
        }
      />
    </>
  )
}

export default BookmarkRibbon
