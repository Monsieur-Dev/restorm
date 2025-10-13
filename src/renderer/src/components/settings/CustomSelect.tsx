import React, { useState, useRef, useEffect } from 'react'
import { VscChevronDown } from 'react-icons/vsc'

interface CustomSelectProps {
  value: string
  options: string[]
  onChange: (value: string) => void
  className?: string
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  options,
  onChange,
  className = ''
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
    <div className={`custom-select ${className}`} ref={selectRef}>
      <div
        className={`custom-select__trigger ${isOpen ? 'custom-select__trigger--open' : ''}`}
        onClick={handleToggle}
      >
        <span className="custom-select__value">{value}</span>
        <VscChevronDown className="custom-select__icon" />
      </div>
      {isOpen && (
        <div className="custom-select__dropdown" ref={dropdownRef}>
          {options.map((option) => (
            <div
              key={option}
              className={`custom-select__option ${option === value ? 'custom-select__option--selected' : ''}`}
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

