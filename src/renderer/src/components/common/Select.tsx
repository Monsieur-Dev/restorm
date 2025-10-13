import React, { useState, useRef, useEffect } from 'react'
import { VscChevronDown } from 'react-icons/vsc'
import './Controls.css'

interface SelectProps {
  value: string
  options: string[]
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}

export const Select: React.FC<SelectProps> = ({
  value,
  options,
  onChange,
  className = '',
  placeholder = 'Select...'
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (
        selectRef.current &&
        !selectRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [isOpen])

  const handleSelect = (option: string): void => {
    onChange(option)
    setIsOpen(false)
  }

  const handleToggle = (): void => {
    setIsOpen(!isOpen)
  }

  return (
    <div className={`select-wrapper ${className}`} ref={selectRef}>
      <div
        className={`select-trigger ${isOpen ? 'select-trigger--open' : ''}`}
        onClick={handleToggle}
      >
        <span className="select-value">{value || placeholder}</span>
        <VscChevronDown className="select-icon" />
      </div>
      {isOpen && (
        <div className="select-dropdown" ref={dropdownRef}>
          {options.map((option) => (
            <div
              key={option}
              className={`select-option ${option === value ? 'select-option--selected' : ''}`}
              onClick={() => {
                handleSelect(option)
              }}
            >
              {option}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

