import React, { useCallback, useState, useRef } from 'react'

import './breadcrumb.css'

export interface BreadcrumbItem {
  id: string
  label: string
}

export interface BreadcrumbProps {
  /**
   * Ordered list of breadcrumb items to display.
   * The last item is rendered as the current location and is editable.
   */
  items: BreadcrumbItem[]
  /**
   * Called when a non-editing item is clicked (including the last item when shown as a label).
   */
  onItemClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
  /**
   * Called when the editable last item loses focus or is submitted.
   * Receives the new value and the index of the last item.
   */
  onLastItemChange?: (value: string, index: number) => void
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({
  items,
  onItemClick,
  onLastItemChange,
  className,
  style,
  ariaLabel
}) => {
  const [isEditingLast, setIsEditingLast] = useState(false)
  const [editingValue, setEditingValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleStartEditingLast = useCallback((label: string): void => {
    setIsEditingLast(true)
    setEditingValue(label)
    // Focus is handled via ref callback on the input element
  }, [])

  const handleCommitLast = useCallback(
    (index: number): void => {
      if (!isEditingLast) return
      setIsEditingLast(false)
      if (onLastItemChange) {
        onLastItemChange(editingValue, index)
      }
    },
    [editingValue, isEditingLast, onLastItemChange]
  )

  const handleCancelEditingLast = useCallback((): void => {
    setIsEditingLast(false)
  }, [])

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, index: number): void => {
      if (event.key === 'Enter') {
        event.preventDefault()
        handleCommitLast(index)
        // Blur to revert to label mode
        if (inputRef.current) {
          inputRef.current.blur()
        }
      } else if (event.key === 'Escape') {
        event.preventDefault()
        handleCancelEditingLast()
        if (inputRef.current) {
          inputRef.current.blur()
        }
      }
    },
    [handleCommitLast, handleCancelEditingLast]
  )

  if (items.length === 0) {
    return null
  }

  const rootClasses = ['ecui-breadcrumb', className].filter(Boolean).join(' ')

  return (
    <nav className={rootClasses} style={style} aria-label={ariaLabel ?? 'Breadcrumb'}>
      <ol className="ecui-breadcrumb-list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1

          if (!isLast) {
            return (
              <li key={item.id} className="ecui-breadcrumb-item">
                <button
                  type="button"
                  className="ecui-breadcrumb-link"
                  onClick={(event): void => {
                    if (onItemClick) {
                      onItemClick(item, index, event)
                    }
                  }}
                >
                  {item.label}
                </button>
                <span className="ecui-breadcrumb-separator" aria-hidden="true">
                  <i className="codicon codicon-chevron-right" />
                </span>
              </li>
            )
          }

          return (
            <li key={item.id} className="ecui-breadcrumb-item ecui-breadcrumb-item--last">
              {isEditingLast ? (
                <input
                  ref={(node): void => {
                    inputRef.current = node
                    if (node) {
                      // Auto-focus when the input appears
                      node.focus()
                      node.select()
                    }
                  }}
                  className="ecui-breadcrumb-input"
                  type="text"
                  value={editingValue}
                  onChange={(event): void => {
                    setEditingValue(event.target.value)
                  }}
                  onBlur={(): void => {
                    handleCommitLast(index)
                  }}
                  onKeyDown={(event): void => {
                    handleInputKeyDown(event, index)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="ecui-breadcrumb-link ecui-breadcrumb-link--current"
                  aria-current="page"
                  onClick={(event): void => {
                    if (onItemClick) {
                      onItemClick(item, index, event)
                    }
                    handleStartEditingLast(item.label)
                  }}
                >
                  {item.label}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default Breadcrumb
