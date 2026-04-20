import React, { useCallback } from 'react'
import type { Icon } from '../../../types/icon'
import { IconView } from '../IconView'
import { IconSelect } from '../IconSelect/IconSelect'
import { EditableLabel } from '../EditableLabel'

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
  const lastItem = items[items.length - 1]
  const lastIndex = items.length - 1

  const handleEditableCommit = useCallback((nextValue: string): void => {
    if (!lastItem || !onLastItemChange) return
    onLastItemChange(lastItem, nextValue, lastIndex)
  }, [lastItem, lastIndex, onLastItemChange])

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

          // Last item: current location, editable icon + name.
          // Name editing is delegated to `<EditableLabel>` — it owns
          // the hover pencil, input swap, Enter / Escape / blur handling
          // + the "commit only on actual change" guard. Breadcrumb just
          // maps the component's onChange to its existing public
          // `onLastItemChange` callback, and keeps the WAI-ARIA
          // breadcrumb semantics (`aria-current="page"`) on a wrapper.
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
              <span aria-current="page">
                <EditableLabel
                  as="span"
                  value={item.label}
                  onChange={handleEditableCommit}
                  editable={canEditName}
                  className="ecui-breadcrumb-link ecui-breadcrumb-link--current"
                  {...(dataTestId ? { 'data-testid': `${dataTestId}-editable-last` } : {})}
                />
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export const Breadcrumb = React.memo(BreadcrumbInner)

export default Breadcrumb
