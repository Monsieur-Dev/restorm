import React, { useCallback } from 'react'
import type { Icon } from '../../../types/icon'
import { Button } from '../Button'
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
   * Called on a non-last item's auxiliary click (middle mouse button,
   * i.e. `event.button === 1`). Mirrors the classic browser
   * "open link in background tab" gesture so the consumer can open
   * the target without stealing focus. Only fires on non-last items
   * since the last item is the current page / editable label.
   */
  onItemAuxClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
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
   * When `true`, every item (including the last) is rendered as a
   * clickable navigation button — no "current page" styling, no
   * editable label, no `aria-current`. Use this when the breadcrumb
   * shows only the ancestor path and the current page is displayed
   * elsewhere (e.g. as an H1 title row below the breadcrumb). Mutually
   * exclusive with `canEditName` / `canEditIcon`.
   * @default false
   */
  allNavigable?: boolean
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
  onItemAuxClick,
  onLastItemChange,
  onLastItemIconChange,
  canEditIcon = false,
  canEditName = false,
  allNavigable = false,
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
          // In `allNavigable` mode every item — even the last — is
          // treated as an ancestor-style clickable link. Use this when
          // the current page is rendered separately (e.g. as an H1
          // next to the breadcrumb row).
          const isLast = !allNavigable && index === items.length - 1

          if (!isLast) {
            // Non-last items: navigate only, icon is static. Middle-click
            // routes through `onItemAuxClick` (when provided) so
            // consumers can implement "open in background" without
            // receiving the plain `onItemClick` too — on platforms that
            // fire both `click` and `auxclick` for the middle button,
            // the consumer can tell them apart by event.button.
            // Suppress the trailing chevron on the final item when we
            // were told to display the entire path as ancestors (the
            // row visually ends with the last navigable item).
            const isFinalListItem = index === items.length - 1
            return (
              <li key={item.id} className="ecui-breadcrumb-item">
                {/* span wrapper: onAuxClick (middle-click) is not forwarded by
                    ECUI Button; a display:contents span preserves the breadcrumb
                    item layout while intercepting middle-click before the browser
                    auto-scroll kicks in. Type-cast: callers ignore the event arg. */}
                <span
                  style={{ display: 'contents' }}
                  onAuxClick={(event): void => {
                    if (event.button !== 1) return
                    // Prevent the browser's default middle-click behaviour
                    // (autoscroll / pointer-lock cursor on Chromium) —
                    // we're hijacking it for navigation.
                    event.preventDefault()
                    if (onItemAuxClick) {
                      onItemAuxClick(item, index, event as unknown as React.MouseEvent<HTMLButtonElement>)
                    }
                  }}
                >
                  <Button
                    link
                    className="ecui-breadcrumb-link"
                    onClick={(event): void => {
                      if (onItemClick) {
                        onItemClick(item, index, event as unknown as React.MouseEvent<HTMLButtonElement>)
                      }
                    }}
                  >
                    {renderIcon(item.icon)}
                    {item.label}
                  </Button>
                </span>
                {!isFinalListItem ? (
                  <span className="ecui-breadcrumb-separator" aria-hidden="true">
                    <i className="codicon codicon-chevron-right" />
                  </span>
                ) : null}
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
