import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../Button'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'

import '../Tag/tag.css'
import './tagsView.css'

export interface TagsViewProps {
  /** List of tag labels to display */
  tags: string[]
  /** Called when tags change (add, rename, remove) */
  onChange?: (tags: string[]) => void
  /** Label for the "Remove tag" menu item. @default Uses i18n translation key 'tagsView.removeTag' */
  removeTagLabel?: string
  /** Optional test id applied to the root element. */
  'data-testid'?: string
  className?: string
  style?: React.CSSProperties
  /** Custom tag renderer. Replaces the default tag button. */
  renderTag?: ((tag: string, index: number, handlers: { onClick: () => void; onContextMenu: (e: React.MouseEvent) => void }) => React.ReactNode) | undefined
  /** Additional context menu items added before the default items */
  additionalContextMenuItems?: ((tag: string, index: number) => ContextMenuItem[]) | undefined
}

export const TagsView: React.FC<TagsViewProps> = ({ tags, onChange, removeTagLabel, className, style, 'data-testid': dataTestId, renderTag, additionalContextMenuItems }) => {
  const testId = dataTestId ?? 'tagsview'
  const { t } = useTranslation()
  const resolvedRemoveTagLabel = removeTagLabel ?? t('tagsView.removeTag')
  const [rawEditingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState<string>('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Derive effective editing index - automatically null if out of bounds
  const editingIndex = rawEditingIndex !== null && rawEditingIndex >= 0 && rawEditingIndex < tags.length
    ? rawEditingIndex
    : null

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

  const newTagLabel = t('tagsView.newTag', 'New tag')

  const handleAddTag = useCallback(() => {
    const next = [...tags, newTagLabel]
    onChange?.(next)
    // Only enter built-in editing mode if no custom renderTag is provided.
    // When renderTag is used, the Tag component handles editing via startEditing.
    if (!renderTag) {
      setEditingIndex(next.length - 1)
      setEditingValue(newTagLabel)
    }
  }, [onChange, tags, renderTag, newTagLabel])

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
    () => {
      const extra = (contextMenu.index != null && additionalContextMenuItems)
        ? additionalContextMenuItems(tags[contextMenu.index] ?? '', contextMenu.index)
        : []
      return [
        ...extra,
        ...(extra.length > 0 ? [{ id: 'separator-before-remove', label: '', isSeparator: true }] : []),
        {
          id: 'remove',
          label: resolvedRemoveTagLabel,
          icon: 'close',
          onClick: () => {
            if (contextMenu.index != null) {
              handleRemoveAt(contextMenu.index)
            }
          }
        }
      ]
    },
    [contextMenu.index, handleRemoveAt, resolvedRemoveTagLabel, additionalContextMenuItems, tags]
  )

  const rootClassName = useMemo(
    () => ['ecui-tags-view', className].filter(Boolean).join(' '),
    [className]
  )

  return (
    <div
      className={rootClassName}
      style={style}
      data-testid={testId}
      data-tag-count={String(tags.length)}
      data-editing-index={editingIndex === null ? '' : String(editingIndex)}
      data-contextmenu-visible={contextMenu.visible ? 'true' : 'false'}
    >
      <div className="ecui-tags-view-list" data-testid={`${testId}-list`}>
        {tags.map((tag, index) => {
          const isEditing = editingIndex === index

          // When renderTag is provided, skip the built-in editing UI —
          // the custom tag component handles editing internally.
          if (isEditing && !renderTag) {
            return (
              <div
                key={`${tag}-${index}`}
                className="ecui-tag ecui-tag--editing"
                data-testid={`${testId}-tag-${index}`}
                data-is-editing="true"
              >
                <input
                  ref={inputRef}
                  data-testid={`${testId}-tag-${index}-input`}
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

          const tagHandlers = {
            onClick: (): void => { beginEditing(index) },
            onContextMenu: (event: React.MouseEvent): void => {
              event.preventDefault()
              event.stopPropagation()
              setContextMenu({
                visible: true,
                x: event.clientX,
                y: event.clientY,
                index
              })
            }
          }

          if (renderTag) {
            return (
              <React.Fragment key={`${tag}-${index}`}>
                {renderTag(tag, index, tagHandlers)}
              </React.Fragment>
            )
          }

          return (
            <button
              key={`${tag}-${index}`}
              type="button"
              className="ecui-tag"
              data-testid={`${testId}-tag-${index}`}
              data-is-editing="false"
              onClick={tagHandlers.onClick}
              onContextMenu={tagHandlers.onContextMenu}
            >
              <span className="ecui-tag-label" data-testid={`${testId}-tag-${index}-label`}>{tag}</span>
            </button>
          )
        })}

        <Button
          small
          secondary
          icon="add"
          onClick={handleAddTag}
          data-testid={`${testId}-add`}
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
        data-testid={`${testId}-contextmenu`}
      />
    </div>
  )
}
