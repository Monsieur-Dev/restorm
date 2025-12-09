import React, { useState, useRef, useEffect, useCallback } from 'react'
import Button from './Button'
import { ButtonWithDropdownProps, IButtonOptions, defaultButtonStyles } from './types'

const ButtonWithDropdown: React.FC<ButtonWithDropdownProps> = ({
  options,
  label,
  icon,
  onClick,
  className = '',
  id
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => { document.removeEventListener('mousedown', handleClickOutside); }
    }
    return undefined
  }, [isDropdownOpen])

  // Handle primary button click
  const handlePrimaryClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    if (options.disabled) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }, [options.disabled, onClick])

  // Handle dropdown button click
  const handleDropdownClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    if (options.disabled) {
      event.preventDefault()
      return
    }
    event.stopPropagation()
    setIsDropdownOpen(!isDropdownOpen)
  }, [options.disabled, isDropdownOpen])

  // Handle action click
  const handleActionClick = useCallback((action: { label: string; onClick: () => void }) => {
    action.onClick()
    setIsDropdownOpen(false)
  }, [])

  // Merge options with default styles for separator
  const mergedOptions: IButtonOptions & typeof defaultButtonStyles = {
    ...defaultButtonStyles,
    ...options
  }

  // Build CSS classes
  const containerClasses = [
    'monaco-button-dropdown',
    'default-colors',
    options.disabled ? 'disabled' : '',
    className
  ].filter(Boolean).join(' ')

  // Separator styles
  const separatorStyles: React.CSSProperties = {
    backgroundColor: mergedOptions.secondary ? mergedOptions.buttonSecondaryBackground : mergedOptions.buttonBackground,
    borderTop: mergedOptions.buttonBorder ? `1px solid ${mergedOptions.buttonBorder}` : undefined,
    borderBottom: mergedOptions.buttonBorder ? `1px solid ${mergedOptions.buttonBorder}` : undefined
  }

  const separatorDivStyles: React.CSSProperties = {
    backgroundColor: mergedOptions.buttonSeparator
  }

  return (
    <div className="button-container" id={id}>
      <div ref={containerRef} className={containerClasses}>
        {/* Primary Button */}
        <a
          className="monaco-button monaco-text-button"
          role="button"
          tabIndex={0}
          onClick={handlePrimaryClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handlePrimaryClick(e as unknown as React.MouseEvent<HTMLAnchorElement>)
            }
          }}
          aria-disabled={options.disabled}
          aria-label={options.ariaLabel ?? label}
          style={{
            color: 'var(--ecui-button-foreground)',
            backgroundColor: 'var(--ecui-button-background)'
          }}
        >
          {icon && <span className={`codicon codicon-${icon}`} />}
          <span>{label}</span>
        </a>
        
        {/* Separator */}
        <div className="monaco-button-dropdown-separator" style={separatorStyles}>
          <div style={separatorDivStyles} />
        </div>
        
        {/* Dropdown Button */}
        <Button
          options={{
            ...options,
            title: 'More Actions...',
            supportIcons: true
          }}
          icon="chevron-down"
          onClick={handleDropdownClick}
          className="monaco-dropdown-button"
        />
        
        {/* Dropdown Menu */}
        {isDropdownOpen && (
          <div
            ref={dropdownRef}
            className="monaco-button-dropdown-menu"
          >
            {options.actions.map((action, index) => (
              <a
                key={index}
                className="monaco-button-dropdown-action"
                role="button"
                tabIndex={0}
                onClick={() => { handleActionClick(action); }}
              >
                {action.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export { ButtonWithDropdown }
export default ButtonWithDropdown
