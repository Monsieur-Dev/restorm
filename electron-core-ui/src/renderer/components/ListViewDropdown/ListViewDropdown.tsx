import React, { useEffect, useRef, useState } from 'react'
import { Button } from '../Button'
import type { ButtonProps } from '../Button'
import { ListView } from '../ListView'
import { ScrollableElement } from '../ScrollableElement/ScrollableElement'
import type {
  ListViewItemData,
  ListViewItemEventPayload,
  ListViewSelectionMode,
  ListViewProps
} from '../ListView'

export interface ListViewDropdownProps {
  items: ListViewItemData[]
  selectedIds?: string[]
  expandedIds?: string[]
  selectionMode?: ListViewSelectionMode
  rootRole?: 'tree' | 'list'
  /** Accessible label for the list inside the dropdown */
  menuAriaLabel?: string
  /** Alignment of the dropdown relative to the button (default: right) */
  align?: 'left' | 'right'
  /** Minimum width of the dropdown panel (default: 220) */
  minWidth?: number
  /** Maximum height of the dropdown panel (default: 320) */
  maxHeight?: number
  /** Props forwarded to the underlying Button (except onClick and children) */
  buttonProps?: Omit<ButtonProps, 'onClick' | 'children'>
  /** Content rendered inside the trigger button */
  buttonContent: React.ReactNode
  /** Called when an item is clicked. The dropdown closes after this callback. */
  onItemClick?: (payload: ListViewItemEventPayload) => void
  /** Called when an item is expanded/collapsed. */
  onItemToggle?: (payload: ListViewItemEventPayload, expanded: boolean) => void
  /** Optional test id applied to the root element. Defaults to `listviewdropdown`. */
  'data-testid'?: string
}

export const ListViewDropdown: React.FC<ListViewDropdownProps> = ({
  items,
  selectedIds,
  expandedIds,
  selectionMode = 'single',
  rootRole = 'tree',
  menuAriaLabel,
  align = 'right',
  minWidth = 220,
  maxHeight = 320,
  buttonProps,
  buttonContent,
  onItemClick,
  onItemToggle,
  'data-testid': dataTestId
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const rootTestId = dataTestId ?? 'listviewdropdown'
  const buttonTestId = `${rootTestId}-button`
  const panelTestId = `${rootTestId}-panel`
  const scrollableTestId = `${rootTestId}-scrollable`
  const listViewTestId = `${rootTestId}-listview`

  const selectedIdsAttr = (selectedIds ?? []).join('|')
  const expandedIdsAttr = (expandedIds ?? []).join('|')

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent): void => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div
      ref={containerRef}
      data-testid={rootTestId}
      data-is-open={isOpen ? 'true' : 'false'}
      data-align={align}
      data-selection-mode={selectionMode}
      data-root-role={rootRole}
      data-selected-ids={selectedIdsAttr}
      data-expanded-ids={expandedIdsAttr}
      style={{
        position: 'relative',
        display: 'inline-block'
      }}
    >
      <Button
        {...buttonProps}
        data-testid={buttonProps?.['data-testid'] ?? buttonTestId}
        onClick={() => {
          setIsOpen((prev) => !prev)
        }}
      >
        {buttonContent}
      </Button>

      {isOpen && (
        <div
          data-testid={panelTestId}
          style={{
            position: 'absolute',
            right: align === 'right' ? 0 : undefined,
            left: align === 'left' ? 0 : undefined,
            marginTop: 4,
            minWidth,
            maxHeight,
            zIndex: 1000,
            backgroundColor: 'var(--editor-background)',
            border: '1px solid var(--dropdown-border)',
            boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)'
          }}
        >
          <ScrollableElement
            data-testid={scrollableTestId}
            style={{
              height: maxHeight || 400,
              width: '100%'
            }}
          >
            {(() => {
              const listViewProps: ListViewProps = {
                items,
                rootRole,
                ariaLabel: menuAriaLabel ?? '',
                selectedIds: selectedIds ?? [],
                selectionMode,
                'data-testid': listViewTestId,
                onItemClick: (payload) => {
                  onItemClick?.(payload)
                  setIsOpen(false)
                }
              }

              if (expandedIds) {
                listViewProps.expandedIds = expandedIds
              }
              if (onItemToggle) {
                listViewProps.onItemToggle = onItemToggle
              }

              return <ListView {...listViewProps} />
            })()}
          </ScrollableElement>
        </div>
      )}
    </div>
  )
}
