import React, { forwardRef, useRef, useState, useEffect } from 'react'
import { ScrollableElement } from '../ScrollableElement'

interface MenuBarItemProps {
  title: string
  children?: React.ReactNode
  isFocused?: boolean
  isActive?: boolean
  onClick?: () => void
  onMouseEnter?: () => void
  className?: string
  id?: string
}

const MenuBarItem = forwardRef<HTMLDivElement, MenuBarItemProps>(({
  title,
  children,
  isFocused = false,
  isActive = false,
  onClick,
  onMouseEnter,
  className = '',
  id
}, ref) => {
  const titleRef = useRef<HTMLDivElement>(null)
  const [calculatedHeight, setCalculatedHeight] = useState<string>('auto')
  const scrollableRef = useRef<HTMLDivElement>(null)

  const handleClick = (): void => {
    onClick?.()
  }

  const handleMouseEnter = (): void => {
    onMouseEnter?.()
  }

  const handleMouseLeave = (): void => {
    // Do nothing for top-level menus - they should only open on click
  }

  // Calculate dynamic height for scroll fix
  useEffect(() => {
    if (isActive && scrollableRef.current) {
      setTimeout(() => {
        if (scrollableRef.current) {
          const rect = scrollableRef.current.getBoundingClientRect()
          const windowHeight = window.innerHeight
          const availableHeight = windowHeight - rect.top - 10
          const currentHeight = scrollableRef.current.scrollHeight

          if (availableHeight < currentHeight) {
            setCalculatedHeight(`${availableHeight}px`)
          } else {
            setCalculatedHeight('auto')
          }
        }
      }, 0)
    } else {
      setCalculatedHeight('auto')
    }
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
      tabIndex={isFocused ? 0 : -1}
      aria-haspopup={!!children}
      aria-expanded={isActive}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div ref={titleRef} className="menubar-menu-title" role="none" aria-hidden="true">
        {title}
      </div>
      {children && isActive && (
        <div ref={scrollableRef} className="monaco-menu menubar-menu-items-holder monaco-menu-container" style={{
          position: 'fixed',
          zIndex: 2000,
          left: `${titleRef.current?.getBoundingClientRect().left ?? 0}px`,
          top: `${titleRef.current?.getBoundingClientRect().bottom ?? 0}px`
        }}>
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
    </div>
  )
})

MenuBarItem.displayName = 'MenuBarItem'

export default MenuBarItem
