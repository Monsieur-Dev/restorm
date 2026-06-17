import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MenuItem, MenuItemSeparator } from '../MenuBar'
import { useOverlayPresence } from '../../hooks/useOverlayPresence'
import { registerOpenContextMenu } from './openContextMenuRegistry'

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
  /**
   * When true, the rendered label gets a trailing `…` appended at
   * render time — the standard UX convention for "this entry opens
   * a dialog / window". Mirrors `MenuItem.opensDialog`.
   */
  opensDialog?: boolean
  onClick?: () => void
  /** Optional submenu items */
  items?: ContextMenuItem[]
  /**
   * Optional test id applied to this item's row (and, via `MenuItem` /
   * `MenuItemSeparator`, to its derived sub-elements — `${testId}-label`,
   * `${testId}-submenu`, `${testId}-separator`, …).
   */
  'data-testid'?: string
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
  // The requested anchor is the cursor position; we shift the menu back
  // into the viewport when it would overflow the bottom / right edge, so a
  // right-click low on the screen doesn't clip the last entries.
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: y, left: x })

  // Register with the overlay-presence service while open so a
  // main-process compositor view (the Mini browser's `WebContentsView`)
  // collapses out from under the menu instead of painting on top of it —
  // a `position: fixed` HTML overlay can't otherwise out-stack a native
  // view. Same hook every other ECUI portal (Modal, Tooltip, submenu …)
  // uses; the rect is read lazily from `containerRef`.
  useOverlayPresence(containerRef, visible)

  useLayoutEffect(() => {
    if (!visible) return
    const el = containerRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const maxLeft = Math.max(0, window.innerWidth - width)
    const maxTop = Math.max(0, window.innerHeight - height)
    setPos({ left: Math.min(x, maxLeft), top: Math.min(y, maxTop) })
  }, [visible, x, y, items])

  const renderItems = (menuItems: ContextMenuItem[]): React.ReactNode =>
    menuItems.map((item) => {
      if (item.isSeparator) {
        return (
          <MenuItemSeparator
            key={item.id}
            id={item.id}
            {...(item['data-testid'] !== undefined && { 'data-testid': item['data-testid'] })}
          />
        )
      }

      const hasSubmenu = Array.isArray(item.items) && item.items.length > 0

      return (
        <MenuItem
          key={item.id}
          id={item.id}
          title={item.label}
          {...(item['data-testid'] !== undefined && { 'data-testid': item['data-testid'] })}
          {...(item.shortcut ? { shortcut: item.shortcut } : {})}
          disabled={!!item.disabled}
          checked={!!item.checked}
          opensDialog={!!item.opensDialog}
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
          {...(item.onClick && {
            // Wire onClick whether or not the item also has a submenu.
            // Submenu parents that supply onClick fire the action on
            // click; their submenu still opens on hover/keyboard.
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

    const deregister = registerOpenContextMenu(onRequestClose)

    const handlePointerDown = (event: PointerEvent): void => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        onRequestClose()
      }
    }

    // `pointerdown` in the capture phase: fire on the way down, before a
    // descendant can interfere. We use pointerdown (not mousedown) because
    // surfaces like the React Flow pane call `preventDefault()` on their
    // pan pointerdown, which suppresses the compatibility `mousedown` —
    // so a left-click on the canvas never produced a mousedown and the
    // menu stayed open. Capture + pointerdown sees every press.
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      deregister()
    }
  }, [visible, onRequestClose])

  if (!visible) return null

  return (
    <div
      className="ecui-context-menu"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        // A context menu is the active interaction layer — it must sit ABOVE
        // tooltips/popovers and modal overlays (both `z-index: 10000`), e.g. a
        // type-pick menu opened from a field inside a Tooltip-based popover.
        // Stays below the window controls (`100001`).
        zIndex: 10002,
      }}
      data-x={String(x)}
      data-y={String(y)}
      {...(dataTestId && { 'data-testid': dataTestId })}
      ref={containerRef}
      onContextMenu={(e) => {
        // Prevent the platform menu and stop the bubble — without
        // stopPropagation, a right-click on top of an open menu reaches
        // the surrounding container's contextmenu handler (e.g. the
        // sidebar's empty-area handler) which then opens a *different*
        // menu on top, because the click target is the menu overlay,
        // not whatever was underneath it.
        e.preventDefault()
        e.stopPropagation()
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
