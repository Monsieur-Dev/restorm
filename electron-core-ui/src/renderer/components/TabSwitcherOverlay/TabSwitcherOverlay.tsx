/**
 * TabSwitcherOverlay
 *
 * A controlled overlay component for switching between open tabs using Ctrl+Tab.
 * Displays a list of tabs sorted by navigation history (most recent first).
 *
 * ## Usage
 *
 * ```tsx
 * <TabSwitcherOverlay
 *   open={isOpen}
 *   items={tabItems}
 *   selectedIndex={selectedIdx}
 *   onSelect={(item) => activateTab(item.id)}
 *   onClose={() => setIsOpen(false)}
 *   style={{ top: 36, left: 100, width: 400 }}
 * />
 * ```
 *
 * ## Features
 *
 * - Keyboard-driven: designed to work with Ctrl+Tab cycling
 * - Auto-scrolls to keep the selected item visible
 * - Uses ScrollableElement for themed scrollbars matching the application style
 * - Positioned via `style` prop (typically anchored to the search bar)
 */

import React, { useEffect, useRef, useCallback } from 'react'
import { ScrollableElement } from '../ScrollableElement'
import './tabSwitcherOverlay.css'

/** An item displayed in the tab switcher overlay */
export interface TabSwitcherItem {
  /** Unique tab identifier */
  id: string
  /** Plain text title (used when no icon is provided) */
  title: string
  /** Rich icon/badge content (displayed instead of title when provided) */
  icon?: React.ReactNode
  /** Whether this tab is currently active in the workbench */
  isActive?: boolean
}

export interface TabSwitcherOverlayProps {
  /** Whether the overlay is visible */
  open: boolean
  /** List of tab items to display, sorted by desired order */
  items: TabSwitcherItem[]
  /** Index of the currently highlighted item */
  selectedIndex: number
  /** Called when an item is selected (clicked or confirmed) */
  onSelect: (item: TabSwitcherItem) => void
  /** Called when the overlay should close without selection */
  onClose: () => void
  /** Custom style for positioning the overlay (top, left, width) */
  style?: React.CSSProperties
  'data-testid'?: string
}

export function TabSwitcherOverlay({
  open,
  items,
  selectedIndex,
  onSelect,
  onClose,
  style: customStyle,
  'data-testid': testId
}: TabSwitcherOverlayProps): React.ReactNode {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const selectedRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [open, selectedIndex])

  // Close on click outside the overlay
  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent): void => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => { document.removeEventListener('mousedown', handleMouseDown) }
  }, [open, onClose])

  const overlayStyle: React.CSSProperties = customStyle ?? { top: 36, left: '50%', transform: 'translateX(-50%)', width: 400 }

  const itemRefCallback = useCallback(
    (index: number) => (el: HTMLDivElement | null) => {
      if (index === selectedIndex) {
        selectedRef.current = el
      }
    },
    [selectedIndex]
  )

  if (!open) {
    return null
  }

  return (
    <div
      ref={overlayRef}
      className="tab-switcher-overlay"
      style={overlayStyle}
      data-testid={testId}
      data-selected-index={selectedIndex}
    >
      <ScrollableElement
        className="tab-switcher-list"
        {...(testId ? { 'data-testid': `${testId}-scrollable` } : {})}
        options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false, fitContent: true }}
        style={{ maxHeight: 350 }}
      >
        <div className="tab-switcher-list-content">
          {items.map((item, index) => {
            const isSelected = index === selectedIndex
            const className = [
              'tab-switcher-item',
              isSelected ? 'tab-switcher-item--selected' : ''
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <div
                key={item.id}
                ref={itemRefCallback(index)}
                className={className}
                data-testid={testId ? `${testId}-item-${index}` : undefined}
                onClick={() => { onSelect(item) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelect(item)
                  }
                  if (e.key === 'Escape') {
                    onClose()
                  }
                }}
                role="option"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
              >
                {item.icon ? (
                  <span className="tab-switcher-item-icon">{item.icon}</span>
                ) : (
                  <span className="tab-switcher-item-title">{item.title}</span>
                )}
                {item.isActive && <span className="tab-switcher-item-active" />}
              </div>
            )
          })}
        </div>
      </ScrollableElement>
    </div>
  )
}
