import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { MenuItemProps } from './types'
import { ScrollableElement } from '../ScrollableElement'

const MenuItem: React.FC<MenuItemProps> = ({
  title,
  shortcut,
  onClick,
  checked = false,
  disabled = false,
  icon,
  children,
  className = '',
  id
}) => {
  const [showSubmenu, setShowSubmenu] = useState(false)
  const itemRef = useRef<HTMLAnchorElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Store the calculated height only when submenu is shown (null means use 'auto')
  const [activeHeight, setActiveHeight] = useState<string | null>(null)
  const [submenuPosition, setSubmenuPosition] = useState({ left: 0, top: 0 })

  // Derive effective height: 'auto' when not shown, calculated value when shown
  const calculatedHeight = showSubmenu && activeHeight !== null ? activeHeight : 'auto'

  // Calculate submenu position when showing
  useLayoutEffect(() => {
    if (showSubmenu && itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect()
      setSubmenuPosition({ left: rect.right, top: rect.top })
    }
  }, [showSubmenu])

  const hasSubmenu = React.Children.count(children) > 0

  const handleClick = useCallback((event: React.MouseEvent): void => {
    if (disabled) {
      event.preventDefault()
      return
    }

    if (hasSubmenu) {
      event.preventDefault()
      return
    }

    onClick?.()
  }, [disabled, hasSubmenu, onClick])

  const handleKeyDown = useCallback((event: React.KeyboardEvent): void => {
    if (disabled) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (hasSubmenu) {
        setShowSubmenu(true)
      } else {
        onClick?.()
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
    if (!disabled && hasSubmenu) {
      // Clear any existing timeout
      if (submenuTimeoutRef.current) {
        clearTimeout(submenuTimeoutRef.current)
      }
      
      // Set timeout to show submenu after 300ms
      submenuTimeoutRef.current = setTimeout(() => {
        setShowSubmenu(true)
      }, 300)
    }
  }, [disabled, hasSubmenu])

  const handleMouseLeave = useCallback((): void => {
    // Clear the timeout for showing submenu
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current)
      submenuTimeoutRef.current = null
    }
    // Don't hide submenu when mouse leaves - keep it open
    // The submenu will only close when clicking outside or pressing Escape
  }, [])

  const handleSubmenuMouseEnter = useCallback((): void => {
    setShowSubmenu(true)
  }, [])

  const handleSubmenuMouseLeave = useCallback((): void => {
    // Don't hide submenu when mouse leaves submenu - keep it open
    // The submenu will only close when clicking outside or pressing Escape
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

  // Calculate dynamic height for scroll fix when submenu is shown
  useEffect(() => {
    if (!showSubmenu || !submenuRef.current) {
      return
    }
    const timeoutId = setTimeout(() => {
      if (submenuRef.current) {
        const rect = submenuRef.current.getBoundingClientRect()
        const windowHeight = window.innerHeight
        const availableHeight = windowHeight - rect.top - 10
        const currentHeight = submenuRef.current.scrollHeight
        
        if (availableHeight < currentHeight) {
          setActiveHeight(`${availableHeight}px`)
        } else {
          setActiveHeight(`${currentHeight}px`)
        }
      }
    }, 0)
    return () => { clearTimeout(timeoutId) }
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
    return (
      <span className="keybinding" aria-label={`Keyboard shortcut: ${shortcut}`}>
        {shortcut}
      </span>
    )
  }

  const renderSubmenuIndicator = (): React.JSX.Element => {
    if (!hasSubmenu) return <span className="codicon-placeholder" aria-hidden="true" />
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
      >
        <div className="menu-content">
          {renderIcon()}
          <span className="action-label">{title}</span>
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
            zIndex: 2000,
            left: `${submenuPosition.left}px`,
            top: `${submenuPosition.top}px`
          }}
          onMouseEnter={handleSubmenuMouseEnter}
          onMouseLeave={handleSubmenuMouseLeave}
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
                padding: '2px 0'
              }}
            >
            <ul className="actions-container" role="menu">
              {React.Children.map(children, (child, index) => {
                if (React.isValidElement(child)) {
                  return React.cloneElement(child, { key: index })
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

export default MenuItem
