import React, { useEffect, useRef } from 'react'
import { MenuItem, MenuItemSeparator } from '../MenuBar'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: string
  shortcut?: string
  isSeparator?: boolean
  disabled?: boolean
  onClick?: () => void
}

export interface ContextMenuProps {
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  onRequestClose: () => void
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  visible,
  x,
  y,
  items,
  onRequestClose
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)

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
      ref={containerRef}
      onContextMenu={(e) => {
        e.preventDefault()
      }}
    >
      <div className="menu menubar-menu-items-holder menu-container">
        <div className="menu">
          <ul className="actions-container" role="menu">
            {items.map((item) =>
              item.isSeparator ? (
                <MenuItemSeparator key={item.id} />
              ) : (
                <MenuItem
                  key={item.id}
                  title={item.label}
                  {...(item.shortcut ? { shortcut: item.shortcut } : {})}
                  disabled={!!item.disabled}
                  icon={
                    item.icon ? (
                      <i
                        className={`codicon codicon-${item.icon}`}
                        aria-hidden="true"
                      />
                    ) : undefined
                  }
                  onClick={() => {
                    if (item.disabled) return
                    item.onClick?.()
                    onRequestClose()
                  }}
                />
              )
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default ContextMenu
