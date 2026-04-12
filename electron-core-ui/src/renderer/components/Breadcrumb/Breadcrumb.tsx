import React, { useCallback, useState, useRef, useEffect } from 'react'
import type { Icon } from '../../../types/icon'
import { IconView } from '../IconView'
import { IconSelect } from '../IconSelect/IconSelect'

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
   */
  'data-testid'?: string
  /**
   * Called when a non-editing item is clicked (including the last item when shown as a label).
   */
  onItemClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
  /**
   * Called when the editable last item is renamed (Enter or blur).
   */
  onLastItemChange?: (item: BreadcrumbItem, newValue: string, index: number) => void
  /**
   * Called when the icon of the last item is changed via IconSelect.
   */
  onLastItemIconChange?: (item: BreadcrumbItem, newIcon: Icon | null, index: number) => void
  /**
   * Allow editing the icon of the last (current) item via IconSelect.
   * @default false
   */
  canEditIcon?: boolean
  /**
   * Allow editing the name of the last (current) item via inline input.
   * @default false
   */
  canEditName?: boolean
  /**
   * Show the root item even when it's the only item (normally hidden).
   * @default false
   */
  showRoot?: boolean
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
}

/** Render an icon using IconView */
function renderIcon(icon: Icon | null | undefined): React.ReactNode {
  if (!icon || icon.type === 'none') return null
  return <IconView icon={icon} size={16} className="ecui-breadcrumb-icon" />
}

const BreadcrumbInner: React.FC<BreadcrumbProps> = ({
  items,
  'data-testid': dataTestId,
  onItemClick,
  onLastItemChange,
  onLastItemIconChange,
  canEditIcon = false,
  canEditName = false,
  showRoot: _showRoot = false,
  className,
  style,
  ariaLabel
}) => {
  const [isEditingLast, setIsEditingLast] = useState(false)
  const [editingValue, setEditingValue] = useState('')
  const [editingItem, setEditingItem] = useState<BreadcrumbItem | null>(null)
  const [committedValue, setCommittedValue] = useState<string | null>(null)
  const [isHoveringLast, setIsHoveringLast] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const shouldSelectOnMount = useRef(false)
  const ignoreNextBlurCommit = useRef(false)

  const lastItem = items[items.length - 1]
  const lastIndex = items.length - 1
  const displayedLastLabel = (committedValue !== null && committedValue !== lastItem?.label)
    ? committedValue
    : lastItem?.label

  const handleStartEditingLast = useCallback((): void => {
    if (!canEditName || !lastItem) return
    setIsEditingLast(true)
    setEditingValue(displayedLastLabel ?? lastItem.label)
    setEditingItem(lastItem)
    shouldSelectOnMount.current = true
  }, [canEditName, lastItem, displayedLastLabel])

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
      if (onLastItemChange && editingValue !== editingItem.label) {
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
        ignoreNextBlurCommit.current = true
        handleCommitLast(index)
        if (inputRef.current) {
          inputRef.current.blur()
        }
      } else if (event.key === 'Escape') {
        event.preventDefault()
        ignoreNextBlurCommit.current = true
        handleCancelEditingLast()
        if (inputRef.current) {
          inputRef.current.blur()
        }
      }
    },
    [handleCommitLast, handleCancelEditingLast]
  )

  const handleIconChange = useCallback((newIcon: Icon | null): void => {
    if (!lastItem || !onLastItemIconChange) return
    onLastItemIconChange(lastItem, newIcon, lastIndex)
  }, [lastItem, lastIndex, onLastItemIconChange])

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
            // Non-last items: navigate only, icon is static
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

          // Last item: current location, editable icon + name
          return (
            <li
              key={item.id}
              className="ecui-breadcrumb-item ecui-breadcrumb-item--last"
            >
              {canEditIcon && item.icon != null ? (
                <IconSelect
                  value={item.icon ?? null}
                  onChange={handleIconChange}
                  className="ecui-breadcrumb-icon-select"
                  {...(dataTestId ? { 'data-testid': `${dataTestId}-icon-select` } : {})}
                />
              ) : (
                renderIcon(item.icon)
              )}
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
                  className="ecui-breadcrumb-link ecui-breadcrumb-link--current ecui-breadcrumb-link--editable"
                  aria-current="page"
                  onMouseEnter={() => { setIsHoveringLast(true) }}
                  onMouseLeave={() => { setIsHoveringLast(false) }}
                  onClick={(event): void => {
                    if (onItemClick) {
                      onItemClick(item, index, event)
                    }
                    handleStartEditingLast()
                  }}
                >
                  {displayedLastLabel}
                  {isHoveringLast && canEditName ? (
                    <i className="codicon codicon-edit ecui-breadcrumb-edit-hint" />
                  ) : null}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export const Breadcrumb = React.memo(BreadcrumbInner)

export default Breadcrumb
