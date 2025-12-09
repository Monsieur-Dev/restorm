import React, { useState, useRef, useEffect } from 'react'

interface CustomDropdownOption {
  value: string
  label: React.ReactNode
}

interface CustomDropdownProps {
  id?: string
  value: string
  options: CustomDropdownOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

const CustomDropdown: React.FC<CustomDropdownProps> = ({
  id,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Select...'
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find(opt => opt.value === value)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (disabled) return

    switch (e.key) {
      case 'Enter':
      case ' ':
        if (!isOpen) {
          setIsOpen(true)
          setFocusedIndex(options.findIndex(opt => opt.value === value))
        } else if (focusedIndex >= 0 && options[focusedIndex]) {
          onChange(options[focusedIndex].value)
          setIsOpen(false)
        }
        e.preventDefault()
        break

      case 'Escape':
        setIsOpen(false)
        e.preventDefault()
        break

      case 'ArrowDown':
        if (!isOpen) {
          setIsOpen(true)
          setFocusedIndex(options.findIndex(opt => opt.value === value))
        } else {
          setFocusedIndex(prev => Math.min(prev + 1, options.length - 1))
        }
        e.preventDefault()
        break

      case 'ArrowUp':
        if (isOpen) {
          setFocusedIndex(prev => Math.max(prev - 1, 0))
        }
        e.preventDefault()
        break

      case 'Home':
        if (isOpen) {
          setFocusedIndex(0)
        }
        e.preventDefault()
        break

      case 'End':
        if (isOpen) {
          setFocusedIndex(options.length - 1)
        }
        e.preventDefault()
        break
    }
  }

  // Scroll focused item into view
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && listRef.current) {
      const focusedElement = listRef.current.children[focusedIndex] as HTMLElement | undefined
      focusedElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedIndex, isOpen])

  const handleOptionClick = (optionValue: string): void => {
    onChange(optionValue)
    setIsOpen(false)
  }

  return (
    <div
      ref={dropdownRef}
      id={id}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '400px'
      }}
    >
      {/* Dropdown button */}
      <div
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={`${id}-listbox`}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen)
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          backgroundColor: 'var(--vscode-dropdown-background)',
          color: 'var(--vscode-tab-active-text-color)',
          border: '1px solid var(--vscode-dropdown-border)',
          borderRadius: '2px',
          fontSize: '13px',
          fontFamily: 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          outline: 'none'
        }}
        onFocus={(e) => {
          e.currentTarget.style.outline = '1px solid var(--vscode-focusBorder)'
          e.currentTarget.style.outlineOffset = '-1px'
        }}
        onBlur={(e) => {
          e.currentTarget.style.outline = 'none'
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        {/* Chevron icon like VSCode */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
          style={{ marginLeft: '8px', flexShrink: 0, opacity: 0.8 }}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"
          />
        </svg>
      </div>

      {/* Dropdown list */}
      {isOpen && (
        <div
          ref={listRef}
          id={`${id}-listbox`}
          role="listbox"
          aria-activedescendant={focusedIndex >= 0 ? `${id}-option-${focusedIndex}` : undefined}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '4px',
            maxHeight: '300px',
            overflowY: 'auto',
            backgroundColor: 'var(--vscode-editor-background)',
            border: '1px solid var(--vscode-dropdown-border)',
            borderRadius: '2px',
            boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
            zIndex: 1000
          }}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                handleOptionClick(option.value)
              }}
              onMouseEnter={() => {
                setFocusedIndex(index)
              }}
              style={{
                padding: '3px 12px',
                fontSize: '13px',
                cursor: 'pointer',
                backgroundColor:
                  focusedIndex === index
                    ? 'var(--vscode-list-hoverBackground)'
                    : option.value === value
                    ? 'var(--vscode-list-activeSelectionBackground)'
                    : 'transparent',
                color:
                  option.value === value
                    ? 'var(--vscode-list-activeSelectionForeground)'
                    : 'var(--vscode-tab-active-text-color)',
                fontWeight: option.value === value ? '500' : '400',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default CustomDropdown

