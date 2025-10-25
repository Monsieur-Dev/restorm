import React, { useState, useCallback, useRef, useEffect } from 'react'
import './menubar.css'
import { MenuBarProps, MenuBarState } from './types'

const MenuBar: React.FC<MenuBarProps> = ({
  children,
  className = '',
  id
}) => {
  const [state, setState] = useState<MenuBarState>({
    focusedMenuIndex: null,
    isOpen: false,
    activeMenuIndex: null
  })

  const menubarRef = useRef<HTMLDivElement>(null)
  const menuItemsRef = useRef<(HTMLDivElement | null)[]>([])

  const menuItems = React.Children.toArray(children)

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const { key } = event

    switch (key) {
      case 'ArrowLeft':
        event.preventDefault()
        setState(prev => ({
          ...prev,
          focusedMenuIndex: prev.focusedMenuIndex !== null 
            ? Math.max(0, prev.focusedMenuIndex - 1)
            : menuItems.length - 1
        }))
        break

      case 'ArrowRight':
        event.preventDefault()
        setState(prev => ({
          ...prev,
          focusedMenuIndex: prev.focusedMenuIndex !== null 
            ? Math.min(menuItems.length - 1, prev.focusedMenuIndex + 1)
            : 0
        }))
        break

      case 'ArrowDown':
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (state.focusedMenuIndex !== null) {
          setState(prev => ({
            ...prev,
            isOpen: true,
            activeMenuIndex: prev.focusedMenuIndex
          }))
        }
        break

      case 'Escape':
        event.preventDefault()
        setState({
          focusedMenuIndex: null,
          isOpen: false,
          activeMenuIndex: null
        })
        break

      case 'Tab':
        event.preventDefault()
        setState(prev => ({
          ...prev,
          focusedMenuIndex: prev.focusedMenuIndex !== null 
            ? (prev.focusedMenuIndex + 1) % menuItems.length
            : 0
        }))
        break

      default:
        // Handle Alt+key mnemonics
        if (event.altKey && key.length === 1) {
          const menuIndex = menuItems.findIndex((_, index) => {
            const menuElement = menuItemsRef.current[index]
            if (!menuElement) return false
            
            const titleElement = menuElement.querySelector('.menubar-menu-title')
            if (!titleElement) return false
            
            const title = titleElement.textContent?.toLowerCase() || ''
            return title.includes(key.toLowerCase())
          })

          if (menuIndex !== -1) {
            event.preventDefault()
            setState(prev => ({
              ...prev,
              focusedMenuIndex: menuIndex,
              isOpen: true,
              activeMenuIndex: menuIndex
            }))
          }
        }
        break
    }
  }, [menuItems, state.focusedMenuIndex])


  const handleMenuClick = useCallback((index: number) => {
    setState(prev => ({
      ...prev,
      focusedMenuIndex: index,
      isOpen: !prev.isOpen || prev.activeMenuIndex !== index,
      activeMenuIndex: !prev.isOpen || prev.activeMenuIndex !== index ? index : null
    }))
  }, [])

  const handleMenuMouseEnter = useCallback((index: number) => {
    setState(prev => {
      // Only open on hover if a menu is already open
      if (!prev.isOpen) {
        return prev
      }
      
      return {
        ...prev,
        focusedMenuIndex: index,
        isOpen: true,
        activeMenuIndex: index
      }
    })
  }, [])

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menubarRef.current && !menubarRef.current.contains(event.target as Node)) {
        setState({
          focusedMenuIndex: null,
          isOpen: false,
          activeMenuIndex: null
        })
      }
    }

    if (state.isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
    return undefined
  }, [state.isOpen])

  // Focus management
  useEffect(() => {
    if (state.focusedMenuIndex !== null && menuItemsRef.current[state.focusedMenuIndex]) {
      menuItemsRef.current[state.focusedMenuIndex]?.focus()
    }
  }, [state.focusedMenuIndex])

  const menubarClasses = [
    'menubar',
    className
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={menubarRef}
      id={id}
      className={menubarClasses}
      role="menubar"
      style={{
        width: 'fit-content',
        background: 'transparent'
      }}
      onKeyDown={handleKeyDown}
    >
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return child

        const isFocused = state.focusedMenuIndex === index
        const isActive = state.activeMenuIndex === index

        return React.cloneElement(child, {
          key: index,
          ref: (el: HTMLDivElement | null) => {
            menuItemsRef.current[index] = el
          },
          isFocused,
          isActive,
          onClick: () => handleMenuClick(index),
          onMouseEnter: () => handleMenuMouseEnter(index)
        })
      })}
    </div>
  )
}

export default MenuBar
