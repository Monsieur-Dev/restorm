import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../Button'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'

import './tagsView.css'

export interface TagsViewProps {
  /** List of tag labels to display */
  tags: string[]
  /** Called when tags change (add, rename, remove) */
  onChange?: (tags: string[]) => void
  /** Label for the "Remove tag" menu item. @default "Remove tag" */
  removeTagLabel?: string
  className?: string
  style?: React.CSSProperties
}

export const TagsView: React.FC<TagsViewProps> = ({ tags, onChange, removeTagLabel = 'Remove tag', className, style }) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState<string>('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    index: number | null
  }>({
    visible: false,
    x: 0,
    y: 0,
    index: null
  })

  // Ensure editing index stays in bounds when tags array changes
  useEffect(() => {
    if (editingIndex != null && (editingIndex < 0 || editingIndex >= tags.length)) {
      setEditingIndex(null)
      setEditingValue('')
    }
  }, [editingIndex, tags.length])

  // Focus input when entering editing mode
  useEffect(() => {
    if (editingIndex != null && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingIndex])

  const beginEditing = useCallback(
    (index: number) => {
      setEditingIndex(index)
      setEditingValue(tags[index] ?? '')
    },
    [tags]
  )

  const commitEditing = useCallback(() => {
    if (editingIndex == null) return
    const trimmed = editingValue.trim()

    if (!trimmed) {
      // Empty value removes the tag
      const next = tags.filter((_t, i) => i !== editingIndex)
      onChange?.(next)
    } else if (trimmed !== tags[editingIndex]) {
      const next = tags.slice()
      next[editingIndex] = trimmed
      onChange?.(next)
    }

    setEditingIndex(null)
    setEditingValue('')
  }, [editingIndex, editingValue, tags, onChange])

  const cancelEditing = useCallback(() => {
    setEditingIndex(null)
    setEditingValue('')
  }, [])

  const handleAddTag = useCallback(() => {
    const next = [...tags, '']
    onChange?.(next)
    setEditingIndex(next.length - 1)
    setEditingValue('')
  }, [onChange, tags])

  const handleRemoveAt = useCallback(
    (index: number) => {
      const next = tags.filter((_t, i) => i !== index)
      onChange?.(next)
      if (editingIndex != null && index === editingIndex) {
        cancelEditing()
      }
    },
    [cancelEditing, editingIndex, onChange, tags]
  )

  const menuItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        id: 'remove',
        label: removeTagLabel,
        icon: 'close',
        onClick: () => {
          if (contextMenu.index != null) {
            handleRemoveAt(contextMenu.index)
          }
        }
      }
    ],
    [contextMenu.index, handleRemoveAt, removeTagLabel]
  )

  const rootClassName = useMemo(
    () => ['ecui-tags-view', className].filter(Boolean).join(' '),
    [className]
  )

  return (
    <div className={rootClassName} style={style}>
      <div className="ecui-tags-view-list">
        {tags.map((tag, index) => {
          const isEditing = editingIndex === index

          if (isEditing) {
            return (
              <div
                key={`${tag}-${index}`}
                className="ecui-tag ecui-tag--editing"
              >
                <input
                  ref={inputRef}
                  className="ecui-tag-input"
                  type="text"
                  value={editingValue}
                  onChange={(event) => {
                    setEditingValue(event.target.value)
                  }}
                  onBlur={commitEditing}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitEditing()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelEditing()
                    }
                  }}
                />
              </div>
            )
          }

          return (
            <button
              key={`${tag}-${index}`}
              type="button"
              className="ecui-tag"
              onClick={() => {
                beginEditing(index)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setContextMenu({
                  visible: true,
                  x: event.clientX,
                  y: event.clientY,
                  index
                })
              }}
            >
              <span className="ecui-tag-label">{tag}</span>
            </button>
          )
        })}

        <Button
          small
          secondary
          icon="add"
          onClick={handleAddTag}
        />
      </div>

      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        items={menuItems}
        onRequestClose={() => {
          setContextMenu((prev) => ({ ...prev, visible: false }))
        }}
      />
    </div>
  )
}

export default TagsView
