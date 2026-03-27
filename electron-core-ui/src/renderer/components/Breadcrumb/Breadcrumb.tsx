import React, { useCallback, useState, useRef, useEffect } from 'react'
import type { Icon } from '../../../types/icon'

import './breadcrumb.css'

export interface BreadcrumbItem {
  id: string
  label: string
  /** Optional icon to display before the label */
  icon?: Icon | null
}

export interface BreadcrumbProps {
  /**
   * Ordered list of breadcrumb items to display.
   * The last item is rendered as the current location and is editable.
   */
  items: BreadcrumbItem[]
  /**
   * Optional test id to put on the root element.
   * Use this to target the whole breadcrumb in E2E tests.
   */
  'data-testid'?: string
  /**
   * Called when a non-editing item is clicked (including the last item when shown as a label).
   */
  onItemClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
  /**
   * Called when the editable last item is renamed (Enter or blur).
   * Receives the item, new value, and index.
   */
  onLastItemChange?: (item: BreadcrumbItem, newValue: string, index: number) => void
  /**
   * Show the root item even when it's the only item (normally hidden).
   * @default false
   */
  showRoot?: boolean
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
}

/** Render an icon (emoji or codicon) */
function renderIcon(icon: Icon | null | undefined): React.ReactNode {
  if (!icon || icon.type === 'none') return null
  if (icon.type === 'emoji') {
    return <span className="ecui-breadcrumb-icon ecui-breadcrumb-icon--emoji">{icon.value}</span>
  }
  // icon.type === 'codicon'
  return <i className={`ecui-breadcrumb-icon codicon codicon-${icon.value}`} />
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({
  items,
  'data-testid': dataTestId,
  onItemClick,
  onLastItemChange,
  showRoot: _showRoot = false,
  className,
  style,
  ariaLabel
}) => {
  const [isEditingLast, setIsEditingLast] = useState(false)
  const [editingValue, setEditingValue] = useState('')
  const [editingItem, setEditingItem] = useState<BreadcrumbItem | null>(null)
  // Stores the committed value temporarily until parent updates item.label
  const [committedValue, setCommittedValue] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const shouldSelectOnMount = useRef(false)
  const ignoreNextBlurCommit = useRef(false)

  // Derive the displayed value for the last item:
  // Show committedValue only if it differs from the current item.label
  const lastItem = items[items.length - 1]
  const displayedLastLabel = (committedValue !== null && committedValue !== lastItem?.label)
    ? committedValue
    : lastItem?.label

  const handleStartEditingLast = useCallback((item: BreadcrumbItem): void => {
    setIsEditingLast(true)
    setEditingValue(item.label)
    setEditingItem(item)
    shouldSelectOnMount.current = true
  }, [])

  // Focus and select on mount when editing starts
  useEffect(() => {
    if (isEditingLast && inputRef.current && shouldSelectOnMount.current) {
      inputRef.current.focus()
      inputRef.current.select()
      shouldSelectOnMount.current = false
    }
  }, [isEditingLast])

  const handleCommitLast = useCallback(
    (index: number): void => {
      if (!isEditingLast || !editingItem) return
      setIsEditingLast(false)
      // Only call callback if value actually changed
      if (onLastItemChange && editingValue !== editingItem.label) {
        // Store the committed value temporarily to show it until parent updates
        setCommittedValue(editingValue)
        onLastItemChange(editingItem, editingValue, index)
      }
      setEditingItem(null)
    },
    [editingValue, isEditingLast, editingItem, onLastItemChange]
  )

  const handleCancelEditingLast = useCallback((): void => {
    setIsEditingLast(false)
    setEditingItem(null)
  }, [])

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, index: number): void => {
      if (event.key === 'Enter') {
        event.preventDefault()
        // Avoid committing twice (keydown + blur).
        ignoreNextBlurCommit.current = true
        handleCommitLast(index)
        // Blur to revert to label mode
        if (inputRef.current) {
          inputRef.current.blur()
        }
      } else if (event.key === 'Escape') {
        event.preventDefault()
        // Avoid committing on blur when cancelling.
        ignoreNextBlurCommit.current = true
        handleCancelEditingLast()
        if (inputRef.current) {
          inputRef.current.blur()
        }
      }
    },
    [handleCommitLast, handleCancelEditingLast]
  )

  // Hide only if empty
  if (items.length === 0) {
    return null
  }

  const rootClasses = ['ecui-breadcrumb', className].filter(Boolean).join(' ')

  return (
    <nav className={rootClasses} style={style} aria-label={ariaLabel ?? 'Breadcrumb'} data-testid={dataTestId}>
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
                  {renderIcon(item.icon)}
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
                  ref={inputRef}
                  className="ecui-breadcrumb-input"
                  type="text"
                  value={editingValue}
                  onChange={(event): void => {
                    setEditingValue(event.target.value)
                  }}
                  onBlur={(): void => {
                    if (ignoreNextBlurCommit.current) {
                      ignoreNextBlurCommit.current = false
                      return
                    }
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
                    handleStartEditingLast(item)
                  }}
                >
                  {renderIcon(item.icon)}
                  {displayedLastLabel}
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
