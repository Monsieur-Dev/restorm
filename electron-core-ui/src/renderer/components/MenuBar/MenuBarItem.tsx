import React, { forwardRef, useRef, useState, useEffect, useLayoutEffect, useMemo } from 'react'
import { ScrollableElement } from '../ScrollableElement'
import { keyboardShortcutService } from '../../services/KeyboardShortcutService'
import { useOverlayPresence } from '../../hooks/useOverlayPresence'

interface MenuBarItemProps {
  /**
   * Top-level menu label. Accepts a ReactNode so the responsive
   * MenuBar can pass a codicon glyph for the overflow / hamburger
   * buttons. The Alt-mnemonic logic in `MenuBar` reads the rendered
   * `textContent`, so passing a string still works exactly as before.
   */
  title: React.ReactNode
  children?: React.ReactNode
  isFocused?: boolean
  isActive?: boolean
  /**
   * Whether THIS item is the bar's current roving-tabindex stop (see
   * `MenuBarState.tabStopIndex`). Drives `tabIndex` directly — unlike
   * `isFocused`, it stays true for the last-active item even while nothing
   * has actual DOM/keyboard focus, so the bar always has exactly one Tab
   * stop reachable from the rest of the UI.
   */
  isTabStop?: boolean
  onClick?: () => void
  onMouseEnter?: () => void
  className?: string
  id?: string
  'aria-label'?: string
  'data-testid'?: string
}

/** Extract shortcut info from MenuItem children recursively */
interface ShortcutInfo {
  shortcut: string
  onClick: () => void
  disabled: boolean
}

function extractShortcuts(children: React.ReactNode): ShortcutInfo[] {
  const shortcuts: ShortcutInfo[] = []
  
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    
    const props = child.props as Record<string, unknown>
    const shortcut = props['shortcut']
    const onClick = props['onClick']
    const disabled = props['disabled']
    const childChildren = props['children']
    
    // Check if this is a MenuItem with a shortcut
    if (shortcut && typeof shortcut === 'string' && typeof onClick === 'function') {
      shortcuts.push({
        shortcut,
        onClick: onClick as () => void,
        disabled: disabled === true
      })
    }
    
    // Recurse into children (for nested menus)
    if (childChildren) {
      shortcuts.push(...extractShortcuts(childChildren as React.ReactNode))
    }
  })
  
  return shortcuts
}

const MenuBarItem = forwardRef<HTMLDivElement, MenuBarItemProps>(({
  title,
  children,
  isFocused = false,
  isActive = false,
  isTabStop = false,
  onClick,
  onMouseEnter,
  className = '',
  id,
  'aria-label': ariaLabel,
  'data-testid': dataTestId
}, ref) => {
  const testId = dataTestId
  const titleRef = useRef<HTMLDivElement>(null)
  // Store the calculated height only when active (null means use 'auto')
  const [activeHeight, setActiveHeight] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const scrollableRef = useRef<HTMLDivElement>(null)

  // While the dropdown is open, register it with the overlay-presence
  // service so a main-process compositor view (the Mini browser's
  // `WebContentsView`) collapses out from under the fixed-position menu
  // instead of painting on top of it. Mirrors the submenu registration
  // in `MenuItem`.
  useOverlayPresence(scrollableRef, isActive)

  // Extract shortcuts from children and register them globally
  const shortcuts = useMemo(() => extractShortcuts(children), [children])
  
  // Create a stable key for shortcuts to avoid unnecessary re-registrations
  const shortcutsKey = useMemo(() => {
    return shortcuts
      .filter(s => !s.disabled)
      .map(s => s.shortcut)
      .sort()
      .join('|')
  }, [shortcuts])
  
  // Store shortcuts in ref for access in registration effect without re-triggering it
  const shortcutsRef = useRef(shortcuts)
  useEffect(() => {
    shortcutsRef.current = shortcuts
  }, [shortcuts])
  
  // Store handlers in a ref to avoid re-registration when only handlers change
  const handlersRef = useRef<Map<string, () => void>>(new Map())
  useEffect(() => {
    handlersRef.current.clear()
    for (const info of shortcuts) {
      if (!info.disabled) {
        handlersRef.current.set(info.shortcut.toLowerCase(), info.onClick)
      }
    }
  }, [shortcuts])
  
  // Register keyboard shortcuts - these stay active even when menu is closed
  useEffect(() => {
    const unregisters: (() => void)[] = []
    const currentShortcuts = shortcutsRef.current
    
    for (const info of currentShortcuts) {
      if (!info.disabled) {
        // Use a wrapper that calls the current handler from ref
        const handler = (): void => {
          const currentHandler = handlersRef.current.get(info.shortcut.toLowerCase())
          if (currentHandler) {
            currentHandler()
          }
        }
        const unregister = keyboardShortcutService.register(info.shortcut, handler)
        unregisters.push(unregister)
      }
    }
    
    return () => {
      for (const unregister of unregisters) {
        unregister()
      }
    }
  }, [shortcutsKey])

  // Derive effective height: 'auto' when not active, calculated value when active
  const calculatedHeight = isActive && activeHeight !== null ? activeHeight : 'auto'

  // Calculate menu position when becoming active
  useLayoutEffect(() => {
    if (isActive && titleRef.current) {
      const rect = titleRef.current.getBoundingClientRect()
      setMenuPosition({ left: rect.left, top: rect.bottom })
    }
  }, [isActive])

  const handleClick = (): void => {
    onClick?.()
  }

  const handleMouseEnter = (): void => {
    onMouseEnter?.()
  }

  const handleMouseLeave = (): void => {
    // Do nothing for top-level menus - they should only open on click
  }

  // Calculate dynamic height for scroll fix when active
  useEffect(() => {
    if (!isActive || !scrollableRef.current) {
      return
    }
    const timeoutId = setTimeout(() => {
      if (scrollableRef.current) {
        const rect = scrollableRef.current.getBoundingClientRect()
        const windowHeight = window.innerHeight
        const availableHeight = windowHeight - rect.top - 10
        const currentHeight = scrollableRef.current.scrollHeight

        if (availableHeight < currentHeight) {
          setActiveHeight(`${availableHeight}px`)
        } else {
          setActiveHeight(null)
        }
      }
    }, 0)
    return () => { clearTimeout(timeoutId) }
  }, [isActive])

  const buttonClasses = [
    'menubar-menu-button',
    isFocused ? 'focused' : '',
    isActive ? 'open' : '',
    className
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={ref}
      id={id}
      className={buttonClasses}
      role="menuitem"
      tabIndex={isTabStop ? 0 : -1}
      aria-haspopup={!!children}
      aria-expanded={isActive}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...(testId && {
        'data-testid': testId,
        'data-is-focused': isFocused ? 'true' : 'false',
        'data-is-active': isActive ? 'true' : 'false',
        'data-has-children': children ? 'true' : 'false'
      })}
    >
      <div
        ref={titleRef}
        className="menubar-menu-title"
        role="none"
        aria-hidden="true"
        {...(testId && { 'data-testid': `${testId}-title` })}
      >
        {title}
      </div>
      {children && isActive && (
        <div
          ref={scrollableRef}
          className="menu menubar-menu-items-holder menu-container"
          style={{
          position: 'fixed',
          zIndex: 2000,
          left: `${menuPosition.left}px`,
          top: `${menuPosition.top}px`
          }}
          {...(testId && { 'data-testid': `${testId}-menu` })}
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
              height: calculatedHeight,
              maxHeight: calculatedHeight,
              width: '300px',
              minWidth: '300px',
              maxWidth: '300px',
              padding: 0
            }}
            {...(testId && { 'data-testid': `${testId}-scrollable` })}
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
    </div>
  )
})

MenuBarItem.displayName = 'MenuBarItem'

export default MenuBarItem
