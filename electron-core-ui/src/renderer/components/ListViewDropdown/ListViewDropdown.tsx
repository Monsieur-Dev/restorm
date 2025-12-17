import React, { useEffect, useRef, useState } from 'react'
import { Button } from '../Button'
import type { ButtonProps } from '../Button'
import { ListView } from '../ListView'
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
  onItemToggle
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

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
      style={{
        position: 'relative',
        display: 'inline-block'
      }}
    >
      <Button
        {...buttonProps}
        onClick={() => {
          setIsOpen((prev) => !prev)
        }}
      >
        {buttonContent}
      </Button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            right: align === 'right' ? 0 : undefined,
            left: align === 'left' ? 0 : undefined,
            marginTop: 4,
            minWidth,
            maxHeight,
            overflow: 'hidden',
            zIndex: 1000,
            backgroundColor: 'var(--editor-background)',
            border: '1px solid var(--dropdown-border)',
            boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)'
          }}
        >
          {(() => {
            const listViewProps: ListViewProps = {
              items,
              rootRole,
              ariaLabel: menuAriaLabel ?? '',
              selectedIds: selectedIds ?? [],
              selectionMode,
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
        </div>
      )}
    </div>
  )
}
