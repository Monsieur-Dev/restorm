/**
 * Tag — a label-shaped tag with optional custom color and inline editing.
 *
 * Uses a single contentEditable span for both display and editing,
 * seamlessly integrating with the tag shape.
 *
 * @example
 * ```tsx
 * import { Tag } from 'electron-core-ui/renderer'
 *
 * <Tag label="query" />
 * <Tag label="pet" color="#ff0000" />
 * <Tag label="edit me" editable onLabelChange={(v) => console.log(v)} />
 * ```
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { getContrastColor } from '../../utils/colorContrast'
import './tag.css'

export interface TagProps {
  /** Tag text */
  label: string
  /** Optional background color (hex). Text color is auto-computed for contrast. */
  color?: string | undefined
  /** Compact mode (smaller font, tighter padding) */
  compact?: boolean
  /** Whether the tag can be edited inline (default: false) */
  editable?: boolean
  /** Called when the tag label changes (only when editable) */
  onLabelChange?: (newLabel: string) => void
  /** Called when the tag should be removed (empty text on edit commit) */
  onRemove?: () => void
  /** Start in editing mode (for newly created tags) */
  startEditing?: boolean
  /** Click handler */
  onClick?: () => void
  /** Context menu handler */
  onContextMenu?: (event: React.MouseEvent) => void
  /** Test ID */
  'data-testid'?: string
}

function selectAll(el: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

export const Tag: React.FC<TagProps> = ({
  label,
  color,
  compact = false,
  editable = false,
  onLabelChange,
  onRemove,
  startEditing = false,
  onClick,
  onContextMenu,
  'data-testid': testId
}) => {
  const [isEditing, setIsEditing] = useState(startEditing)
  const spanRef = useRef<HTMLSpanElement>(null)

  const hasCustomColor = !!color
  const textColor = hasCustomColor ? getContrastColor(color) : undefined

  // Enter editing mode: focus + select all
  useEffect(() => {
    if (isEditing && spanRef.current) {
      spanRef.current.focus()
      selectAll(spanRef.current)
    }
  }, [isEditing])

  const commitEdit = useCallback(() => {
    const text = spanRef.current?.textContent ?? ''
    const trimmed = text.trim()
    if (!trimmed) {
      onRemove?.()
    } else if (trimmed !== label) {
      onLabelChange?.(trimmed)
    } else if (spanRef.current) {
      // Reset text to label (in case of whitespace changes)
      spanRef.current.textContent = label
    }
    setIsEditing(false)
  }, [label, onLabelChange, onRemove])

  const cancelEdit = useCallback(() => {
    if (!label.trim()) {
      onRemove?.()
    } else if (spanRef.current) {
      spanRef.current.textContent = label
    }
    setIsEditing(false)
  }, [label, onRemove])

  const handleClick = useCallback(() => {
    if (editable && !isEditing) {
      setIsEditing(true)
    } else if (!editable) {
      onClick?.()
    }
  }, [editable, isEditing, onClick])

  const className = [
    'ecui-tag',
    hasCustomColor ? '' : 'ecui-tag--default',
    compact ? 'ecui-tag--compact' : '',
    isEditing ? 'ecui-tag--editing' : ''
  ].filter(Boolean).join(' ')

  const style: React.CSSProperties | undefined = hasCustomColor
    ? { backgroundColor: color, color: textColor }
    : undefined

  return (
    <span
      className={className}
      style={style}
      onClick={handleClick}
      onContextMenu={isEditing ? undefined : onContextMenu}
      data-testid={testId}
    >
      <span
        ref={spanRef}
        className={isEditing ? 'ecui-tag-input' : undefined}
        contentEditable={isEditing}
        suppressContentEditableWarning
        role={isEditing ? 'textbox' : undefined}
        onBlur={isEditing ? commitEdit : undefined}
        onKeyDown={isEditing ? (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
          if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
        } : undefined}
        onInput={isEditing ? (e) => {
          const text = (e.target as HTMLSpanElement).textContent
          if (text && text.length > 30) {
            (e.target as HTMLSpanElement).textContent = text.substring(0, 30)
            const range = document.createRange()
            range.selectNodeContents(e.target as HTMLSpanElement)
            range.collapse(false)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          }
        } : undefined}
      >
        {label}
      </span>
    </span>
  )
}
