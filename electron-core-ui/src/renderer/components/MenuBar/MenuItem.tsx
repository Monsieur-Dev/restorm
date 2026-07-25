import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { MenuItemProps } from './types'
import { ScrollableElement } from '../ScrollableElement'
import { useOverlayPresence } from '../../hooks/useOverlayPresence'
import { computeSubmenuPlacement } from './computeSubmenuPlacement'

const SUBMENU_WIDTH = 300
const VIEWPORT_PADDING = 8
const OVERLAP_OFFSET = 8

const MenuItem: React.FC<MenuItemProps> = ({
  title,
  shortcut,
  onClick,
  checked = false,
  disabled = false,
  icon,
  opensDialog = false,
  children,
  className = '',
  id,
  'data-testid': dataTestId
}) => {
  const renderedTitle = opensDialog ? `${title}…` : title
  const testId = dataTestId
  // Note: Keyboard shortcuts are registered by MenuBarItem parent component
  // to keep them active even when the menu is closed
  const [showSubmenu, setShowSubmenu] = useState(false)
  const itemRef = useRef<HTMLAnchorElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  useOverlayPresence(submenuRef, showSubmenu)
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Position and size the submenu via direct DOM mutation on the refs. This runs
  // before paint and fits the submenu inside the viewport on BOTH axes: it flips
  // or overlaps on horizontal overflow, and slides the submenu up on vertical
  // overflow so it stays fully readable instead of being clipped into a strip.
  // Clipping + scroll is the fallback for a submenu taller than the viewport.
  //
  // Position AND clipping are owned together, on purpose: computed by two
  // separate effects their viewport margins disagree, which reintroduces a
  // parasitic scrollbar a couple of pixels tall. Writing the clip straight to
  // the DOM rather than through state also guarantees each opening is measured
  // at its natural height — a clip held in state would outlive the closed
  // submenu, under-estimate the height on the next opening and defeat the clamp.
  useLayoutEffect(() => {
    if (!showSubmenu || !itemRef.current || !submenuRef.current) return

    const holder = submenuRef.current
    const itemRect = itemRef.current.getBoundingClientRect()
    const parentRect = itemRef.current.closest('.menu-container')?.getBoundingClientRect() ?? null
    const holderHeight = holder.getBoundingClientRect().height
    // The computed clip is an outer holder height, but it is applied to the
    // scroll viewport nested inside it — subtract the holder's padding + border.
    const scroller = holder.querySelector<HTMLElement>(':scope > .scrollable-element')
    const chrome = scroller ? holderHeight - scroller.getBoundingClientRect().height : 0

    const { left, top, maxHeight } = computeSubmenuPlacement({
      itemTop: itemRect.top,
      itemLeft: itemRect.left,
      itemRight: itemRect.right,
      parentMenuTop: parentRect?.top ?? null,
      parentMenuLeft: parentRect?.left ?? null,
      submenuWidth: SUBMENU_WIDTH,
      submenuHeight: holderHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      padding: VIEWPORT_PADDING,
      overlapOffset: OVERLAP_OFFSET
    })

    holder.style.left = `${left}px`
    holder.style.top = `${top}px`
    if (scroller) {
      const clip = maxHeight === null ? '' : `${Math.max(0, maxHeight - chrome)}px`
      scroller.style.height = clip
      scroller.style.maxHeight = clip
    }
  }, [showSubmenu])

  const hasSubmenu = React.Children.count(children) > 0

  const handleClick = useCallback((event: React.MouseEvent): void => {
    if (disabled) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    // Submenu parents that don't supply onClick stay submenu-only —
    // their click only opens the submenu (which already happens on
    // hover / ArrowRight). Submenu parents WITH an onClick fire the
    // action on click; the submenu still serves the secondary
    // entries via hover.
    if (hasSubmenu && !onClick) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    onClick?.()
  }, [disabled, hasSubmenu, onClick])

  const handleKeyDown = useCallback((event: React.KeyboardEvent): void => {
    if (disabled) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (onClick) {
        onClick()
      } else if (hasSubmenu) {
        setShowSubmenu(true)
      }
    } else if (event.key === 'ArrowRight' && hasSubmenu) {
      event.preventDefault()
      setShowSubmenu(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setShowSubmenu(false)
      itemRef.current?.blur()
    }
  }, [disabled, hasSubmenu, onClick])

  const handleMouseEnter = useCallback((): void => {
    if (disabled) return

    // Always close sibling submenus at the same level, even if this item has no submenu.
    if (itemRef.current) {
      const parentMenu = itemRef.current.closest('ul.actions-container')
      if (parentMenu) {
        const closeEvent = new CustomEvent('close-other-submenus', {
          bubbles: false,
          detail: { excludeElement: itemRef.current }
        })
        parentMenu.dispatchEvent(closeEvent)
      }
    }

    if (!hasSubmenu) return

      // Clear any existing timeout
      if (submenuTimeoutRef.current) {
        clearTimeout(submenuTimeoutRef.current)
      }
      
      // Set timeout to show submenu after 300ms
      submenuTimeoutRef.current = setTimeout(() => {
        setShowSubmenu(true)
      }, 300)
  }, [disabled, hasSubmenu])

  const handleMouseLeave = useCallback((): void => {
    // Clear the timeout for showing submenu
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current)
      submenuTimeoutRef.current = null
    }
  }, [])

  const handleSubmenuMouseEnter = useCallback((): void => {
    setShowSubmenu(true)
  }, [])

  const handleSubmenuMouseLeave = useCallback((): void => {
    // Don't hide submenu when mouse leaves submenu - keep it open
    // The submenu will only close when clicking outside or pressing Escape
  }, [])

  // Listen for close-other-submenus event from sibling MenuItems
  useEffect(() => {
    if (!itemRef.current) return

    const parentMenu = itemRef.current.closest('ul.actions-container')
    if (!parentMenu) return

    const handleCloseOtherSubmenus = (event: Event): void => {
      const customEvent = event as CustomEvent<{ excludeElement: HTMLElement }>
      // Close this submenu when another item of the same level is hovered.
      if (customEvent.detail.excludeElement !== itemRef.current) {
        setShowSubmenu(false)
        // Clear any pending timeout
        if (submenuTimeoutRef.current) {
          clearTimeout(submenuTimeoutRef.current)
          submenuTimeoutRef.current = null
        }
      }
    }

    parentMenu.addEventListener('close-other-submenus', handleCloseOtherSubmenus)
    return () => {
      parentMenu.removeEventListener('close-other-submenus', handleCloseOtherSubmenus)
    }
  }, [])

  // Close submenu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (submenuRef.current && !submenuRef.current.contains(event.target as Node) && 
          itemRef.current && !itemRef.current.contains(event.target as Node)) {
        setShowSubmenu(false)
      }
    }

    if (showSubmenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => { document.removeEventListener('mousedown', handleClickOutside); }
    }
    return undefined
  }, [showSubmenu])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (submenuTimeoutRef.current) {
        clearTimeout(submenuTimeoutRef.current)
      }
    }
  }, [])

  const renderIcon = (): React.JSX.Element => {
    if (icon) {
      return (
        <span className="codicon-placeholder" aria-hidden="true">
          {icon}
        </span>
      )
    }
    if (checked) {
      return <span className="codicon codicon-check" aria-hidden="true" />
    }
    return <span className="codicon-placeholder" aria-hidden="true" />
  }

  const renderShortcut = (): React.ReactNode => {
    if (!shortcut) return null
    
    // Split the shortcut by common separators (+, -, space)
    const parts = shortcut.split(/([+\- ])/).filter(Boolean)
    
    return (
      <span
        className="keybinding"
        aria-label={`Keyboard shortcut: ${shortcut}`}
        {...(testId && { 'data-testid': `${testId}-shortcut` })}
      >
        {parts.map((part, index) => {
          // If it's a separator, render it as-is
          if (/^[+\- ]$/.test(part)) {
            return <span key={index}>{part}</span>
          }
          // Otherwise, wrap it in a kbd tag
          return <kbd key={index}>{part}</kbd>
        })}
      </span>
    )
  }

  const renderSubmenuIndicator = (): React.JSX.Element | null => {
    if (!hasSubmenu) return null
    return <span className="codicon codicon-chevron-right" aria-hidden="true" />
  }

  const itemClasses = [
    'action-menu-item',
    disabled ? 'disabled' : '',
    checked ? 'checked' : '',
    hasSubmenu ? 'submenu' : '',
    showSubmenu ? 'submenu-open' : '',
    className
  ].filter(Boolean).join(' ')

  return (
    <li 
      className={`action-item ${hasSubmenu ? 'submenu-item' : ''}`.trim()}
      role="presentation"
    >
      <a
        ref={itemRef}
        id={id}
        className={itemClasses}
        role="menuitem"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-checked={checked}
        aria-haspopup={hasSubmenu}
        aria-expanded={hasSubmenu ? showSubmenu : undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...(testId && {
          'data-testid': testId,
          'data-disabled': disabled ? 'true' : 'false',
          'data-checked': checked ? 'true' : 'false',
          'data-has-submenu': hasSubmenu ? 'true' : 'false',
          'data-submenu-open': showSubmenu ? 'true' : 'false'
        })}
      >
        <div className="menu-content">
          {renderIcon()}
          <span className="action-label" {...(testId && { 'data-testid': `${testId}-label` })}>{renderedTitle}</span>
        </div>
        <div className="menu-right">
          {renderShortcut()}
          {renderSubmenuIndicator()}
        </div>
      </a>

      {hasSubmenu && showSubmenu && (
        <div
          ref={submenuRef}
          className="menu menubar-menu-items-holder menu-container"
          style={{
            position: 'fixed',
            zIndex: 2000
          }}
          onMouseEnter={handleSubmenuMouseEnter}
          onMouseLeave={handleSubmenuMouseLeave}
          {...(testId && { 'data-testid': `${testId}-submenu` })}
        >
            <ScrollableElement
              options={{
                vertical: 'auto',
                horizontal: 'hidden',
                verticalScrollbarSize: 7,
                useShadows: true,
                handleMouseWheel: true
              }}
              style={{
                // Height is left to the content and clipped by the layout
                // effect above when the submenu is taller than the viewport.
                width: '300px',
                minWidth: '300px',
                maxWidth: '300px',
                padding: 0
              }}
              {...(testId && { 'data-testid': `${testId}-submenu-scrollable` })}
            >
            <ul className="actions-container" role="menu">
              {React.Children.map(children, (child, index) => {
                if (React.isValidElement(child)) {
                  const childTestId = (child.props as { 'data-testid'?: unknown })['data-testid']
                  return React.cloneElement(child, {
                    key: index,
                    ...(testId && childTestId === undefined && { 'data-testid': `${testId}-item-${index}` })
                  })
                }
                return child
              })}
            </ul>
            </ScrollableElement>
        </div>
      )}
    </li>
  )
}

// Stable identity for the native-menu template walker, which matches
// nodes by displayName rather than importing the components (avoids a
// renderer import cycle). Also improves React DevTools output.
MenuItem.displayName = 'MenuItem'

export default MenuItem
