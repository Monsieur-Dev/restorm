import React, { useEffect, useRef } from 'react'
import { MenuItem, MenuItemSeparator } from '../MenuBar'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: string
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
  if (!visible) return null

  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
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
  }, [onRequestClose])

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
      <div className="monaco-menu menubar-menu-items-holder monaco-menu-container">
        <div className="monaco-menu">
          <ul className="actions-container" role="menu">
            {items.map((item) =>
              item.isSeparator ? (
                <MenuItemSeparator key={item.id} />
              ) : (
                <MenuItem
                  key={item.id}
                  title={item.label}
                  disabled={item.disabled}
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

