import React, { useEffect, useRef } from 'react'
import { MenuItem, MenuItemSeparator } from '../MenuBar'

export interface ContextMenuItem {
  id: string
  label: string
  /**
   * Codicon name (without the `codicon-` prefix) when a string, or any
   * React node for custom glyphs (colored method badges, protocol
   * pills, SVGs, etc.). Strings get wrapped in a `codicon codicon-…`
   * `<i>`; nodes are rendered as-is. The icon slot reserves a 16 px
   * minimum but grows to accommodate wider glyphs and push the label
   * right — a Badge larger than a codicon stays in its lane without
   * overlapping the label text.
   */
  icon?: string | React.ReactNode
  shortcut?: string
  isSeparator?: boolean
  disabled?: boolean
  checked?: boolean
  onClick?: () => void
  /** Optional submenu items */
  items?: ContextMenuItem[]
}

export interface ContextMenuProps {
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  onRequestClose: () => void
  /** Optional test id applied to the root element. */
  'data-testid'?: string
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  visible,
  x,
  y,
  items,
  onRequestClose,
  'data-testid': dataTestId
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const renderItems = (menuItems: ContextMenuItem[]): React.ReactNode =>
    menuItems.map((item) => {
      if (item.isSeparator) {
        return <MenuItemSeparator key={item.id} id={item.id} />
      }

      const hasSubmenu = Array.isArray(item.items) && item.items.length > 0

      return (
        <MenuItem
          key={item.id}
          id={item.id}
          title={item.label}
          {...(item.shortcut ? { shortcut: item.shortcut } : {})}
          disabled={!!item.disabled}
          checked={!!item.checked}
          icon={
            item.icon === undefined || item.icon === null
              ? undefined
              : typeof item.icon === 'string'
                ? (
                    <i
                      className={`codicon codicon-${item.icon}`}
                      aria-hidden="true"
                    />
                  )
                : item.icon
          }
          {...(!hasSubmenu && {
            onClick: () => {
              if (item.disabled) return
              item.onClick?.()
              onRequestClose()
            }
          })}
        >
          {hasSubmenu ? renderItems(item.items ?? []) : undefined}
        </MenuItem>
      )
    })

  useEffect(() => {
    if (!visible) return

    const handleMouseDown = (event: MouseEvent): void => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        onRequestClose()
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [visible, onRequestClose])

  if (!visible) return null

  return (
    <div
      className="ecui-context-menu"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 1000,
      }}
      data-x={String(x)}
      data-y={String(y)}
      {...(dataTestId && { 'data-testid': dataTestId })}
      ref={containerRef}
      onContextMenu={(e) => {
        e.preventDefault()
      }}
    >
      <div className="menu menubar-menu-items-holder menu-container">
        <div className="menu">
          <ul className="actions-container" role="menu">
            {renderItems(items)}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default ContextMenu
