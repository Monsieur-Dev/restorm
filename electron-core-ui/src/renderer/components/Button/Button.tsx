import React, { useCallback, useRef } from 'react'
import './button.css'
import { IButtonOptions, IButtonStyles, ButtonProps, defaultButtonStyles } from './types'

const Button: React.FC<ButtonProps> = ({
  options = {},
  icon,
  disabled = false,
  secondary = false,
  small = false,
  line = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  className = '',
  id,
  'data-testid': dataTestId,
  children
}) => {
  const buttonRef = useRef<HTMLAnchorElement>(null)

  // Merge options with default styles
  const mergedOptions: IButtonOptions & IButtonStyles = {
    ...defaultButtonStyles,
    ...options
  }

  // Handle click events
  const handleClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    if (disabled) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }, [disabled, onClick])

  // Handle keyboard events
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (disabled) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick?.(event as unknown as React.MouseEvent<HTMLAnchorElement>)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      buttonRef.current?.blur()
    }
  }, [disabled, onClick])

  // No need for hover/focus state management - CSS handles it

  // Render icon if provided
  const renderIcon = (): React.JSX.Element | null => {
    if (!icon) return null
    return <span className={`codicon codicon-${icon}`} />
  }

  // Render children with icon support
  const renderChildren = (): React.ReactNode => {
    if (!children) return null

    // If children is a string, parse for $(iconName) pattern
    if (typeof children === 'string') {
      const iconRegex = /\$\(([^)]+)\)/g
      const parts = children.split(iconRegex)
      
      return parts.map((part, index) => {
        if (index % 2 === 1) {
          // This is an icon name
          return <span key={index} className={`codicon codicon-${part}`} />
        } else {
          // This is text
          return part
        }
      })
    }

    // If children is not a string, render as-is
    return children
  }

  // Build CSS classes
  const buttonClasses = [
    'button',
    'text-button',
    small ? 'small-button' : '',
    line ? 'line-button' : '',
    secondary ? 'secondary' : '',
    disabled ? 'disabled' : '',
    'default-colors',
    className
  ].filter(Boolean).join(' ')

  // No inline styles - let CSS handle colors via CSS variables
  const inlineStyles: React.CSSProperties = {}

  return (
    <div className="button-container">
      <a
        ref={buttonRef}
        id={id}
        data-testid={dataTestId}
        className={buttonClasses}
        style={inlineStyles}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        title={typeof mergedOptions.title === 'string' ? mergedOptions.title : undefined}
        aria-label={mergedOptions.ariaLabel}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
      >
        {renderIcon()}
        {renderChildren()}
      </a>
    </div>
  )
}

export { Button }
export default Button
