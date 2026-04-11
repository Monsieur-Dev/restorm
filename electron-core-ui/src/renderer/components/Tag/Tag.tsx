/**
 * Tag — a label-shaped tag with optional custom color and inline editing.
 *
 * Features:
 * - Clothing-label shape (angled left notch with decorative hole punch)
 * - Custom background color with auto-computed contrast text color (black/white)
 * - Compact variant for smaller contexts (e.g. search results)
 * - Optional inline editing with auto-sizing input
 *
 * @example
 * ```tsx
 * import { Tag } from 'electron-core-ui/renderer'
 *
 * <Tag label="query" />
 * <Tag label="pet" color="#ff0000" />
 * <Tag label="edit me" editable onLabelChange={(v) => console.log(v)} />
 * <Tag label="small" compact />
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
  /** Click handler */
  onClick?: () => void
  /** Context menu handler */
  onContextMenu?: (event: React.MouseEvent) => void
  /** Test ID */
  'data-testid'?: string
}

export const Tag: React.FC<TagProps> = ({
  label,
  color,
  compact = false,
  editable = false,
  onLabelChange,
  onClick,
  onContextMenu,
  'data-testid': testId
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasCustomColor = !!color
  const textColor = hasCustomColor ? getContrastColor(color) : undefined

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== label) {
      onLabelChange?.(trimmed)
    }
    setIsEditing(false)
  }, [editValue, label, onLabelChange])

  const cancelEdit = useCallback(() => {
    setEditValue(label)
    setIsEditing(false)
  }, [label])

  const handleClick = useCallback(() => {
    if (editable) {
      setEditValue(label)
      setIsEditing(true)
    } else {
      onClick?.()
    }
  }, [editable, label, onClick])

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
      onClick={isEditing ? undefined : handleClick}
      onContextMenu={isEditing ? undefined : onContextMenu}
      data-testid={testId}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          className="ecui-tag-input"
          type="text"
          value={editValue}
          maxLength={30}
          style={{ width: `${Math.max(0.5, editValue.length * 0.85)}ch` }}
          onChange={(e) => { setEditValue(e.target.value) }}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
          }}
        />
      ) : (
        label
      )}
    </span>
  )
}
