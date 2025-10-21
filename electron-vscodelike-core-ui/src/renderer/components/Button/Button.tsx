import React, { useCallback, useRef } from 'react'
import './button.css'
import { IButtonOptions, IButtonStyles, ButtonProps, defaultButtonStyles } from './types'

const Button: React.FC<ButtonProps> = ({
  options,
  label = '',
  icon,
  onClick,
  onMouseEnter,
  onMouseLeave,
  className = '',
  id
}) => {
  const buttonRef = useRef<HTMLAnchorElement>(null)

  // Merge options with default styles
  const mergedOptions: IButtonOptions & IButtonStyles = {
    ...defaultButtonStyles,
    ...options
  }

  // Handle click events
  const handleClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    if (mergedOptions.disabled) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }, [mergedOptions.disabled, onClick])

  // Handle keyboard events
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (mergedOptions.disabled) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick?.(event as any)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      buttonRef.current?.blur()
    }
  }, [mergedOptions.disabled, onClick])

  // No need for hover/focus state management - CSS handles it

  // Render icon if provided
  const renderIcon = () => {
    if (!icon) return null
    return <span className={`codicon codicon-${icon}`} />
  }

  // Render label with icon support
  const renderLabel = () => {
    if (!label) return null

    // Simple icon parsing - look for $(iconName) pattern
    const iconRegex = /\$\(([^)]+)\)/g
    const parts = label.split(iconRegex)
    
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

  // Build CSS classes
  const buttonClasses = [
    'monaco-button',
    'monaco-text-button',
    mergedOptions.secondary ? 'secondary' : '',
    mergedOptions.disabled ? 'disabled' : '',
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
        className={buttonClasses}
        style={inlineStyles}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        title={typeof mergedOptions.title === 'string' ? mergedOptions.title : undefined}
        aria-label={mergedOptions.ariaLabel}
        role="button"
        tabIndex={mergedOptions.disabled ? -1 : 0}
        aria-disabled={mergedOptions.disabled}
      >
        {renderIcon()}
        {renderLabel()}
      </a>
    </div>
  )
}

export { Button }
export default Button
